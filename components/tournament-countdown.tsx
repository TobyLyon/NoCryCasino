"use client"

import { useEffect, useState } from "react"
import { Clock } from "lucide-react"

interface TournamentCountdownProps {
  endDate: string | null
  className?: string
}

export function TournamentCountdown({ endDate, className = "" }: TournamentCountdownProps) {
  const [timeLeft, setTimeLeft] = useState("")

  useEffect(() => {
    if (!endDate) {
      setTimeLeft("TBA")
      return
    }

    const calculateTimeLeft = () => {
      try {
        const end = new Date(endDate).getTime()

        if (isNaN(end)) {
          setTimeLeft("Invalid Date")
          return
        }

        const now = new Date().getTime()
        const difference = end - now

        if (difference <= 0) {
          setTimeLeft("Ended")
          return
        }

        const days = Math.floor(difference / (1000 * 60 * 60 * 24))
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((difference % (1000 * 60)) / 1000)

        if (days > 0) {
          setTimeLeft(`${days}d ${hours}h ${minutes}m`)
        } else if (hours > 0) {
          setTimeLeft(`${hours}h ${minutes}m ${seconds}s`)
        } else {
          setTimeLeft(`${minutes}m ${seconds}s`)
        }
      } catch (error) {
        console.error("[v0] Error calculating countdown:", error)
        setTimeLeft("Error")
      }
    }

    calculateTimeLeft()
    const interval = setInterval(calculateTimeLeft, 1000)

    return () => clearInterval(interval)
  }, [endDate])

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Clock className="h-4 w-4 text-primary shrink-0" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">Time Left</div>
        <div className="text-sm font-semibold font-mono truncate">{timeLeft}</div>
      </div>
    </div>
  )
}
