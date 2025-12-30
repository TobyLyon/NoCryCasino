import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"

export const runtime = "nodejs"

type Body = {
  round_id?: string
  lock_before?: string
  limit?: number
  dry_run?: boolean
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:rounds:lock", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const dry_run = body?.dry_run === true
    const lock_before =
      typeof body?.lock_before === "string" && body.lock_before.length > 0
        ? body.lock_before
        : new Date().toISOString()

    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(200, Math.floor(body.limit)) : 50

    const supabase = createServiceClient()

    let q = supabase
      .from("market_rounds")
      .select("round_id, market_type, lock_ts, status")
      .eq("status", "OPEN")
      .lte("lock_ts", lock_before)
      .order("lock_ts", { ascending: true })
      .limit(limit)

    if (typeof body?.round_id === "string" && body.round_id.length > 0) {
      q = q.eq("round_id", body.round_id)
    }

    const { data: rounds, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = Array.isArray(rounds) ? rounds : []
    const results: any[] = []

    for (const r of rows) {
      if (!dry_run) {
        const { error: up1 } = await supabase.from("market_rounds").update({ status: "LOCKED" }).eq("round_id", r.round_id)
        if (up1) return NextResponse.json({ error: up1.message }, { status: 500 })

        const { error: up2 } = await supabase.from("outcome_markets").update({ status: "LOCKED" }).eq("round_id", r.round_id)
        if (up2) return NextResponse.json({ error: up2.message }, { status: 500 })

        const { data: expired, error: expErr } = await supabase.rpc("pm_expire_round_orders", { p_round_id: r.round_id })
        if (expErr) return NextResponse.json({ error: expErr.message }, { status: 500 })

        results.push({ round_id: r.round_id, locked: true, expired })
      } else {
        results.push({ round_id: r.round_id, locked: false, dry_run: true })
      }
    }

    return NextResponse.json({ ok: true, dry_run, locked: results.length, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
