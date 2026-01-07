import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { normalizeKolDisplayName } from "@/lib/utils"

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:kols", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 250_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const payload = await request.json()
  const rows = Array.isArray(payload) ? payload : [payload]

  const supabase = createServiceClient()

  const normalized = rows
    .map((r: any) => {
      const wallet_address = r.wallet_address ?? r.walletAddress
      if (typeof wallet_address !== "string" || wallet_address.length === 0) return null

      const display_name_raw = r.display_name ?? r.displayName
      const display_name = normalizeKolDisplayName(display_name_raw) ?? undefined

      const avatar_url_raw = r.avatar_url ?? r.avatarUrl
      const avatar_url = typeof avatar_url_raw === "string" && avatar_url_raw.trim().length > 0 ? avatar_url_raw.trim() : undefined

      const twitter_handle_raw = r.twitter_handle ?? r.twitterHandle
      const twitter_handle = typeof twitter_handle_raw === "string" && twitter_handle_raw.trim().length > 0 ? twitter_handle_raw.trim() : undefined

      const twitter_url_raw = r.twitter_url ?? r.twitterUrl
      const twitter_url = typeof twitter_url_raw === "string" && twitter_url_raw.trim().length > 0 ? twitter_url_raw.trim() : undefined

      const telegram_url_raw = r.telegram_url ?? r.telegramUrl
      const telegram_url = typeof telegram_url_raw === "string" && telegram_url_raw.trim().length > 0 ? telegram_url_raw.trim() : undefined

      const website_url_raw = r.website_url ?? r.websiteUrl
      const website_url = typeof website_url_raw === "string" && website_url_raw.trim().length > 0 ? website_url_raw.trim() : undefined

      const is_active_raw = r.is_active ?? r.isActive
      const is_active = typeof is_active_raw === "boolean" ? is_active_raw : undefined

      const is_tracked_raw = r.is_tracked ?? r.isTracked
      const is_tracked = typeof is_tracked_raw === "boolean" ? is_tracked_raw : undefined

      const tracked_rank_raw = r.tracked_rank ?? r.trackedRank
      const tracked_rank =
        typeof tracked_rank_raw === "number" && Number.isFinite(tracked_rank_raw) && tracked_rank_raw > 0 ? Math.floor(tracked_rank_raw) : undefined

      return {
        wallet_address,
        ...(typeof display_name === "string" ? { display_name } : null),
        ...(typeof avatar_url === "string" ? { avatar_url } : null),
        ...(typeof twitter_handle === "string" ? { twitter_handle } : null),
        ...(typeof twitter_url === "string" ? { twitter_url } : null),
        ...(typeof telegram_url === "string" ? { telegram_url } : null),
        ...(typeof website_url === "string" ? { website_url } : null),
        ...(typeof is_active === "boolean" ? { is_active } : null),
        ...(typeof is_tracked === "boolean" ? { is_tracked } : null),
        ...(typeof tracked_rank === "number" ? { tracked_rank } : null),
      }
    })
    .filter(Boolean) as any[]

  const { error } = await supabase.from("kols").upsert(normalized, { onConflict: "wallet_address" })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: normalized.length })
}
