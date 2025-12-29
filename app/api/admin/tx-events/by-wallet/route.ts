import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

export async function GET(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:tx-events:by-wallet", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 10_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const url = new URL(request.url)

    const wallet = (url.searchParams.get("wallet") || "").trim()
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 })
    }

    const limitRaw = Number(url.searchParams.get("limit") || "50")
    const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 50))

    const sourceContains = (url.searchParams.get("sourceContains") || "").trim()
    const includeRaw = (url.searchParams.get("includeRaw") || "0").toLowerCase()
    const includeRawBool = includeRaw === "1" || includeRaw === "true"

    const supabase = createServiceClient()

    // Join tx_events <- tx_event_wallets and order by tx_events.block_time
    const { data, error } = await supabase
      .from("tx_events")
      .select("signature, block_time, slot, raw, tx_event_wallets!inner(wallet_address)")
      .eq("tx_event_wallets.wallet_address", wallet)
      .order("block_time", { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = Array.isArray(data) ? data : []

    const filtered = sourceContains
      ? rows.filter((r: any) => {
          const s = typeof r?.raw?.source === "string" ? r.raw.source : ""
          return s.toLowerCase().includes(sourceContains.toLowerCase())
        })
      : rows

    const events = filtered.map((r: any) => {
      const raw = r?.raw
      const source = typeof raw?.source === "string" ? raw.source : ""
      const type = typeof raw?.type === "string" ? raw.type : ""
      return {
        signature: String(r?.signature ?? ""),
        block_time: (r?.block_time ?? null) as string | null,
        slot: (r?.slot ?? null) as number | null,
        type,
        source,
        raw: includeRawBool ? raw : undefined,
      }
    })

    return NextResponse.json({ ok: true, wallet, count: events.length, events })
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to list tx events", details: e?.message ?? String(e) },
      { status: 500 },
    )
  }
}
