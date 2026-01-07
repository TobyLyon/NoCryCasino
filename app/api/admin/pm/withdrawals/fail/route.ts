import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"

export const runtime = "nodejs"

type Body = {
  withdrawal_id: string
  error?: string
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:withdrawals:fail", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const withdrawal_id = String(body?.withdrawal_id ?? "").trim()
    const errorMsg = typeof body?.error === "string" && body.error.trim().length > 0 ? body.error.trim() : "FAILED_BY_ADMIN"

    if (!withdrawal_id) return NextResponse.json({ error: "Missing withdrawal_id" }, { status: 400 })

    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc("pm_fail_withdrawal_admin", {
      p_withdrawal_id: withdrawal_id,
      p_error: errorMsg,
    })

    if (!error) {
      return NextResponse.json({ ok: true, withdrawal_id, result: data ?? null })
    }

    const msg = typeof error.message === "string" ? error.message.toLowerCase() : ""
    const missingFn = msg.includes("pm_fail_withdrawal_admin") && msg.includes("does not exist")
    if (!missingFn) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: row, error: rowErr } = await supabase
      .from("escrow_withdrawals")
      .select("withdrawal_id, processing_nonce")
      .eq("withdrawal_id", withdrawal_id)
      .maybeSingle()

    if (rowErr) return NextResponse.json({ error: rowErr.message }, { status: 500 })
    const processing_nonce = typeof (row as any)?.processing_nonce === "string" ? String((row as any).processing_nonce) : ""
    if (!processing_nonce || processing_nonce.trim().length < 8) {
      return NextResponse.json({ error: "Withdrawal not claimed (missing processing_nonce)" }, { status: 409 })
    }

    const { data: data2, error: err2 } = await supabase.rpc("pm_fail_withdrawal", {
      p_withdrawal_id: withdrawal_id,
      p_processing_nonce: processing_nonce,
      p_error: errorMsg,
    })

    if (err2) return NextResponse.json({ error: err2.message }, { status: 500 })

    return NextResponse.json({ ok: true, withdrawal_id, result: data2 ?? null })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
