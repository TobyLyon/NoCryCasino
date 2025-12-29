/**
 * Token PnL Calculation
 * Addresses audit item 8.1: Parse tokenTransfers + swap events for token PnL
 */

type TokenTransfer = {
  fromUserAccount?: string
  toUserAccount?: string
  mint?: string
  tokenAmount?: number
  tokenStandard?: string
}

type NativeTransfer = {
  fromUserAccount?: string
  toUserAccount?: string
  amount?: number
  lamports?: number
}

type SwapEvent = {
  nativeInput?: { account: string; amount: string }
  nativeOutput?: { account: string; amount: string }
  tokenInputs?: Array<{ userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string } }>
  tokenOutputs?: Array<{ userAccount: string; tokenAccount: string; mint: string; rawTokenAmount: { tokenAmount: string } }>
  innerSwaps?: SwapEvent[]
}

type HeliusEvent = {
  signature?: string
  type?: string
  source?: string
  nativeTransfers?: NativeTransfer[]
  tokenTransfers?: TokenTransfer[]
  events?: {
    swap?: SwapEvent
  }
  accountData?: Array<{ account: string; nativeBalanceChange?: number; tokenBalanceChanges?: Array<{ mint: string; rawTokenAmount: { tokenAmount: string } }> }>
}

const WSOL_MINT = "So11111111111111111111111111111111111111112"

export type WalletPnL = {
  wallet_address: string
  net_sol_lamports: number
  token_transfers: Array<{
    mint: string
    net_amount: number
    direction: "in" | "out"
  }>
  swap_volume_sol: number
  tx_count: number
  wins: number
  losses: number
  counterparties: Set<string>
  is_self_transfer: boolean
}

function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string" && v.length > 0) {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}

/**
 * Compute net SOL lamports for a wallet from native transfers
 */
export function computeNetSolLamports(raw: HeliusEvent, wallet: string): number {
  let net = 0

  const accountData = Array.isArray(raw?.accountData) ? raw.accountData : []
  const nativeBalanceChanges = accountData
    .filter((a) => a?.account === wallet)
    .map((a: any) => toNumber(a?.nativeBalanceChange))
    .filter((n) => Number.isFinite(n) && n !== 0)

  const usedNativeBalanceChange = nativeBalanceChanges.length > 0
  if (usedNativeBalanceChange) {
    net += nativeBalanceChanges.reduce((sum, n) => sum + n, 0)
  }

  // WSOL (wrapped SOL) changes are not reflected in nativeBalanceChange.
  // We treat WSOL deltas as SOL lamports for PnL parity.
  let sawWsolBalanceChange = false
  for (const acc of accountData) {
    if (acc?.account !== wallet) continue
    const changes = Array.isArray((acc as any)?.tokenBalanceChanges) ? (acc as any).tokenBalanceChanges : []
    for (const tc of changes) {
      const mint = tc?.mint
      if (mint !== WSOL_MINT) continue
      // rawTokenAmount.tokenAmount is base units (lamports) for WSOL.
      const amtBase = toNumber(tc?.rawTokenAmount?.tokenAmount)
      if (amtBase !== 0) {
        net += amtBase
        sawWsolBalanceChange = true
      }
    }
  }

  // If we already used nativeBalanceChange, don't also process nativeTransfers/swap native fields
  // or we will double-count native SOL deltas.
  if (usedNativeBalanceChange) {
    // Some payloads include tokenTransfers but not tokenBalanceChanges.
    // Only use tokenTransfers as a fallback to avoid double-counting.
    if (!sawWsolBalanceChange) {
      const tokenTransfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
      for (const t of tokenTransfers) {
        if (t?.mint !== WSOL_MINT) continue
        const amtSol = toNumber(t?.tokenAmount)
        if (!amtSol) continue
        const amtLamports = Math.round(amtSol * 1e9)
        if (t?.fromUserAccount === wallet) net -= amtLamports
        if (t?.toUserAccount === wallet) net += amtLamports
      }
    }

    return net
  }

  const native = Array.isArray(raw?.nativeTransfers) ? raw.nativeTransfers : []
  for (const t of native) {
    const from = t?.fromUserAccount
    const to = t?.toUserAccount
    const amt = toNumber(t?.amount ?? t?.lamports)
    if (from === wallet) net -= amt
    if (to === wallet) net += amt
  }

  const swap = raw?.events?.swap
  const walkSwap = (s: SwapEvent | undefined) => {
    if (!s) return
    if (s?.nativeInput?.account === wallet) net -= toNumber(s.nativeInput.amount)
    if (s?.nativeOutput?.account === wallet) net += toNumber(s.nativeOutput.amount)
    if (Array.isArray(s?.innerSwaps)) {
      for (const inner of s.innerSwaps) {
        walkSwap(inner)
      }
    }
  }
  walkSwap(swap)

  const tokenTransfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
  for (const t of tokenTransfers) {
    if (t?.mint !== WSOL_MINT) continue
    const amtSol = toNumber(t?.tokenAmount)
    if (!amtSol) continue
    const amtLamports = Math.round(amtSol * 1e9)
    if (t?.fromUserAccount === wallet) net -= amtLamports
    if (t?.toUserAccount === wallet) net += amtLamports
  }

  return net
}

/**
 * Compute token transfer deltas for a wallet
 */
export function computeTokenTransfers(
  raw: HeliusEvent,
  wallet: string
): Array<{ mint: string; net_amount: number; direction: "in" | "out" }> {
  const byMint = new Map<string, number>()

  const transfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
  for (const t of transfers) {
    const from = t?.fromUserAccount
    const to = t?.toUserAccount
    const mint = t?.mint
    const amt = toNumber(t?.tokenAmount)

    if (!mint || amt === 0) continue

    if (from === wallet) {
      byMint.set(mint, (byMint.get(mint) ?? 0) - amt)
    }
    if (to === wallet) {
      byMint.set(mint, (byMint.get(mint) ?? 0) + amt)
    }
  }

  // Also check accountData for balance changes
  const accountData = Array.isArray(raw?.accountData) ? raw.accountData : []
  for (const acc of accountData) {
    if (acc?.account !== wallet) continue
    const tokenChanges = Array.isArray(acc?.tokenBalanceChanges) ? acc.tokenBalanceChanges : []
    for (const tc of tokenChanges) {
      const mint = tc?.mint
      const amt = toNumber(tc?.rawTokenAmount?.tokenAmount)
      if (mint && amt !== 0) {
        byMint.set(mint, (byMint.get(mint) ?? 0) + amt)
      }
    }
  }

  return Array.from(byMint.entries())
    .filter(([_, amt]) => amt !== 0)
    .map(([mint, amt]) => ({
      mint,
      net_amount: amt,
      direction: amt > 0 ? "in" as const : "out" as const,
    }))
}

/**
 * Compute swap volume in SOL for a wallet
 */
export function computeSwapVolumeSol(raw: HeliusEvent, wallet: string): number {
  let volume = 0

  const swap = raw?.events?.swap
  if (!swap) {
    // Fallback: many enhanced txs (e.g. PumpFun) omit events.swap.
    // Approximate swap volume using WSOL token transfers involving the wallet.
    const tokenTransfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
    for (const t of tokenTransfers) {
      if (t?.mint !== WSOL_MINT) continue
      const amtSol = toNumber(t?.tokenAmount)
      if (!amtSol) continue
      const amtLamports = Math.round(Math.abs(amtSol) * 1e9)
      if (t?.fromUserAccount === wallet) volume += amtLamports
      if (t?.toUserAccount === wallet) volume += amtLamports
    }
    return volume
  }

  const processSwap = (s: SwapEvent) => {
    // Native input
    if (s?.nativeInput?.account === wallet) {
      volume += toNumber(s.nativeInput.amount)
    }
    // Native output
    if (s?.nativeOutput?.account === wallet) {
      volume += toNumber(s.nativeOutput.amount)
    }

    // Inner swaps
    if (Array.isArray(s?.innerSwaps)) {
      for (const inner of s.innerSwaps) {
        processSwap(inner)
      }
    }
  }

  processSwap(swap)

  return volume
}

/**
 * Extract counterparties from a transaction for a wallet
 */
export function extractCounterparties(raw: HeliusEvent, wallet: string): Set<string> {
  const counterparties = new Set<string>()

  const native = Array.isArray(raw?.nativeTransfers) ? raw.nativeTransfers : []
  for (const t of native) {
    const from = t?.fromUserAccount
    const to = t?.toUserAccount
    if (from === wallet && to && to !== wallet) counterparties.add(to)
    if (to === wallet && from && from !== wallet) counterparties.add(from)
  }

  const transfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
  for (const t of transfers) {
    const from = t?.fromUserAccount
    const to = t?.toUserAccount
    if (from === wallet && to && to !== wallet) counterparties.add(to)
    if (to === wallet && from && from !== wallet) counterparties.add(from)
  }

  return counterparties
}

/**
 * Detect if a transaction is a self-transfer (same wallet on both sides)
 */
export function isSelfTransfer(raw: HeliusEvent, wallet: string): boolean {
  const native = Array.isArray(raw?.nativeTransfers) ? raw.nativeTransfers : []
  for (const t of native) {
    if (t?.fromUserAccount === wallet && t?.toUserAccount === wallet) {
      return true
    }
  }

  const transfers = Array.isArray(raw?.tokenTransfers) ? raw.tokenTransfers : []
  for (const t of transfers) {
    if (t?.fromUserAccount === wallet && t?.toUserAccount === wallet) {
      return true
    }
  }

  return false
}

/**
 * Compute full PnL analysis for a wallet from a Helius event
 */
export function analyzeWalletPnL(raw: HeliusEvent, wallet: string): WalletPnL {
  const net_sol_lamports = computeNetSolLamports(raw, wallet)
  const token_transfers = computeTokenTransfers(raw, wallet)
  const swap_volume_sol = computeSwapVolumeSol(raw, wallet) / 1e9
  const counterparties = extractCounterparties(raw, wallet)
  const is_self_transfer = isSelfTransfer(raw, wallet)

  return {
    wallet_address: wallet,
    net_sol_lamports,
    token_transfers,
    swap_volume_sol,
    tx_count: 1,
    wins: net_sol_lamports > 0 ? 1 : 0,
    losses: net_sol_lamports < 0 ? 1 : 0,
    counterparties,
    is_self_transfer,
  }
}

/**
 * Aggregate multiple WalletPnL results
 */
export function aggregateWalletPnL(results: WalletPnL[]): WalletPnL {
  if (results.length === 0) {
    return {
      wallet_address: "",
      net_sol_lamports: 0,
      token_transfers: [],
      swap_volume_sol: 0,
      tx_count: 0,
      wins: 0,
      losses: 0,
      counterparties: new Set(),
      is_self_transfer: false,
    }
  }

  const wallet_address = results[0].wallet_address
  let net_sol_lamports = 0
  let swap_volume_sol = 0
  let tx_count = 0
  let wins = 0
  let losses = 0
  const counterparties = new Set<string>()
  const tokenByMint = new Map<string, number>()
  let has_self_transfer = false

  for (const r of results) {
    net_sol_lamports += r.net_sol_lamports
    swap_volume_sol += r.swap_volume_sol
    tx_count += r.tx_count
    wins += r.wins
    losses += r.losses
    if (r.is_self_transfer) has_self_transfer = true

    for (const cp of r.counterparties) {
      counterparties.add(cp)
    }

    for (const tt of r.token_transfers) {
      tokenByMint.set(tt.mint, (tokenByMint.get(tt.mint) ?? 0) + tt.net_amount)
    }
  }

  const token_transfers = Array.from(tokenByMint.entries())
    .filter(([_, amt]) => amt !== 0)
    .map(([mint, amt]) => ({
      mint,
      net_amount: amt,
      direction: amt > 0 ? "in" as const : "out" as const,
    }))

  return {
    wallet_address,
    net_sol_lamports,
    token_transfers,
    swap_volume_sol,
    tx_count,
    wins,
    losses,
    counterparties,
    is_self_transfer: has_self_transfer,
  }
}
