import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

function toISOStringFromAnyTimestamp(value: unknown): string | null {
  if (typeof value === "number") {
    if (value > 1_000_000_000_000) return new Date(value).toISOString()
    return new Date(value * 1000).toISOString()
  }
  if (typeof value === "string") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d.toISOString()
  }
  return null
}

function extractSignature(evt: any): string | null {
  const sig = evt?.signature ?? evt?.transactionSignature ?? evt?.txSignature
  if (typeof sig === "string" && sig.length > 0) return sig
  if (Array.isArray(sig) && typeof sig[0] === "string") return sig[0]
  return null
}

function extractSlot(evt: any): number | null {
  const slot = evt?.slot
  if (typeof slot === "number" && Number.isFinite(slot)) return slot
  if (typeof slot === "string" && slot.length > 0) {
    const n = Number(slot)
    if (Number.isFinite(n)) return n
  }
  return null
}

function extractBlockTime(evt: any): string | null {
  return (
    toISOStringFromAnyTimestamp(evt?.blockTime) ??
    toISOStringFromAnyTimestamp(evt?.timestamp) ??
    toISOStringFromAnyTimestamp(evt?.block_time)
  )
}

function extractWalletAddresses(evt: any): string[] {
  const out = new Set<string>()

  const add = (v: unknown) => {
    if (typeof v === "string" && v.length > 0) out.add(v)
  }

  if (Array.isArray(evt?.accountData)) {
    for (const a of evt.accountData) add(a?.account)
  }

  if (Array.isArray(evt?.accounts)) {
    for (const a of evt.accounts) add(a)
  }

  if (Array.isArray(evt?.nativeTransfers)) {
    for (const t of evt.nativeTransfers) {
      add(t?.fromUserAccount)
      add(t?.toUserAccount)
    }
  }

  if (Array.isArray(evt?.tokenTransfers)) {
    for (const t of evt.tokenTransfers) {
      add(t?.fromUserAccount)
      add(t?.toUserAccount)
    }
  }

  const swap = evt?.events?.swap
  const walkSwap = (s: any) => {
    if (!s) return
    add(s?.nativeInput?.account)
    add(s?.nativeOutput?.account)

    if (Array.isArray(s?.tokenInputs)) {
      for (const ti of s.tokenInputs) add(ti?.userAccount)
    }

    if (Array.isArray(s?.tokenOutputs)) {
      for (const to of s.tokenOutputs) add(to?.userAccount)
    }

    if (Array.isArray(s?.innerSwaps)) {
      for (const inner of s.innerSwaps) walkSwap(inner)
    }
  }
  walkSwap(swap)

  return Array.from(out)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  const s = Math.max(1, Math.floor(size))
  for (let i = 0; i < arr.length; i += s) out.push(arr.slice(i, i + s))
  return out
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "webhooks:helius", limit: 600, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 1_500_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "HELIUS_WEBHOOK_AUTH_TOKEN" })
  if (auth) return auth

  try {
    const payload = await request.json()
    const events = Array.isArray(payload) ? payload : [payload]

    const supabase = createServiceClient()

    const results = [] as Array<{ signature: string; stored: boolean; walletsLinked: number }>

    for (const evt of events) {
      const signature = extractSignature(evt)
      if (!signature) continue

      const blockTimeIso = extractBlockTime(evt)
      const slot = extractSlot(evt)

      const { error: upsertError } = await supabase.from("tx_events").upsert(
        {
          signature,
          block_time: blockTimeIso,
          slot,
          source: "helius",
          raw: evt,
        },
        { onConflict: "signature" },
      )

      if (upsertError) {
        return NextResponse.json({ error: "Failed to store event", details: upsertError.message }, { status: 500 })
      }

      const wallets = extractWalletAddresses(evt)

      const trackedWallets: any[] = []
      for (const wChunk of chunk(wallets, 500)) {
        const { data, error } = await supabase
          .from("kols")
          .select("wallet_address")
          .in("wallet_address", wChunk)
          .eq("is_active", true)
          .eq("is_tracked", true)

        if (error) {
          return NextResponse.json({ error: "Failed to query kols", details: error.message }, { status: 500 })
        }

        if (Array.isArray(data) && data.length > 0) trackedWallets.push(...data)
      }

      const trackedSet = new Set((trackedWallets ?? []).map((w: any) => w.wallet_address))
      const links = Array.from(trackedSet).map((wallet_address) => ({ signature, wallet_address }))

      if (links.length > 0) {
        const { error: linkError } = await supabase.from("tx_event_wallets").upsert(links)
        if (linkError) {
          return NextResponse.json({ error: "Failed to link wallets", details: linkError.message }, { status: 500 })
        }
      }

      const nowIso = new Date().toISOString()
      const trackedGeneric: any[] = []
      for (const wChunk of chunk(wallets, 500)) {
        const { data, error } = await supabase
          .from("tracked_wallets")
          .select("wallet_address, tracked_until")
          .in("wallet_address", wChunk)
          .eq("is_active", true)
          .or(`tracked_until.is.null,tracked_until.gt.${nowIso}`)

        if (error) {
          return NextResponse.json({ error: "Failed to query tracked wallets", details: error.message }, { status: 500 })
        }

        if (Array.isArray(data) && data.length > 0) trackedGeneric.push(...data)
      }

      const genericSet = new Set((trackedGeneric ?? []).map((w: any) => String(w.wallet_address)))
      const genericLinks = Array.from(genericSet)
        .filter((wallet_address) => wallet_address.length > 0)
        .map((wallet_address) => ({ signature, wallet_address }))

      if (genericLinks.length > 0) {
        const { error: linkErr } = await supabase.from("tx_event_tracked_wallets").upsert(genericLinks)
        if (linkErr) {
          return NextResponse.json({ error: "Failed to link tracked wallets", details: linkErr.message }, { status: 500 })
        }
      }

      results.push({ signature, stored: true, walletsLinked: links.length + genericLinks.length })
    }

    return NextResponse.json({ ok: true, count: results.length, results })
  } catch (error: any) {
    return NextResponse.json({ error: "Webhook handler failed", details: error?.message ?? String(error) }, { status: 500 })
  }
}
