import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

type WindowKey = "daily" | "weekly" | "monthly"

function nextDailyCloseUtc(): string {
  const d = new Date()
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0))
  return next.toISOString()
}

function nextWeeklyCloseUtc(): string {
  // Next Monday 00:00 UTC
  const d = new Date()
  const day = d.getUTCDay() // 0=Sun
  const daysUntilMon = (8 - day) % 7 || 7
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysUntilMon, 0, 0, 0, 0))
  return next.toISOString()
}

function nextMonthlyCloseUtc(): string {
  const d = new Date()
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  return next.toISOString()
}

function closesAtForWindow(window_key: WindowKey): string {
  if (window_key === "weekly") return nextWeeklyCloseUtc()
  if (window_key === "monthly") return nextMonthlyCloseUtc()
  return nextDailyCloseUtc()
}

function getEscrowAddressesFromEnv(): string[] {
  const raw = process.env.ESCROW_WALLET_ADDRESSES
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  const a1 = process.env.ESCROW_WALLET_1_ADDRESS
  const a2 = process.env.ESCROW_WALLET_2_ADDRESS
  const a3 = process.env.ESCROW_WALLET_3_ADDRESS
  return [a1, a2, a3].filter((v): v is string => typeof v === "string" && v.length > 0)
}

function pickEscrowAddress(args: { window_key: WindowKey; closes_at: string; addresses: string[] }): string | null {
  const { window_key, closes_at, addresses } = args
  if (!addresses || addresses.length === 0) return null

  // Deterministic rotation by round
  const seed = `${window_key}::${closes_at}`
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) >>> 0
  return addresses[sum % addresses.length] ?? addresses[0]!
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:markets:bootstrap", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as any
    const windowRaw = (body?.window_key || body?.window || "all").toLowerCase()

    const closesAtOverride =
      typeof body?.closes_at === "string" && body.closes_at.length > 0 && Number.isFinite(Date.parse(body.closes_at))
        ? body.closes_at
        : null

    const windows: WindowKey[] =
      windowRaw === "daily" || windowRaw === "weekly" || windowRaw === "monthly"
        ? [windowRaw]
        : ["daily", "weekly", "monthly"]

    const { data: kols, error: kolsError } = await supabase
      .from("kols")
      .select("wallet_address")
      .eq("is_active", true)
      .eq("is_tracked", true)
      .order("tracked_rank", { ascending: true, nullsFirst: false })
      .limit(200)

    if (kolsError) return NextResponse.json({ error: kolsError.message }, { status: 500 })

    const trackedWallets = (kols ?? []).map((k: any) => k.wallet_address).filter((v: any) => typeof v === "string")
    const now = new Date().toISOString()

    const escrowAddresses = getEscrowAddressesFromEnv()

    let total = 0
    const created: Array<{ window_key: WindowKey; closes_at: string; count: number }> = []

    for (const w of windows) {
      const closes_at = closesAtOverride ?? closesAtForWindow(w)
      const escrow_wallet_address = pickEscrowAddress({ window_key: w, closes_at, addresses: escrowAddresses })
      const rows = trackedWallets.map((kol_wallet_address) => ({
        window_key: w,
        kol_wallet_address,
        closes_at,
        escrow_wallet_address,
        status: "open" as const,
        created_at: now,
      }))

      const { error } = await supabase.from("wager_markets").upsert(rows, {
        onConflict: "window_key,kol_wallet_address,closes_at",
      })

      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      total += rows.length
      created.push({ window_key: w, closes_at, count: rows.length })
    }

    return NextResponse.json({ ok: true, total, created })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
