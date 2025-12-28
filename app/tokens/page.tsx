"use client"

import { Header } from "@/components/header"
import { Card } from "@/components/ui/card"

const groups = [
  { title: "Low Caps", subtitle: "MC 10-1k" },
  { title: "$100k+", subtitle: "" },
  { title: "$1m+", subtitle: "" },
]

export default function TokensPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Realtime Token Tracker</h1>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {groups.map((g) => (
            <div key={g.title} className="space-y-3">
              <div className="text-sm font-semibold">{g.title}</div>
              <Card className="p-0 overflow-hidden border-border/60 bg-card/70">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">ape</div>
                    <div className="text-xs text-muted-foreground">{g.subtitle}</div>
                  </div>
                  <div className="text-sm font-semibold text-primary">+0.0%</div>
                </div>
                <div className="divide-y divide-border/50">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="px-4 py-3 flex items-center justify-between text-sm">
                      <div className="text-primary font-semibold">0.00 Sol (+0.00)</div>
                      <div className="text-xs text-muted-foreground">0s</div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
