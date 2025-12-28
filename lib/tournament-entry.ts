"use server"

import { createServiceClient } from "@/lib/supabase/service"

export async function verifyAndCreateEntry(
  walletAddress: string,
  tournamentId: string,
  transactionSignature: string,
  entryAmount: number,
) {
  const supabase = createServiceClient()

  try {
    // 1. Create or get user by wallet address
    const { data: existingUser } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", walletAddress)
      .maybeSingle()

    let userId: string

    if (!existingUser) {
      // Create new user with wallet address
      const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert({
          wallet_address: walletAddress,
          total_winnings: 0,
          total_tournaments_entered: 0,
          total_tournaments_won: 0,
        })
        .select()
        .single()

      if (userError || !newUser) {
        console.error("Failed to create user:", userError)
        throw new Error("Failed to create user profile")
      }

      userId = newUser.id
    } else {
      userId = existingUser.id
    }

    const { data: existingEntry } = await supabase
      .from("tournament_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("tournament_id", tournamentId)
      .maybeSingle()

    if (existingEntry) {
      throw new Error("ALREADY_ENTERED_THIS_TOURNAMENT")
    }

    const { data: activeEntries, error: checkError } = await supabase
      .from("tournament_entries")
      .select("id, tournament_id, tournaments!inner(status, title)")
      .eq("user_id", userId)
      .eq("status", "active")
      .in("tournaments.status", ["live", "upcoming"])
      .neq("tournament_id", tournamentId)

    if (checkError) {
      console.error("Failed to check active tournaments:", checkError)
      throw new Error("Failed to verify tournament eligibility")
    }

    if (activeEntries && activeEntries.length > 0) {
      const activeTournamentTitle = (activeEntries[0] as any).tournaments?.title || "another tournament"
      throw new Error(`ALREADY_IN_TOURNAMENT:${activeTournamentTitle}`)
    }

    // 2. Record escrow payment
    const { error: escrowError } = await supabase.from("escrow").insert({
      tournament_id: tournamentId,
      user_id: userId,
      amount: entryAmount,
      transaction_signature: transactionSignature,
      status: "confirmed",
    })

    if (escrowError) {
      console.error("Failed to record escrow:", escrowError)
      throw new Error("Failed to record payment")
    }

    // 3. Create tournament entry
    const { error: entryError } = await supabase.from("tournament_entries").insert({
      tournament_id: tournamentId,
      user_id: userId,
      entry_amount: entryAmount,
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

    // 4. Update user stats
    await supabase
      .from("users")
      .update({
        total_tournaments_entered: existingUser ? existingUser.total_tournaments_entered + 1 : 1,
      })
      .eq("wallet_address", walletAddress)

    return { success: true, message: "Successfully entered tournament" }
  } catch (error) {
    console.error("Entry verification failed:", error)
    return {
      success: false,
      message: error instanceof Error ? error.message : "Failed to verify entry",
    }
  }
}
