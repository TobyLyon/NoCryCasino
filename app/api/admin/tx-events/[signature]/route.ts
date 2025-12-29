import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

export async function GET(
  request: NextRequest,
  { params }: { params: { signature: string } },
) {
  const limited = rateLimit({ request, key: "admin:tx-events:get", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 10_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const signature = typeof params?.signature === "string" ? params.signature.trim() : ""
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 })
    }

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from("tx_events")
      .select("signature, block_time, slot, source, raw")
      .eq("signature", signature)
      .maybeSingle()

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
