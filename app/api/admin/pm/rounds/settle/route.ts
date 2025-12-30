import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { createLeaderboardSnapshot, getLeaderboardSnapshot, saveLeaderboardSnapshot, type WindowKey } from "@/lib/analytics/snapshot"

export const runtime = "nodejs"

type Body = {
  round_id?: string
  settle_before?: string
  limit?: number
  top_n?: number
  use_snapshot?: boolean
  apply_anti_manipulation?: boolean
  dry_run?: boolean
}

function windowKeyForMarketType(market_type: string): WindowKey {
  const mt = String(market_type).toUpperCase()
  if (mt === "WEEKLY") return "weekly"
  if (mt === "MONTHLY") return "monthly"
  return "daily"
}

let solPriceCache: { value: number; ts: number } | null = null

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (solPriceCache && now - solPriceCache.ts < 60_000) return solPriceCache.value

  const timeoutMs = 7_000

  const fetchJson = async (url: string) => {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        headers: {
          accept: "application/json",
          "user-agent": "nocrycasino/1.0",
        },
        signal: controller.signal,
      })
      return { res, json: (await res.json().catch(() => null)) as any }
    } finally {
      clearTimeout(t)
    }
  }

  try {
    {
      const { res, json } = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd")
      const v = Number(json?.solana?.usd)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        solPriceCache = { value: price, ts: now }
        return price
      }
    }

    {
      const { res, json } = await fetchJson("https://price.jup.ag/v4/price?ids=SOL")
      const v = Number(json?.data?.SOL?.price)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        solPriceCache = { value: price, ts: now }
        return price
      }
    }

    return solPriceCache?.value ?? 124
  } catch {
    return solPriceCache?.value ?? 124
  }
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:rounds:settle", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const dry_run = body?.dry_run === true
    const settle_before =
      typeof body?.settle_before === "string" && body.settle_before.length > 0
        ? body.settle_before
        : new Date().toISOString()

    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(100, Math.floor(body.limit)) : 25
    const top_n = typeof body?.top_n === "number" && Number.isFinite(body.top_n) && body.top_n > 0 ? Math.min(25, Math.floor(body.top_n)) : 3

    const use_snapshot = body?.use_snapshot !== false
    const apply_anti_manipulation = body?.apply_anti_manipulation !== false

    const solPriceUsd = await getSolPriceUsd()

    const supabase = createServiceClient()

    let q = supabase
      .from("market_rounds")
      .select("round_id, market_type, lock_ts, settle_ts, status")
      .in("status", ["LOCKED", "SETTLING"])
      .lte("settle_ts", settle_before)
      .order("settle_ts", { ascending: true })
      .limit(limit)

    if (typeof body?.round_id === "string" && body.round_id.length > 0) {
      q = q.eq("round_id", body.round_id)
    }

    const { data: rounds, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = Array.isArray(rounds) ? rounds : []
    const results: any[] = []

    for (const r of rows) {
      const window_key = windowKeyForMarketType(r.market_type)
      const closes_at = new Date(String(r.lock_ts)).toISOString()

      let snapshot = use_snapshot ? await getLeaderboardSnapshot({ window_key, closes_at }) : null
      if (!snapshot) {
        snapshot = await createLeaderboardSnapshot({ window_key, closes_at, sol_price_usd: solPriceUsd, apply_anti_manipulation })
        if (!dry_run && use_snapshot) {
          await saveLeaderboardSnapshot(snapshot)
        }
      }

      const eligible = snapshot.rankings.filter((x) => x.is_eligible)
      const winners = eligible.slice(0, top_n).map((x) => x.wallet_address)

      if (!dry_run) {
        await supabase.from("market_rounds").update({ status: "SETTLING", snapshot_hash: snapshot.snapshot_hash }).eq("round_id", r.round_id)

        const { data: outcomeRows, error: outErr } = await supabase
          .from("outcome_markets")
          .select("outcome_id, kol_wallet_address")
          .eq("round_id", r.round_id)
          .limit(5000)

        if (outErr) return NextResponse.json({ error: outErr.message }, { status: 500 })

        const outs = Array.isArray(outcomeRows) ? outcomeRows : []
        const winSet = new Set(winners)

        const updates = outs.map((o: any) => ({
          outcome_id: o.outcome_id,
          status: "SETTLED" as const,
          final_outcome: winSet.has(String(o.kol_wallet_address)),
        }))

        const { error: upErr } = await supabase.from("outcome_markets").upsert(updates, { onConflict: "outcome_id" })
        if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

        const { error: roundUpErr } = await supabase
          .from("market_rounds")
          .update({ status: "SETTLED", snapshot_hash: snapshot.snapshot_hash })
          .eq("round_id", r.round_id)

        if (roundUpErr) return NextResponse.json({ error: roundUpErr.message }, { status: 500 })
      }

      results.push({ round_id: r.round_id, window_key, closes_at, snapshot_hash: snapshot.snapshot_hash, winners })
    }

    return NextResponse.json({ ok: true, dry_run, settled: results.length, results, top_n })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
