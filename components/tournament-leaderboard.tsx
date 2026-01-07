"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trophy, TrendingUp } from "lucide-react"
import { useEffect, useState } from "react"
import { createBrowserClient } from "@/lib/supabase/client"

interface LeaderboardEntry {
  rank: number
  player: string
  pnl: number
  trades: number
  status: "active" | "eliminated" | "winner"
  current_roi: number
  current_volume: number
}

export function TournamentLeaderboard({
  tournamentId,
  tournamentType: _tournamentType,
}: {
  tournamentId: string
  tournamentType?: string
}) {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createBrowserClient()

  useEffect(() => {
    async function fetchLeaderboard() {
      try {
        const { data, error } = await supabase
          .from("tournament_entries")
          .select("id, tournament_id, wallet_address, current_roi, current_volume, status")
          .eq("tournament_id", tournamentId)
          .order("current_roi", { ascending: false })

        if (error) {
          console.error("[v0] Error fetching leaderboard:", error)
          return
        }

        const formattedData =
          data?.map((entry, index) => ({
            rank: index + 1,
            player: entry.wallet_address,
            pnl: Number(entry.current_roi) || 0,
            trades: 0, // TODO: Add trades count
            status: entry.status as "active" | "eliminated" | "winner",
            current_roi: Number(entry.current_roi) || 0,
            current_volume: Number(entry.current_volume) || 0,
          })) || []

        setLeaderboard(formattedData)
      } catch (err) {
        console.error("[v0] Exception fetching leaderboard:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchLeaderboard()

    // Subscribe to real-time updates
    const channel = supabase
      .channel("leaderboard-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tournament_entries",
          filter: `tournament_id=eq.${tournamentId}`,
        },
        () => {
          fetchLeaderboard()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [tournamentId])

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Trophy className="h-5 w-5 text-primary" />
          <h2 className="text-2xl font-bold">Live Leaderboard</h2>
        </div>
        <div className="text-center text-muted-foreground py-8">Loading...</div>
      </Card>
    )
  }

  if (leaderboard.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-6">
          <Trophy className="h-5 w-5 text-primary" />
          <h2 className="text-2xl font-bold">Live Leaderboard</h2>
        </div>
        <div className="text-center text-muted-foreground py-8">No entries yet. Be the first to join!</div>
      </Card>
    )
  }

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-6">
        <Trophy className="h-5 w-5 text-primary" />
        <h2 className="text-2xl font-bold">Live Leaderboard</h2>
      </div>

      <div className="space-y-3">
        {leaderboard.map((entry) => (
          <div
            key={entry.rank}
            className="flex items-center gap-4 p-4 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
          >
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 font-bold text-primary">
              {entry.rank}
            </div>

            <div className="flex-1">
              <div className="font-mono font-semibold text-sm">{entry.player}</div>
              <div className="text-sm text-muted-foreground">{entry.trades} trades</div>
            </div>

            <div className="text-right">
              <div className="flex items-center gap-1 font-bold text-lg text-primary">
                <TrendingUp className="h-4 w-4" />
                {entry.pnl > 0 ? "+" : ""}
                {entry.pnl.toFixed(2)}%
              </div>
              <Badge variant="secondary" className="text-xs">
                {entry.status}
              </Badge>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
