"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Header } from "@/components/header"
import { TrendingUp, Clock, Users, Plus, ChevronRight, Flame, Trophy, Calendar, Search, X } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

type MarketType = "DAILY" | "WEEKLY" | "MONTHLY"
type ViewTab = "markets" | "community"
type Category = "all" | "crypto" | "sports" | "politics" | "entertainment" | "other"

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

type UserPrediction = {
  prediction_id: string
  creator_wallet: string
  question: string
  category: string
  end_date: string
  status: string
  total_volume: number
  yes_pool: number
  no_pool: number
  created_at: string
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function makeNonce(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`
}

function buildPmMessage(title: string, fields: Record<string, string>): string {
  const lines = [title]
  for (const [k, v] of Object.entries(fields)) lines.push(`${k}=${v}`)
  return lines.join("\n")
}

function formatTimeLeft(endDate: string): string {
  const end = new Date(endDate).getTime()
  const now = Date.now()
  const diff = end - now

  if (diff <= 0) return "Ended"

  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))

  if (days > 0) return `${days}d ${hours}h left`
  if (hours > 0) return `${hours}h left`
  return "< 1h left"
}

function formatVolume(vol: number): string {
  if (!Number.isFinite(vol) || vol === 0) return "0 SOL"
  if (vol >= 1000) return `${(vol / 1000).toFixed(1)}K SOL`
  return `${vol.toFixed(2)} SOL`
}

function getYesPercent(yes: number, no: number): number {
  const total = yes + no
  if (total === 0) return 50
  return Math.round((yes / total) * 100)
}

const CATEGORIES: { value: Category; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <Flame className="h-4 w-4" /> },
  { value: "crypto", label: "Crypto", icon: <TrendingUp className="h-4 w-4" /> },
  { value: "sports", label: "Sports", icon: <Trophy className="h-4 w-4" /> },
  { value: "politics", label: "Politics", icon: <Users className="h-4 w-4" /> },
  { value: "entertainment", label: "Entertainment", icon: <Calendar className="h-4 w-4" /> },
  { value: "other", label: "Other", icon: <Clock className="h-4 w-4" /> },
]

export default function PredictionMarketsPage() {
  const { toast } = useToast()
  const { publicKey, connected, connect, connecting, signMessage } = useWallet()

  const [viewTab, setViewTab] = useState<ViewTab>("markets")
  const [marketType, setMarketType] = useState<MarketType>("DAILY")
  const [category, setCategory] = useState<Category>("all")
  const [searchQuery, setSearchQuery] = useState("")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [predictions, setPredictions] = useState<UserPrediction[]>([])

  // Create prediction modal
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newQuestion, setNewQuestion] = useState("")
  const [newCategory, setNewCategory] = useState<Category>("crypto")
  const [newEndDate, setNewEndDate] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Load KOL rounds
  useEffect(() => {
    if (viewTab !== "markets") return
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
    return () => { mounted = false }
  }, [marketType, viewTab])

  // Load community predictions
  useEffect(() => {
    if (viewTab !== "community") return
    let mounted = true

    async function run() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (category !== "all") params.set("category", category)
        params.set("status", "approved")
        params.set("limit", "100")

        const res = await fetch(`/api/pm/predictions?${params.toString()}`)
        const json = (await res.json().catch(() => null)) as any
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load predictions")
        if (!mounted) return
        setPredictions(Array.isArray(json?.predictions) ? (json.predictions as UserPrediction[]) : [])
        setLoading(false)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message ?? String(e))
        setPredictions([])
        setLoading(false)
      }
    }

    run()
    return () => { mounted = false }
  }, [category, viewTab])

  async function handleCreatePrediction() {
    if (!publicKey) {
      toast({ title: "Wallet not connected", description: "Connect your wallet to create a prediction", variant: "destructive" })
      return
    }

    if (!signMessage) {
      toast({ title: "Wallet unsupported", description: "Your wallet doesn't support message signing", variant: "destructive" })
      return
    }

    if (!connected && !connecting) {
      try {
        await connect()
      } catch {
        toast({ title: "Connection failed", description: "Please reconnect your wallet", variant: "destructive" })
        return
      }
    }

    if (!newQuestion.trim() || newQuestion.trim().length < 10) {
      toast({ title: "Invalid question", description: "Question must be at least 10 characters", variant: "destructive" })
      return
    }

    if (!newEndDate) {
      toast({ title: "Missing end date", description: "Please select when this prediction ends", variant: "destructive" })
      return
    }

    setSubmitting(true)

    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const end_date = new Date(newEndDate).toISOString()

      const message = buildPmMessage("NoCryCasino PM Prediction v1", {
        wallet_address,
        question: newQuestion.trim(),
        category: newCategory,
        end_date,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/predictions/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address,
          question: newQuestion.trim(),
          category: newCategory,
          end_date,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Failed to create prediction")
      }

      toast({ title: "Prediction submitted!", description: "Your prediction is pending review" })
      setShowCreateModal(false)
      setNewQuestion("")
      setNewCategory("crypto")
      setNewEndDate("")
    } catch (e: any) {
      toast({ title: "Failed to create", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  const filteredPredictions = predictions.filter((p) => {
    if (!searchQuery.trim()) return true
    return p.question.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const filteredRounds = rounds.filter((r) => {
    if (!searchQuery.trim()) return true
    return r.round_id.toLowerCase().includes(searchQuery.toLowerCase())
  })

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <Header />

      <main className="mx-auto max-w-7xl px-4 py-8">
        {/* Hero Section */}
        <div className="mb-10">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
                Prediction Markets
              </h1>
              <p className="mt-2 text-lg text-muted-foreground max-w-xl">
                Trade on the future. Bet on KOL performance or create your own predictions.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition-all hover:shadow-xl hover:shadow-emerald-500/30 hover:scale-[1.02]"
            >
              <Plus className="h-5 w-5" />
              Create Prediction
              <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
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
                <div className="text-2xl font-bold">{rounds.length + predictions.length}</div>
                <div className="text-xs text-muted-foreground">Active Markets</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-500/10 p-2.5">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">--</div>
                <div className="text-xs text-muted-foreground">Traders</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-purple-500/10 p-2.5">
                <Flame className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">--</div>
                <div className="text-xs text-muted-foreground">24h Volume</div>
              </div>
            </div>
          </div>
          <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2.5">
                <Trophy className="h-5 w-5 text-amber-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">--</div>
                <div className="text-xs text-muted-foreground">Resolved</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Tabs */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm p-1">
            <button
              type="button"
              onClick={() => setViewTab("markets")}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
                viewTab === "markets"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              KOL Markets
            </button>
            <button
              type="button"
              onClick={() => setViewTab("community")}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-all ${
                viewTab === "community"
                  ? "bg-foreground text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Community
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 w-full sm:w-72 rounded-xl border border-border/40 bg-card/30 backdrop-blur-sm pl-10 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50"
            />
          </div>
        </div>

        {/* Sub-filters */}
        {viewTab === "markets" ? (
          <div className="mb-6 flex flex-wrap gap-2">
            {(["DAILY", "WEEKLY", "MONTHLY"] as MarketType[]).map((mt) => (
              <button
                key={mt}
                type="button"
                onClick={() => setMarketType(mt)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  marketType === mt
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30"
                    : "border border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {mt.charAt(0) + mt.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        ) : (
          <div className="mb-6 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                type="button"
                onClick={() => setCategory(cat.value)}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                  category === cat.value
                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30"
                    : "border border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
                }`}
              >
                {cat.icon}
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        ) : viewTab === "markets" ? (
          filteredRounds.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-12 text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No {marketType.toLowerCase()} markets yet</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Markets are created automatically when KOL rounds are bootstrapped.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredRounds.map((r) => {
                const isOpen = r.status === "OPEN"
                const lockDate = new Date(r.lock_ts)
                
                return (
                  <Link
                    key={r.round_id}
                    href={`/pm/rounds/${encodeURIComponent(r.round_id)}`}
                    className="group rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-5 transition-all hover:border-emerald-500/30 hover:bg-card/50 hover:shadow-lg hover:shadow-emerald-500/5"
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.market_type === "DAILY" ? "bg-blue-500/10 text-blue-400" :
                            r.market_type === "WEEKLY" ? "bg-purple-500/10 text-purple-400" :
                            "bg-amber-500/10 text-amber-400"
                          }`}>
                            {r.market_type}
                          </span>
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            isOpen ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
                          }`}>
                            {r.status}
                          </span>
                        </div>
                        <h3 className="font-semibold text-sm leading-tight line-clamp-2 group-hover:text-emerald-400 transition-colors">
                          KOL Performance Round
                        </h3>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Locks</span>
                        <span className="font-medium">{lockDate.toLocaleDateString()}</span>
                      </div>
                      
                      <div className="h-2 rounded-full bg-muted/50 overflow-hidden">
                        <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTimeLeft(r.lock_ts)}
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-emerald-400 transition-colors" />
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          )
        ) : (
          filteredPredictions.length === 0 ? (
            <div className="rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-12 text-center">
              <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                <Plus className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold">No community predictions yet</h3>
              <p className="mt-2 text-sm text-muted-foreground mb-4">
                Be the first to create a prediction for the community!
              </p>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create Prediction
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredPredictions.map((p) => {
                const yesPercent = getYesPercent(p.yes_pool, p.no_pool)
                
                return (
                  <div
                    key={p.prediction_id}
                    className="group rounded-2xl border border-border/40 bg-card/30 backdrop-blur-sm p-5 transition-all hover:border-emerald-500/30 hover:bg-card/50"
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">
                            {p.category}
                          </span>
                        </div>
                        <h3 className="font-semibold text-sm leading-tight line-clamp-3">
                          {p.question}
                        </h3>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-emerald-400 font-medium">Yes {yesPercent}%</span>
                        <span className="text-red-400 font-medium">No {100 - yesPercent}%</span>
                      </div>
                      
                      <div className="h-2 rounded-full bg-red-500/20 overflow-hidden">
                        <div 
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all"
                          style={{ width: `${yesPercent}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5" />
                          {formatTimeLeft(p.end_date)}
                        </div>
                        <div>{formatVolume(p.total_volume)}</div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-2">
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                        >
                          Buy Yes
                        </button>
                        <button
                          type="button"
                          className="rounded-lg bg-red-500/10 border border-red-500/30 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          Buy No
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </main>

      {/* Create Prediction Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="relative w-full max-w-lg rounded-2xl border border-border/60 bg-card p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setShowCreateModal(false)}
              className="absolute right-4 top-4 rounded-lg p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mb-6">
              <h2 className="text-xl font-bold">Create a Prediction</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Submit a yes/no question for the community to bet on.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">Question</label>
                <textarea
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder="Will Bitcoin reach $100,000 by end of 2025?"
                  rows={3}
                  className="w-full rounded-xl border border-border/60 bg-background/50 px-4 py-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50 resize-none"
                />
                <div className="mt-1 text-xs text-muted-foreground text-right">
                  {newQuestion.length}/500
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <div className="flex flex-wrap gap-2">
                  {CATEGORIES.filter(c => c.value !== "all").map((cat) => (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => setNewCategory(cat.value as Category)}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                        newCategory === cat.value
                          ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/30"
                          : "border border-border/40 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {cat.icon}
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Resolution Date</label>
                <input
                  type="datetime-local"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
                  max={new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16)}
                  className="w-full rounded-xl border border-border/60 bg-background/50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500/50"
                />
              </div>

              <div className="pt-2">
                {!connected ? (
                  <button
                    type="button"
                    onClick={() => connect()}
                    disabled={connecting}
                    className="w-full rounded-xl bg-foreground py-3 text-sm font-semibold text-background hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {connecting ? "Connecting..." : "Connect Wallet to Submit"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreatePrediction}
                    disabled={submitting || !newQuestion.trim() || !newEndDate}
                    className="w-full rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitting ? "Submitting..." : "Submit Prediction"}
                  </button>
                )}
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Predictions are reviewed before going live. Clear, verifiable questions are more likely to be approved.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
