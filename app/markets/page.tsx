"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Header } from "@/components/header"
import { AsciiShaderBackground } from "@/components/ascii-shader-background"
import { TrendingUp, Clock, Users, Trophy, ChevronRight, Search, Zap, Target, BarChart3 } from "lucide-react"

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

function formatTimeLeft(endDate: string): string {
  const end = new Date(endDate).getTime()
  const now = Date.now()
  const diff = end - now

  if (diff <= 0) return "Ended"

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h ${mins}m left`
  return `${mins}m left`
}

function Avatar({ src, name, size = 48 }: { src: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const initial = name.trim().length > 0 ? name.trim()[0]!.toUpperCase() : "?"

  if (!src || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 font-semibold text-emerald-400"
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {initial}
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={name}
      className="rounded-full border-2 border-border/40 object-cover"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  )
}

export default function MarketsPage() {
  const [windowKey, setWindowKey] = useState<WindowKey>("daily")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [markets, setMarkets] = useState<MarketRow[]>([])
  const [searchQuery, setSearchQuery] = useState("")

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

  const filteredMarkets = useMemo(() => {
    if (!searchQuery.trim()) return markets
    const q = searchQuery.toLowerCase()
    return markets.filter((m) => {
      const name = m.kols?.display_name?.toLowerCase() ?? ""
      const wallet = m.kol_wallet_address.toLowerCase()
      return name.includes(q) || wallet.includes(q)
    })
  }, [markets, searchQuery])

  const openCount = markets.filter((m) => m.status === "open").length
  const closedCount = markets.filter((m) => m.status === "closed" || m.status === "settled").length

  return (
    <div className="relative min-h-screen bg-black">
      <AsciiShaderBackground mode="plasma" opacity={0.12} color="emerald" />
      
      <div className="relative z-10">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-8">
        {/* Hero Section */}
        <div className="mb-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 p-2.5 border border-emerald-500/30">
                  <Target className="h-6 w-6 text-emerald-400" />
                </div>
                <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                  KOL Markets
                </h1>
              </div>
              <p className="text-lg text-muted-foreground max-w-xl">
                Bet on which KOLs will finish in the Top 3 by profit. Markets resolve automatically based on leaderboard rankings.
              </p>
            </div>

            <Link
              href="/leaderboard"
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all hover:shadow-xl hover:shadow-emerald-500/30 hover:scale-[1.02]"
            >
              <BarChart3 className="h-5 w-5" />
              View Leaderboard
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        {/* Stats Bar */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-500/10 p-2.5">
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{markets.length}</div>
                <div className="text-xs text-muted-foreground">Total Markets</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/10 p-2.5">
                <Zap className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{openCount}</div>
                <div className="text-xs text-muted-foreground">Open Now</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/10 p-2.5">
                <Trophy className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{closedCount}</div>
                <div className="text-xs text-muted-foreground">Resolved</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2.5">
                <Users className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">Top 3</div>
                <div className="text-xs text-muted-foreground">Win Condition</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filters Row */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Time Period Tabs */}
          <div className="inline-flex rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-1">
            {(["daily", "weekly", "monthly"] as WindowKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setWindowKey(key)}
                className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
                  windowKey === key
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search KOLs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full sm:w-72 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50"
            />
          </div>
        </div>

        {/* How It Works */}
        <div className="mb-8 rounded-2xl border border-border/40 bg-gradient-to-r from-emerald-500/5 to-teal-500/5 backdrop-blur-sm p-5">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-emerald-500/10 p-2 border border-emerald-500/20">
              <Trophy className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-semibold text-sm mb-1">How Markets Work</h3>
              <p className="text-sm text-muted-foreground">
                Each market represents a KOL. If they finish in the <span className="text-emerald-400 font-medium">Top 3</span> by realized profit when the market closes, 
                the market resolves <span className="text-emerald-400 font-medium">YES</span>. Otherwise, it resolves <span className="text-red-400 font-medium">NO</span>.
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        ) : filteredMarkets.length === 0 ? (
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-12 text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
              <Target className="h-6 w-6 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">
              {searchQuery ? "No markets found" : `No ${title.toLowerCase()} markets yet`}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {searchQuery 
                ? "Try a different search term"
                : "Markets are created automatically for tracked KOLs. Check back soon!"}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredMarkets.map((m) => {
              const name =
                typeof m.kols?.display_name === "string" && m.kols.display_name.length > 0
                  ? m.kols.display_name
                  : `${m.kol_wallet_address.slice(0, 4)}…${m.kol_wallet_address.slice(-4)}`

              const isOpen = m.status === "open"
              const isSettled = m.status === "settled"

              return (
                <Link
                  key={m.id}
                  href={`/markets/${m.id}`}
                  className="group rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-5 transition-all hover:border-emerald-500/30 hover:bg-card/50 hover:shadow-lg hover:shadow-emerald-500/5"
                >
                  <div className="flex items-start gap-4 mb-4">
                    <Avatar src={m.kols?.avatar_url} name={name} size={48} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          windowKey === "daily" ? "bg-blue-500/10 text-blue-400" :
                          windowKey === "weekly" ? "bg-purple-500/10 text-purple-400" :
                          "bg-amber-500/10 text-amber-400"
                        }`}>
                          {title}
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          isOpen ? "bg-emerald-500/10 text-emerald-400" : 
                          isSettled ? "bg-blue-500/10 text-blue-400" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          {m.status.charAt(0).toUpperCase() + m.status.slice(1)}
                        </span>
                      </div>
                      <h3 className="font-semibold text-sm leading-tight truncate group-hover:text-emerald-400 transition-colors">
                        {name}
                      </h3>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl bg-background/50 border border-border/40 p-3">
                      <div className="text-xs text-muted-foreground mb-1">Question</div>
                      <div className="text-sm font-medium">
                        Will {name} finish Top 3?
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Closes</span>
                      <span className="font-medium">{new Date(m.closes_at).toLocaleDateString()}</span>
                    </div>
                    
                    <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                      <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        {formatTimeLeft(m.closes_at)}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-400 transition-colors" />
                    </div>

                    {isOpen && (
                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <button
                          type="button"
                          onClick={(e) => e.preventDefault()}
                          className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        >
                          Buy Yes
                        </button>
                        <button
                          type="button"
                          onClick={(e) => e.preventDefault()}
                          className="rounded-lg bg-red-500/10 border border-red-500/30 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          Buy No
                        </button>
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
        </main>
      </div>
    </div>
  )
}
