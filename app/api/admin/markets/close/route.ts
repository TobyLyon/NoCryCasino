/**
 * Admin endpoint to transition markets from 'open' to 'closed' status
 * Addresses audit gap: Market status transition at closes_at
 */

import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"

export const runtime = "nodejs"

type WindowKey = "daily" | "weekly" | "monthly"

type CloseBody = {
  window_key?: WindowKey | "all"
  closes_before?: string
  limit?: number
  dry_run?: boolean
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:markets:close", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as CloseBody

    const windowRaw = body?.window_key ?? "all"
    const windows: WindowKey[] =
      windowRaw === "daily" || windowRaw === "weekly" || windowRaw === "monthly"
        ? [windowRaw]
        : ["daily", "weekly", "monthly"]

    const closes_before =
      typeof body?.closes_before === "string" && body.closes_before.length > 0
        ? body.closes_before
        : new Date().toISOString()

    const limit =
      typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0
        ? Math.floor(body.limit)
        : 1000

    const dry_run = body?.dry_run === true

    // Find open markets past their closes_at
    const { data: markets, error: marketsError } = await supabase
      .from("wager_markets")
      .select("id, window_key, kol_wallet_address, closes_at")
      .in("window_key", windows)
      .eq("status", "open")
      .lte("closes_at", closes_before)
      .order("closes_at", { ascending: true })
      .limit(limit)

    if (marketsError) {
      return NextResponse.json({ error: marketsError.message }, { status: 500 })
    }

    const toClose = (markets ?? []) as Array<{
      id: string
      window_key: WindowKey
      kol_wallet_address: string
      closes_at: string
    }>

    if (toClose.length === 0) {
      return NextResponse.json({ ok: true, dry_run, closed_count: 0, message: "No markets to close" })
    }

    if (!dry_run) {
      const ids = toClose.map((m) => m.id)
      const { error: updateError } = await supabase
        .from("wager_markets")
        .update({ status: "closed" })
        .in("id", ids)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    }

    // Group by window for summary
    const byWindow = new Map<string, number>()
    for (const m of toClose) {
      byWindow.set(m.window_key, (byWindow.get(m.window_key) ?? 0) + 1)
    }

    return NextResponse.json({
      ok: true,
      dry_run,
      closed_count: toClose.length,
      by_window: Object.fromEntries(byWindow),
      sample: toClose.slice(0, 5).map((m) => ({
        id: m.id,
        window_key: m.window_key,
        closes_at: m.closes_at,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
