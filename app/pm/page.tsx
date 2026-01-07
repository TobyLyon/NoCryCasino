"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { Header } from "@/components/header"

type MarketType = "DAILY" | "WEEKLY" | "MONTHLY"

type RoundRow = {
  round_id: string
  market_type: MarketType
  start_ts: string
  lock_ts: string
  settle_ts: string
  status: string
  collateral_mint: string
  escrow_wallet_pubkey: string
  rake_bps: number
  snapshot_hash: string | null
}

export default function PredictionMarketsPage() {
  const [marketType, setMarketType] = useState<MarketType>("DAILY")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rounds, setRounds] = useState<RoundRow[]>([])

  useEffect(() => {
    let mounted = true

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/pm/rounds?market_type=${encodeURIComponent(marketType)}&limit=50`)
        const json = (await res.json().catch(() => null)) as any
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load rounds")
        if (!mounted) return
        setRounds(Array.isArray(json?.rounds) ? (json.rounds as RoundRow[]) : [])
        setLoading(false)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message ?? String(e))
        setRounds([])
        setLoading(false)
      }
    }

    run()

    return () => {
      mounted = false
    }
  }, [marketType])

  const title = useMemo(() => {
    if (marketType === "WEEKLY") return "Weekly"
    if (marketType === "MONTHLY") return "Monthly"
    return "Daily"
  }, [marketType])

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Prediction Markets</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            Orderbook-style prediction markets with deposits, positions, and limit orders.
          </div>
        </div>

        <div className="mb-6 inline-flex rounded-lg border border-border/60 bg-background/50 p-1">
          <button
            type="button"
            onClick={() => setMarketType("DAILY")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              marketType === "DAILY" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Daily
          </button>
          <button
            type="button"
            onClick={() => setMarketType("WEEKLY")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              marketType === "WEEKLY" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setMarketType("MONTHLY")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              marketType === "MONTHLY" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Monthly
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Loading {title} rounds…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Failed to load rounds: {error}
          </div>
        ) : rounds.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            No {title.toLowerCase()} rounds yet.
            <div className="mt-2 text-xs">
              Create rounds via the admin bootstrap endpoint and they will show up here.
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {rounds.map((r) => (
              <div key={r.round_id} className="rounded-xl border border-border/60 bg-card/50 px-4 py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.round_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.market_type} • locks {new Date(r.lock_ts).toLocaleString()} • settles {new Date(r.settle_ts).toLocaleString()} • {r.status}
                    </div>
                  </div>
                  <Link
                    href={`/pm/rounds/${encodeURIComponent(r.round_id)}`}
                    className="h-9 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 inline-flex items-center justify-center"
                  >
                    View
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
