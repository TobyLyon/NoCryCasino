import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { buildPmMessage, requireFreshIssuedAt, requireSignedBody } from "@/lib/pm/signing"

export const runtime = "nodejs"

type Body = {
  order_id: string
  wallet_address: string
  idempotency_key: string
  issued_at: string
  signature_base64: string
  message?: string
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "pm:orders:cancel", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  const tooLarge = enforceMaxBodyBytes(request, 25_000)
  if (tooLarge) return tooLarge

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const order_id = String(body?.order_id ?? "").trim()
    const wallet_address = String(body?.wallet_address ?? "").trim()
    const idempotency_key = String(body?.idempotency_key ?? "").trim()
    const issued_at = String(body?.issued_at ?? "").trim()
    const signature_base64 = String(body?.signature_base64 ?? "").trim()

    if (!order_id) return NextResponse.json({ error: "Missing order_id" }, { status: 400 })
    if (!wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (!idempotency_key || idempotency_key.length < 8) return NextResponse.json({ error: "Missing idempotency_key" }, { status: 400 })
    if (!issued_at) return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
    if (!signature_base64) return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })

    const freshness = requireFreshIssuedAt(issued_at, 5 * 60 * 1000)
    if (!freshness.ok) return NextResponse.json({ error: freshness.error }, { status: 400 })

    const expectedMessage = buildPmMessage("NoCryCasino PM Cancel v1", {
      order_id,
      wallet_address,
      idempotency_key,
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
    const { data, error } = await supabase.rpc("pm_cancel_order", {
      p_order_id: order_id,
      p_user_pubkey: wallet_address,
      p_idempotency_key: idempotency_key,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
