import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

type HeliusWebhook = {
  webhookID: string
  wallet?: string
  webhookURL: string
  transactionTypes: string[]
  accountAddresses: string[]
  webhookType: string
  authHeader?: string
  encoding?: string
  txnStatus?: string
}

function getHeliusWebhookBaseUrl(): string {
  return process.env.HELIUS_WEBHOOK_API_BASE_URL?.trim() || "https://api.helius.xyz"
}

function toHeliusWebhookUrl(webhookId: string, apiKey: string): string {
  const base = getHeliusWebhookBaseUrl().replace(/\/$/, "")
  return `${base}/v0/webhooks/${encodeURIComponent(webhookId)}?api-key=${encodeURIComponent(apiKey)}`
}

async function heliusGetWebhook(webhookId: string, apiKey: string): Promise<HeliusWebhook> {
  const res = await fetch(toHeliusWebhookUrl(webhookId, apiKey), {
    method: "GET",
    headers: { "content-type": "application/json" },
    cache: "no-store",
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Helius GET webhook failed (${res.status}): ${text}`)
  }

  return JSON.parse(text) as HeliusWebhook
}

async function heliusUpdateWebhook(webhookId: string, apiKey: string, body: Partial<HeliusWebhook>): Promise<HeliusWebhook> {
  const res = await fetch(toHeliusWebhookUrl(webhookId, apiKey), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`Helius PUT webhook failed (${res.status}): ${text}`)
  }

  return JSON.parse(text) as HeliusWebhook
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

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:helius:webhook:sync", limit: 10, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const apiKey = process.env.HELIUS_API_KEY
  const webhookId = process.env.HELIUS_WEBHOOK_ID

  if (!apiKey || apiKey.length === 0) {
    return NextResponse.json({ error: "Missing HELIUS_API_KEY" }, { status: 500 })
  }

  if (!webhookId || webhookId.length === 0) {
    return NextResponse.json({ error: "Missing HELIUS_WEBHOOK_ID" }, { status: 500 })
  }

  try {
    const body = (await request.json().catch(() => null)) as any
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : 2000

    const supabase = createServiceClient()
    const { data: kols, error } = await supabase
      .from("kols")
      .select("wallet_address")
      .eq("is_active", true)
      .eq("is_tracked", true)
      .order("tracked_rank", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const addresses = uniqStrings((kols ?? []).map((k: any) => String(k.wallet_address)))

    const current = await heliusGetWebhook(webhookId, apiKey)

    const updateBody: Partial<HeliusWebhook> = {
      webhookURL: current.webhookURL,
      transactionTypes: current.transactionTypes,
      accountAddresses: addresses,
      webhookType: current.webhookType,
      authHeader: current.authHeader,
      encoding: current.encoding,
      txnStatus: current.txnStatus,
    }

    const updated = await heliusUpdateWebhook(webhookId, apiKey, updateBody)

    return NextResponse.json({
      ok: true,
      trackedWallets: addresses.length,
      heliusWebhookId: webhookId,
      heliusBaseUrl: getHeliusWebhookBaseUrl(),
      heliusAccountAddresses: updated.accountAddresses?.length ?? null,
      transactionTypes: updated.transactionTypes ?? null,
      webhookURL: updated.webhookURL ?? null,
    })
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    console.error("Helius webhook sync failed:", msg)
    return NextResponse.json(
      {
        error: msg,
        heliusWebhookId: webhookId,
        heliusBaseUrl: getHeliusWebhookBaseUrl(),
      },
      { status: 500 },
    )
  }
}
