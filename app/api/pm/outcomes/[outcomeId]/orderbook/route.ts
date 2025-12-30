import { NextResponse, type NextRequest } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"

export const runtime = "nodejs"

type Side = "BUY" | "SELL"

export async function GET(request: NextRequest, context: { params: Promise<{ outcomeId: string }> }) {
  try {
    const { outcomeId } = await context.params
    if (!outcomeId) return NextResponse.json({ error: "Missing outcomeId" }, { status: 400 })

    const url = new URL(request.url)
    const sideRaw = (url.searchParams.get("side") ?? "").toUpperCase()
    const side: Side | null = sideRaw === "BUY" || sideRaw === "SELL" ? (sideRaw as Side) : null

    const limitRaw = Number(url.searchParams.get("limit") ?? 200)
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200

    const supabase = createPublicClient()

    const sideToUse: Side = side ?? "BUY"
    const { data, error } = await supabase.rpc("pm_public_orderbook", {
      p_outcome_id: outcomeId,
      p_side: sideToUse,
      p_limit: limit,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, outcome_id: outcomeId, side: sideToUse, levels: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
