import { NextResponse, type NextRequest } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"

export const runtime = "nodejs"

type MarketType = "DAILY" | "WEEKLY" | "MONTHLY"

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const mtRaw = (url.searchParams.get("market_type") ?? "DAILY").toUpperCase()
    const market_type: MarketType = mtRaw === "WEEKLY" ? "WEEKLY" : mtRaw === "MONTHLY" ? "MONTHLY" : "DAILY"

    const limitRaw = Number(url.searchParams.get("limit") ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50

    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from("market_rounds")
      .select("round_id, market_type, start_ts, lock_ts, settle_ts, status, collateral_mint, escrow_wallet_pubkey, rake_bps, inputs_hash, snapshot_hash, created_at, updated_at")
      .eq("market_type", market_type)
      .order("lock_ts", { ascending: false })
      .limit(limit)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, market_type, rounds: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
