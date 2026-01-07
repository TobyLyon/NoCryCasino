import { Header } from "@/components/header"
import { TournamentDetails } from "@/components/tournament-details"
import { TournamentLeaderboard } from "@/components/tournament-leaderboard"
import { TournamentEntry } from "@/components/tournament-entry"
import { createServerClient } from "@/lib/supabase/server"

export default async function TournamentPage({ params }: { params: { id: string } }) {
  const supabase = await createServerClient()

  const { data: tournament, error } = await supabase.from("tournaments").select("*").eq("id", params.id).single()

  if (error || !tournament) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="text-center py-12">
            <h1 className="text-2xl font-bold mb-4">Tournament Not Found</h1>
            <p className="text-muted-foreground">The tournament you're looking for doesn't exist.</p>
          </div>
        </main>
      </div>
    )
  }

  const statusRaw = String(tournament.status ?? "upcoming")
  const status = (statusRaw === "active"
    ? "live"
    : statusRaw === "completed"
      ? "ended"
      : statusRaw === "live" || statusRaw === "upcoming" || statusRaw === "ended"
        ? statusRaw
        : "upcoming") as "live" | "upcoming" | "ended"

  const formattedTournament = {
    id: tournament.id,
    title: tournament.title,
    description: tournament.description,
    tournamentType: tournament.tournament_type,
    prizePool: Number(tournament.prize_pool),
    entryFee: Number(tournament.entry_fee),
    participants: tournament.current_participants || 0,
    maxParticipants: tournament.max_participants,
    target: Number(tournament.target_value),
    duration: tournament.duration || "24h",
    status,
    endsAt: new Date(tournament.end_date),
    startedAt: new Date(tournament.start_date),
    escrowWalletAddress: tournament.escrow_wallet_address || null,
    rules: tournament.rules || [
      `First to reach +${tournament.target_value}% wins`,
      "No wash trading or manipulation",
      "Winner takes entire prize pool",
    ],
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-8">
            <TournamentDetails tournament={formattedTournament} />
            <TournamentLeaderboard tournamentId={tournament.id} tournamentType={tournament.tournament_type} />
          </div>

          <div className="lg:col-span-1">
            <TournamentEntry tournament={formattedTournament} />
          </div>
        </div>
      </main>
    </div>
  )
}
