import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { normalizeKolDisplayName } from "@/lib/utils"

function toXHandleUrl(handle: string): string {
  const h = handle.trim().replace(/^@/, "")
  return `https://x.com/${encodeURIComponent(h)}`
}

function toXSearchUrl(query: string): string {
  return `https://x.com/search?q=${encodeURIComponent(query)}`
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:kols:seed", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 1_000_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const supabase = createServiceClient()

  const body = (await request.json().catch(() => null)) as any
  const provided = Array.isArray(body?.kols) ? (body.kols as any[]) : null
  const reset_tracked = body?.reset_tracked === true

  if (reset_tracked) {
    const { error: resetError } = await supabase
      .from("kols")
      .update({ is_tracked: false, tracked_rank: null })
      .neq("wallet_address", "")

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 })
    }
  }

  const sourceRows: any[] = provided
    ? provided
    : ((await import("../../../../../kolscan-clone/src/lib/real-kol-data")).realDailyKOLs as any[])

  const rows = sourceRows
    .map((k: any, idx: number) => {
      const wallet_address = k?.wallet_address ?? k?.fullWallet ?? k?.full_wallet ?? k?.wallet
      if (typeof wallet_address !== "string" || wallet_address.length === 0) return null

      const nameRaw = k?.display_name ?? k?.name
      const display_name = normalizeKolDisplayName(nameRaw)

      const avatarRaw = k?.avatar_url ?? k?.avatar
      const avatar_url = typeof avatarRaw === "string" && avatarRaw.length > 0 ? avatarRaw : null

      const tracked_rank_raw = k?.tracked_rank ?? k?.rank
      const tracked_rank =
        typeof tracked_rank_raw === "number" && Number.isFinite(tracked_rank_raw) && tracked_rank_raw > 0
          ? Math.floor(tracked_rank_raw)
          : idx + 1

      const twitter_handle_raw = k?.twitter_handle
      const twitter_handle = typeof twitter_handle_raw === "string" && twitter_handle_raw.length > 0 ? twitter_handle_raw : null

      const twitter_url_raw = k?.twitter_url
      const twitter_url =
        typeof twitter_url_raw === "string" && twitter_url_raw.length > 0
          ? twitter_url_raw
          : twitter_handle
            ? toXHandleUrl(twitter_handle)
            : display_name
              ? toXSearchUrl(display_name)
              : null

      return {
        wallet_address,
        display_name,
        avatar_url,
        twitter_handle,
        twitter_url,
        telegram_url: null,
        website_url: null,
        is_active: true,
        is_tracked: true,
        tracked_rank,
      }
    })
    .filter(Boolean) as any[]

  const { error } = await supabase.from("kols").upsert(rows, { onConflict: "wallet_address" })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: rows.length })
}
