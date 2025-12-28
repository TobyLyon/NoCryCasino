"use client"

import { useEffect, useState } from "react"
import { createBrowserClient } from "@/lib/supabase/client"
import { Card } from "@/components/ui/card"
import { formatDistanceToNowStrict } from "date-fns"

type Row = {
  signature: string
  block_time: string | null
  raw: any
}

export function WalletTxFeed({ walletAddress }: { walletAddress: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [configMissing, setConfigMissing] = useState(false)

  useEffect(() => {
    let isMounted = true

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!url || !key) {
      setConfigMissing(true)
      setLoading(false)
      return
    }

    const supabase = createBrowserClient()

    async function fetchRows() {
      const { data, error } = await supabase
        .from("tx_event_wallets")
        .select(
          `
          signature,
          tx_events:tx_events(signature, block_time, raw)
        `,
        )
        .eq("wallet_address", walletAddress)
        .order("signature", { ascending: false })
        .limit(50)

      if (!isMounted) return

      if (error || !data) {
        setRows([])
        setLoading(false)
        return
      }

      const mapped = (data as any[])
        .map((d) => {
          const e = d.tx_events
          return e
            ? {
                signature: e.signature,
                block_time: e.block_time ?? null,
                raw: e.raw,
              }
            : null
        })
        .filter(Boolean) as Row[]

      setRows(mapped)
      setLoading(false)
    }

    fetchRows()

    const channel = supabase
      .channel(`tx-event-wallets-${walletAddress}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tx_event_wallets",
          filter: `wallet_address=eq.${walletAddress}`,
        },
        () => {
          fetchRows()
        },
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [walletAddress])

  return (
    <Card className="p-0 overflow-hidden border-border/60 bg-card/70">
      <div className="divide-y divide-border/50">
        {configMissing ? (
          <div className="p-6 text-sm text-muted-foreground">Supabase is not configured.</div>
        ) : loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No transactions for this wallet yet.</div>
        ) : (
          rows.map((r) => {
            const description =
              typeof r.raw?.description === "string" && r.raw.description.length > 0
                ? r.raw.description
                : `${r.signature.slice(0, 8)}…${r.signature.slice(-8)}`

            const ago = r.block_time ? formatDistanceToNowStrict(new Date(r.block_time), { addSuffix: true }) : ""

            return (
              <div key={r.signature} className="px-4 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm leading-5 text-foreground">
                    <span className="font-semibold">{description}</span>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">{ago}</div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
