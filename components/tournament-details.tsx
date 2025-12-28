import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Trophy, Users, Target, Clock } from "lucide-react"

interface Tournament {
  id: string
  title: string
  description: string
  prizePool: number
  entryFee: number
  participants: number
  maxParticipants: number
  target: number
  duration: string
  status: "live" | "upcoming" | "ended"
  endsAt: Date
  startedAt: Date
  rules: string[]
}

export function TournamentDetails({ tournament }: { tournament: Tournament }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">{tournament.title}</h1>
          <p className="text-muted-foreground">{tournament.description}</p>
        </div>
        <Badge variant={tournament.status === "live" ? "default" : "secondary"} className="text-sm">
          {tournament.status === "live" ? "Live Now" : tournament.status === "ended" ? "Ended" : "Upcoming"}
        </Badge>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Prize Pool</div>
            <div className="font-bold">{tournament.prizePool} SOL</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Players</div>
            <div className="font-bold">
              {tournament.participants}/{tournament.maxParticipants}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Target</div>
            <div className="font-bold">+{tournament.target}%</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Clock className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-sm text-muted-foreground">Duration</div>
            <div className="font-bold">{tournament.duration}</div>
          </div>
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-border">
        <h3 className="font-bold mb-3">Tournament Rules</h3>
        <ul className="space-y-2">
          {tournament.rules.map((rule, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-muted-foreground">
              <span className="text-primary mt-0.5">•</span>
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}
