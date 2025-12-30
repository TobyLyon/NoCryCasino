import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createHash } from "crypto"
import { requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import {
  createLeaderboardSnapshot,
  saveLeaderboardSnapshot,
  getLeaderboardSnapshot,
  type WindowKey,
  type RankedKol,
} from "@/lib/analytics/snapshot"

export const runtime = "nodejs"

type SettleBody = {
  window_key?: WindowKey | "all"
  closes_before?: string
  limit?: number
  dry_run?: boolean
  top_n?: number
  settlement_nonce?: string
  use_snapshot?: boolean
  apply_anti_manipulation?: boolean
}

type MarketRow = {
  id: string
  window_key: WindowKey
  kol_wallet_address: string
  closes_at: string
  status: "open" | "closed" | "settled" | "cancelled"
  settlement_nonce: string | null
}

let solPriceCache: { value: number; ts: number } | null = null

async function getSolPriceUsd(): Promise<number> {
  const now = Date.now()
  if (solPriceCache && now - solPriceCache.ts < 60_000) return solPriceCache.value

  try {
    const timeoutMs = 7_000

    const fetchJson = async (url: string) => {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, {
          next: { revalidate: 60 },
          headers: {
            accept: "application/json",
            "user-agent": "trade-wars/1.0",
          },
          signal: controller.signal,
        })
        return { res, json: (await res.json().catch(() => null)) as any }
      } finally {
        clearTimeout(t)
      }
    }

    // 1) CoinGecko
    {
      const { res, json } = await fetchJson(
        "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
      )
      const v = Number(json?.solana?.usd)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        solPriceCache = { value: price, ts: now }
        return price
      }
    }

    // 2) Jupiter
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

function generateSettlementNonce(window_key: WindowKey, closes_at: string): string {
  const data = `${window_key}::${closes_at}::${Date.now()}`
  return createHash("sha256").update(data).digest("hex").slice(0, 16)
}

function computeSettlementHash(updates: Array<{ id: string; resolved_outcome: string; resolved_rank: number | null }>): string {
  const data = JSON.stringify(updates.map((u) => ({ id: u.id, o: u.resolved_outcome, r: u.resolved_rank })))
  return createHash("sha256").update(data).digest("hex").slice(0, 32)
}

export async function POST(request: NextRequest) {
  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as SettleBody

    const windowRaw = body?.window_key ?? "all"
    const windows: WindowKey[] =
      windowRaw === "daily" || windowRaw === "weekly" || windowRaw === "monthly"
        ? [windowRaw]
        : ["daily", "weekly", "monthly"]

    const closes_before =
      typeof body?.closes_before === "string" && body.closes_before.length > 0 ? body.closes_before : new Date().toISOString()

    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : 500
    const dry_run = body?.dry_run === true
    const top_n = typeof body?.top_n === "number" && Number.isFinite(body.top_n) && body.top_n > 0 ? Math.floor(body.top_n) : 3
    const use_snapshot = body?.use_snapshot !== false // default true
    const apply_anti_manipulation = body?.apply_anti_manipulation !== false // default true

    // Fetch markets to settle
    const { data: markets, error: marketsError } = await supabase
      .from("wager_markets")
      .select("id, window_key, kol_wallet_address, closes_at, status, settlement_nonce")
      .in("window_key", windows)
      .lte("closes_at", closes_before)
      .in("status", ["open", "closed"])
      .is("settled_at", null)
      .order("closes_at", { ascending: true })
      .limit(limit)

    if (marketsError) return NextResponse.json({ error: marketsError.message }, { status: 500 })

    // Group markets by window+closes_at
    const byGroup = new Map<string, MarketRow[]>()
    for (const m of (markets ?? []) as any[]) {
      const key = `${m.window_key}::${m.closes_at}`
      const arr = byGroup.get(key) ?? []
      arr.push(m as MarketRow)
      byGroup.set(key, arr)
    }

    const solPriceUsd = await getSolPriceUsd()
    const results: any[] = []
    let totalSettled = 0

    for (const [key, group] of byGroup.entries()) {
      const [window_key, closes_at] = key.split("::") as [WindowKey, string]

      // Check for existing snapshot or create new one
      let snapshot = use_snapshot ? await getLeaderboardSnapshot({ window_key, closes_at }) : null

      if (!snapshot) {
        snapshot = await createLeaderboardSnapshot({
          window_key,
          closes_at,
          sol_price_usd: solPriceUsd,
          apply_anti_manipulation,
        })

        // Save snapshot for audit trail
        if (!dry_run && use_snapshot) {
          await saveLeaderboardSnapshot(snapshot)
        }
      }

      const rankByWallet = new Map(snapshot.rankings.map((r) => [r.wallet_address, r]))

      // Generate settlement nonce for idempotency
      const settlement_nonce = body?.settlement_nonce ?? generateSettlementNonce(window_key, closes_at)

      const updates = group.map((m) => {
        const r = rankByWallet.get(m.kol_wallet_address)
        const resolved_rank = r?.rank ?? null
        const resolved_profit_sol = r?.profit_sol ?? null
        const is_eligible = r?.is_eligible ?? true

        // Only eligible KOLs can win; ineligible KOLs resolve NO regardless of rank
        const yes = is_eligible && typeof resolved_rank === "number" ? resolved_rank <= top_n : false

        return {
          id: m.id,
          status: "settled" as const,
          settled_at: new Date().toISOString(),
          resolved_outcome: yes ? ("yes" as const) : ("no" as const),
          resolved_rank,
          resolved_profit_sol,
          resolved_profit_usd: typeof resolved_profit_sol === "number" ? resolved_profit_sol * solPriceUsd : null,
          snapshot_at: snapshot!.snapshot_at,
          snapshot_hash: snapshot!.snapshot_hash,
          settlement_hash: "", // Will be computed below
          settlement_nonce,
        }
      })

      // Compute settlement hash for integrity verification
      const settlement_hash = computeSettlementHash(updates)
      updates.forEach((u) => {
        u.settlement_hash = settlement_hash
      })

      if (!dry_run && updates.length > 0) {
        // Check for duplicate settlement nonce (idempotency)
        const { data: existing } = await supabase
          .from("wager_markets")
          .select("id")
          .eq("settlement_nonce", settlement_nonce)
          .limit(1)

        if (existing && existing.length > 0) {
          results.push({
            window_key,
            closes_at,
            error: "Settlement already processed (duplicate nonce)",
            settlement_nonce,
          })
          continue
        }

        const { error: upError } = await supabase.from("wager_markets").upsert(updates, { onConflict: "id" })
        if (upError) return NextResponse.json({ error: upError.message }, { status: 500 })
      }

      // Find winners for response
      const eligibleRanked = snapshot.rankings.filter((r) => r.is_eligible)
      const winners = eligibleRanked.slice(0, top_n).map((r) => r.wallet_address)

      totalSettled += updates.length
      results.push({
        window_key,
        closes_at,
        snapshot_hash: snapshot.snapshot_hash,
        settlement_hash,
        settlement_nonce,
        winners,
        settled_count: updates.length,
        disqualified_count: snapshot.rankings.filter((r) => !r.is_eligible).length,
      })
    }

    return NextResponse.json({
      ok: true,
      dry_run,
      use_snapshot,
      apply_anti_manipulation,
      top_n,
      total_groups: results.length,
      total_settled: totalSettled,
      results,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
