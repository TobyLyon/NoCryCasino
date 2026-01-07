"use server"

import { createServiceClient } from "@/lib/supabase/service"
import { withRpcFallback } from "@/lib/solana/rpc"

export async function verifyAndCreateEntry(
  walletAddress: string,
  tournamentId: string,
  transactionSignature: string,
  entryAmount: number,
) {
  const supabase = createServiceClient()

  const getDefaultTournamentEscrowAddress = async (): Promise<string> => {
    const { ESCROW_WALLET_ADDRESS } = await import("@/lib/solana/escrow")
    return ESCROW_WALLET_ADDRESS
  }

  async function verifyTournamentDeposit(args: {
    txSig: string
    fromWallet: string
    toWallet: string
    minLamports: number
  }): Promise<{ ok: true; lamports: number } | { ok: false; error: string }> {
    const { SystemProgram } = await import("@solana/web3.js")

    return withRpcFallback(async (connection) => {
      const tx = await connection.getParsedTransaction(args.txSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      if (!tx) return { ok: false as const, error: "Deposit transaction not found" }
      if (tx.meta?.err) return { ok: false as const, error: "Deposit transaction failed" }

      const instructions: any[] = Array.isArray(tx.transaction.message.instructions) ? (tx.transaction.message.instructions as any[]) : []

      let matchedLamports = 0
      for (const ix of instructions) {
        if (ix?.programId?.toBase58?.() !== SystemProgram.programId.toBase58()) continue
        const parsed = ix?.parsed
        if (parsed?.type !== "transfer") continue
        const info = parsed?.info
        const src = info?.source
        const dst = info?.destination
        const lamports = Number(info?.lamports)
        if (src === args.fromWallet && dst === args.toWallet && Number.isFinite(lamports) && lamports > 0) {
          matchedLamports += lamports
        }
      }

      if (matchedLamports < args.minLamports) return { ok: false as const, error: "Deposit amount too low" }

      return { ok: true as const, lamports: matchedLamports }
    })
  }

  try {
    const wallet = String(walletAddress ?? "").trim()
    const tournament_id = String(tournamentId ?? "").trim()
    const tx_sig = String(transactionSignature ?? "").trim()

    if (!wallet) throw new Error("Missing wallet address")
    if (!tournament_id) throw new Error("Missing tournament ID")
    if (!tx_sig || tx_sig.length < 20) throw new Error("Missing transaction signature")

    // 0) Load tournament (authoritative entry fee + status + capacity)
    const { data: tournament, error: tErr } = await supabase
      .from("tournaments")
      .select("id, status, entry_fee, max_participants, current_participants, end_date, escrow_wallet_address")
      .eq("id", tournament_id)
      .maybeSingle()

    if (tErr) {
      console.error("Failed to load tournament:", tErr)
      throw new Error("Failed to load tournament")
    }
    if (!tournament) throw new Error("Tournament not found")

    const status = String((tournament as any)?.status ?? "")
    if (status !== "active" && status !== "upcoming") {
      throw new Error("TOURNAMENT_NOT_OPEN")
    }

    const max = Number((tournament as any)?.max_participants)
    const cur = Number((tournament as any)?.current_participants)
    if (Number.isFinite(max) && max > 0 && Number.isFinite(cur) && cur >= max) {
      throw new Error("TOURNAMENT_FULL")
    }

    const entry_fee = Number((tournament as any)?.entry_fee)
    if (!Number.isFinite(entry_fee) || entry_fee <= 0) throw new Error("Invalid tournament entry fee")

    const trackedUntilRaw = (tournament as any)?.end_date
    const tracked_until =
      typeof trackedUntilRaw === "string" && trackedUntilRaw.length > 0 && Number.isFinite(Date.parse(trackedUntilRaw))
        ? new Date(trackedUntilRaw).toISOString()
        : null

    // 1) Create user row if needed
    const { data: existingUser, error: userLookupErr } = await supabase
      .from("users")
      .select("wallet_address, total_tournaments_entered")
      .eq("wallet_address", wallet)
      .maybeSingle()

    if (userLookupErr) {
      console.error("Failed to load user:", userLookupErr)
      throw new Error("Failed to load user")
    }

    if (!existingUser) {
      const { error: userInsertErr } = await supabase
        .from("users")
        .insert({
          wallet_address: wallet,
          total_winnings: 0,
          total_tournaments_entered: 0,
          total_tournaments_won: 0,
        })

      if (userInsertErr) {
        console.error("Failed to create user:", userInsertErr)
        throw new Error("Failed to create user profile")
      }
    }

    // 2) If already entered this tournament, return success (idempotent)
    const { data: already, error: alreadyErr } = await supabase
      .from("tournament_entries")
      .select("id")
      .eq("tournament_id", tournament_id)
      .eq("wallet_address", wallet)
      .maybeSingle()

    if (alreadyErr) {
      console.error("Failed to check existing entry:", alreadyErr)
      throw new Error("Failed to verify tournament eligibility")
    }
    if (already) {
      return { success: true, message: "Already entered" }
    }

    // 3) Enforce one active tournament per wallet
    const { data: activeEntries, error: activeErr } = await supabase
      .from("tournament_entries")
      .select("id, tournament_id, tournaments!inner(status, title)")
      .eq("wallet_address", wallet)
      .eq("status", "active")
      .neq("tournament_id", tournament_id)

    if (activeErr) {
      console.error("Failed to check active tournaments:", activeErr)
      throw new Error("Failed to verify tournament eligibility")
    }

    if (activeEntries && activeEntries.length > 0) {
      const activeTournamentRaw = (activeEntries[0] as any)?.tournaments
      const activeTournament = Array.isArray(activeTournamentRaw) ? activeTournamentRaw[0] : activeTournamentRaw
      const title = activeTournament?.title || "another tournament"
      throw new Error(`ALREADY_IN_TOURNAMENT:${title}`)
    }

    // 4) Verify deposit on-chain
    const escrowWalletDb = (tournament as any)?.escrow_wallet_address
    const escrowWallet =
      typeof escrowWalletDb === "string" && escrowWalletDb.trim().length > 0 ? escrowWalletDb.trim() : await getDefaultTournamentEscrowAddress()
    const minLamports = Math.floor(entry_fee * 1e9)
    const verified = await verifyTournamentDeposit({
      txSig: tx_sig,
      fromWallet: wallet,
      toWallet: escrowWallet,
      minLamports,
    })
    if (!verified.ok) throw new Error(verified.error)

    // 5) Record escrow payment (server-verified amount)
    const { error: escrowError } = await supabase.from("escrow").insert({
      tournament_id,
      wallet_address: wallet,
      amount: verified.lamports / 1e9,
      transaction_signature: tx_sig,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
    })

    if (escrowError) {
      console.error("Failed to record escrow:", escrowError)
      if (escrowError.code === "23505") {
        // idempotent retry
      } else {
        throw new Error("Failed to record payment")
      }
    }

    // 6) Create tournament entry
    const { error: entryError } = await supabase.from("tournament_entries").insert({
      tournament_id,
      wallet_address: wallet,
      entry_amount: entry_fee,
      current_pnl: 0,
      current_roi: 0,
      current_volume: 0,
      consecutive_wins: 0,
      status: "active",
    })

    if (entryError) {
      console.error("Failed to create entry:", entryError)
      if (entryError.code === "23505") {
        throw new Error("ALREADY_ENTERED_THIS_TOURNAMENT")
      }
      throw new Error("Failed to create tournament entry")
    }

    await supabase.from("tracked_wallets").upsert(
      {
        wallet_address: wallet,
        source: "tournament",
        tracked_until,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" },
    )

    // 7) Update user stats
    const entered = Number((existingUser as any)?.total_tournaments_entered)
    await supabase
      .from("users")
      .update({ total_tournaments_entered: (Number.isFinite(entered) ? entered : 0) + 1 })
      .eq("wallet_address", wallet)

    return { success: true, message: "Successfully entered tournament" }
  } catch (error) {
    console.error("Entry verification failed:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to verify entry",
    }
  }
}
