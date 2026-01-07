import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"

export const runtime = "nodejs"

type BootstrapBody = {
  tournament_id?: string
  include_statuses?: string[]
  dry_run?: boolean
  limit?: number
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

function pickEscrowAddress(args: { tournament_id: string; addresses: string[] }): string | null {
  const { tournament_id, addresses } = args
  if (!addresses || addresses.length === 0) return null

  const seed = String(tournament_id)
  let sum = 0
  for (let i = 0; i < seed.length; i++) sum = (sum + seed.charCodeAt(i)) >>> 0
  return addresses[sum % addresses.length] ?? addresses[0]!
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:tournaments:bootstrap-escrow", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as BootstrapBody

    const dry_run = body?.dry_run === true
    const limit = typeof body?.limit === "number" && Number.isFinite(body.limit) && body.limit > 0 ? Math.min(500, Math.floor(body.limit)) : 100

    const statuses = Array.isArray(body?.include_statuses) && body.include_statuses.length > 0 ? body.include_statuses : ["upcoming", "active"]

    const escrowAddresses = getEscrowAddressesFromEnv()
    if (escrowAddresses.length === 0) {
      return NextResponse.json({ error: "No escrow wallets configured" }, { status: 500 })
    }

    let q = supabase
      .from("tournaments")
      .select("id, escrow_wallet_address, status")
      .is("escrow_wallet_address", null)
      .in("status", statuses)
      .limit(limit)

    if (typeof body?.tournament_id === "string" && body.tournament_id.trim().length > 0) {
      q = q.eq("id", body.tournament_id.trim())
    }

    const { data: tournaments, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (tournaments ?? []) as Array<{ id: string; escrow_wallet_address: string | null; status: string }>

    const planned = rows.map((t) => ({
      id: t.id,
      escrow_wallet_address: pickEscrowAddress({ tournament_id: t.id, addresses: escrowAddresses }),
      status: t.status,
    }))

    const missing = planned.filter((p) => !p.escrow_wallet_address)
    if (missing.length > 0) {
      return NextResponse.json({ error: "Failed to assign escrow wallet", details: missing.map((m) => m.id) }, { status: 500 })
    }

    if (dry_run) {
      return NextResponse.json({ ok: true, dry_run, count: planned.length, sample: planned.slice(0, 10) })
    }

    const updated: any[] = []
    for (const p of planned) {
      const { data: updatedRow, error: upErr } = await supabase
        .from("tournaments")
        .update({ escrow_wallet_address: p.escrow_wallet_address })
        .eq("id", p.id)
        .is("escrow_wallet_address", null)
        .select("id, escrow_wallet_address")
        .maybeSingle()

      if (upErr) {
        return NextResponse.json({ error: upErr.message }, { status: 500 })
      }

      if (updatedRow) updated.push(updatedRow)
    }

    return NextResponse.json({ ok: true, dry_run, updated_count: updated.length, updated })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
