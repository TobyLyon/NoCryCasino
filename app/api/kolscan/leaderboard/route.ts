import { NextResponse, type NextRequest } from "next/server"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"

function toInt(v: string | null, fallback: number): number {
  if (!v) return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.floor(n)
}

function timeframeToDays(tf: string): 1 | 7 | 30 {
  const t = tf.toLowerCase()
  if (t === "weekly" || t === "7") return 7
  if (t === "monthly" || t === "30") return 30
  return 1
}

async function warmKolscanCookie(): Promise<string> {
  const now = Date.now()
  ;(globalThis as any).__kolscanCookieCache = (globalThis as any).__kolscanCookieCache ?? { cookie: "", ts: 0 }
  const cache = (globalThis as any).__kolscanCookieCache as { cookie: string; ts: number }

  if (cache.cookie && now - cache.ts <= 10 * 60_000) return cache.cookie

  const warm = await fetch("https://kolscan.io/leaderboard?timeframe=1", {
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

  const cookieHeader = parts.join("; ")
  cache.cookie = cookieHeader
  cache.ts = now
  return cookieHeader
}

async function fetchKolscanLeaderboard(args: { timeframe: 1 | 7 | 30; page: number; pageSize: number }): Promise<any> {
  const cookieHeader = await warmKolscanCookie()

  const res = await fetch("https://kolscan.io/api/leaderboard", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      origin: "https://kolscan.io",
      referer: `https://kolscan.io/leaderboard?timeframe=${args.timeframe}`,
      "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
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
    return { ok: false, status: res.status, error: text.slice(0, 500) }
  }

  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, status: 502, error: `Invalid JSON: ${text.slice(0, 200)}` }
  }

  return { ok: true, status: 200, data: json?.data ?? json }
}

export async function GET(request: NextRequest) {
  const limited = rateLimit({ request, key: "public:kolscan:leaderboard", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 5_000)
  if (tooLarge) return tooLarge

  try {
    const url = new URL(request.url)

    const timeframe = (url.searchParams.get("timeframe") || "daily").trim()
    const tf = timeframeToDays(timeframe)

    const pageRaw = toInt(url.searchParams.get("page"), 0)
    const page = Math.max(0, pageRaw)

    const pageSizeRaw = toInt(url.searchParams.get("pageSize"), 10)
    const pageSize = Math.min(50, Math.max(1, pageSizeRaw))

    const result = await fetchKolscanLeaderboard({ timeframe: tf, page, pageSize })
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Kolscan fetch failed", status: result.status }, { status: 502 })
    }

    return NextResponse.json({ ok: true, timeframe, page, pageSize, data: result.data })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch kolscan leaderboard", details: e?.message ?? String(e) },
      { status: 500 },
    )
  }
}
