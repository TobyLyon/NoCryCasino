"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/header"

type WindowKey = "daily" | "weekly" | "monthly"

type MarketRow = {
  id: string
  window_key: WindowKey
  kol_wallet_address: string
  closes_at: string
  status: "open" | "closed" | "settled" | "cancelled"
  created_at: string
  kols?: {
    display_name: string | null
    avatar_url: string | null
    twitter_url: string | null
    twitter_handle: string | null
  } | null
}

export default function MarketsPage() {
  const [windowKey, setWindowKey] = useState<WindowKey>("daily")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<MarketRow[]>([])

  useEffect(() => {
    let mounted = true

    async function run() {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/markets?window=${encodeURIComponent(windowKey)}`)
        const json = (await res.json()) as any

        if (!res.ok || !json?.ok) {
          throw new Error(json?.error ?? "Failed to load markets")
        }

        if (!mounted) return
        setMarkets(Array.isArray(json?.markets) ? json.markets : [])
        setLoading(false)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message ?? String(e))
        setMarkets([])
        setLoading(false)
      }
    }

    run()

    return () => {
      mounted = false
    }
  }, [windowKey])

  const title = useMemo(() => {
    if (windowKey === "weekly") return "Weekly"
    if (windowKey === "monthly") return "Monthly"
    return "Daily"
  }, [windowKey])

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Markets</h1>
          <div className="mt-1 text-sm text-muted-foreground">
            Polymarket-style markets. Top 3 KOLs (by profit) resolve YES.
          </div>
        </div>

        <div className="mb-6 inline-flex rounded-lg border border-border/60 bg-background/50 p-1">
          <button
            type="button"
            onClick={() => setWindowKey("daily")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              windowKey === "daily" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Daily
          </button>
          <button
            type="button"
            onClick={() => setWindowKey("weekly")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              windowKey === "weekly" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Weekly
          </button>
          <button
            type="button"
            onClick={() => setWindowKey("monthly")}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              windowKey === "monthly" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Monthly
          </button>
        </div>

        {loading ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Loading {title} markets…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Failed to load markets: {error}
          </div>
        ) : markets.length === 0 ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            No {title.toLowerCase()} markets yet.
            <div className="mt-2 text-xs">
              Once you create markets (one per tracked KOL per window), they will appear here.
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {markets.map((m) => {
              const name =
                typeof m.kols?.display_name === "string" && m.kols.display_name.length > 0
                  ? m.kols.display_name
                  : `${m.kol_wallet_address.slice(0, 4)}…${m.kol_wallet_address.slice(-4)}`

              return (
                <div
                  key={m.id}
                  className="flex items-center gap-4 rounded-xl border border-border/60 bg-card/50 px-4 py-3"
                >
                  {m.kols?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.kols.avatar_url}
                      alt={name}
                      className="h-10 w-10 rounded-full border border-border/60"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded-full border border-border/60 bg-background/40" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      {title} • closes {new Date(m.closes_at).toLocaleString()} • {m.status}
                    </div>
                  </div>

                  <Link
                    href={`/leaderboard?timeframe=${m.window_key}`}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    View leaderboard
                  </Link>

                  <Link
                    href={`/markets/${m.id}`}
                    className="h-9 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 inline-flex items-center"
                  >
                    Bet
                  </Link>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
