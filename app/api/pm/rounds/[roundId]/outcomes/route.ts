import { NextResponse, type NextRequest } from "next/server"
import { createPublicClient } from "@/lib/supabase/public"

export const runtime = "nodejs"

export async function GET(_request: NextRequest, context: { params: Promise<{ roundId: string }> }) {
  try {
    const { roundId } = await context.params
    if (!roundId) return NextResponse.json({ error: "Missing roundId" }, { status: 400 })

    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from("outcome_markets")
      .select(
        "outcome_id, round_id, kol_wallet_address, question_text, status, final_outcome, created_at, kols!outcome_markets_kol_wallet_address_fkey(display_name, avatar_url, twitter_url, twitter_handle)",
      )
      .eq("round_id", roundId)
      .order("created_at", { ascending: true })
      .limit(500)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, round_id: roundId, outcomes: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
