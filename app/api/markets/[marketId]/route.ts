import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { normalizeKolDisplayName } from "@/lib/utils"

export const runtime = "nodejs"

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ marketId: string }> },
) {
  try {
    const { marketId } = await context.params
    if (!marketId) return NextResponse.json({ error: "Missing marketId" }, { status: 400 })

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from("wager_markets")
      .select(
        "id, window_key, kol_wallet_address, closes_at, status, created_at, escrow_wallet_address, settled_at, resolved_outcome, resolved_rank, resolved_profit_sol, resolved_profit_usd, kols!wager_markets_kol_wallet_address_fkey(display_name, avatar_url, twitter_url, twitter_handle)",
      )
      .eq("id", marketId)
      .maybeSingle()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: "Market not found" }, { status: 404 })

    const k = (data as any)?.kols
    const market =
      k && typeof k === "object"
        ? {
            ...(data as any),
            kols: {
              ...(k as any),
              display_name: normalizeKolDisplayName((k as any).display_name),
            },
          }
        : data

    return NextResponse.json({ ok: true, market })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
