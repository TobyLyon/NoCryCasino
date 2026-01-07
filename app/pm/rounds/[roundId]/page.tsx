"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useConnection, useWallet } from "@solana/wallet-adapter-react"
import { Header } from "@/components/header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { depositToEscrowAddress } from "@/lib/solana/escrow"

type RoundRow = {
  round_id: string
  market_type: "DAILY" | "WEEKLY" | "MONTHLY"
  start_ts: string
  lock_ts: string
  settle_ts: string
  status: string
  collateral_mint: string
  escrow_wallet_pubkey: string
  rake_bps: number
  snapshot_hash: string | null
}

type OutcomeRow = {
  outcome_id: string
  round_id: string
  kol_wallet_address: string
  question_text: string
  status: string
  final_outcome: boolean | null
  created_at: string
  kols?: {
    display_name: string | null
    avatar_url: string | null
    twitter_url: string | null
    twitter_handle: string | null
  } | null
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

export default function PmRoundPage({ params }: { params: { roundId: string } }) {
  const { toast } = useToast()
  const { connection } = useConnection()
  const { publicKey, connected, connect, connecting, signMessage, sendTransaction, wallet } = useWallet()

  const [round, setRound] = useState<RoundRow | null>(null)
  const [outcomes, setOutcomes] = useState<OutcomeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [depositAmount, setDepositAmount] = useState("0.5")
  const [depositing, setDepositing] = useState(false)

  const [meState, setMeState] = useState<any>(null)
  const refreshing = useRef(false)

  const roundId = useMemo(() => decodeURIComponent(params.roundId ?? ""), [params.roundId])

  useEffect(() => {
    let mounted = true

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [r1, r2] = await Promise.all([
          fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}`),
          fetch(`/api/pm/rounds/${encodeURIComponent(roundId)}/outcomes`),
        ])

        const j1 = (await r1.json().catch(() => null)) as any
        const j2 = (await r2.json().catch(() => null)) as any

        if (!r1.ok || !j1?.ok) throw new Error(j1?.error ?? "Failed to load round")
        if (!r2.ok || !j2?.ok) throw new Error(j2?.error ?? "Failed to load outcomes")

        if (!mounted) return
        setRound((j1.round ?? null) as RoundRow | null)
        setOutcomes(Array.isArray(j2?.outcomes) ? (j2.outcomes as OutcomeRow[]) : [])
        setLoading(false)
      } catch (e: any) {
        if (!mounted) return
        setError(e?.message ?? String(e))
        setRound(null)
        setOutcomes([])
        setLoading(false)
      }
    }

    if (roundId) void load()

    return () => {
      mounted = false
    }
  }, [roundId])

  async function refreshMe() {
    if (!publicKey || !signMessage) return
    if (refreshing.current) return
    refreshing.current = true
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
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load state")
      setMeState(json)
    } catch (e: any) {
      setMeState(null)
      toast({ title: "PM state", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      refreshing.current = false
    }
  }

  useEffect(() => {
    if (connected) void refreshMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey?.toBase58()])

  async function depositAndCredit() {
    if (!round) return
    if (!publicKey || !sendTransaction) {
      toast({ title: "Wallet not connected", description: "Connect your wallet to deposit", variant: "destructive" })
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
      toast({ title: "Wallet unsupported", description: "Your wallet doesn't support message signing", variant: "destructive" })
      return
    }

    const amount = Number(depositAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast({ title: "Invalid amount", description: "Deposit amount must be > 0", variant: "destructive" })
      return
    }

    setDepositing(true)

    try {
      const tx_sig = await depositToEscrowAddress(
        connection,
        publicKey,
        amount,
        round.escrow_wallet_pubkey,
        sendTransaction,
      )

      const wallet_address = publicKey.toBase58()
      const issued_at = new Date().toISOString()
      const nonce = makeNonce()

      const message = buildPmMessage("NoCryCasino PM Deposit Credit v1", {
        wallet_address,
        tx_sig,
        min_amount_sol: String(amount),
        mint: "SOL",
        round_scope: round.round_id,
        nonce,
        issued_at,
      })

      const sigBytes = await signMessage(new TextEncoder().encode(message))
      const signature_base64 = base64FromBytes(sigBytes)

      const res = await fetch("/api/pm/deposits/credit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wallet_address,
          tx_sig,
          min_amount_sol: amount,
          mint: "SOL",
          round_scope: round.round_id,
          nonce,
          issued_at,
          signature_base64,
          message,
        }),
      })

      const json = (await res.json().catch(() => null)) as any
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to credit deposit")

      toast({ title: "Deposit credited", description: `+${amount.toFixed(3)} SOL` })
      await refreshMe()
    } catch (e: any) {
      toast({ title: "Deposit failed", description: e?.message ?? String(e), variant: "destructive" })
    } finally {
      setDepositing(false)
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

  if (error || !round) {
    return (
      <div className="min-h-screen">
        <Header />
        <main className="container mx-auto px-4 py-8">
          <div className="rounded-xl border border-border/60 bg-card/50 p-8 text-center text-muted-foreground">
            Failed to load round: {error ?? "Not found"}
          </div>
        </main>
      </div>
    )
  }

  const bal = meState?.balance
  const available = typeof bal?.available_collateral === "number" ? bal.available_collateral : Number(bal?.available_collateral ?? 0)
  const reserved = typeof bal?.reserved_collateral === "number" ? bal.reserved_collateral : Number(bal?.reserved_collateral ?? 0)

  return (
    <div className="min-h-screen">
      <Header />

      <main className="container mx-auto px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold truncate">{round.round_id}</h1>
            <div className="mt-1 text-sm text-muted-foreground">
              {round.market_type} • locks {new Date(round.lock_ts).toLocaleString()} • settles {new Date(round.settle_ts).toLocaleString()} • {round.status}
            </div>
            <div className="mt-2 text-xs text-muted-foreground break-all">Escrow: {round.escrow_wallet_pubkey}</div>
          </div>

          <div className="flex gap-2">
            {!connected ? (
              <Button onClick={() => connect()} disabled={connecting} className="h-9">
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            ) : (
              <Button onClick={() => refreshMe()} className="h-9" variant="outline">
                Refresh
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Balance</CardTitle>
            </CardHeader>
            <CardContent>
              {!connected ? (
                <div className="text-sm text-muted-foreground">Connect a wallet to view your PM balance.</div>
              ) : (
                <div className="space-y-1 text-sm">
                  <div>Available: {Number.isFinite(available) ? available.toFixed(4) : "0.0000"} SOL</div>
                  <div>Reserved: {Number.isFinite(reserved) ? reserved.toFixed(4) : "0.0000"} SOL</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card/50">
            <CardHeader>
              <CardTitle>Deposit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">
                Send SOL to this round’s escrow wallet and we’ll credit your PM balance.
              </div>

              <label className="text-sm text-muted-foreground">
                Amount (SOL)
                <input
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm"
                  inputMode="decimal"
                />
              </label>

              <Button onClick={depositAndCredit} disabled={depositing || !connected} className="w-full">
                {depositing ? "Depositing…" : "Deposit + Credit"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8">
          <h2 className="text-lg font-semibold">Outcomes</h2>
          <div className="mt-3 grid gap-3">
            {outcomes.map((o) => {
              const name =
                typeof o.kols?.display_name === "string" && o.kols.display_name.length > 0
                  ? o.kols.display_name
                  : `${o.kol_wallet_address.slice(0, 4)}…${o.kol_wallet_address.slice(-4)}`

              return (
                <div key={o.outcome_id} className="rounded-xl border border-border/60 bg-card/50 px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{name}</div>
                      <div className="text-xs text-muted-foreground truncate">{o.question_text}</div>
                    </div>

                    <Link
                      href={`/pm/outcomes/${encodeURIComponent(o.outcome_id)}`}
                      className="h-9 rounded-md bg-foreground px-3 text-sm font-medium text-background hover:opacity-90 inline-flex items-center"
                    >
                      Trade
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
