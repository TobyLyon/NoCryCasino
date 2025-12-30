import { NextResponse, type NextRequest } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"

export const runtime = "nodejs"

export async function GET(request: NextRequest, context: { params: Promise<{ outcomeId: string }> }) {
  try {
    const { outcomeId } = await context.params
    if (!outcomeId) return NextResponse.json({ error: "Missing outcomeId" }, { status: 400 })

    const url = new URL(request.url)
    const limitRaw = Number(url.searchParams.get("limit") ?? 100)
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 100

    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from("fills")
      .select("fill_id, outcome_id, taker_order_id, maker_order_id, price, quantity, fee_bps, fee_amount, match_id, created_at")
      .eq("outcome_id", outcomeId)
      .order("created_at", { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, outcome_id: outcomeId, fills: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
