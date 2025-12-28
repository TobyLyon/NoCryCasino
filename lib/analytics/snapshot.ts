/**
 * Leaderboard Snapshot System
 * Addresses audit item 8.2: Snapshot locking at closes_at
 */

import { createServiceClient } from "@/lib/supabase/service"
import { createHash } from "crypto"
import { analyzeWalletPnL, aggregateWalletPnL, type WalletPnL } from "./token-pnl"

export type WindowKey = "daily" | "weekly" | "monthly"

export type RankedKol = {
  wallet_address: string
  rank: number
  profit_sol: number
  profit_usd: number
  wins: number
  losses: number
  tx_count: number
  swap_volume_sol: number
  unique_counterparties: number
  is_eligible: boolean
  disqualification_reasons: string[]
}

export type LeaderboardSnapshot = {
  window_key: WindowKey
  closes_at: string
  snapshot_at: string
  snapshot_hash: string
  rankings: RankedKol[]
}

function computeSnapshotHash(rankings: RankedKol[]): string {
  const data = JSON.stringify(
    rankings.map((r) => ({
      w: r.wallet_address,
      r: r.rank,
      p: r.profit_sol,
    }))
  )
  return createHash("sha256").update(data).digest("hex").slice(0, 32)
}

function cutoffForWindow(window_key: WindowKey, closesAtIso: string): string {
  const endMs = Date.parse(closesAtIso)
  const day = 24 * 60 * 60 * 1000
  const delta = window_key === "daily" ? day : window_key === "weekly" ? 7 * day : 30 * day
  return new Date(endMs - delta).toISOString()
}

/**
 * Create a frozen leaderboard snapshot for a window
 */
export async function createLeaderboardSnapshot(args: {
  window_key: WindowKey
  closes_at: string
  sol_price_usd: number
  apply_anti_manipulation?: boolean
}): Promise<LeaderboardSnapshot> {
  const { window_key, closes_at, sol_price_usd, apply_anti_manipulation = true } = args
  const supabase = createServiceClient()

  // Get tracked KOLs with versioning check
  const { data: kols, error: kolsError } = await supabase
    .from("kols")
    .select("wallet_address, tracked_from, tracked_until, wallet_created_at")
    .eq("is_active", true)
    .eq("is_tracked", true)
    .or(`tracked_until.is.null,tracked_until.gt.${closes_at}`)
    .lte("tracked_from", closes_at)
    .order("tracked_rank", { ascending: true, nullsFirst: false })
    .limit(500)

  if (kolsError) throw new Error(kolsError.message)

  const trackedWallets = (kols ?? []).map((k: any) => k.wallet_address)
  const trackedSet = new Set(trackedWallets)
  const kolMap = new Map((kols ?? []).map((k: any) => [k.wallet_address, k]))

  const cutoffIso = cutoffForWindow(window_key, closes_at)

  // Fetch events for the window
  const { data: events, error: eventsError } = await supabase
    .from("tx_events")
    .select("signature, block_time, raw, tx_event_wallets(wallet_address)")
    .gte("block_time", cutoffIso)
    .lt("block_time", closes_at)
    .order("block_time", { ascending: false })
    .limit(50000)

  if (eventsError) throw new Error(eventsError.message)

  // Aggregate PnL per wallet
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

      const pnl = analyzeWalletPnL(raw, wallet)
      const arr = walletPnLs.get(wallet) ?? []
      arr.push(pnl)
      walletPnLs.set(wallet, arr)
    }
  }

  // Build rankings
  const rankings: RankedKol[] = []

  for (const wallet of trackedWallets) {
    const pnls = walletPnLs.get(wallet) ?? []
    const agg = aggregateWalletPnL(pnls)
    const kol = kolMap.get(wallet)

    const profit_sol = agg.net_sol_lamports / 1e9
    const disqualification_reasons: string[] = []

    // Anti-manipulation checks (simplified inline for snapshot)
    if (apply_anti_manipulation) {
      // Wallet age check
      if (kol?.wallet_created_at) {
        const created = new Date(kol.wallet_created_at)
        const closeDate = new Date(closes_at)
        const ageDays = Math.floor((closeDate.getTime() - created.getTime()) / (1000 * 60 * 60 * 24))
        if (ageDays < 7) {
          disqualification_reasons.push(`Wallet age (${ageDays}d) below minimum (7d)`)
        }
      }

      // Self-transfer check
      const selfTransferCount = pnls.filter((p) => p.is_self_transfer).length
      if (agg.tx_count > 0 && selfTransferCount / agg.tx_count > 0.1) {
        disqualification_reasons.push(`High self-transfer ratio (${((selfTransferCount / agg.tx_count) * 100).toFixed(1)}%)`)
      }

      // Counterparty diversity check
      if (agg.counterparties.size < 3 && agg.tx_count >= 5) {
        disqualification_reasons.push(`Low counterparty diversity (${agg.counterparties.size} unique)`)
      }
    }

    rankings.push({
      wallet_address: wallet,
      rank: 0, // Will be assigned after sorting
      profit_sol,
      profit_usd: profit_sol * sol_price_usd,
      wins: agg.wins,
      losses: agg.losses,
      tx_count: agg.tx_count,
      swap_volume_sol: agg.swap_volume_sol,
      unique_counterparties: agg.counterparties.size,
      is_eligible: disqualification_reasons.length === 0,
      disqualification_reasons,
    })
  }

  // Sort by profit (eligible first, then by profit)
  rankings.sort((a, b) => {
    // Eligible wallets rank higher
    if (a.is_eligible !== b.is_eligible) return a.is_eligible ? -1 : 1
    // Then by profit
    if (b.profit_sol !== a.profit_sol) return b.profit_sol - a.profit_sol
    // Then by wins
    if (b.wins !== a.wins) return b.wins - a.wins
    // Deterministic tiebreaker
    return a.wallet_address.localeCompare(b.wallet_address)
  })

  // Assign ranks
  rankings.forEach((r, idx) => {
    r.rank = idx + 1
  })

  const snapshot_at = new Date().toISOString()
  const snapshot_hash = computeSnapshotHash(rankings)

  return {
    window_key,
    closes_at,
    snapshot_at,
    snapshot_hash,
    rankings,
  }
}

/**
 * Save a leaderboard snapshot to the database
 */
export async function saveLeaderboardSnapshot(snapshot: LeaderboardSnapshot): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase.from("leaderboard_snapshots").upsert(
    {
      window_key: snapshot.window_key,
      closes_at: snapshot.closes_at,
      snapshot_at: snapshot.snapshot_at,
      snapshot_hash: snapshot.snapshot_hash,
      rankings: snapshot.rankings,
    },
    { onConflict: "window_key,closes_at" }
  )

  if (error) throw new Error(error.message)
}

/**
 * Get an existing leaderboard snapshot
 */
export async function getLeaderboardSnapshot(args: {
  window_key: WindowKey
  closes_at: string
}): Promise<LeaderboardSnapshot | null> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from("leaderboard_snapshots")
    .select("window_key, closes_at, snapshot_at, snapshot_hash, rankings")
    .eq("window_key", args.window_key)
    .eq("closes_at", args.closes_at)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) return null

  return {
    window_key: data.window_key as WindowKey,
    closes_at: data.closes_at,
    snapshot_at: data.snapshot_at,
    snapshot_hash: data.snapshot_hash,
    rankings: data.rankings as RankedKol[],
  }
}

/**
 * Verify a snapshot hash matches the stored rankings
 */
export function verifySnapshotHash(snapshot: LeaderboardSnapshot): boolean {
  const computed = computeSnapshotHash(snapshot.rankings)
  return computed === snapshot.snapshot_hash
}
