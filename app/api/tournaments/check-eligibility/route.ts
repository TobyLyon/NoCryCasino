import { createServiceClient } from "@/lib/supabase/service"
import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { walletAddress, tournamentId } = await request.json()

    console.log("[v0] Eligibility check for wallet:", walletAddress, "tournament:", tournamentId)

    if (!walletAddress || !tournamentId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const supabase = createServiceClient()

    // Get user by wallet address
    const { data: user } = await supabase.from("users").select("id").eq("wallet_address", walletAddress).maybeSingle()

    console.log("[v0] User found:", user)

    if (!user) {
      console.log("[v0] New user - eligible")
      return NextResponse.json({ eligible: true })
    }

    // Check if already entered THIS tournament
    const { data: existingEntry } = await supabase
      .from("tournament_entries")
      .select("id")
      .eq("user_id", user.id)
      .eq("tournament_id", tournamentId)
      .maybeSingle()

    console.log("[v0] Existing entry in this tournament:", existingEntry)

    if (existingEntry) {
      console.log("[v0] User already entered this tournament")
      return NextResponse.json({
        eligible: false,
        reason: "ALREADY_ENTERED",
        message: "You've already entered this tournament with your current wallet.",
      })
    }

    const { data: activeEntries, error: activeError } = await supabase
      .from("tournament_entries")
      .select("id, tournament_id, status, tournaments(id, title, status)")
      .eq("user_id", user.id)
      .eq("status", "active")

    console.log("[v0] Active entries query result:", { activeEntries, activeError })

    if (activeEntries && activeEntries.length > 0) {
      // Filter for entries where tournament is not this one
      const otherActiveEntries = activeEntries.filter((entry: any) => entry.tournament_id !== tournamentId)

      console.log("[v0] Other active entries:", otherActiveEntries)

      if (otherActiveEntries.length > 0) {
        const activeTournamentRaw = (otherActiveEntries[0] as any)?.tournaments
        const activeTournament = Array.isArray(activeTournamentRaw) ? activeTournamentRaw[0] : activeTournamentRaw
        console.log("[v0] User is in another active tournament:", activeTournament)
        return NextResponse.json({
          eligible: false,
          reason: "IN_OTHER_TOURNAMENT",
          message: `You're already in an active tournament: ${activeTournament?.title || "Unknown"}`,
          tournamentName: activeTournament?.title,
        })
      }
    }

    console.log("[v0] User is eligible to enter")
    return NextResponse.json({ eligible: true })
  } catch (error) {
    console.error("[v0] Eligibility check failed:", error)
    return NextResponse.json({ error: "Failed to check eligibility" }, { status: 500 })
  }
}
