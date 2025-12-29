import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

type HeliusEnhancedTx = {
  signature?: string
  timestamp?: number
  slot?: number
  type?: string
  source?: string
}

function toIsoFromSeconds(tsSeconds: unknown): string | null {
  if (typeof tsSeconds !== "number" || !Number.isFinite(tsSeconds) || tsSeconds <= 0) return null
  return new Date(tsSeconds * 1000).toISOString()
}

function uniqStrings(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const s = v.trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function getHeliusRpcBaseUrl(): string {
  return process.env.HELIUS_RPC_API_BASE_URL?.trim() || "https://api-mainnet.helius-rpc.com"
}

function toHeliusTxByAddressUrl(args: {
  wallet: string
  apiKey: string
  limit: number
  before?: string | null
}): string {
  const base = getHeliusRpcBaseUrl().replace(/\/$/, "")
  const url = new URL(`${base}/v0/addresses/${encodeURIComponent(args.wallet)}/transactions`)
  url.searchParams.set("api-key", args.apiKey)
  url.searchParams.set("limit", String(args.limit))
  url.searchParams.set("commitment", "finalized")
  url.searchParams.set("order", "desc")
  if (args.before) url.searchParams.set("before", args.before)
  return url.toString()
}

async function heliusFetchTxPage(args: {
  wallet: string
  apiKey: string
  limit: number
  before?: string | null
}): Promise<HeliusEnhancedTx[]> {
  const res = await fetch(toHeliusTxByAddressUrl(args), { method: "GET", cache: "no-store" })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Helius tx history failed (${res.status}): ${text}`)
  }
  const json = JSON.parse(text)
  return Array.isArray(json) ? (json as HeliusEnhancedTx[]) : []
}

async function upsertBatches(args: {
  supabase: ReturnType<typeof createServiceClient>
  txEvents: Array<{ signature: string; block_time: string | null; slot: number | null; source: string; raw: any }>
  links: Array<{ signature: string; wallet_address: string }>
  batchSize?: number
}): Promise<{ eventsUpserted: number; linksUpserted: number }> {
  const batchSize = typeof args.batchSize === "number" && args.batchSize > 0 ? Math.floor(args.batchSize) : 200

  let eventsUpserted = 0
  let linksUpserted = 0

  for (let i = 0; i < args.txEvents.length; i += batchSize) {
    const batch = args.txEvents.slice(i, i + batchSize)
    if (batch.length === 0) continue
    const { error } = await args.supabase.from("tx_events").upsert(batch, { onConflict: "signature" })
    if (error) throw new Error(error.message)
    eventsUpserted += batch.length
  }

  for (let i = 0; i < args.links.length; i += batchSize) {
    const batch = args.links.slice(i, i + batchSize)
    if (batch.length === 0) continue
    const { error } = await args.supabase.from("tx_event_wallets").upsert(batch)
    if (error) throw new Error(error.message)
    linksUpserted += batch.length
  }

  return { eventsUpserted, linksUpserted }
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:helius:transactions:backfill", limit: 10, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const apiKey = process.env.HELIUS_API_KEY
  if (!apiKey || apiKey.length === 0) {
    return NextResponse.json({ error: "Missing HELIUS_API_KEY" }, { status: 500 })
  }

  const startedAt = Date.now()

  try {
    const body = (await request.json().catch(() => null)) as any

    const days = typeof body?.days === "number" && Number.isFinite(body.days) && body.days > 0 ? body.days : 1
    const cutoffMs = Date.now() - Math.floor(days * 24 * 60 * 60 * 1000)
    const cutoffEpoch = Math.floor(cutoffMs / 1000)

    const maxRunMs =
      typeof body?.maxRunMs === "number" && Number.isFinite(body.maxRunMs) && body.maxRunMs > 1_000 ? Math.floor(body.maxRunMs) : 55_000

    const walletLimit =
      typeof body?.walletLimit === "number" && Number.isFinite(body.walletLimit) && body.walletLimit > 0 ? Math.floor(body.walletLimit) : 10

    const perWalletLimitRaw =
      typeof body?.perWalletLimit === "number" && Number.isFinite(body.perWalletLimit) && body.perWalletLimit > 0
        ? Math.floor(body.perWalletLimit)
        : 100
    const perWalletLimit = Math.min(100, Math.max(1, perWalletLimitRaw))

    const maxPagesPerWalletRaw =
      typeof body?.maxPagesPerWallet === "number" && Number.isFinite(body.maxPagesPerWallet) && body.maxPagesPerWallet > 0
        ? Math.floor(body.maxPagesPerWallet)
        : 10
    const maxPagesPerWallet = Math.min(50, Math.max(1, maxPagesPerWalletRaw))

    const after = typeof body?.after === "string" && body.after.trim().length > 0 ? body.after.trim() : null

    const walletsRaw = body?.wallets
    const walletsInput = Array.isArray(walletsRaw) ? uniqStrings(walletsRaw.map((v: any) => String(v))) : null

    const allowedTypesRaw = body?.transactionTypes
    const allowedTypesInput = Array.isArray(allowedTypesRaw)
      ? uniqStrings(allowedTypesRaw.map((v: any) => String(v)))
      : ["SWAP", "SWAP_EXACT_OUT", "SWAP_WITH_PRICE_IMPACT"]
    const allowedTypes = new Set(allowedTypesInput)

    const supabase = createServiceClient()

    const { data: kols, error: kolsError } = walletsInput && walletsInput.length > 0
      ? await supabase
          .from("kols")
          .select("wallet_address")
          .eq("is_active", true)
          .eq("is_tracked", true)
          .in("wallet_address", walletsInput)
          .order("wallet_address", { ascending: true })
      : await supabase
          .from("kols")
          .select("wallet_address")
          .eq("is_active", true)
          .eq("is_tracked", true)
          .gt("wallet_address", after ?? "")
          .order("wallet_address", { ascending: true })
          .limit(walletLimit)

    if (kolsError) {
      return NextResponse.json({ error: kolsError.message }, { status: 500 })
    }

    const wallets = (kols ?? []).map((k: any) => String(k.wallet_address)).filter((s) => s.length > 0)
    if (wallets.length === 0) {
      return NextResponse.json({ ok: true, cutoffEpoch, cutoffIso: new Date(cutoffMs).toISOString(), processedWallets: 0, eventsUpserted: 0, linksUpserted: 0, exhausted: true })
    }

    let eventsUpserted = 0
    let linksUpserted = 0
    let processedWallets = 0

    for (const wallet of wallets) {
      if (Date.now() - startedAt > maxRunMs) break

      let before: string | null = null
      let pages = 0

      while (pages < maxPagesPerWallet) {
        if (Date.now() - startedAt > maxRunMs) break

        const page = await heliusFetchTxPage({ wallet, apiKey, limit: perWalletLimit, before })
        if (page.length === 0) break

        pages += 1

        let minTsInPage: number | null = null

        const txEventsBatch: Array<{ signature: string; block_time: string | null; slot: number | null; source: string; raw: any }> = []
        const linksBatch: Array<{ signature: string; wallet_address: string }> = []

        for (const tx of page) {
          const sig = typeof tx?.signature === "string" ? tx.signature : null
          if (!sig) continue

          const ts = typeof tx?.timestamp === "number" && Number.isFinite(tx.timestamp) ? tx.timestamp : null
          if (typeof ts === "number") {
            minTsInPage = minTsInPage === null ? ts : Math.min(minTsInPage, ts)
            if (ts < cutoffEpoch) continue
          }

          const type = typeof tx?.type === "string" ? tx.type : null
          if (type && !allowedTypes.has(type)) continue

          const block_time = toIsoFromSeconds(tx?.timestamp)
          const slot = typeof tx?.slot === "number" && Number.isFinite(tx.slot) ? tx.slot : null

          txEventsBatch.push({ signature: sig, block_time, slot, source: "helius_backfill", raw: tx })
          linksBatch.push({ signature: sig, wallet_address: wallet })
        }

        if (txEventsBatch.length > 0) {
          try {
            const { eventsUpserted: e, linksUpserted: l } = await upsertBatches({
              supabase,
              txEvents: txEventsBatch,
              links: linksBatch,
              batchSize: 200,
            })
            eventsUpserted += e
            linksUpserted += l
          } catch (err: any) {
            return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 })
          }
        }

        const lastSig = page[page.length - 1]?.signature
        before = typeof lastSig === "string" && lastSig.length > 0 ? lastSig : null

        if (minTsInPage !== null && minTsInPage < cutoffEpoch) {
          break
        }

        if (!before) break
      }

      processedWallets += 1
    }

    const nextAfter = walletsInput && walletsInput.length > 0 ? null : processedWallets > 0 ? wallets[Math.min(processedWallets - 1, wallets.length - 1)] : after
    const exhausted = walletsInput && walletsInput.length > 0 ? true : processedWallets >= wallets.length ? wallets.length < walletLimit : false

    return NextResponse.json({
      ok: true,
      days,
      cutoffEpoch,
      cutoffIso: new Date(cutoffMs).toISOString(),
      processedWallets,
      eventsUpserted,
      linksUpserted,
      nextAfter,
      exhausted,
      duration_ms: Date.now() - startedAt,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
