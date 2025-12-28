/**
 * Admin endpoint to manage emergency halt
 */

import { NextResponse, type NextRequest } from "next/server"
import {
  isEmergencyHaltActive,
  activateEmergencyHalt,
  deactivateEmergencyHalt,
} from "@/lib/escrow/security"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

export const runtime = "nodejs"

type HaltBody = {
  action: "activate" | "deactivate" | "status"
  reason?: string
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:escrow:halt", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 10_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const body = (await request.json().catch(() => ({}))) as HaltBody

    if (body.action === "activate") {
      const reason = body.reason ?? "Manual activation"
      await activateEmergencyHalt(reason)
      return NextResponse.json({ ok: true, action: "activated", reason })
    }

    if (body.action === "deactivate") {
      await deactivateEmergencyHalt()
      return NextResponse.json({ ok: true, action: "deactivated" })
    }

    // Default: status check
    const active = await isEmergencyHaltActive()
    return NextResponse.json({ ok: true, emergency_halt_active: active })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:escrow:halt:get", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const active = await isEmergencyHaltActive()
    return NextResponse.json({ ok: true, emergency_halt_active: active })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
