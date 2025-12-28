"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { depositToEscrowAddress } from "@/lib/solana/escrow"

type Outcome = "yes" | "no"
type Side = "buy" | "sell"

type Market = {
  id: string
  window_key: "daily" | "weekly" | "monthly"
  kol_wallet_address: string
  closes_at: string
  status: "open" | "closed" | "settled" | "cancelled"
  created_at: string
  escrow_wallet_address?: string | null
  settled_at?: string | null
  resolved_outcome?: "yes" | "no" | null
  resolved_rank?: number | null
  resolved_profit_sol?: number | null
  resolved_profit_usd?: number | null
  kols?: {
    display_name: string | null
    avatar_url: string | null
    twitter_url: string | null
    twitter_handle: string | null
  } | null
}

type OrderRow = {
  id: string
  market_id: string
  wallet_address: string
  outcome: Outcome
  side: Side
  price: number
  quantity: number
  filled_quantity: number
  status: string
  client_order_id: string | null
  created_at: string
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function buildOrderMessage(input: {
  market_id: string
  wallet_address: string
  outcome: Outcome
  side: Side
  price: number
  quantity: number
  client_order_id: string
  issued_at: string
}): string {
  return [
    "NoCryCasino Wager Order v1",
    `market_id=${input.market_id}`,
    `wallet_address=${input.wallet_address}`,
    `outcome=${input.outcome}`,
    `side=${input.side}`,
    `price=${input.price}`,
    `quantity=${input.quantity}`,
    `client_order_id=${input.client_order_id}`,
    `issued_at=${input.issued_at}`,
  ].join("\n")
}

export default function MarketDetailPage({ params }: { params: { marketId: string } }) {
  const { toast } = useToast()
  const { connection } = useConnection()
  const { publicKey, connected, connect, connecting, signMessage, sendTransaction, wallet } = useWallet()

  const [market, setMarket] = useState<Market | null>(null)
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [outcome, setOutcome] = useState<Outcome>("yes")
  const [side, setSide] = useState<Side>("buy")
  const [price, setPrice] = useState<string>("0.50")
  const [quantity, setQuantity] = useState<string>("1")

  const walletAddress = publicKey?.toBase58() ?? null

  const name = useMemo(() => {
    if (market?.kols?.display_name) return market.kols.display_name
    if (market?.kol_wallet_address) return `${market.kol_wallet_address.slice(0, 4)}…${market.kol_wallet_address.slice(-4)}`
    return "Market"
  }, [market])

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/markets/${encodeURIComponent(params.marketId)}`)
        const json = await res.json()
        if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load market")

        if (!mounted) return
        setMarket(json.market as Market)
        setLoading(false)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message ?? String(e))
        setLoading(false)
      }
    }

    load()

    return () => {
      mounted = false
    }
  }, [params.marketId])

  useEffect(() => {
    let mounted = true

    async function loadOrders() {
      if (!walletAddress) {
        setOrders([])
        return
      }

      try {
        const res = await fetch(`/api/markets/${encodeURIComponent(params.marketId)}/orders?wallet=${encodeURIComponent(walletAddress)}`)
        const json = await res.json()
        if (!res.ok || !json?.ok) return
        if (!mounted) return
        setOrders(Array.isArray(json?.orders) ? (json.orders as OrderRow[]) : [])
      } catch {
        // ignore
      }
    }

    loadOrders()

    return () => {
      mounted = false
    }
  }, [params.marketId, walletAddress])

  async function placeOrder() {
    if (!connected || !publicKey) {
      toast({ title: "Wallet not connected", description: "Connect your wallet to place an order", variant: "destructive" })
      return
    }

    if (!market?.escrow_wallet_address) {
      toast({ title: "Market unavailable", description: "This market is missing an escrow wallet", variant: "destructive" })
      return
    }

    if (!sendTransaction) {
      toast({ title: "Wallet unsupported", description: "Your wallet can't send transactions", variant: "destructive" })
      return
    }

    if (!wallet?.adapter?.connected) {
      try {
        await connect()
      } catch {
        toast({ title: "Connection failed", description: "Please reconnect your wallet", variant: "destructive" })
        return
      }
    }

    if (!signMessage) {
      toast({
        title: "Wallet unsupported",
        description: "Your wallet doesn't support message signing. Try Phantom or Solflare.",
        variant: "destructive",
      })
      return
    }

    const p = Number(price)
    const q = Number(quantity)

    if (!Number.isFinite(p) || p < 0 || p > 1) {
      toast({ title: "Invalid price", description: "Price must be between 0 and 1", variant: "destructive" })
      return
    }

    // Escrow MVP: quantity is stake (SOL)
    if (!Number.isFinite(q) || q <= 0) {
      toast({ title: "Invalid stake", description: "Stake (SOL) must be > 0", variant: "destructive" })
      return
    }

    const client_order_id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const issued_at = new Date().toISOString()

    const message = buildOrderMessage({
      market_id: params.marketId,
      wallet_address: publicKey.toBase58(),
      outcome,
      side,
      price: p,
      quantity: q,
      client_order_id,
      issued_at,
    })

    setSubmitting(true)

    try {
      if (!publicKey) throw new Error("Wallet not connected")

      if (!connected && !connecting) {
        await connect()
      }

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      // Escrow transfer first
      const deposit_signature = await depositToEscrowAddress(
        connection,
        publicKey,
        q,
        market.escrow_wallet_address,
        sendTransaction,
      )

      const res = await fetch(`/api/markets/${encodeURIComponent(params.marketId)}/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wallet_address: publicKey.toBase58(),
          outcome,
          side,
          price: p,
          quantity: q,
          client_order_id,
          issued_at,
          message,
          signature_base64,
          deposit_signature,
          deposit_amount_sol: q,
        }),
      })

      const json = await res.json()
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to place order")

      toast({ title: "Order placed", description: `Created ${side.toUpperCase()} ${outcome.toUpperCase()} @ ${p}` })

      // Refresh my orders
      const res2 = await fetch(
        `/api/markets/${encodeURIComponent(params.marketId)}/orders?wallet=${encodeURIComponent(publicKey.toBase58())}`,
      )
      const json2 = await res2.json()
      if (res2.ok && json2?.ok) setOrders(Array.isArray(json2?.orders) ? (json2.orders as OrderRow[]) : [])
    } catch (e: any) {
      toast({ title: "Order failed", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">Loading…</div>
        </main>
      </div>
    )
  }

  if (error || !market) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Failed to load market: {error ?? "Not found"}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">Bet: {name}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {market.window_key.toUpperCase()} • closes {new Date(market.closes_at).toLocaleString()} • {market.status}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {market.kols?.twitter_url ? (
              <Link
                href={market.kols.twitter_url}
                target="_blank"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                X
              </Link>
            ) : null}
            <Link
              href={`/leaderboard?timeframe=${market.window_key}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Leaderboard
            </Link>
          </div>
        </div>

        {market.status === "settled" ? (
          <div className="mb-4 rounded-xl border border-border/60 bg-card/50 px-4 py-3">
            <div className="text-sm font-medium">Resolved: {market.resolved_outcome?.toUpperCase() ?? "—"}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Settled {market.settled_at ? new Date(market.settled_at).toLocaleString() : "—"}
              {typeof market.resolved_rank === "number" ? ` • Rank #${market.resolved_rank}` : ""}
              {typeof market.resolved_profit_sol === "number" ? ` • Profit ${market.resolved_profit_sol.toFixed(4)} SOL` : ""}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Place Order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button variant={outcome === "yes" ? "default" : "outline"} onClick={() => setOutcome("yes")}>
                  YES
                </Button>
                <Button variant={outcome === "no" ? "default" : "outline"} onClick={() => setOutcome("no")}>
                  NO
                </Button>
              </div>

              <div className="flex gap-2">
                <Button variant={"default"} onClick={() => setSide("buy")}>
                  Buy
                </Button>
              </div>

              <div className="grid gap-3">
                <label className="text-sm text-muted-foreground">
                  Price (0-1)
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm"
                    inputMode="decimal"
                  />
                </label>

                <label className="text-sm text-muted-foreground">
                  Stake (SOL)
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm"
                    inputMode="decimal"
                  />
                </label>
              </div>

              {!connected ? (
                <Button onClick={() => connect()} disabled={connecting} className="w-full">
                  {connecting ? "Connecting…" : "Connect Wallet"}
                </Button>
              ) : (
                <Button onClick={placeOrder} disabled={submitting} className="w-full">
                  {submitting ? "Placing…" : "Place Order"}
                </Button>
              )}

              <div className="text-xs text-muted-foreground">
                Beta rules: Top 3 KOLs (by profit) resolve YES. Your stake is escrowed in SOL.
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>My Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {!walletAddress ? (
                <div className="text-sm text-muted-foreground">Connect a wallet to view your orders.</div>
              ) : orders.length === 0 ? (
                <div className="text-sm text-muted-foreground">No orders yet.</div>
              ) : (
                <div className="space-y-2">
                  {orders.map((o) => (
                    <div key={o.id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          {o.side.toUpperCase()} {o.outcome.toUpperCase()} @ {o.price}
                        </div>
                        <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Qty {o.quantity} • Filled {o.filled_quantity} • {o.status}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
