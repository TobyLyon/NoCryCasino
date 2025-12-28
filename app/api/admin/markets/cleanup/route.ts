import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

type Status = "open" | "closed" | "settled" | "cancelled"

type CleanupBody = {
  dry_run?: boolean
  delete_untracked?: boolean
  delete_inactive?: boolean
  prune_closed_before?: string
  prune_statuses?: Status[]
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:markets:cleanup", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as CleanupBody

    const dry_run = body?.dry_run === true
    const delete_untracked = body?.delete_untracked !== false
    const delete_inactive = body?.delete_inactive !== false

    const prune_closed_before =
      typeof body?.prune_closed_before === "string" && body.prune_closed_before.length > 0 ? body.prune_closed_before : null

    const prune_statuses: Status[] = Array.isArray(body?.prune_statuses)
      ? (body.prune_statuses as Status[])
      : ["closed", "settled", "cancelled"]

    let totalCandidates = 0
    let deletedMarkets = 0

    const allIds = new Set<string>()

    if (delete_untracked || delete_inactive) {
      let q = supabase
        .from("wager_markets")
        .select(
          "id, kols!wager_markets_kol_wallet_address_fkey!inner(is_tracked, is_active)",
        )
        .limit(5000)

      if (delete_untracked && delete_inactive) {
        q = q.or("kols.is_tracked.eq.false,kols.is_active.eq.false")
      } else if (delete_untracked) {
        q = q.eq("kols.is_tracked", false)
      } else if (delete_inactive) {
        q = q.eq("kols.is_active", false)
      }

      const { data, error } = await q
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      for (const row of data ?? []) {
        if (row?.id) allIds.add(row.id)
      }
    }

    if (prune_closed_before) {
      const { data, error } = await supabase
        .from("wager_markets")
        .select("id, status, closes_at")
        .lt("closes_at", prune_closed_before)
        .in("status", prune_statuses)
        .limit(5000)

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      for (const row of data ?? []) {
        if (row?.id) allIds.add(row.id)
      }
    }

    const ids = Array.from(allIds)
    totalCandidates = ids.length

    if (!dry_run && ids.length > 0) {
      const { error } = await supabase.from("wager_markets").delete().in("id", ids)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      deletedMarkets = ids.length
    }

    return NextResponse.json({
      ok: true,
      dry_run,
      total_candidates: totalCandidates,
      deleted_markets: deletedMarkets,
      notes: {
        delete_untracked,
        delete_inactive,
        prune_closed_before,
        prune_statuses,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
