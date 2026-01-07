import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { computeRealizedTradePnL, extractTradeLeg, isTradeLike, type TradeLeg } from "@/lib/analytics/kolscan-pnl"

export const runtime = "nodejs"

type Body = {
  tournament_id?: string
  dry_run?: boolean
  max_events?: number
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
          headers: { accept: "application/json", "user-agent": "trade-wars/1.0" },
          signal: controller.signal,
        })
        const json = (await res.json().catch(() => null)) as any
        return { res, json }
      } finally {
        clearTimeout(t)
      }
    }

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

function metricForType(tournament_type: string): "roi" | "pnl" | "volume" | "wins" {
  const t = String(tournament_type ?? "").toLowerCase()
  if (t === "volume_race") return "volume"
  if (t === "pnl_absolute" || t === "pnl_race") return "pnl"
  if (t === "consecutive_wins") return "wins"
  return "roi"
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  const s = Math.max(1, Math.floor(size))
  for (let i = 0; i < arr.length; i += s) out.push(arr.slice(i, i + s))
  return out
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:tournaments:recompute-standings", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as Body

    const tournament_id = typeof body?.tournament_id === "string" ? body.tournament_id.trim() : ""
    if (!tournament_id) return NextResponse.json({ error: "Missing tournament_id" }, { status: 400 })

    const dry_run = body?.dry_run === true
    const max_events =
      typeof body?.max_events === "number" && Number.isFinite(body.max_events) && body.max_events > 0
        ? Math.min(100_000, Math.floor(body.max_events))
        : 50_000

    const { data: tournament, error: tErr } = await supabase
      .from("tournaments")
      .select("id, status, tournament_type, start_date, end_date")
      .eq("id", tournament_id)
      .maybeSingle()

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 })

    const startIso = tournament.start_date ? new Date(String(tournament.start_date)).toISOString() : null
    if (!startIso) return NextResponse.json({ error: "Tournament missing start_date" }, { status: 400 })

    const endRaw = tournament.end_date ? new Date(String(tournament.end_date)).toISOString() : null
    const nowIso = new Date().toISOString()
    const endIso = endRaw && Date.parse(endRaw) < Date.parse(nowIso) ? endRaw : nowIso

    const { data: entries, error: eErr } = await supabase
      .from("tournament_entries")
      .select("id, wallet_address, entry_amount, consecutive_wins")
      .eq("tournament_id", tournament_id)
      .limit(5000)

    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

    const entryRows = (entries ?? []) as Array<{
      id: string
      wallet_address: string
      entry_amount: number
      consecutive_wins: number
    }>

    if (entryRows.length === 0) {
      return NextResponse.json({ ok: true, dry_run, tournament_id, updated_count: 0, message: "No entries" })
    }

    const wallets = Array.from(
      new Set(entryRows.map((e) => String(e.wallet_address)).filter((w) => w.length > 0)),
    )
    const walletSet = new Set(wallets)

    const solPriceUsd = await getSolPriceUsd()

    const events: any[] = []
    const walletChunks = chunk(wallets, 500)

    for (const wChunk of walletChunks) {
      if (events.length >= max_events) break
      const remaining = Math.max(0, max_events - events.length)

      const { data: chunkEvents, error: evErr } = await supabase
        .from("tx_events")
        .select("signature, block_time, raw, tx_event_tracked_wallets!inner(wallet_address)")
        .gte("block_time", startIso)
        .lt("block_time", endIso)
        .in("tx_event_tracked_wallets.wallet_address", wChunk)
        .order("block_time", { ascending: false })
        .limit(remaining)

      if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 })

      if (Array.isArray(chunkEvents) && chunkEvents.length > 0) {
        events.push(...chunkEvents)
      }
    }

    const walletLegs = new Map<string, TradeLeg[]>()
    const seenSigs = new Map<string, Set<string>>()

    for (const evt of (events ?? []) as any[]) {
      const raw = evt?.raw
      const links = Array.isArray(evt?.tx_event_tracked_wallets) ? evt.tx_event_tracked_wallets : []
      const sig = String(evt?.signature ?? "")
      const blockTimeMs = evt?.block_time ? new Date(String(evt.block_time)).getTime() : Date.now()

      for (const l of links) {
        const wallet = typeof l?.wallet_address === "string" ? l.wallet_address : ""
        if (!wallet || !walletSet.has(wallet)) continue

        let seen = seenSigs.get(wallet)
        if (!seen) {
          seen = new Set()
          seenSigs.set(wallet, seen)
        }
        if (seen.has(sig)) continue
        seen.add(sig)

        if (isTradeLike(raw, wallet)) {
          const leg = extractTradeLeg(raw, wallet, blockTimeMs, solPriceUsd)
          if (leg) {
            const arr = walletLegs.get(wallet) ?? []
            arr.push(leg)
            walletLegs.set(wallet, arr)
          }
        }
      }
    }

    const byWallet = new Map<string, { pnl: number; roi: number; volume: number }>()
    for (const e of entryRows) {
      const wallet = String(e.wallet_address)
      const legs = walletLegs.get(wallet) ?? []
      const realized = computeRealizedTradePnL(legs)
      const pnl = realized.realized_lamports / 1e9
      const entryAmount = Number(e.entry_amount)
      const roi = entryAmount > 0 && Number.isFinite(entryAmount) ? (pnl / entryAmount) * 100 : 0
      const volume = realized.volume_lamports / 1e9
      byWallet.set(wallet, { pnl, roi, volume })
    }

    const metric = metricForType((tournament as any)?.tournament_type)

    const computed = entryRows.map((e) => {
      const m = byWallet.get(String(e.wallet_address)) ?? { pnl: 0, roi: 0, volume: 0 }
      return {
        id: e.id,
        wallet_address: e.wallet_address,
        entry_amount: e.entry_amount,
        consecutive_wins: e.consecutive_wins,
        current_pnl: m.pnl,
        current_roi: m.roi,
        current_volume: m.volume,
        rank: 0,
      }
    })

    computed.sort((a, b) => {
      const av =
        metric === "volume" ? Number(a.current_volume) : metric === "pnl" ? Number(a.current_pnl) : metric === "wins" ? Number(a.consecutive_wins) : Number(a.current_roi)
      const bv =
        metric === "volume" ? Number(b.current_volume) : metric === "pnl" ? Number(b.current_pnl) : metric === "wins" ? Number(b.consecutive_wins) : Number(b.current_roi)
      if (bv !== av) return bv - av
      return String(a.wallet_address).localeCompare(String(b.wallet_address))
    })

    computed.forEach((r, idx) => {
      r.rank = idx + 1
    })

    if (dry_run) {
      return NextResponse.json({
        ok: true,
        dry_run,
        tournament_id,
        start: startIso,
        end: endIso,
        sol_price_usd: solPriceUsd,
        entry_count: entryRows.length,
        event_count: Array.isArray(events) ? events.length : 0,
        metric,
        top: computed.slice(0, 10).map((x) => ({ wallet: x.wallet_address, rank: x.rank, roi: x.current_roi, pnl: x.current_pnl, volume: x.current_volume })),
      })
    }

    const updates = computed.map((r) => ({
      id: r.id,
      current_pnl: r.current_pnl,
      current_roi: r.current_roi,
      current_volume: r.current_volume,
      rank: r.rank,
      updated_at: new Date().toISOString(),
    }))

    const { error: upErr } = await supabase.from("tournament_entries").upsert(updates, { onConflict: "id" })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, dry_run, tournament_id, updated_count: updates.length, metric })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
