"use client"

import { useEffect, useState } from "react"
import { Header } from "@/components/header"
import { AsciiShaderBackground } from "@/components/ascii-shader-background"
import { createBrowserClient } from "@/lib/supabase/client"
import { Loader2 } from "lucide-react"

interface Mission {
  id: string
  title: string
  description: string
  reward_amount: number
  difficulty: "easy" | "medium" | "hard" | "expert"
  target_value: number
  time_limit_hours?: number
  status: "active" | "completed" | "expired"
  mission_type: string
}

export default function MissionsPage() {
  const [missions, setMissions] = useState<Mission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchMissions() {
      const supabase = createBrowserClient()

      const { data, error } = await supabase
        .from("missions")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false })

      if (error) {
        console.error("Error fetching missions:", error)
      } else {
        setMissions(data || [])
      }

      setLoading(false)
    }

    fetchMissions()
  }, [])

  if (loading) {
    return (
      <div className="relative min-h-screen bg-black">
        <AsciiShaderBackground mode="plasma" opacity={0.12} color="emerald" />
        <div className="relative z-10">
          <Header />
          <main className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
          </main>
        </div>
      </div>
    )
  }

  if (missions.length === 0) {
    return (
      <div className="relative min-h-screen bg-black">
        <AsciiShaderBackground mode="plasma" opacity={0.12} color="emerald" />
        <div className="relative z-10">
          <Header />
          <main className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold mb-2">Missions</h1>
            <p className="text-muted-foreground">
              Complete trading challenges to earn SOL rewards and prove your skills
            </p>
          </div>

          <div className="flex flex-col items-center justify-center py-20 px-4 text-center min-h-[60vh]">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
                <path d="M4 22h16"></path>
                <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
                <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
              </svg>
            </div>
            <h1 className="text-4xl font-bold mb-4">Missions</h1>
            <p className="text-xl text-muted-foreground">Coming Soon!</p>
          </div>
          </main>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-black">
      <AsciiShaderBackground mode="plasma" opacity={0.12} color="emerald" />
      <div className="relative z-10">
        <Header />
        <main className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Missions</h1>
          <p className="text-muted-foreground">Complete trading challenges to earn SOL rewards and prove your skills</p>
        </div>

        <div className="flex flex-col items-center justify-center py-20 px-4 text-center min-h-[60vh]">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"></path>
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"></path>
              <path d="M4 22h16"></path>
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"></path>
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"></path>
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"></path>
            </svg>
          </div>
          <h1 className="text-4xl font-bold mb-4">Missions</h1>
          <p className="text-xl text-muted-foreground">Coming Soon!</p>
        </div>
        </main>
      </div>
    </div>
  )
}
