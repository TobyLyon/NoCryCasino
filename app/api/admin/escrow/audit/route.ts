/**
 * Admin endpoint to audit escrow wallet security
 */

import { NextResponse, type NextRequest } from "next/server"
import { auditEscrowSecurity } from "@/lib/escrow/security"
import { rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:escrow:audit", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  try {
    const audit = await auditEscrowSecurity()

    return NextResponse.json({
      ok: true,
      ...audit,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
