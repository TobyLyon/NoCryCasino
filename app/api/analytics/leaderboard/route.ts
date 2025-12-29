import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { analyzeWalletPnL, aggregateWalletPnL, type WalletPnL } from "@/lib/analytics/token-pnl"
import { rateLimit } from "@/lib/api/guards"

type TimeFrame = "daily" | "weekly" | "monthly"

type KolRow = {
  wallet_address: string
  display_name: string | null
  avatar_url: string | null
  twitter_handle: string | null
  twitter_url: string | null
  telegram_url: string | null
  tracked_from: string | null
  wallet_created_at: string | null
}

type LeaderboardRow = {
  rank: number
  wallet_address: string
  display_name: string | null
  avatar_url: string | null
  twitter_handle: string | null
  twitter_url: string | null
  telegram_url: string | null
  wins: number
  losses: number
  profit_sol: number
  profit_usd: number
  tx_count: number
  swap_volume_sol: number
  unique_counterparties: number
  is_eligible: boolean
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
      console.error("SOL price (CoinGecko) failed", { status: res.status, ok: res.ok })
    }

    // 2) Jupiter fallback (no API key)
    {
      const { res, json } = await fetchJson("https://price.jup.ag/v4/price?ids=SOL")
      const v = Number(json?.data?.SOL?.price)
      const price = Number.isFinite(v) && v > 0 ? v : 0
      if (res.ok && price > 0) {
        solPriceCache = { value: price, ts: now }
        return price
      }
      console.error("SOL price (Jupiter) failed", { status: res.status, ok: res.ok })
    }

    // 3) Fallback to last known, else a sane default
    return solPriceCache?.value ?? 124
  } catch (e) {
    console.error("SOL price fetch unexpected error", e)
    return solPriceCache?.value ?? 124
  }
}

function timeframeToCutoffIso(timeframe: TimeFrame): string {
  const tz = "America/New_York"

  const dtfParts = (date: Date) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
    const parts = fmt.formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value
    const year = Number(get("year") ?? 0)
    const month = Number(get("month") ?? 0)
    const day = Number(get("day") ?? 0)
    const hour = Number(get("hour") ?? 0)
    const minute = Number(get("minute") ?? 0)
    const second = Number(get("second") ?? 0)
    const weekdayRaw = String(get("weekday") ?? "")
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const weekday = weekdayMap[weekdayRaw] ?? 0
    return { year, month, day, hour, minute, second, weekday }
  }

  const getTimeZoneOffsetMs = (date: Date) => {
    const p = dtfParts(date)
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    return asUtc - date.getTime()
  }

  const zonedTimeToUtcMs = (args: { year: number; month: number; day: number; hour: number; minute: number; second: number }) => {
    const base = Date.UTC(args.year, args.month - 1, args.day, args.hour, args.minute, args.second)
    let utc = base
    for (let i = 0; i < 2; i += 1) {
      const off = getTimeZoneOffsetMs(new Date(utc))
      utc = base - off
    }
    return utc
  }

  const now = new Date()
  if (timeframe === "monthly") {
    const dayMs = 24 * 60 * 60 * 1000
    return new Date(now.getTime() - 30 * dayMs).toISOString()
  }

  const p = dtfParts(now)
  const todayUtcBase = Date.UTC(p.year, p.month - 1, p.day)

  if (timeframe === "daily") {
    return new Date(zonedTimeToUtcMs({ year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 })).toISOString()
  }

  const daysSinceMonday = (p.weekday + 6) % 7
  const mondayUtcBase = todayUtcBase - daysSinceMonday * 24 * 60 * 60 * 1000
  const monday = new Date(mondayUtcBase)
  const y = monday.getUTCFullYear()
  const m = monday.getUTCMonth() + 1
  const d = monday.getUTCDate()
  return new Date(zonedTimeToUtcMs({ year: y, month: m, day: d, hour: 0, minute: 0, second: 0 })).toISOString()
}

export async function GET(request: NextRequest) {
  const limited = rateLimit({ request, key: "analytics:leaderboard", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  try {
    const url = new URL(request.url)
    const timeframeRaw = (url.searchParams.get("timeframe") || "daily").toLowerCase()
    const timeframe: TimeFrame =
      timeframeRaw === "weekly" ? "weekly" : timeframeRaw === "monthly" ? "monthly" : "daily"

    const cutoffIso = timeframeToCutoffIso(timeframe)

    const supabase = createServiceClient()

    const [{ data: kols, error: kolsError }, solPriceUsd] = await Promise.all([
      supabase
        .from("kols")
        .select("wallet_address, display_name, avatar_url, twitter_handle, twitter_url, telegram_url, tracked_from, wallet_created_at")
        .eq("is_active", true)
        .eq("is_tracked", true)
        .order("tracked_rank", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(200),
      getSolPriceUsd(),
    ])

    if (kolsError) {
      return NextResponse.json({ error: kolsError.message }, { status: 500 })
    }

    const tracked = (kols ?? []) as KolRow[]
    const trackedSet = new Set(tracked.map((k) => k.wallet_address))
    const kolMap = new Map(tracked.map((k) => [k.wallet_address, k]))

    const { data: events, error: eventsError } = await supabase
      .from("tx_events")
      .select("signature, block_time, raw, tx_event_wallets(wallet_address)")
      .gte("block_time", cutoffIso)
      .order("block_time", { ascending: false })
      .limit(10000)

    if (eventsError) {
      return NextResponse.json({ error: eventsError.message }, { status: 500 })
    }

    // Use new token PnL analytics
    const walletPnLs = new Map<string, WalletPnL[]>()
    const seenSigs = new Map<string, Set<string>>()

    for (const evt of (events ?? []) as any[]) {
      const raw = evt?.raw
      const links = Array.isArray(evt?.tx_event_wallets) ? evt.tx_event_wallets : []
      const sig = String(evt?.signature ?? "")

      for (const l of links) {
        const wallet = l?.wallet_address
        if (typeof wallet !== "string" || !trackedSet.has(wallet)) continue

        // Dedupe by signature per wallet
        let seen = seenSigs.get(wallet)
        if (!seen) {
          seen = new Set()
          seenSigs.set(wallet, seen)
        }
        if (seen.has(sig)) continue
        seen.add(sig)

        // Analyze with full token PnL (native + token transfers + swaps)
        const pnl = analyzeWalletPnL(raw, wallet)
        const arr = walletPnLs.get(wallet) ?? []
        arr.push(pnl)
        walletPnLs.set(wallet, arr)
      }
    }

    const rows: LeaderboardRow[] = tracked
      .map((k) => {
        const pnls = walletPnLs.get(k.wallet_address) ?? []
        const agg = aggregateWalletPnL(pnls)
        const profit_sol = agg.net_sol_lamports / 1e9

        // Basic eligibility check (wallet age)
        let is_eligible = true
        if (k.wallet_created_at) {
          const created = new Date(k.wallet_created_at)
          const now = new Date()
          const ageDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
          if (ageDays < 7) is_eligible = false
        }

        // Self-transfer ratio check
        const selfTransferCount = pnls.filter((p) => p.is_self_transfer).length
        if (agg.tx_count > 0 && selfTransferCount / agg.tx_count > 0.1) {
          is_eligible = false
        }

        return {
          rank: 0,
          wallet_address: k.wallet_address,
          display_name: k.display_name,
          avatar_url: k.avatar_url,
          twitter_handle: k.twitter_handle,
          twitter_url: k.twitter_url,
          telegram_url: k.telegram_url,
          wins: agg.wins,
          losses: agg.losses,
          profit_sol,
          profit_usd: profit_sol * solPriceUsd,
          tx_count: agg.tx_count,
          swap_volume_sol: agg.swap_volume_sol,
          unique_counterparties: agg.counterparties.size,
          is_eligible,
        }
      })
      .sort((a, b) => {
        // Eligible wallets rank higher
        if (a.is_eligible !== b.is_eligible) return a.is_eligible ? -1 : 1
        // Then by profit
        return b.profit_sol - a.profit_sol
      })
      .map((r, idx) => ({ ...r, rank: idx + 1 }))

    return NextResponse.json({ ok: true, timeframe, solPriceUsd, rows })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
