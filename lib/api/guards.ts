import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

type RateLimitEntry = { count: number; resetAt: number }

const buckets = new Map<string, RateLimitEntry>()

export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return request.headers.get("x-real-ip") ?? "unknown"
}

export function rateLimit(args: {
  request: NextRequest
  key: string
  limit: number
  windowMs: number
}): NextResponse | null {
  const now = Date.now()
  const ip = getClientIp(args.request)
  const k = `${args.key}:${ip}`

  const existing = buckets.get(k)
  if (!existing || now >= existing.resetAt) {
    buckets.set(k, { count: 1, resetAt: now + args.windowMs })
    return null
  }

  existing.count += 1
  if (existing.count > args.limit) {
    const retryAfter = Math.max(0, Math.ceil((existing.resetAt - now) / 1000))
    return NextResponse.json(
      { error: "Rate limited" },
      { status: 429, headers: { "retry-after": String(retryAfter) } },
    )
  }

  return null
}

export function enforceMaxBodyBytes(request: NextRequest, maxBytes: number): NextResponse | null {
  const raw = request.headers.get("content-length")
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  if (n > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 })
  }
  return null
}

export function requireBearerIfConfigured(args: {
  request: NextRequest
  envVarName: string
  productionRequired?: boolean
}): NextResponse | null {
  const expected = process.env[args.envVarName]

  const prodRequired = args.productionRequired !== false
  if (process.env.NODE_ENV === "production" && prodRequired && (!expected || expected.length === 0)) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }

  if (!expected) return null

  const auth = args.request.headers.get("authorization")
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const m = auth.match(/^Bearer\s+(.+)$/i)
  const got = m?.[1] ?? null
  if (!got || got !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  return null
}
