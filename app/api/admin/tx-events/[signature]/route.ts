import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ signature: string }> },
) {
  const limited = rateLimit({ request, key: "admin:tx-events:get", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 10_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const params = await context.params
    const signature = typeof params?.signature === "string" ? params.signature.trim() : ""
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 })
    }

    const url = new URL(request.url)
    const includeRaw = (url.searchParams.get("includeRaw") || "0").toLowerCase()
    const includeRawBool = includeRaw === "1" || includeRaw === "true"

    const supabase = createServiceClient()

    const selectClause = includeRawBool
      ? "signature, block_time, slot, source, raw"
      : "signature, block_time, slot, source, description, raw_source, raw_type"

    let data: any = null
    let error: any = null

    {
      const r = await supabase
        .from("tx_events")
        .select(selectClause)
        .eq("signature", signature)
        .maybeSingle()
      data = r.data
      error = r.error
    }

    if (!includeRawBool && error && typeof error?.message === "string" && error.message.toLowerCase().includes("does not exist")) {
      const r = await supabase
        .from("tx_events")
        .select("signature, block_time, slot, source")
        .eq("signature", signature)
        .maybeSingle()
      data = r.data
      error = r.error
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, event: data })
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to fetch tx event", details: e?.message ?? String(e) },
      { status: 500 },
    )
  }
}
