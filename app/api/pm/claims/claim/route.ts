import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { buildPmMessage, requireFreshIssuedAt, requireSignedBody } from "@/lib/pm/signing"
import { consumePmNonce, isPmNonceRequired } from "@/lib/pm/nonce"

export const runtime = "nodejs"

type Body = {
  outcome_id: string
  wallet_address: string
  idempotency_key: string
  nonce?: string
  issued_at: string
  signature_base64: string
  message?: string
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "pm:claims:claim", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  const tooLarge = enforceMaxBodyBytes(request, 25_000)
  if (tooLarge) return tooLarge

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const outcome_id = String(body?.outcome_id ?? "").trim()
    const wallet_address = String(body?.wallet_address ?? "").trim()
    const idempotency_key = String(body?.idempotency_key ?? "").trim()
    const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : ""
    const issued_at = String(body?.issued_at ?? "").trim()
    const signature_base64 = String(body?.signature_base64 ?? "").trim()

    if (!outcome_id) return NextResponse.json({ error: "Missing outcome_id" }, { status: 400 })
    if (!wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (!idempotency_key || idempotency_key.length < 8) return NextResponse.json({ error: "Missing idempotency_key" }, { status: 400 })
    if (nonce.length > 0 && nonce.length < 8) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })
    if (!issued_at) return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
    if (!signature_base64) return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })

    const nonceRequired = isPmNonceRequired()
    if (nonceRequired && nonce.length === 0) return NextResponse.json({ error: "Missing nonce" }, { status: 400 })

    const freshness = requireFreshIssuedAt(issued_at, 5 * 60 * 1000)
    if (!freshness.ok) return NextResponse.json({ error: freshness.error }, { status: 400 })

    const expectedMessage = buildPmMessage("NoCryCasino PM Claim v1", {
      outcome_id,
      wallet_address,
      idempotency_key,
      ...(nonce.length > 0 ? { nonce } : {}),
      issued_at,
    })

    if (typeof body?.message === "string" && body.message.length > 0 && body.message !== expectedMessage) {
      return NextResponse.json({ error: "Message mismatch" }, { status: 400 })
    }

    const sigCheck = await requireSignedBody({
      request,
      expectedMessage,
      walletAddress: wallet_address,
      signatureB64: signature_base64,
    })

    if (!sigCheck.ok) return NextResponse.json({ error: sigCheck.error }, { status: sigCheck.status })

    const supabase = createServiceClient()

    if (nonce.length > 0) {
      const used = await consumePmNonce({
        supabase,
        walletAddress: wallet_address,
        nonce,
        action: "pm_claim",
        issuedAt: issued_at,
      })
      if (!used.ok) return NextResponse.json({ error: used.error }, { status: used.status })
    }

    const { data, error } = await supabase.rpc("pm_claim_settlement", {
      p_user_pubkey: wallet_address,
      p_outcome_id: outcome_id,
      p_idempotency_key: idempotency_key,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
