"use client"

import { useEffect, useState } from "react"
import { createBrowserClient } from "@/lib/supabase/client"
import { Card } from "@/components/ui/card"
import { formatDistanceToNowStrict } from "date-fns"

type TxEventRow = {
  signature: string
  block_time: string | null
  raw: any
}

function timeAgo(blockTime: string | null): string {
  if (!blockTime) return ""
  const d = new Date(blockTime)
  if (Number.isNaN(d.getTime())) return ""
  return `${formatDistanceToNowStrict(d, { addSuffix: true })}`
}

export function RealtimeFeed() {
  const [events, setEvents] = useState<TxEventRow[]>([])
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

    async function fetchEvents() {
      const { data, error } = await supabase
        .from("tx_events")
        .select("signature, block_time, raw")
        .order("block_time", { ascending: false, nullsFirst: false })
        .limit(20)

      if (!isMounted) return
      if (!error) setEvents((data as any) ?? [])
      setLoading(false)
    }

    fetchEvents()

    const channel = supabase
      .channel("tx-events")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "tx_events",
        },
        () => {
          fetchEvents()
        },
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(channel)
    }
  }, [])

  return (
    <Card className="p-0 overflow-hidden border-border/60 bg-card/70">
      <div className="divide-y divide-border/50">
        {configMissing ? (
          <div className="p-6 text-sm text-muted-foreground">Supabase is not configured.</div>
        ) : loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading…</div>
        ) : events.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">No transactions yet.</div>
        ) : (
          events.map((e) => {
            const description =
              typeof e.raw?.description === "string" && e.raw.description.length > 0
                ? e.raw.description
                : `${e.signature.slice(0, 8)}…${e.signature.slice(-8)}`

            const ago = timeAgo(e.block_time)

            return (
              <div key={e.signature} className="px-4 py-3 flex items-center gap-3">
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
