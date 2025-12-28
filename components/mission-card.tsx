"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Trophy, Clock, CheckCircle2 } from "lucide-react"

interface Mission {
  id: string
  title: string
  description: string
  reward: number
  difficulty: "easy" | "medium" | "hard"
  progress: number
  target: number
  timeLimit: string
  status: "available" | "active" | "completed"
}

export function MissionCard({ mission }: { mission: Mission }) {
  const progressPercentage = (mission.progress / mission.target) * 100

  const difficultyColors = {
    easy: "bg-green-500/10 text-green-500",
    medium: "bg-yellow-500/10 text-yellow-500",
    hard: "bg-red-500/10 text-red-500",
  }

  return (
    <Card className="p-6 hover:border-primary/50 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold mb-1">{mission.title}</h3>
          <p className="text-sm text-muted-foreground">{mission.description}</p>
        </div>
        {mission.status === "completed" && <CheckCircle2 className="h-6 w-6 text-primary flex-shrink-0 ml-2" />}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Badge variant="secondary" className={difficultyColors[mission.difficulty]}>
          {mission.difficulty}
        </Badge>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" />
          {mission.timeLimit}
        </div>
      </div>

      {mission.status !== "available" && (
        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-semibold">
              {mission.progress}/{mission.target}
            </span>
          </div>
          <Progress value={progressPercentage} className="h-2" />
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-border">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          <span className="font-bold text-lg">{mission.reward} SOL</span>
        </div>

        {mission.status === "available" && <Button size="sm">Start Mission</Button>}
        {mission.status === "active" && (
          <Button size="sm" variant="outline">
            View Progress
          </Button>
        )}
        {mission.status === "completed" && (
          <Badge variant="default" className="bg-primary">
            Completed
          </Badge>
        )}
      </div>
    </Card>
  )
}
