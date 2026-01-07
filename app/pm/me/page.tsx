"use client"

import { useEffect, useRef, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"

type PmState = {
  ok: true
  emergency_halt_active: boolean
  wallet_address: string
  balance: { user_pubkey: string; available_collateral: number; reserved_collateral: number; updated_at: string } | null
  positions: Array<{ position_id: string; outcome_id: string; yes_shares: number; reserved_yes_shares: number; avg_cost: number | null; updated_at: string }>
  orders: Array<{ order_id: string; outcome_id: string; side: string; price: number; quantity: number; filled_quantity: number; status: string; tif: string; reserved_collateral: number; idempotency_key: string; created_at: string }>
  deposits: Array<{ deposit_id: string; round_scope: string | null; amount: number; mint: string; tx_sig: string; status: string; created_at: string }>
  withdrawals: Array<{ withdrawal_id: string; amount: number; mint: string; destination_pubkey: string; tx_sig: string | null; status: string; idempotency_key: string | null; processing_nonce: string | null; processing_at: string | null; error: string | null; created_at: string }>
  claims: Array<{ claim_id: string; outcome_id: string; round_id: string; yes_shares: number; final_outcome: boolean; claimable_amount: number; status: string; claimed_at: string | null; idempotency_key: string | null; created_at: string }>
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

export default function PmMePage() {
  const { toast } = useToast()
  const { publicKey, connected, connect, connecting, signMessage } = useWallet()

  const [state, setState] = useState<PmState | null>(null)
  const [loading, setLoading] = useState(false)

  const [destination, setDestination] = useState("")
  const [amount, setAmount] = useState("0.1")
  const [withdrawing, setWithdrawing] = useState(false)

  const refreshing = useRef(false)

  async function refresh() {
    if (!publicKey) return
    if (!signMessage) return
    if (refreshing.current) return
    refreshing.current = true

    setLoading(true)

    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()

      const message = buildPmMessage("NoCryCasino PM Me v1", {
        wallet_address,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/me/state", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ wallet_address, nonce, issued_at, signature_base64, message }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load PM state")

      setState(json as PmState)
    } catch (e: any) {
      setState(null)
      toast({ title: "PM state", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      setLoading(false)
      refreshing.current = false
    }
  }

  useEffect(() => {
    if (connected) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()])

  async function requestWithdrawal() {
    if (!publicKey) {
      toast({ title: "Wallet not connected", description: "Connect your wallet to withdraw", variant: "destructive" })
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

    const destination_pubkey = destination.trim()
    const amount_sol = Number(amount)
    if (!destination_pubkey) {
      toast({ title: "Invalid destination", description: "Enter a destination address", variant: "destructive" })
      return
    }
    if (!Number.isFinite(amount_sol) || amount_sol <= 0) {
      toast({ title: "Invalid amount", description: "Amount must be > 0", variant: "destructive" })
      return
    }

    setWithdrawing(true)

    try {
      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()
      const idempotency_key = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : makeNonce()

      const message = buildPmMessage("NoCryCasino PM Withdraw Request v1", {
        wallet_address,
        destination_pubkey,
        amount_sol: String(amount_sol),
        idempotency_key,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/withdrawals/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address,
          destination_pubkey,
          amount_sol,
          idempotency_key,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Withdrawal request failed")

      toast({ title: "Withdrawal requested", description: `${amount_sol.toFixed(4)} SOL` })
      setDestination("")
      await refresh()
    } catch (e: any) {
      toast({ title: "Withdrawal failed", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      setWithdrawing(false)
    }
  }

  const bal = state?.balance
  const available = typeof bal?.available_collateral === "number" ? bal.available_collateral : Number(bal?.available_collateral ?? 0)
  const reserved = typeof bal?.reserved_collateral === "number" ? bal.reserved_collateral : Number(bal?.reserved_collateral ?? 0)

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold">PM Account</h1>
            <div className="mt-1 text-sm text-muted-foreground">Balance, positions, orders, deposits and withdrawals.</div>
          </div>

          <div className="flex gap-2">
            {!connected ? (
              <Button onClick={() => connect()} disabled={connecting} className="h-9">
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            ) : (
              <Button onClick={() => refresh()} disabled={loading} variant="outline" className="h-9">
                {loading ? "Refreshing…" : "Refresh"}
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Balance</CardTitle>
            </CardHeader>
            <CardContent>
              {!connected ? (
                <div className="text-sm text-muted-foreground">Connect a wallet to view your PM account.</div>
              ) : (
                <div className="space-y-1 text-sm">
                  <div>Available: {Number.isFinite(available) ? available.toFixed(4) : "0.0000"} SOL</div>
                  <div>Reserved: {Number.isFinite(reserved) ? reserved.toFixed(4) : "0.0000"} SOL</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50 lg:col-span-2">
            <CardHeader>
              <CardTitle>Request Withdrawal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-muted-foreground">
                  Destination
                  <input
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm"
                  />
                </label>

                <label className="text-sm text-muted-foreground">
                  Amount (SOL)
                  <input
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm"
                    inputMode="decimal"
                  />
                </label>
              </div>

              <Button onClick={requestWithdrawal} disabled={!connected || withdrawing} className="w-full">
                {withdrawing ? "Requesting…" : "Request Withdrawal"}
              </Button>

              <div className="text-xs text-muted-foreground">
                Withdrawals are processed automatically by an admin job.
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Positions</CardTitle>
            </CardHeader>
            <CardContent>
              {!state ? (
                <div className="text-sm text-muted-foreground">No data loaded.</div>
              ) : state.positions.length === 0 ? (
                <div className="text-sm text-muted-foreground">No positions.</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {state.positions.slice(0, 50).map((p) => (
                    <div key={p.position_id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                      <div className="text-xs text-muted-foreground break-all">Outcome: {p.outcome_id}</div>
                      <div className="mt-1">Yes shares: {Number(p.yes_shares ?? 0).toFixed(4)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Orders</CardTitle>
            </CardHeader>
            <CardContent>
              {!state ? (
                <div className="text-sm text-muted-foreground">No data loaded.</div>
              ) : state.orders.length === 0 ? (
                <div className="text-sm text-muted-foreground">No orders.</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {state.orders.slice(0, 50).map((o) => (
                    <div key={o.order_id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          {o.side} @ {Number(o.price).toFixed(4)}
                        </div>
                        <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground break-all">Outcome: {o.outcome_id}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Qty {Number(o.quantity).toFixed(4)} • Filled {Number(o.filled_quantity).toFixed(4)} • {o.status}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Deposits</CardTitle>
            </CardHeader>
            <CardContent>
              {!state ? (
                <div className="text-sm text-muted-foreground">No data loaded.</div>
              ) : state.deposits.length === 0 ? (
                <div className="text-sm text-muted-foreground">No deposits.</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {state.deposits.slice(0, 30).map((d) => (
                    <div key={d.deposit_id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{Number(d.amount).toFixed(4)} {d.mint}</div>
                        <div className="text-xs text-muted-foreground">{new Date(d.created_at).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground break-all">tx: {d.tx_sig}</div>
                      <div className="mt-1 text-xs text-muted-foreground">round: {d.round_scope ?? "—"} • {d.status}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Withdrawals</CardTitle>
            </CardHeader>
            <CardContent>
              {!state ? (
                <div className="text-sm text-muted-foreground">No data loaded.</div>
              ) : state.withdrawals.length === 0 ? (
                <div className="text-sm text-muted-foreground">No withdrawals.</div>
              ) : (
                <div className="space-y-2 text-sm">
                  {state.withdrawals.slice(0, 30).map((w) => (
                    <div key={w.withdrawal_id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">{Number(w.amount).toFixed(4)} {w.mint}</div>
                        <div className="text-xs text-muted-foreground">{new Date(w.created_at).toLocaleString()}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground break-all">to: {w.destination_pubkey}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{w.status}{w.tx_sig ? ` • tx: ${w.tx_sig}` : ""}</div>
                      {w.error ? <div className="mt-1 text-xs text-red-400">{w.error}</div> : null}
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
