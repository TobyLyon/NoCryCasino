import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { computeNetSolLamports, computeTokenTransfers } from "@/lib/analytics/token-pnl"
import { rateLimit } from "@/lib/api/guards"

type CacheEntry = { expiresAt: number; payload: any }

const leaderboardCache = new Map<string, CacheEntry>()

function getCacheTtlMs(timeframe: TimeFrame): number {
  if (timeframe === "daily") return 15_000
  if (timeframe === "weekly") return 30_000
  return 60_000
}

type TimeFrame = "daily" | "weekly" | "monthly"

type DropReason =
  | "not_trade_like"
  | "no_sol_delta"
  | "no_nonstable_token_delta"
  | "invalid_token_amount"

const DEBUG_TARGET_WALLETS = {
  Pain: "J6TDXvarvpBdPXTaTU8eJbtso1PUCYKGkVtMKUUY8iEa",
  Casino: "8rvAsDKeAcEjEkiZMug9k8v1y8mW6gQQiMobd89Uy7qR",
  Robo: "4ZdCpHJrSn4E9GmfP8jjfsAExHGja2TEn4JmXfEeNtyT",
  Jijo: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk",
  clukz: "G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC",
} as const

const WSOL_MINT = "So11111111111111111111111111111111111111112"

const STABLE_MINTS = new Set([
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "USD1ttGY1N17NEEHLmELoaybftRBUSErhqYiQzvEmuB",
])

const DEX_SOURCES = new Set([
  "PUMP_FUN",
  "PUMP_AMM",
  "JUPITER",
  "RAYDIUM",
  "ORCA",
  "LIFINITY",
  "MERCURIAL",
  "SABER",
  "SAROS",
  "CREMA",
  "ALDRIN",
  "CYKURA",
])

type TradeLeg = {
  token_mint: string
  side: "buy" | "sell"
  token_amount: number
  sol_change_lamports: number
  block_time_ms: number
}

function computeTradeSolChangeLamports(raw: any, wallet: string, solPriceUsd: number): number {
  let netStrict = 0
  let sawSwapNativeStrict = false

  let netRelaxed = 0
  let sawSwapNativeRelaxed = false

  const walkSwap = (s: any) => {
    if (!s) return
    const ni = s?.nativeInput
    const no = s?.nativeOutput

    const inAmt = Number(ni?.amount)
    if (Number.isFinite(inAmt) && inAmt !== 0) {
      netRelaxed -= inAmt
      sawSwapNativeRelaxed = true
      if (ni?.account === wallet) {
        netStrict -= inAmt
        sawSwapNativeStrict = true
      }
    }

    const outAmt = Number(no?.amount)
    if (Number.isFinite(outAmt) && outAmt !== 0) {
      netRelaxed += outAmt
      sawSwapNativeRelaxed = true
      if (no?.account === wallet) {
        netStrict += outAmt
        sawSwapNativeStrict = true
      }
    }
    const inner = s?.innerSwaps
    if (Array.isArray(inner)) {
      for (const x of inner) walkSwap(x)
    }
  }

  walkSwap(raw?.events?.swap)
  if (sawSwapNativeStrict && netStrict !== 0) return netStrict

  const source = typeof raw?.source === "string" ? raw.source : ""
  if (source === "JUPITER" && sawSwapNativeRelaxed && netRelaxed !== 0) return netRelaxed

  const wsolDeltaSol = computeTokenTransfers(raw, wallet)
    .filter((t) => t.mint === WSOL_MINT)
    .reduce((sum, t) => sum + t.net_amount, 0)
  const wsolDeltaLamports = Math.round(wsolDeltaSol * 1e9)
  if (wsolDeltaLamports !== 0) return wsolDeltaLamports

  const stableDeltaUsd = computeTokenTransfers(raw, wallet)
    .filter((t) => STABLE_MINTS.has(t.mint))
    .reduce((sum, t) => sum + t.net_amount, 0)
  if (stableDeltaUsd !== 0 && Number.isFinite(solPriceUsd) && solPriceUsd > 0) {
    const solDelta = stableDeltaUsd / solPriceUsd
    const lamports = Math.round(solDelta * 1e9)
    if (lamports !== 0) return lamports
  }

  return computeNetSolLamports(raw, wallet)
}

function extractTradeLeg(raw: any, wallet: string, blockTimeMs: number, solPriceUsd: number): TradeLeg | null {
  const sol_change_lamports = computeTradeSolChangeLamports(raw, wallet, solPriceUsd)
  if (!sol_change_lamports) return null

  const tokenDeltas = computeTokenTransfers(raw, wallet)
    .filter((t) => t.mint !== WSOL_MINT && !STABLE_MINTS.has(t.mint))
    .map((t) => ({ mint: t.mint, amt: t.net_amount }))

  if (tokenDeltas.length === 0) return null

  let primary = tokenDeltas[0]
  for (const d of tokenDeltas) {
    if (Math.abs(d.amt) > Math.abs(primary.amt)) primary = d
  }

  const token_amount = Math.abs(primary.amt)
  if (!Number.isFinite(token_amount) || token_amount <= 0) return null

  const side: TradeLeg["side"] = primary.amt > 0 ? "buy" : "sell"
  return {
    token_mint: primary.mint,
    side,
    token_amount,
    sol_change_lamports,
    block_time_ms: blockTimeMs,
  }
}

function extractTradeLegWithReason(
  raw: any,
  wallet: string,
  blockTimeMs: number,
  solPriceUsd: number,
): { leg: TradeLeg | null; reason: DropReason | null } {
  const sol_change_lamports = computeTradeSolChangeLamports(raw, wallet, solPriceUsd)
  if (!sol_change_lamports) return { leg: null, reason: "no_sol_delta" }

  const tokenDeltas = computeTokenTransfers(raw, wallet)
    .filter((t) => t.mint !== WSOL_MINT && !STABLE_MINTS.has(t.mint))
    .map((t) => ({ mint: t.mint, amt: t.net_amount }))

  if (tokenDeltas.length === 0) return { leg: null, reason: "no_nonstable_token_delta" }

  let primary = tokenDeltas[0]
  for (const d of tokenDeltas) {
    if (Math.abs(d.amt) > Math.abs(primary.amt)) primary = d
  }

  const token_amount = Math.abs(primary.amt)
  if (!Number.isFinite(token_amount) || token_amount <= 0) return { leg: null, reason: "invalid_token_amount" }

  const side: TradeLeg["side"] = primary.amt > 0 ? "buy" : "sell"
  return {
    leg: {
      token_mint: primary.mint,
      side,
      token_amount,
      sol_change_lamports,
      block_time_ms: blockTimeMs,
    },
    reason: null,
  }
}

function computeRealizedTradePnL(legs: TradeLeg[]): {
  realized_lamports: number
  wins: number
  losses: number
  tx_count: number
  volume_lamports: number
} {
  const byMint = new Map<string, { qty: number; cost_lamports: number }>()
  const profitByMint = new Map<string, number>()
  let realized_lamports = 0
  let wins = 0
  let losses = 0
  let volume_lamports = 0

  const ordered = legs.slice().sort((a, b) => a.block_time_ms - b.block_time_ms)
  for (const leg of ordered) {
    volume_lamports += Math.round(Math.abs(leg.sol_change_lamports))

    const state = byMint.get(leg.token_mint) ?? { qty: 0, cost_lamports: 0 }

    if (leg.side === "buy") {
      const cost = leg.sol_change_lamports < 0 ? -leg.sol_change_lamports : 0
      state.qty += leg.token_amount
      state.cost_lamports += cost
      byMint.set(leg.token_mint, state)
      continue
    }

    // sell
    if (state.qty <= 0 || state.cost_lamports <= 0) {
      byMint.set(leg.token_mint, state)
      continue
    }

    const proceeds = leg.sol_change_lamports > 0 ? leg.sol_change_lamports : 0
    const soldQty = Math.min(leg.token_amount, state.qty)
    if (soldQty <= 0) {
      byMint.set(leg.token_mint, state)
      continue
    }

    const costBasis = state.cost_lamports * (soldQty / state.qty)
    const profit = proceeds - costBasis
    realized_lamports += profit
    profitByMint.set(leg.token_mint, (profitByMint.get(leg.token_mint) ?? 0) + profit)

    state.qty -= soldQty
    state.cost_lamports -= costBasis
    if (state.qty <= 1e-18 || state.cost_lamports <= 0) {
      state.qty = 0
      state.cost_lamports = 0
    }
    byMint.set(leg.token_mint, state)
  }
  for (const p of profitByMint.values()) {
    if (p > 0) wins += 1
    if (p < 0) losses += 1
  }

  return {
    realized_lamports,
    wins,
    losses,
    tx_count: legs.length,
    volume_lamports,
  }
}

function isTradeLike(raw: any, wallet: string): boolean {
  if (!raw || typeof raw !== "object") return false
  if (raw?.transactionError?.error) return false

  const source = typeof raw?.source === "string" ? raw.source : ""
  if (source === "SYSTEM_PROGRAM") return false

  const t = typeof raw?.type === "string" ? raw.type : ""
  if (t === "SWAP" || t === "SWAP_EXACT_OUT" || t === "SWAP_WITH_PRICE_IMPACT") {
    // For SWAP types, require a DEX-ish source when provided (avoid misc system activity)
    return source.length === 0 || source === "UNKNOWN" || DEX_SOURCES.has(source)
  }

  if (t !== "TRANSFER" && t !== "UNKNOWN") return false

  // For non-swap types, only count DEX-ish sources; otherwise it's likely a funding/transfer tx.
  if (!DEX_SOURCES.has(source)) return false

  const tokenTransfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
  const accountData = Array.isArray(raw?.accountData) ? raw.accountData : []

  const hasWsolTransfer = tokenTransfers.some(
    (x: any) =>
      x?.mint === WSOL_MINT && (x?.fromUserAccount === wallet || x?.toUserAccount === wallet),
  )
  const hasNonWsolTransfer = tokenTransfers.some(
    (x: any) =>
      typeof x?.mint === "string" && x.mint.length > 0 && x.mint !== WSOL_MINT && (x?.fromUserAccount === wallet || x?.toUserAccount === wallet),
  )

  let hasWsolBalance = false
  let hasNonWsolBalance = false
  for (const acc of accountData) {
    const tbc = Array.isArray(acc?.tokenBalanceChanges) ? acc.tokenBalanceChanges : []
    for (const tc of tbc) {
      const mint = tc?.mint
      const belongsToWallet = tc?.userAccount === wallet || acc?.account === wallet
      if (!belongsToWallet) continue
      if (mint === WSOL_MINT) hasWsolBalance = true
      if (typeof mint === "string" && mint.length > 0 && mint !== WSOL_MINT) hasNonWsolBalance = true
    }
  }

  const hasWsol = hasWsolTransfer || hasWsolBalance
  const hasOther = hasNonWsolTransfer || hasNonWsolBalance
  return hasWsol && hasOther
}

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
  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const days = timeframe === "monthly" ? 30 : timeframe === "weekly" ? 7 : 1
  return new Date(now.getTime() - days * dayMs).toISOString()
}

export async function GET(request: NextRequest) {
  const limited = rateLimit({ request, key: "analytics:leaderboard", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  try {
    const buildSha =
      process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null

    const url = new URL(request.url)
    const timeframeRaw = (url.searchParams.get("timeframe") || "daily").toLowerCase()
    const timeframe: TimeFrame =
      timeframeRaw === "weekly" ? "weekly" : timeframeRaw === "monthly" ? "monthly" : "daily"

    const bypassCache = url.searchParams.get("cache") === "0" || url.searchParams.get("cache") === "false"

    const debugRaw = (url.searchParams.get("debug") || "0").toLowerCase()
    const debugLevel = debugRaw === "true" ? 1 : Number.parseInt(debugRaw || "0", 10) || 0
    const debug = debugLevel > 0
    const applyEligibility = !(url.searchParams.get("eligibility") === "0" || url.searchParams.get("eligibility") === "false")

    const kolLimitParam = url.searchParams.get("kolLimit")
    const pageSizeParam = url.searchParams.get("pageSize")
    const maxLinksParam = url.searchParams.get("maxLinks")

    const kolLimitNum = kolLimitParam && kolLimitParam.trim().length > 0 ? Number(kolLimitParam) : NaN
    const pageSizeNum = pageSizeParam && pageSizeParam.trim().length > 0 ? Number(pageSizeParam) : NaN
    const maxLinksNum = maxLinksParam && maxLinksParam.trim().length > 0 ? Number(maxLinksParam) : NaN

    const kolLimit = Math.min(
      5000,
      Math.max(50, Number.isFinite(kolLimitNum) ? kolLimitNum : 2000),
    )
    const pageSize = Math.min(
      1000,
      Math.max(100, Number.isFinite(pageSizeNum) ? pageSizeNum : 200),
    )
    const defaultMaxLinks = timeframe === "daily" ? 2_000 : timeframe === "weekly" ? 25_000 : 50_000
    const minMaxLinks = timeframe === "daily" ? 500 : timeframe === "weekly" ? 5_000 : 10_000
    const maxLinks = Math.min(
      600_000,
      Math.max(minMaxLinks, Number.isFinite(maxLinksNum) ? maxLinksNum : defaultMaxLinks),
    )

    const cacheKey = [
      "leaderboard",
      timeframe,
      applyEligibility ? "1" : "0",
      String(debugLevel),
      String(kolLimit),
      String(pageSize),
      String(maxLinks),
    ].join(":")

    if (!bypassCache) {
      const hit = leaderboardCache.get(cacheKey)
      if (hit && Date.now() < hit.expiresAt) {
        return NextResponse.json(hit.payload)
      }
    }

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
        .limit(kolLimit),
      getSolPriceUsd(),
    ])

    if (kolsError) {
      return NextResponse.json({ error: kolsError.message }, { status: 500 })
    }

    const tracked = (kols ?? []) as KolRow[]
    const trackedWallets = tracked.map((k) => k.wallet_address)
    const trackedSet = new Set(trackedWallets)
    const kolMap = new Map(tracked.map((k) => [k.wallet_address, k]))

    const events = [] as Array<{
      signature: string
      block_time: string | null
      raw: any
      wallets: string[]
    }>

    let processed = 0
    let cursorBlockTime: string | null = null
    while (processed < maxLinks) {
      let q = supabase
        .from("tx_events")
        .select("signature, block_time, raw")
        .gte("block_time", cutoffIso)
        .order("block_time", { ascending: false })
        .limit(pageSize)
      if (cursorBlockTime) {
        q = q.lt("block_time", cursorBlockTime)
      }

      const { data: evData, error: evError } = await q

      if (evError) {
        return NextResponse.json({ error: evError.message }, { status: 500 })
      }

      const rows = (evData ?? []) as any[]
      if (rows.length === 0) break
      processed += rows.length

      const sigs = rows.map((r) => String(r?.signature ?? "")).filter((s) => s.length > 0)
      if (sigs.length === 0) {
        const lastBt = rows[rows.length - 1]?.block_time
        cursorBlockTime = lastBt ? String(lastBt) : null
        if (!cursorBlockTime) break
        if (rows.length < pageSize) break
        continue
      }

      const linkData: any[] = []
      const sigChunkSize = 25
      for (let i = 0; i < sigs.length; i += sigChunkSize) {
        const chunk = sigs.slice(i, i + sigChunkSize)
        const { data, error } = await supabase
          .from("tx_event_wallets")
          .select("signature, wallet_address")
          .in("signature", chunk)
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 })
        }
        if (Array.isArray(data) && data.length > 0) linkData.push(...data)
      }

      const bySig = new Map<string, string[]>()
      for (const l of (linkData ?? []) as any[]) {
        const sig = String(l?.signature ?? "")
        const w = String(l?.wallet_address ?? "")
        if (!sig || !w) continue
        if (!trackedSet.has(w)) continue
        const arr = bySig.get(sig) ?? []
        arr.push(w)
        bySig.set(sig, arr)
      }

      for (const r of rows) {
        const signature = String(r?.signature ?? "")
        if (!signature) continue
        const block_time = (r?.block_time ?? null) as string | null
        const raw = r?.raw
        const wallets = bySig.get(signature) ?? []
        if (wallets.length === 0) continue
        events.push({ signature, block_time, raw, wallets })
      }

      const lastBt = rows[rows.length - 1]?.block_time
      cursorBlockTime = lastBt ? String(lastBt) : null
      if (!cursorBlockTime) break
      if (rows.length < pageSize) break
    }

    const walletLegs = new Map<string, TradeLeg[]>()
    const seenSigs = new Map<string, Set<string>>()

    const targetSet = new Set<string>(Object.values(DEBUG_TARGET_WALLETS))
    const debug2Wallets: Record<
      string,
      {
        considered: number
        tradeLike: number
        legOk: number
        firstNoSolDeltaSig?: string
        firstPumpNoSolDeltaSig?: string
        dropReasons: Record<string, number>
        accepted: Array<{ signature: string; type: string; source: string }>
        dropped: Array<{
          signature: string
          reason: DropReason
          type: string
          source: string
          swapPreview?: {
            nativeInput?: { account: string; amount: string }
            nativeOutput?: { account: string; amount: string }
            tokenInputs?: string[]
            tokenOutputs?: string[]
          }
        }>
      }
    > = {}
    const ensureDebugWallet = (wallet: string) => {
      if (debug2Wallets[wallet]) return debug2Wallets[wallet]
      debug2Wallets[wallet] = {
        considered: 0,
        tradeLike: 0,
        legOk: 0,
        firstNoSolDeltaSig: undefined,
        firstPumpNoSolDeltaSig: undefined,
        dropReasons: {},
        accepted: [],
        dropped: [],
      }
      return debug2Wallets[wallet]
    }

    const pushDroppedSample = (
      dbg: {
        dropped: Array<{
          signature: string
          reason: DropReason
          type: string
          source: string
          swapPreview?: {
            nativeInput?: { account: string; amount: string }
            nativeOutput?: { account: string; amount: string }
            tokenInputs?: string[]
            tokenOutputs?: string[]
          }
        }>
      },
      item: {
        signature: string
        reason: DropReason
        type: string
        source: string
        swapPreview?: {
          nativeInput?: { account: string; amount: string }
          nativeOutput?: { account: string; amount: string }
          tokenInputs?: string[]
          tokenOutputs?: string[]
        }
      },
    ) => {
      const isPumpNoSolDelta = item.reason === "no_sol_delta" && /PUMP/i.test(item.source)
      const hasPumpNoSolDelta = dbg.dropped.some((x) => x.reason === "no_sol_delta" && /PUMP/i.test(x.source))

      if (dbg.dropped.length < 10) {
        dbg.dropped.push(item)
        return
      }

      if (isPumpNoSolDelta && !hasPumpNoSolDelta) {
        const idxNotTradeLike = dbg.dropped.findIndex((x) => x.reason === "not_trade_like")
        if (idxNotTradeLike >= 0) {
          dbg.dropped[idxNotTradeLike] = item
          return
        }

        const idxOtherNoSol = dbg.dropped.findIndex((x) => x.reason === "no_sol_delta" && !/PUMP/i.test(x.source))
        if (idxOtherNoSol >= 0) {
          dbg.dropped[idxOtherNoSol] = item
          return
        }

        dbg.dropped[0] = item
        return
      }

      if (item.reason === "not_trade_like") return

      const idx = dbg.dropped.findIndex((x) => x.reason === "not_trade_like")
      if (idx >= 0) {
        dbg.dropped[idx] = item
      }
    }
    const swapPreview = (raw: any) => {
      const s = raw?.events?.swap
      if (!s) return undefined
      const tokenInputs = Array.isArray(s?.tokenInputs)
        ? s.tokenInputs
            .map((x: any) => String(x?.mint ?? ""))
            .filter((m: string) => m.length > 0)
            .slice(0, 4)
        : []
      const tokenOutputs = Array.isArray(s?.tokenOutputs)
        ? s.tokenOutputs
            .map((x: any) => String(x?.mint ?? ""))
            .filter((m: string) => m.length > 0)
            .slice(0, 4)
        : []
      const ni = s?.nativeInput
      const no = s?.nativeOutput
      return {
        nativeInput:
          ni && typeof ni?.account === "string" && typeof ni?.amount === "string"
            ? { account: ni.account, amount: ni.amount }
            : undefined,
        nativeOutput:
          no && typeof no?.account === "string" && typeof no?.amount === "string"
            ? { account: no.account, amount: no.amount }
            : undefined,
        tokenInputs: tokenInputs.length > 0 ? tokenInputs : undefined,
        tokenOutputs: tokenOutputs.length > 0 ? tokenOutputs : undefined,
      }
    }
    const sampleMeta = (raw: any) => {
      const t = typeof raw?.type === "string" ? raw.type : ""
      const s = typeof raw?.source === "string" ? raw.source : ""
      return { type: t, source: s }
    }

    for (const ev of events) {
      const sig = ev.signature
      const raw = ev.raw
      const blockTimeMs = ev.block_time ? new Date(ev.block_time).getTime() : Date.now()
      for (const wallet of ev.wallets) {
        if (!trackedSet.has(wallet)) continue

        let seen = seenSigs.get(wallet)
        if (!seen) {
          seen = new Set()
          seenSigs.set(wallet, seen)
        }
        if (seen.has(sig)) continue
        seen.add(sig)

        const wantsDebug2 = debugLevel >= 2 && targetSet.has(wallet)
        const dbg = wantsDebug2 ? ensureDebugWallet(wallet) : null
        if (dbg) dbg.considered += 1

        if (!isTradeLike(raw, wallet)) {
          if (dbg) {
            const { type, source } = sampleMeta(raw)
            dbg.dropReasons.not_trade_like = (dbg.dropReasons.not_trade_like ?? 0) + 1
            pushDroppedSample(dbg, { signature: sig, reason: "not_trade_like", type, source })
          }
          continue
        }

        if (dbg) dbg.tradeLike += 1

        if (debugLevel >= 2 && dbg) {
          const out = extractTradeLegWithReason(raw, wallet, blockTimeMs, solPriceUsd)
          if (!out.leg) {
            const reason = out.reason ?? "no_sol_delta"
            const { type, source } = sampleMeta(raw)
            dbg.dropReasons[reason] = (dbg.dropReasons[reason] ?? 0) + 1

            if (reason === "no_sol_delta") {
              if (!dbg.firstNoSolDeltaSig) dbg.firstNoSolDeltaSig = sig
              if (/PUMP/i.test(source) && !dbg.firstPumpNoSolDeltaSig) dbg.firstPumpNoSolDeltaSig = sig
            }

            pushDroppedSample(dbg, {
              signature: sig,
              reason,
              type,
              source,
              swapPreview: reason === "no_sol_delta" ? swapPreview(raw) : undefined,
            })
            continue
          }
          dbg.legOk += 1
          const { type, source } = sampleMeta(raw)
          if (dbg.accepted.length < 10) dbg.accepted.push({ signature: sig, type, source })
          const arr = walletLegs.get(wallet) ?? []
          arr.push(out.leg)
          walletLegs.set(wallet, arr)
          continue
        }

        const leg = extractTradeLeg(raw, wallet, blockTimeMs, solPriceUsd)
        if (!leg) continue
        const arr = walletLegs.get(wallet) ?? []
        arr.push(leg)
        walletLegs.set(wallet, arr)
      }
    }

    const rows: LeaderboardRow[] = tracked
      .map((k) => {
        const legs = walletLegs.get(k.wallet_address) ?? []
        const agg = computeRealizedTradePnL(legs)
        const profit_sol = agg.realized_lamports / 1e9

        // Basic eligibility check (wallet age)
        let is_eligible = true
        if (applyEligibility) {
          if (k.wallet_created_at) {
            const created = new Date(k.wallet_created_at)
            const now = new Date()
            const ageDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
            if (ageDays < 7) is_eligible = false
          }

          const selfTransferCount = 0
          if (agg.tx_count > 0 && selfTransferCount / agg.tx_count > 0.1) {
            is_eligible = false
          }
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
          swap_volume_sol: agg.volume_lamports / 1e9,
          unique_counterparties: 0,
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

    if (debug) {
      const walletsWithEvents = Array.from(walletLegs.keys()).length
      let linkRows = 0
      for (const e of events) linkRows += e.wallets.length
      const payload = {
        ok: true,
        buildSha,
        timeframe,
        solPriceUsd,
        cutoffIso,
        trackedWallets: tracked.length,
        linkRows,
        walletsWithEvents,
        eligibility: applyEligibility,
        kolLimit,
        pageSize,
        maxLinks,
        rows,
        debugLevel,
        debugTargets: debugLevel >= 2 ? DEBUG_TARGET_WALLETS : undefined,
        debug2: debugLevel >= 2 ? debug2Wallets : undefined,
      }
      if (!bypassCache) {
        if (leaderboardCache.size > 50) leaderboardCache.clear()
        leaderboardCache.set(cacheKey, { expiresAt: Date.now() + getCacheTtlMs(timeframe), payload })
      }
      return NextResponse.json(payload)
    }

    const payload = { ok: true, buildSha, timeframe, solPriceUsd, rows }
    if (!bypassCache) {
      if (leaderboardCache.size > 50) leaderboardCache.clear()
      leaderboardCache.set(cacheKey, { expiresAt: Date.now() + getCacheTtlMs(timeframe), payload })
    }
    return NextResponse.json(payload)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
