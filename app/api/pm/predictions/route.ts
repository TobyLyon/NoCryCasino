import { NextResponse, type NextRequest } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const category = url.searchParams.get("category") ?? ""
    const status = url.searchParams.get("status") ?? "approved"
    const limitRaw = Number(url.searchParams.get("limit") ?? 50)
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, Math.floor(limitRaw))) : 50

    const supabase = createPublicClient()
    
    let query = supabase
      .from("user_predictions")
      .select("prediction_id, creator_wallet, question, category, end_date, status, total_volume, yes_pool, no_pool, created_at")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (status && status !== "all") {
      query = query.eq("status", status)
    }

    if (category && category !== "all") {
      query = query.eq("category", category)
    }

    const { data, error } = await query

    if (error) {
      // If table doesn't exist yet, return empty array
      if (error.code === "42P01") {
        return NextResponse.json({ ok: true, predictions: [] })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, predictions: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
