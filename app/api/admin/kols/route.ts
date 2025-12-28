import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

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

      return {
        wallet_address,
        display_name: r.display_name ?? r.displayName ?? null,
        avatar_url: r.avatar_url ?? r.avatarUrl ?? null,
        twitter_handle: r.twitter_handle ?? r.twitterHandle ?? null,
        twitter_url: r.twitter_url ?? r.twitterUrl ?? null,
        telegram_url: r.telegram_url ?? r.telegramUrl ?? null,
        website_url: r.website_url ?? r.websiteUrl ?? null,
        is_active: typeof r.is_active === "boolean" ? r.is_active : typeof r.isActive === "boolean" ? r.isActive : true,
      }
    })
    .filter(Boolean) as any[]

  const { error } = await supabase.from("kols").upsert(normalized, { onConflict: "wallet_address" })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, count: normalized.length })
}
