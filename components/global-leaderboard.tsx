"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trophy, Award } from "lucide-react"
import { useEffect, useState } from "react"
import { createBrowserClient } from "@/lib/supabase/client"

interface Trader {
  rank: number
  player: string
  totalWinnings: number
  tournamentsWon: number
  winRate: number
  avgPnl: number
}

export function GlobalLeaderboard() {
  const [traders, setTraders] = useState<Trader[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createBrowserClient()

  useEffect(() => {
    async function fetchGlobalLeaderboard() {
      try {
        const { data, error } = await supabase
          .from("users")
          .select("*")
          .order("total_winnings", { ascending: false })
          .limit(10)

        if (error) {
          console.error("Error fetching global leaderboard:", error)
          return
        }

        const formattedData =
          data?.map((user, index) => ({
            rank: index + 1,
            player: user.wallet_address,
            totalWinnings: Number(user.total_winnings) || 0,
            tournamentsWon: user.total_tournaments_won || 0,
            winRate:
              user.total_tournaments_entered > 0
                ? Math.round((user.total_tournaments_won / user.total_tournaments_entered) * 100)
                : 0,
            avgPnl: 0,
          })) || []

        setTraders(formattedData)
      } catch (err) {
        console.error("Exception fetching global leaderboard:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchGlobalLeaderboard()

    const channel = supabase
      .channel("users-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "users",
        },
        () => {
          fetchGlobalLeaderboard()
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5 text-yellow-500" />
    if (rank === 2) return <Trophy className="h-5 w-5 text-gray-400" />
    if (rank === 3) return <Trophy className="h-5 w-5 text-amber-600" />
    return null
  }

  if (loading) {
    return (
      <Card className="p-6 mt-6">
        <div className="text-center text-muted-foreground py-8">Loading global leaderboard...</div>
      </Card>
    )
  }

  if (traders.length === 0) {
    return (
      <Card className="p-12 mt-6">
        <div className="flex flex-col items-center justify-center text-center">
          <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Trophy className="h-8 w-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No Traders Yet</h3>
          <p className="text-muted-foreground max-w-sm">
            Join a tournament to compete and get on the global leaderboard!
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="p-6 mt-6">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 font-semibold">Rank</th>
              <th className="text-left py-3 px-4 font-semibold">Player</th>
              <th className="text-right py-3 px-4 font-semibold">Total Winnings</th>
              <th className="text-right py-3 px-4 font-semibold">Tournaments Won</th>
              <th className="text-right py-3 px-4 font-semibold">Win Rate</th>
            </tr>
          </thead>
          <tbody>
            {traders.map((trader) => (
              <tr key={trader.rank} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                <td className="py-4 px-4">
                  <div className="flex items-center gap-2">
                    {getRankIcon(trader.rank)}
                    <span className="font-bold text-lg">{trader.rank}</span>
                  </div>
                </td>
                <td className="py-4 px-4">
                  <span className="font-mono font-semibold text-sm">{trader.player}</span>
                </td>
                <td className="py-4 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Trophy className="h-4 w-4 text-primary" />
                    <span className="font-bold text-primary">{trader.totalWinnings.toFixed(2)} SOL</span>
                  </div>
                </td>
                <td className="py-4 px-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Award className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold">{trader.tournamentsWon}</span>
                  </div>
                </td>
                <td className="py-4 px-4 text-right">
                  <Badge variant="secondary">{trader.winRate}%</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
