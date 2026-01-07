import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"

export const runtime = "nodejs"

type Body = {
  tournament_id?: string
  dry_run?: boolean
}

function metricForType(tournament_type: string): "roi" | "pnl" | "volume" | "wins" {
  const t = String(tournament_type ?? "").toLowerCase()
  if (t === "volume_race") return "volume"
  if (t === "pnl_absolute" || t === "pnl_race") return "pnl"
  if (t === "consecutive_wins") return "wins"
  return "roi"
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:tournaments:complete", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as Body

    const tournament_id = typeof body?.tournament_id === "string" ? body.tournament_id.trim() : ""
    if (!tournament_id) return NextResponse.json({ error: "Missing tournament_id" }, { status: 400 })

    const dry_run = body?.dry_run === true

    const { data: tournament, error: tErr } = await supabase
      .from("tournaments")
      .select("id, status, tournament_type, prize_pool, winner_wallet_address")
      .eq("id", tournament_id)
      .maybeSingle()

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 })

    if (String((tournament as any).status) === "completed") {
      return NextResponse.json({ ok: true, dry_run, tournament_id, already_completed: true, winner_wallet_address: (tournament as any).winner_wallet_address ?? null })
    }

    const { data: entries, error: eErr } = await supabase
      .from("tournament_entries")
      .select("id, wallet_address, current_pnl, current_roi, current_volume, consecutive_wins, status, joined_at, rank")
      .eq("tournament_id", tournament_id)
      .limit(5000)

    if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 })

    const rows = (entries ?? []) as any[]
    if (rows.length === 0) return NextResponse.json({ error: "No entries" }, { status: 400 })

    const metric = metricForType((tournament as any)?.tournament_type)

    const sorted = rows
      .map((r) => ({
        id: String(r.id),
        wallet_address: String(r.wallet_address),
        current_pnl: Number(r.current_pnl ?? 0),
        current_roi: Number(r.current_roi ?? 0),
        current_volume: Number(r.current_volume ?? 0),
        consecutive_wins: Number(r.consecutive_wins ?? 0),
        joined_at: String(r.joined_at ?? ""),
        rank: typeof r.rank === "number" ? r.rank : null,
      }))
      .sort((a, b) => {
        const av = metric === "volume" ? a.current_volume : metric === "pnl" ? a.current_pnl : metric === "wins" ? a.consecutive_wins : a.current_roi
        const bv = metric === "volume" ? b.current_volume : metric === "pnl" ? b.current_pnl : metric === "wins" ? b.consecutive_wins : b.current_roi
        if (bv !== av) return bv - av
        if (a.rank != null && b.rank != null && a.rank !== b.rank) return a.rank - b.rank
        if (a.joined_at && b.joined_at && a.joined_at !== b.joined_at) return a.joined_at.localeCompare(b.joined_at)
        return a.wallet_address.localeCompare(b.wallet_address)
      })

    const winner = sorted[0]
    if (!winner?.wallet_address) return NextResponse.json({ error: "Failed to determine winner" }, { status: 500 })

    const prizePool = Number((tournament as any)?.prize_pool ?? 0)

    if (dry_run) {
      return NextResponse.json({ ok: true, dry_run, tournament_id, metric, winner, prize_pool: prizePool })
    }

    const nowIso = new Date().toISOString()

    const { data: claimed, error: claimErr } = await supabase
      .from("tournaments")
      .update({ status: "completed", winner_wallet_address: winner.wallet_address, updated_at: nowIso })
      .eq("id", tournament_id)
      .neq("status", "completed")
      .select("id")
      .maybeSingle()

    if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 })

    if (!claimed) {
      return NextResponse.json({ ok: true, dry_run, tournament_id, already_completed: true, winner_wallet_address: (tournament as any).winner_wallet_address ?? winner.wallet_address })
    }

    await supabase.from("tournament_entries").update({ status: "winner", updated_at: nowIso }).eq("id", winner.id)

    await supabase
      .from("tournament_entries")
      .update({ status: "eliminated", updated_at: nowIso })
      .eq("tournament_id", tournament_id)
      .neq("id", winner.id)
      .eq("status", "active")

    return NextResponse.json({ ok: true, dry_run, tournament_id, winner_wallet_address: winner.wallet_address })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
