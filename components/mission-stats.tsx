import { Card } from "@/components/ui/card"
import { Trophy, Target, CheckCircle2, Zap } from "lucide-react"

interface Mission {
  status: "available" | "active" | "completed"
  reward: number
}

export function MissionStats({ missions }: { missions: Mission[] }) {
  const activeMissions = missions.filter((m) => m.status === "active").length
  const completedMissions = missions.filter((m) => m.status === "completed").length
  const totalRewards = missions.filter((m) => m.status === "completed").reduce((sum, m) => sum + m.reward, 0)
  const availableMissions = missions.filter((m) => m.status === "available").length

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{activeMissions}</div>
            <div className="text-sm text-muted-foreground">Active</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{completedMissions}</div>
            <div className="text-sm text-muted-foreground">Completed</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{totalRewards} SOL</div>
            <div className="text-sm text-muted-foreground">Earned</div>
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Target className="h-5 w-5 text-primary" />
          </div>
          <div>
            <div className="text-2xl font-bold">{availableMissions}</div>
            <div className="text-sm text-muted-foreground">Available</div>
          </div>
        </div>
      </Card>
    </div>
  )
}
