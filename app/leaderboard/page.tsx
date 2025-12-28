"use client"

import { Header } from "@/components/header"
import { KolLeaderboard } from "@/components/kolscan/kol-leaderboard"

export default function LeaderboardPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <KolLeaderboard />
    </div>
  )
}
