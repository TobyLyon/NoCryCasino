"use client"

import { useEffect, useMemo, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"

type Side = "BUY" | "SELL"

type Level = {
  price: number
  open_quantity: number
}

type FillRow = {
  fill_id: string
  price: number
  quantity: number
  fee_bps: number
  fee_amount: number
  match_id: string
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

export default function PmOutcomePage({ params }: { params: { outcomeId: string } }) {
  const { toast } = useToast()
  const { publicKey, connected, connect, connecting, signMessage } = useWallet()

  const outcomeId = useMemo(() => decodeURIComponent(params.outcomeId ?? ""), [params.outcomeId])

  const [buyLevels, setBuyLevels] = useState<Level[]>([])
  const [sellLevels, setSellLevels] = useState<Level[]>([])
  const [fills, setFills] = useState<FillRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [side, setSide] = useState<Side>("BUY")
  const [price, setPrice] = useState("0.50")
  const [quantity, setQuantity] = useState("1")
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [b, s, f] = await Promise.all([
        fetch(`/api/pm/outcomes/${encodeURIComponent(outcomeId)}/orderbook?side=BUY&limit=200`),
        fetch(`/api/pm/outcomes/${encodeURIComponent(outcomeId)}/orderbook?side=SELL&limit=200`),
        fetch(`/api/pm/outcomes/${encodeURIComponent(outcomeId)}/fills?limit=100`),
      ])

      const jb = (await b.json().catch(() => null)) as any
      const js = (await s.json().catch(() => null)) as any
      const jf = (await f.json().catch(() => null)) as any

      if (!b.ok || !jb?.ok) throw new Error(jb?.error ?? "Failed to load orderbook")
      if (!s.ok || !js?.ok) throw new Error(js?.error ?? "Failed to load orderbook")
      if (!f.ok || !jf?.ok) throw new Error(jf?.error ?? "Failed to load fills")

      setBuyLevels(Array.isArray(jb?.levels) ? (jb.levels as Level[]) : [])
      setSellLevels(Array.isArray(js?.levels) ? (js.levels as Level[]) : [])
      setFills(Array.isArray(jf?.fills) ? (jf.fills as FillRow[]) : [])
      setLoading(false)
    } catch (e: any) {
      setError(e?.message ?? String(e))
      setBuyLevels([])
      setSellLevels([])
      setFills([])
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!outcomeId) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeId])

  async function placeOrder() {
    if (!publicKey) {
      toast({ title: "Wallet not connected", description: "Connect your wallet to trade", variant: "destructive" })
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

    const p = Number(price)
    const q = Number(quantity)

    if (!Number.isFinite(p) || p <= 0 || p >= 1) {
      toast({ title: "Invalid price", description: "Price must be between 0 and 1", variant: "destructive" })
      return
    }

    if (!Number.isFinite(q) || q <= 0) {
      toast({ title: "Invalid quantity", description: "Quantity must be > 0", variant: "destructive" })
      return
    }

    setSubmitting(true)

    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const idempotency_key = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : makeNonce()

      const tif = "GTC"

      const message = buildPmMessage("NoCryCasino PM Order v1", {
        outcome_id: outcomeId,
        wallet_address,
        side,
        price: String(p),
        quantity: String(q),
        tif,
        idempotency_key,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/orders/place", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          outcome_id: outcomeId,
          wallet_address,
          side,
          price: p,
          quantity: q,
          tif,
          idempotency_key,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error ?? "Order failed")
      }

      toast({ title: "Order placed", description: `${side} @ ${p}` })
      await load()
    } catch (e: any) {
      toast({ title: "Order failed", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">Outcome</h1>
            <div className="mt-1 text-xs text-muted-foreground break-all">{outcomeId}</div>
          </div>

          {!connected ? (
            <Button onClick={() => connect()} disabled={connecting} className="h-9">
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">Loading…</div>
        ) : error ? (
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Failed to load: {error}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="border-border/60 bg-card/50">
              <CardHeader>
                <CardTitle>Orderbook (BUY)</CardTitle>
              </CardHeader>
              <CardContent>
                {buyLevels.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No bids</div>
                ) : (
                  <div className="space-y-1 text-sm">
                    {buyLevels.slice(0, 20).map((l) => (
                      <div key={`b-${l.price}`} className="flex justify-between">
                        <div className="tabular-nums">{Number(l.price).toFixed(4)}</div>
                        <div className="tabular-nums text-muted-foreground">{Number(l.open_quantity).toFixed(4)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/50">
              <CardHeader>
                <CardTitle>Trade</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="inline-flex rounded-lg border border-border/60 bg-background/50 p-1">
                  <button
                    type="button"
                    onClick={() => setSide("BUY")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      side === "BUY" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Buy
                  </button>
                  <button
                    type="button"
                    onClick={() => setSide("SELL")}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      side === "SELL" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Sell
                  </button>
                </div>

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
                  Quantity
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm"
                    inputMode="decimal"
                  />
                </label>

                <Button onClick={placeOrder} disabled={submitting || !connected} className="w-full">
                  {submitting ? "Submitting…" : "Place Order"}
                </Button>

                <div className="text-xs text-muted-foreground">You must deposit collateral on the round page before buying.</div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/50">
              <CardHeader>
                <CardTitle>Recent Fills</CardTitle>
              </CardHeader>
              <CardContent>
                {fills.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No fills</div>
                ) : (
                  <div className="space-y-1 text-sm">
                    {fills.slice(0, 12).map((f) => (
                      <div key={f.fill_id} className="flex justify-between gap-3">
                        <div className="tabular-nums">{Number(f.price).toFixed(4)}</div>
                        <div className="tabular-nums text-muted-foreground">{Number(f.quantity).toFixed(4)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
