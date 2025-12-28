"use client"

import { Header } from "@/components/header"
import { TournamentCard } from "@/components/tournament-card"
import { TournamentFilters } from "@/components/tournament-filters"
import { createBrowserClient } from "@/lib/supabase/client"
import { useEffect, useState } from "react"

export default function TournamentsPage() {
  const [tournaments, setTournaments] = useState<any[]>([])
  const [filteredTournaments, setFilteredTournaments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<{
    entryFee: number | null
    jackpot: { min: number; max: number } | null
    status: string | null
  }>({
    entryFee: null,
    jackpot: null,
    status: null,
  })

  useEffect(() => {
    async function fetchTournaments() {
      const supabase = createBrowserClient()

      const { data, error } = await supabase
        .from("tournaments")
        .select("*")
        .in("status", ["active", "upcoming"])
        .order("entry_fee", { ascending: true })
        .order("start_date", { ascending: true })

      if (error) {
        console.error("Error fetching tournaments:", error)
        setError("Failed to load tournaments")
      } else {
        setTournaments(data || [])
        setFilteredTournaments(data || [])
      }
      setLoading(false)
    }

    fetchTournaments()
  }, [])

  useEffect(() => {
    let filtered = tournaments

    // Filter by entry fee
    if (filters.entryFee !== null) {
      filtered = filtered.filter((t) => t.entry_fee === filters.entryFee)
    }

    // Filter by jackpot (prize pool)
    if (filters.jackpot !== null) {
      filtered = filtered.filter((t) => {
        const prizePool = t.prize_pool || 0
        return prizePool >= filters.jackpot!.min && prizePool <= filters.jackpot!.max
      })
    }

    // Filter by status
    if (filters.status !== null) {
      filtered = filtered.filter((t) => t.status === filters.status)
    }

    setFilteredTournaments(filtered)
  }, [tournaments, filters])

  const royalRumble = filteredTournaments?.find((t) => t.title === "Royal Rumble")
  const otherTournaments = filteredTournaments?.filter((t) => t.title !== "Royal Rumble") || []

  const tournamentsByTier =
    otherTournaments?.reduce(
      (acc, tournament) => {
        const tier = tournament.entry_fee
        if (!acc[tier]) {
          acc[tier] = []
        }
        acc[tier].push(tournament)
        return acc
      },
      {} as Record<number, typeof otherTournaments>,
    ) || {}

  const tierLabels: Record<number, string> = {
    0.05: "Micro Stakes (0.05 SOL)",
    0.1: "Low Stakes (0.1 SOL)",
    0.2: "Medium Stakes (0.2 SOL)",
    0.5: "High Stakes (0.5 SOL)",
    1.0: "Elite Stakes (1 SOL)",
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Tournaments</h1>
          <p className="text-muted-foreground">
            Join live tournaments and compete for SOL prizes. Choose your stake level and compete!
          </p>
        </div>

        <TournamentFilters onFilterChange={setFilters} />

        {error && (
          <div className="mt-8 p-4 bg-destructive/10 border border-destructive rounded-lg">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="mt-8 text-center">
            <p className="text-muted-foreground">Loading tournaments...</p>
          </div>
        ) : (
          <div className="mt-8 space-y-12">
            {royalRumble && (
              <div>
                <h2 className="text-3xl font-bold mb-4 flex items-center gap-3">
                  <span className="bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                    ⭐ Featured Tournament
                  </span>
                </h2>
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-r from-primary/20 via-accent/20 to-primary/20 rounded-lg blur-xl" />
                  <div className="relative max-w-2xl">
                    <TournamentCard tournament={royalRumble} featured />
                  </div>
                </div>
              </div>
            )}

            {(Object.entries(tournamentsByTier) as [string, any[]][]).map(([tier, tierTournaments]) => {
              return (
                <div key={tier}>
                  <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
                    {tierLabels[Number(tier)]}
                    <span className="text-sm font-normal text-muted-foreground">
                      ({tierTournaments.length} tournament{tierTournaments.length !== 1 ? "s" : ""})
                    </span>
                  </h2>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {tierTournaments.map((tournament) => (
                      <TournamentCard key={tournament.id} tournament={tournament} />
                    ))}
                  </div>
                </div>
              )
            })}

            {filteredTournaments?.length === 0 && !loading && (
              <div className="text-center py-12">
                <p className="text-muted-foreground">
                  {filters.entryFee !== null || filters.jackpot !== null || filters.status !== null
                    ? "No tournaments match your filters. Try adjusting your selection."
                    : "No active tournaments at the moment. Check back soon!"}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
