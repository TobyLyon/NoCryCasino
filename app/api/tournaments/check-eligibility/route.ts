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

    const { data: tournament, error: tErr } = await supabase
      .from("tournaments")
      .select("id, status, max_participants, current_participants")
      .eq("id", tournamentId)
      .maybeSingle()

    if (tErr) {
      console.error("[v0] Failed to load tournament:", tErr)
      return NextResponse.json({ error: "Failed to load tournament" }, { status: 500 })
    }

    if (!tournament) {
      return NextResponse.json({ eligible: false, reason: "TOURNAMENT_NOT_FOUND", message: "Tournament not found" })
    }

    const status = String((tournament as any)?.status ?? "")
    if (status !== "active" && status !== "upcoming") {
      return NextResponse.json({ eligible: false, reason: "TOURNAMENT_NOT_OPEN", message: "Tournament is not open" })
    }

    const max = Number((tournament as any)?.max_participants)
    const cur = Number((tournament as any)?.current_participants)
    if (Number.isFinite(max) && max > 0 && Number.isFinite(cur) && cur >= max) {
      return NextResponse.json({ eligible: false, reason: "TOURNAMENT_FULL", message: "Tournament is full" })
    }

    // Check if already entered THIS tournament
    const { data: existingEntry, error: existingErr } = await supabase
      .from("tournament_entries")
      .select("id")
      .eq("wallet_address", walletAddress)
      .eq("tournament_id", tournamentId)
      .maybeSingle()

    if (existingErr) {
      console.error("[v0] Existing entry check failed:", existingErr)
      return NextResponse.json({ error: "Failed to check existing entry" }, { status: 500 })
    }

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
      .eq("wallet_address", walletAddress)
      .eq("status", "active")

    console.log("[v0] Active entries query result:", { activeEntries, activeError })

    if (activeError) {
      console.error("[v0] Active entries query failed:", activeError)
      return NextResponse.json({ error: "Failed to check active entries" }, { status: 500 })
    }

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
