import { NextResponse, type NextRequest } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, context: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await context.params
    const decoded = typeof roundId === "string" ? decodeURIComponent(roundId) : ""
    if (!decoded) return NextResponse.json({ error: "Missing roundId" }, { status: 400 })

    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from("market_rounds")
      .select(
        "round_id, market_type, start_ts, lock_ts, settle_ts, status, collateral_mint, escrow_wallet_pubkey, rake_bps, inputs_hash, snapshot_hash, created_at, updated_at",
      )
      .eq("round_id", decoded)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: "Round not found" }, { status: 404 })

    return NextResponse.json({ ok: true, round: data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
