import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

function uniqStrings(values: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of values) {
    const s = v.trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function extractKolscanAccounts(pageText: string): Array<{ wallet: string; name: string | null }> {
  const out: Array<{ wallet: string; name: string | null }> = []
  const seen = new Set<string>()

  // Prefer capturing the linked name text when present.
  // Works for HTML anchors and also for markdown-ish link formats.
  const namedLink = /\[([^\]]{1,80})\]\(https?:\/\/kolscan\.io\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})[^)]*\)/g
  for (let m = namedLink.exec(pageText); m; m = namedLink.exec(pageText)) {
    const nameRaw = m[1]!
    const wallet = m[2]!
    if (seen.has(wallet)) continue
    seen.add(wallet)
    const name = nameRaw.replace(/\s+/g, " ").trim()
    out.push({ wallet, name: name.length > 0 ? name : null })
  }

  const htmlAnchor = /<a[^>]+href=["']\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})(?:\?[^"']*)?["'][^>]*>([^<]{1,80})<\/a>/g
  for (let m = htmlAnchor.exec(pageText); m; m = htmlAnchor.exec(pageText)) {
    const wallet = m[1]!
    const nameRaw = m[2]!
    if (seen.has(wallet)) continue
    seen.add(wallet)
    const name = nameRaw.replace(/\s+/g, " ").trim()
    out.push({ wallet, name: name.length > 0 ? name : null })
  }

  const fallback = /\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})/g
  for (let m = fallback.exec(pageText); m; m = fallback.exec(pageText)) {
    const wallet = m[1]!
    if (seen.has(wallet)) continue
    seen.add(wallet)
    out.push({ wallet, name: null })
  }

  return out
}

function extractSocials(html: string): { twitter_url: string | null; telegram_url: string | null; website_url: string | null } {
  const norm = html

  const twitterMatch = norm.match(/https?:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,30}/i)
  const telegramMatch = norm.match(/https?:\/\/t\.me\/[A-Za-z0-9_]{3,64}/i)
  const websiteMatch = norm.match(/https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?:\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=-]*)?/i)

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

async function fetchLeaderboardApi(args: { timeframe: 1 | 7 | 30; page: number; pageSize: number }): Promise<
  Array<{ wallet_address: string; name?: string | null; twitter?: string | null; telegram?: string | null }>
> {
  // Kolscan appears to use bot-management/cookies that are present in a browser.
  // Try to obtain cookies by fetching the leaderboard page first, then call the JSON API with those cookies.
  // Cache cookies briefly to avoid re-fetching per page.
  const now = Date.now()
  ;(globalThis as any).__kolscanCookieCache = (globalThis as any).__kolscanCookieCache ?? { cookie: "", ts: 0 }
  const cache = (globalThis as any).__kolscanCookieCache as { cookie: string; ts: number }

  let cookieHeader = cache.cookie
  if (!cookieHeader || now - cache.ts > 10 * 60_000) {
    const warm = await fetch(`https://kolscan.io/leaderboard?timeframe=${args.timeframe}`, {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
    })

    // Undici/Next runtime supports getSetCookie(); fallback to set-cookie header string.
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

  const res = await fetch("https://kolscan.io/api/leaderboard", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Kolscan appears to block some non-browser UAs; mimic a normal browser.
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      origin: "https://kolscan.io",
      referer: `https://kolscan.io/leaderboard?timeframe=${args.timeframe}`,
      "sec-ch-ua": "\"Chromium\";v=\"124\", \"Google Chrome\";v=\"124\", \"Not-A.Brand\";v=\"99\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-fetch-site": "same-origin",
      "sec-fetch-mode": "cors",
      "sec-fetch-dest": "empty",
      "x-requested-with": "XMLHttpRequest",
      ...(cookieHeader ? { cookie: cookieHeader } : null),
    },
    body: JSON.stringify({ timeframe: args.timeframe, page: args.page, pageSize: args.pageSize }),
    cache: "no-store",
  })

  const text = await res.text()
  if (!res.ok) {
    throw new Error(`kolscan api/leaderboard failed (${res.status}): ${text.slice(0, 250)}`)
  }

  const json = JSON.parse(text) as any
  const data = Array.isArray(json?.data) ? json.data : []
  return data
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": "NoCryCasinoBot/1.0 (+https://nocrycasino.com)",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
  const limited = rateLimit({ request, key: "admin:kols:kolscan:import", limit: 6, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const body = (await request.json().catch(() => null)) as any
  const timeframesInput = Array.isArray(body?.timeframes) ? body.timeframes : null
  const timeframeRaw = typeof body?.timeframe === "string" ? body.timeframe : null

  const timeframes = uniqStrings(
    (timeframesInput ?? (timeframeRaw ? [timeframeRaw] : ["daily"]))
      .map((t: any) => String(t).toLowerCase())
      .filter((t: string) => t === "daily" || t === "weekly" || t === "monthly"),
  ) as Array<"daily" | "weekly" | "monthly">

  const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.floor(body.limit) : 200
  const enrich = body?.enrich === true
  const trackImported = body?.trackImported === true

  const allAccounts: Array<{ wallet: string; name: string | null; twitter?: string | null; telegram?: string | null; timeframe: "daily" | "weekly" | "monthly"; rank: number }> = []
  const sources: Record<string, "api" | "html"> = {}
  const apiErrors: Record<string, string> = {}

  for (const tf of timeframes) {
    const tfParam = tf === "daily" ? 1 : tf === "weekly" ? 7 : 30

    // Prefer the internal JSON API (supports pagination and includes socials).
    // Fallback to HTML parsing if the API fails.
    const pageSize = Math.min(50, Math.max(1, limit))
    let got = 0
    let page = 0

    try {
      while (got < limit && page < 50) {
        const rows = await fetchLeaderboardApi({ timeframe: tfParam as 1 | 7 | 30, page, pageSize })
        if (!rows || rows.length === 0) break

        for (let i = 0; i < rows.length && got < limit; i += 1) {
          const r = rows[i]!
          const wallet = String(r.wallet_address || "").trim()
          if (!wallet) continue
          const name = typeof r.name === "string" && r.name.trim().length > 0 ? r.name.trim() : null
          const twitter = typeof r.twitter === "string" && r.twitter.trim().length > 0 ? r.twitter.trim() : null
          const telegram = typeof r.telegram === "string" && r.telegram.trim().length > 0 ? r.telegram.trim() : null
          allAccounts.push({ wallet, name, twitter, telegram, timeframe: tf, rank: got + 1 })
          got += 1
        }

        page += 1
      }
      sources[tf] = "api"
    } catch (e: any) {
      sources[tf] = "html"
      apiErrors[tf] = e?.message ?? String(e)
      const leaderboardUrl = `https://kolscan.io/leaderboard?timeframe=${tfParam}`
      const leaderboardHtml = await fetchText(leaderboardUrl)
      const accounts = extractKolscanAccounts(leaderboardHtml).slice(0, limit)

      for (let i = 0; i < accounts.length; i += 1) {
        const a = accounts[i]!
        allAccounts.push({ wallet: a.wallet, name: a.name, timeframe: tf, rank: i + 1 })
      }
    }
  }

  // Deduplicate wallets across timeframes (keep first occurrence)
  const seenWallet = new Set<string>()
  const deduped = allAccounts.filter((a) => {
    if (seenWallet.has(a.wallet)) return false
    seenWallet.add(a.wallet)
    return true
  })

  const wallets = uniqStrings(deduped.map((a) => a.wallet))

  const supabase = createServiceClient()

  const rows: any[] = []

  const shouldSetTrackedRank = trackImported && timeframes.length === 1
  const tfParamForEnrich = (tf: "daily" | "weekly" | "monthly") => (tf === "daily" ? 1 : tf === "weekly" ? 7 : 30)

  for (let i = 0; i < deduped.length; i += 1) {
    const a = deduped[i]!

    let twitter_url: string | null = typeof a.twitter === "string" && a.twitter.trim().length > 0 ? a.twitter.trim() : null
    let telegram_url: string | null = typeof a.telegram === "string" && a.telegram.trim().length > 0 ? a.telegram.trim() : null
    let website_url: string | null = null

    if (enrich) {
      const accountUrl = `https://kolscan.io/account/${a.wallet}?timeframe=${tfParamForEnrich(a.timeframe)}`
      const accountHtml = await fetchText(accountUrl)
      const socials = extractSocials(accountHtml)
      twitter_url = socials.twitter_url ?? twitter_url
      telegram_url = socials.telegram_url ?? telegram_url
      website_url = socials.website_url
    }

    const row: any = {
      wallet_address: a.wallet,
      is_active: true,
    }

    if (a.name) row.display_name = a.name
    if (twitter_url) row.twitter_url = twitter_url
    if (telegram_url) row.telegram_url = telegram_url
    if (website_url) row.website_url = website_url

    // Never untrack or clear rank on re-import; only set when explicitly asked.
    if (trackImported) row.is_tracked = true
    if (shouldSetTrackedRank) row.tracked_rank = a.rank

    rows.push(row)
  }

  const { error } = await supabase.from("kols").upsert(rows, { onConflict: "wallet_address" })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    timeframes,
    sources,
    apiErrors: Object.keys(apiErrors).length > 0 ? apiErrors : undefined,
    imported: rows.length,
    uniqueWallets: wallets.length,
    enrich,
    trackImported,
  })
}
