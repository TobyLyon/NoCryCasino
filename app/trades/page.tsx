"use client"

import { Header } from "@/components/header"
import { AsciiShaderBackground } from "@/components/ascii-shader-background"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export default function TradesPage() {
  return (
    <div className="relative min-h-screen bg-black">
      <AsciiShaderBackground mode="matrix" opacity={0.06} color="emerald" />
      <div className="relative z-10">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="mb-4">
            <h1 className="text-2xl font-semibold">Realtime Trades</h1>
          </div>

          <div className="mb-6">
            <Button variant="outline" className="bg-transparent backdrop-blur-sm">
              Filter Wallets
            </Button>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-56 border-border/40 bg-card/30 backdrop-blur-sm" />
            ))}
          </div>

          <div className="mt-10 text-center text-xs text-muted-foreground">
            © 2025 Kolscan. All rights reserved. | Privacy | Terms of Use
          </div>
        </main>
      </div>
    </div>
  )
}
