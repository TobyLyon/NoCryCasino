import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { normalizeKolDisplayName } from "@/lib/utils"

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractSocials(html: string): { twitter_url: string | null; telegram_url: string | null; website_url: string | null } {
  const norm = html

  const twitterMatch = norm.match(/https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,30}/i)
  const telegramMatch = norm.match(/https?:\/\/t\.me\/[A-Za-z0-9_]{3,64}/i)
  const websiteMatch = norm.match(/https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[A-Za-z0-9._~:\/?#\[\]@!$&'()*+,;=-]*)?/i)

  const twitter_url = twitterMatch ? twitterMatch[0] : null
  const telegram_url = telegramMatch ? telegramMatch[0] : null

  let website_url: string | null = null
  if (websiteMatch) {
    const w = websiteMatch[0]
    if (!twitter_url || w !== twitter_url) {
      if (!telegram_url || w !== telegram_url) {
        if (!w.includes("kolscan.io") && !w.includes("pump.fun") && !w.includes("discord") && !w.includes("solscan.io")) {
          website_url = w
        }
      }
    }
  }

  return { twitter_url, telegram_url, website_url }
}

function extractProfileMeta(html: string): { display_name: string | null; avatar_url: string | null } {
  const titleMatch = html.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)
  const imageMatch = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)

  const display_name = normalizeKolDisplayName(titleMatch ? titleMatch[1] : null)

  const avatar_raw = imageMatch ? imageMatch[1] : null
  let avatar_url: string | null = null
  if (typeof avatar_raw === "string" && avatar_raw.trim().length > 0) {
    try {
      const u = new URL(avatar_raw.trim(), "https://kolscan.io")
      if (u.pathname === "/_next/image") {
        const inner = u.searchParams.get("url")
        if (inner) {
          try {
            const decoded = decodeURIComponent(inner)
            avatar_url = new URL(decoded, "https://kolscan.io").toString()
          } catch {
            avatar_url = u.toString()
          }
        } else {
          avatar_url = u.toString()
        }
      } else {
        avatar_url = u.toString()
      }
    } catch {
      avatar_url = avatar_raw.trim()
    }
  }

  return { display_name, avatar_url }
}

async function fetchText(url: string): Promise<string> {
  const now = Date.now()
  ;(globalThis as any).__kolscanCookieCache = (globalThis as any).__kolscanCookieCache ?? { cookie: "", ts: 0 }
  const cache = (globalThis as any).__kolscanCookieCache as { cookie: string; ts: number }

  let cookieHeader = cache.cookie
  if (!cookieHeader || now - cache.ts > 10 * 60_000) {
    const warm = await fetch("https://kolscan.io", {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    })

    const getSetCookie = (warm.headers as any).getSetCookie as undefined | (() => string[])
    const setCookies = typeof getSetCookie === "function" ? getSetCookie.call(warm.headers) : []
    const setCookieStr = warm.headers.get("set-cookie")

    const parts = [...setCookies, ...(setCookieStr ? [setCookieStr] : [])]
      .flatMap((v) => String(v).split(/,(?=[^;]+?=)/g))
      .map((v) => v.split(";")[0]?.trim())
      .filter((v): v is string => !!v)

    cookieHeader = parts.join("; ")
    cache.cookie = cookieHeader
    cache.ts = now
  }

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      ...(cookieHeader ? { cookie: cookieHeader } : null),
    },
    cache: "no-store",
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`kolscan fetch failed (${res.status}): ${text.slice(0, 250)}`)
  }
  return text
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:kols:kolscan:backfill", limit: 6, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const startedAt = Date.now()

  const body = (await request.json().catch(() => null)) as any

  const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(200, Math.floor(body.limit)) : 50
  const delayMs = typeof body?.delayMs === "number" && Number.isFinite(body.delayMs) && body.delayMs >= 0 ? Math.floor(body.delayMs) : 900
  const afterRaw = typeof body?.after === "string" ? body.after : null
  const after = typeof afterRaw === "string" && afterRaw.trim().length > 0 ? afterRaw.trim() : null
  const onlyMissing = body?.onlyMissing !== false
  const isTrackedOnly = body?.isTrackedOnly !== false
  const isActiveOnly = body?.isActiveOnly !== false
  const timeframeDays = body?.timeframeDays === 7 ? 7 : body?.timeframeDays === 30 ? 30 : 1
  const maxRunMs = typeof body?.maxRunMs === "number" && Number.isFinite(body.maxRunMs) && body.maxRunMs > 1000 ? Math.floor(body.maxRunMs) : 55_000

  const supabase = createServiceClient()

  let q = supabase
    .from("kols")
    .select(
      "wallet_address, display_name, avatar_url, twitter_url, telegram_url, website_url, is_active, is_tracked, updated_at",
    )

  if (isActiveOnly) q = q.eq("is_active", true)
  if (isTrackedOnly) q = q.eq("is_tracked", true)

  if (onlyMissing) {
    q = q.or("display_name.is.null,avatar_url.is.null,twitter_url.is.null,telegram_url.is.null,website_url.is.null")
  }

  q = q.order("wallet_address", { ascending: true })
  if (after) q = q.gt("wallet_address", after)

  const { data: kols, error } = await q.limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = Array.isArray(kols) ? kols : []

  let processed = 0
  let updated = 0
  let last_wallet_address: string | null = null
  const errors: Array<{ wallet_address: string; error: string }> = []

  for (let i = 0; i < rows.length; i += 1) {
    const elapsed = Date.now() - startedAt
    if (elapsed > maxRunMs) break

    const k = rows[i] as any
    const wallet_address = String(k.wallet_address || "").trim()
    if (!wallet_address) continue

    processed += 1
    last_wallet_address = wallet_address

    try {
      const accountUrl = `https://kolscan.io/account/${wallet_address}?timeframe=${timeframeDays}`
      const html = await fetchText(accountUrl)

      const socials = extractSocials(html)
      const profile = extractProfileMeta(html)

      const patch: any = { wallet_address }
      let anyChange = false

      const display_name_existing = k.display_name ?? null
      const avatar_url_existing = k.avatar_url ?? null
      const twitter_existing = k.twitter_url ?? null
      const telegram_existing = k.telegram_url ?? null
      const website_existing = k.website_url ?? null

      if (profile.display_name && (!onlyMissing || !display_name_existing)) {
        patch.display_name = profile.display_name
        anyChange = true
      }

      if (profile.avatar_url && (!onlyMissing || !avatar_url_existing)) {
        patch.avatar_url = profile.avatar_url
        anyChange = true
      }

      if (socials.twitter_url && (!onlyMissing || !twitter_existing)) {
        patch.twitter_url = socials.twitter_url
        anyChange = true
      }

      if (socials.telegram_url && (!onlyMissing || !telegram_existing)) {
        patch.telegram_url = socials.telegram_url
        anyChange = true
      }

      if (socials.website_url && (!onlyMissing || !website_existing)) {
        patch.website_url = socials.website_url
        anyChange = true
      }

      if (anyChange) {
        const { error: upsertError } = await supabase.from("kols").upsert([patch], { onConflict: "wallet_address" })
        if (upsertError) throw upsertError
        updated += 1
      }

      if (delayMs > 0 && i < rows.length - 1) await sleep(delayMs)
    } catch (e: any) {
      errors.push({ wallet_address, error: e?.message ?? String(e) })
    }
  }

  const duration_ms = Date.now() - startedAt

  return NextResponse.json({
    ok: true,
    after,
    nextAfter: last_wallet_address,
    limit,
    processed,
    updated,
    duration_ms,
    errors: errors.length > 0 ? errors.slice(0, 25) : undefined,
    exhausted: processed >= rows.length,
  })
}
