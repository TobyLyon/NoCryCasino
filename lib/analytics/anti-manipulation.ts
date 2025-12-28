/**
 * Anti-Manipulation Detection
 * Addresses audit item 8.5: Volume thresholds, wallet age, counterparty diversity checks
 */

import { createServiceClient } from "@/lib/supabase/service"

export type AntiManipulationConfig = {
  min_wallet_age_days: number
  min_volume_sol: number
  min_unique_counterparties: number
  max_self_transfer_ratio: number
  max_wash_trade_ratio: number
}

const DEFAULT_CONFIG: AntiManipulationConfig = {
  min_wallet_age_days: 7,
  min_volume_sol: 0.1,
  min_unique_counterparties: 3,
  max_self_transfer_ratio: 0.1,
  max_wash_trade_ratio: 0.2,
}

let configCache: { config: AntiManipulationConfig; ts: number } | null = null
const CONFIG_CACHE_TTL = 60_000 // 1 minute

export async function getAntiManipulationConfig(): Promise<AntiManipulationConfig> {
  const now = Date.now()
  if (configCache && now - configCache.ts < CONFIG_CACHE_TTL) {
    return configCache.config
  }

  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "anti_manipulation")
      .maybeSingle()

    if (data?.value) {
      const config = { ...DEFAULT_CONFIG, ...data.value }
      configCache = { config, ts: now }
      return config
    }
  } catch {
    // Fall through to default
  }

  configCache = { config: DEFAULT_CONFIG, ts: now }
  return DEFAULT_CONFIG
}

export type WalletValidationResult = {
  is_valid: boolean
  reasons: string[]
  wallet_age_days: number | null
  volume_sol: number
  unique_counterparties: number
  self_transfer_ratio: number
  wash_trade_ratio: number
}

/**
 * Validate a wallet against anti-manipulation rules
 */
export async function validateWallet(
  wallet_address: string,
  stats: {
    wallet_created_at?: Date | string | null
    volume_sol: number
    unique_counterparties: number
    tx_count: number
    self_transfer_count: number
    wash_trade_suspect_count: number
  }
): Promise<WalletValidationResult> {
  const config = await getAntiManipulationConfig()
  const reasons: string[] = []

  // Calculate wallet age
  let wallet_age_days: number | null = null
  if (stats.wallet_created_at) {
    const created = new Date(stats.wallet_created_at)
    const now = new Date()
    wallet_age_days = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))

    if (wallet_age_days < config.min_wallet_age_days) {
      reasons.push(`Wallet age (${wallet_age_days}d) below minimum (${config.min_wallet_age_days}d)`)
    }
  }

  // Check volume threshold
  if (stats.volume_sol < config.min_volume_sol) {
    reasons.push(`Volume (${stats.volume_sol.toFixed(4)} SOL) below minimum (${config.min_volume_sol} SOL)`)
  }

  // Check counterparty diversity
  if (stats.unique_counterparties < config.min_unique_counterparties) {
    reasons.push(`Unique counterparties (${stats.unique_counterparties}) below minimum (${config.min_unique_counterparties})`)
  }

  // Check self-transfer ratio
  const self_transfer_ratio = stats.tx_count > 0 ? stats.self_transfer_count / stats.tx_count : 0
  if (self_transfer_ratio > config.max_self_transfer_ratio) {
    reasons.push(`Self-transfer ratio (${(self_transfer_ratio * 100).toFixed(1)}%) exceeds maximum (${(config.max_self_transfer_ratio * 100).toFixed(1)}%)`)
  }

  // Check wash trade ratio
  const wash_trade_ratio = stats.tx_count > 0 ? stats.wash_trade_suspect_count / stats.tx_count : 0
  if (wash_trade_ratio > config.max_wash_trade_ratio) {
    reasons.push(`Wash trade ratio (${(wash_trade_ratio * 100).toFixed(1)}%) exceeds maximum (${(config.max_wash_trade_ratio * 100).toFixed(1)}%)`)
  }

  return {
    is_valid: reasons.length === 0,
    reasons,
    wallet_age_days,
    volume_sol: stats.volume_sol,
    unique_counterparties: stats.unique_counterparties,
    self_transfer_ratio,
    wash_trade_ratio,
  }
}

/**
 * Detect potential wash trading between two wallets
 * Returns true if the transaction pattern suggests wash trading
 */
export function detectWashTrade(args: {
  wallet_a: string
  wallet_b: string
  recent_txs_a_to_b: number
  recent_txs_b_to_a: number
  time_window_hours: number
}): { is_suspect: boolean; reason?: string } {
  const { wallet_a, wallet_b, recent_txs_a_to_b, recent_txs_b_to_a, time_window_hours } = args

  // Same wallet
  if (wallet_a === wallet_b) {
    return { is_suspect: true, reason: "Self-transfer" }
  }

  // Bidirectional transfers in short time window
  if (recent_txs_a_to_b > 0 && recent_txs_b_to_a > 0) {
    const total = recent_txs_a_to_b + recent_txs_b_to_a
    if (total >= 4 && time_window_hours <= 24) {
      return { is_suspect: true, reason: `High bidirectional activity (${total} txs in ${time_window_hours}h)` }
    }
  }

  return { is_suspect: false }
}

/**
 * Check if a KOL wallet passes all anti-manipulation checks for settlement eligibility
 */
export async function isEligibleForSettlement(
  wallet_address: string,
  window_start: Date,
  window_end: Date
): Promise<{ eligible: boolean; validation: WalletValidationResult }> {
  const supabase = createServiceClient()

  // Get wallet info
  const { data: kol } = await supabase
    .from("kols")
    .select("wallet_address, wallet_created_at, tracked_from")
    .eq("wallet_address", wallet_address)
    .maybeSingle()

  // Get daily stats for the window
  const startDate = window_start.toISOString().split("T")[0]
  const endDate = window_end.toISOString().split("T")[0]

  const { data: stats } = await supabase
    .from("kol_stats_daily")
    .select("volume_sol, unique_counterparties, tx_count, self_transfer_count, wash_trade_suspect_count")
    .eq("wallet_address", wallet_address)
    .gte("date", startDate)
    .lte("date", endDate)

  // Aggregate stats
  const aggregated = {
    wallet_created_at: kol?.wallet_created_at ?? kol?.tracked_from ?? null,
    volume_sol: 0,
    unique_counterparties: 0,
    tx_count: 0,
    self_transfer_count: 0,
    wash_trade_suspect_count: 0,
  }

  const counterpartySet = new Set<number>()

  for (const s of stats ?? []) {
    aggregated.volume_sol += Number(s.volume_sol ?? 0)
    aggregated.tx_count += Number(s.tx_count ?? 0)
    aggregated.self_transfer_count += Number(s.self_transfer_count ?? 0)
    aggregated.wash_trade_suspect_count += Number(s.wash_trade_suspect_count ?? 0)
    // Note: unique_counterparties across days would need deduplication in practice
    counterpartySet.add(Number(s.unique_counterparties ?? 0))
  }

  // Approximate unique counterparties (sum for now, proper impl would track unique addresses)
  aggregated.unique_counterparties = Array.from(counterpartySet).reduce((a, b) => a + b, 0)

  const validation = await validateWallet(wallet_address, aggregated)

  return {
    eligible: validation.is_valid,
    validation,
  }
}
