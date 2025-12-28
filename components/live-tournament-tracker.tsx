"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, Clock, Users } from "lucide-react"
import { useEffect, useState } from "react"

interface LiveTournament {
  id: string
  title: string
  participants: number
  leader: string
  leaderPnl: number
  timeRemaining: string
}

export function LiveTournamentTracker() {
  const [tournaments, setTournaments] = useState<LiveTournament[]>([
    {
      id: "1",
      title: "Weekend Warrior",
      participants: 8,
      leader: "0x7a3f...9b2c",
      leaderPnl: 87.5,
      timeRemaining: "1d 18h",
    },
    {
      id: "2",
      title: "Speed Demon",
      participants: 12,
      leader: "0x4e8d...1a5f",
      leaderPnl: 72.3,
      timeRemaining: "18h 42m",
    },
    {
      id: "3",
      title: "Quick Strike",
      participants: 15,
      leader: "0x9c2b...6d4e",
      leaderPnl: 65.1,
      timeRemaining: "6h 15m",
    },
  ])

  // Simulate live updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTournaments((prev) =>
        prev.map((t) => ({
          ...t,
          leaderPnl: t.leaderPnl + (Math.random() - 0.5) * 2,
        })),
      )
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Live Tournaments</h2>
        <Badge variant="default" className="animate-pulse">
          Live
        </Badge>
      </div>

      <div className="grid gap-4">
        {tournaments.map((tournament) => (
          <Card key={tournament.id} className="p-4 hover:border-primary/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <h3 className="font-bold mb-1">{tournament.title}</h3>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {tournament.participants} players
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {tournament.timeRemaining}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm text-muted-foreground mb-1">Leader</div>
                <div className="font-mono text-sm font-semibold mb-1">{tournament.leader}</div>
                <div className="flex items-center gap-1 text-primary font-bold">
                  <TrendingUp className="h-4 w-4" />+{tournament.leaderPnl.toFixed(1)}%
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
