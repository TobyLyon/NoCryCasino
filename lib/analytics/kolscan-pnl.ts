import { computeNetSolLamports, computeTokenTransfers } from "@/lib/analytics/token-pnl"

export type TradeLeg = {
  token_mint: string
  side: "buy" | "sell"
  token_amount: number
  sol_change_lamports: number
  block_time_ms: number
}

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
  "RAYDIUM_AMM",
  "RAYDIUM_CLMM",
  "ORCA",
  "ORCA_WHIRLPOOL",
  "LIFINITY",
  "METEORA",
  "PHOENIX",
  "OPENBOOK",
  "MERCURIAL",
  "SABER",
  "SAROS",
  "CREMA",
  "ALDRIN",
  "CYKURA",
])

export function isTradeLike(raw: any, wallet: string): boolean {
  if (!raw || typeof raw !== "object") return false
  if (raw?.transactionError?.error) return false

  const source = typeof raw?.source === "string" ? raw.source : ""
  if (source === "SYSTEM_PROGRAM") return false

  const t = typeof raw?.type === "string" ? raw.type : ""
  if (t === "SWAP" || t === "SWAP_EXACT_OUT" || t === "SWAP_WITH_PRICE_IMPACT") {
    return true
  }

  if (t !== "TRANSFER" && t !== "UNKNOWN") return false
  const hasSwapEvent = !!raw?.events?.swap
  if (!hasSwapEvent && !DEX_SOURCES.has(source)) return false

  const transfers = computeTokenTransfers(raw, wallet)
  const hasNonStableToken = transfers.some((x) => x.mint !== WSOL_MINT && !STABLE_MINTS.has(x.mint))
  if (!hasNonStableToken) return false

  const hasWsol = transfers.some((x) => x.mint === WSOL_MINT)
  const hasStable = transfers.some((x) => STABLE_MINTS.has(x.mint))
  const hasSol = computeNetSolLamports(raw, wallet) !== 0

  return hasWsol || hasStable || hasSol
}
export function computeTradeSolChangeLamports(raw: any, wallet: string, solPriceUsd: number): number {
  let netStrict = 0
  let sawSwapNativeStrict = false

  let netRelaxed = 0
  let sawSwapNativeRelaxed = false
  let swapMentionsWallet = false

  const walkSwap = (s: any) => {
    if (!s) return
    const ni = s?.nativeInput
    const no = s?.nativeOutput

    if (ni?.account === wallet || no?.account === wallet) {
      swapMentionsWallet = true
    }

    const tis = s?.tokenInputs
    if (Array.isArray(tis)) {
      for (const ti of tis) {
        if (ti?.userAccount === wallet) {
          swapMentionsWallet = true
          break
        }
      }
    }

    const tos = s?.tokenOutputs
    if (Array.isArray(tos)) {
      for (const to of tos) {
        if (to?.userAccount === wallet) {
          swapMentionsWallet = true
          break
        }
      }
    }

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

  const transfers = computeTokenTransfers(raw, wallet)
  const hasNonStableToken = transfers.some((t) => t.mint !== WSOL_MINT && !STABLE_MINTS.has(t.mint) && t.net_amount !== 0)

  const wsolDeltaSol = transfers
    .filter((t) => t.mint === WSOL_MINT)
    .reduce((sum, t) => sum + t.net_amount, 0)
  const wsolDeltaLamports = Math.round(wsolDeltaSol * 1e9)
  if (wsolDeltaLamports !== 0) return wsolDeltaLamports

  const stableDeltaUsd = transfers
    .filter((t) => STABLE_MINTS.has(t.mint))
    .reduce((sum, t) => sum + t.net_amount, 0)

  const rawNetSol = computeNetSolLamports(raw, wallet)
  const feeLamports = typeof raw?.fee === "number" && Number.isFinite(raw.fee) ? raw.fee : 0
  const feePayer = typeof raw?.feePayer === "string" ? raw.feePayer : null
  const netSolNoFee = feeLamports > 0 && feePayer === wallet ? rawNetSol + feeLamports : rawNetSol

  if (netSolNoFee !== 0) return netSolNoFee

  if (source === "JUPITER" && sawSwapNativeRelaxed && netRelaxed !== 0 && (swapMentionsWallet || hasNonStableToken)) return netRelaxed

  if (stableDeltaUsd !== 0 && Number.isFinite(solPriceUsd) && solPriceUsd > 0) {
    const solDelta = stableDeltaUsd / solPriceUsd
    const lamports = Math.round(solDelta * 1e9)
    if (lamports !== 0) return lamports
  }

  return netSolNoFee
}

export function extractTradeLeg(raw: any, wallet: string, blockTimeMs: number, solPriceUsd: number): TradeLeg | null {
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

export function computeRealizedTradePnL(legs: TradeLeg[]): {
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
    if (proceeds <= 0) {
      byMint.set(leg.token_mint, state)
      continue
    }

    const sellQty = Math.min(state.qty, leg.token_amount)
    if (sellQty <= 0) {
      byMint.set(leg.token_mint, state)
      continue
    }

    const avgCostPerToken = state.cost_lamports / state.qty
    const costForSold = Math.round(avgCostPerToken * sellQty)
    const profit = proceeds - costForSold

    realized_lamports += profit
    profitByMint.set(leg.token_mint, (profitByMint.get(leg.token_mint) ?? 0) + profit)

    // proportional reduction
    state.qty -= sellQty
    state.cost_lamports = Math.max(0, state.cost_lamports - costForSold)
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
