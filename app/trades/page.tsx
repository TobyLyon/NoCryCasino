"use client"

import { Header } from "@/components/header"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function TradesPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="mb-4">
          <h1 className="text-2xl font-semibold">Realtime Trades</h1>
        </div>

        <div className="mb-6">
          <Button variant="outline" className="bg-transparent">
            Filter Wallets
          </Button>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-56 border-border/60 bg-card/70" />
          ))}
        </div>

        <div className="mt-10 text-center text-xs text-muted-foreground">
          © 2025 Kolscan. All rights reserved. | Privacy | Terms of Use
        </div>
      </main>
    </div>
  )
}
