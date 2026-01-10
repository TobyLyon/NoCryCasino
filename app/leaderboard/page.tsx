"use client"

import { Header } from "@/components/header"
import { AsciiShaderBackground } from "@/components/ascii-shader-background"
import { KolLeaderboard } from "@/components/kolscan/kol-leaderboard"

export default function LeaderboardPage() {
  return (
    <div className="relative min-h-screen bg-black">
      <AsciiShaderBackground mode="plasma" opacity={0.12} color="emerald" />
      <div className="relative z-10">
        <Header />
        <KolLeaderboard />
      </div>
    </div>
  )
}
