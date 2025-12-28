"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Trophy, Users, Target, Sparkles, Crown } from "lucide-react"
import Link from "next/link"
import { TournamentCountdown } from "./tournament-countdown"
import { cn } from "@/lib/utils"

interface Tournament {
  id: string
  title: string
  description?: string | null
  tournament_type: string
  entry_fee: number
  prize_pool: number
  current_participants: number
  max_participants: number
  target_value?: number | null
  target_count?: number | null
  status: string
  start_date: string | null
  end_date: string | null
}

export function TournamentCard({ tournament, featured = false }: { tournament: Tournament; featured?: boolean }) {
  const participantPercentage = tournament.max_participants
    ? (tournament.current_participants / tournament.max_participants) * 100
    : 0

  const isLive = tournament.status === "active"

  const getTargetDisplay = () => {
    if (tournament.tournament_type === "consecutive_wins") {
      return `${tournament.target_count ?? 0}x Streak`
    }
    if (tournament.tournament_type === "volume_race") {
      return `$${(tournament.target_value ?? 0).toLocaleString()} Vol`
    }
    if (tournament.tournament_type === "pnl_absolute") {
      return `${tournament.target_value ?? 0} SOL`
    }
    return `+${tournament.target_value ?? 0}%`
  }

  return (
    <Card
      className={cn(
        "relative group overflow-hidden bg-gradient-to-br from-card via-card to-card/50 border-2 border-border/50 hover:border-primary/50 transition-all duration-300 hover:shadow-2xl hover:shadow-primary/10 hover:-translate-y-1",
        featured &&
          "border-primary/50 hover:border-primary/70 shadow-xl shadow-primary/20 hover:shadow-2xl hover:shadow-primary/30",
      )}
    >
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300",
          featured && "from-primary/10 via-transparent to-primary/10 opacity-100",
        )}
      />

      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-r from-transparent via-primary/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000",
          featured && "via-primary/20",
        )}
      />

      <div className="relative p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              {featured && <Crown className="h-5 w-5 text-primary" />}
              <h3 className="text-xl font-bold tracking-tight">{tournament.title || "Untitled Tournament"}</h3>
            </div>
            {tournament.description && (
              <p className="text-sm text-muted-foreground line-clamp-1">{tournament.description}</p>
            )}
          </div>
          <Badge variant={isLive ? "default" : "secondary"} className="ml-2 gap-1">
            {isLive && <Sparkles className="h-3 w-3" />}
            {isLive ? "Live" : "Upcoming"}
          </Badge>
        </div>

        <div className="space-y-4">
          <div
            className={cn(
              "flex items-center gap-3 p-4 rounded-lg bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10 border border-primary/20",
              featured && "from-primary/20 via-accent/20 to-primary/20 border-primary/30",
            )}
          >
            <div className={cn("p-2 rounded-full bg-primary/20", featured && "bg-primary/30")}>
              <Trophy className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Prize Pool</div>
              <div
                className={cn(
                  "text-2xl font-bold bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent",
                  featured && "from-primary via-accent to-primary",
                )}
              >
                {tournament.prize_pool ?? 0} SOL
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border/50">
              <Target className="h-4 w-4 text-primary shrink-0" />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Target</div>
                <div className="text-sm font-semibold truncate">{getTargetDisplay()}</div>
              </div>
            </div>
            <div className="p-3 rounded-lg bg-secondary/50 border border-border/50">
              <TournamentCountdown endDate={tournament.end_date} />
            </div>
          </div>

          <div className="p-4 rounded-lg bg-secondary/30 border border-border/50">
            <div className="flex items-center justify-between text-sm mb-3">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {tournament.current_participants ?? 0}/{tournament.max_participants ?? 0} Players
                </span>
              </div>
              <span className="font-mono font-semibold text-primary">{Math.round(participantPercentage)}%</span>
            </div>
            <Progress value={participantPercentage} className="h-2.5 bg-secondary" />
          </div>

          <div className="pt-4 border-t border-border/50">
            <div className="flex items-center justify-between mb-4 px-1">
              <span className="text-sm text-muted-foreground uppercase tracking-wider">Entry Fee</span>
              <span className="text-lg font-bold text-primary">{tournament.entry_fee ?? 0} SOL</span>
            </div>
            <Button
              asChild
              className={cn(
                "w-full bg-gradient-to-r from-primary via-accent to-primary hover:from-primary/90 hover:via-accent/90 hover:to-primary/90 font-bold tracking-wide shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all duration-300",
                featured &&
                  "from-primary via-accent to-primary hover:from-primary/90 hover:via-accent/90 hover:to-primary/90 shadow-primary/30 hover:shadow-primary/50",
              )}
            >
              <Link href={`/tournaments/${tournament.id}`}>{isLive ? "Join Now" : "View Details"}</Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}
