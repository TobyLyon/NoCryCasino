import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

type WindowKey = "daily" | "weekly" | "monthly"

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const windowRaw = (url.searchParams.get("window") || "daily").toLowerCase()
    const window_key: WindowKey =
      windowRaw === "weekly" ? "weekly" : windowRaw === "monthly" ? "monthly" : "daily"

    const supabase = createServiceClient()

    const { data, error } = await supabase
      .from("wager_markets")
      .select(
        "id, window_key, kol_wallet_address, closes_at, status, created_at, kols!wager_markets_kol_wallet_address_fkey!inner(display_name, avatar_url, twitter_url, twitter_handle)",
      )
      .eq("window_key", window_key)
      .eq("kols.is_active", true)
      .eq("kols.is_tracked", true)
      .order("created_at", { ascending: false })
      .limit(500)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, window_key, markets: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
