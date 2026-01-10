import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { buildPmMessage, requireFreshIssuedAt, requireSignedBody } from "@/lib/pm/signing"
import { consumePmNonce, isPmNonceRequired } from "@/lib/pm/nonce"

export const runtime = "nodejs"

type Body = {
  wallet_address: string
  question: string
  category?: string
  end_date: string
  nonce?: string
  issued_at: string
  signature_base64: string
  message?: string
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "pm:predictions:submit", limit: 30, windowMs: 60_000 })
  if (limited) return limited

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const wallet_address = String(body?.wallet_address ?? "").trim()
    const question = String(body?.question ?? "").trim()
    const category = String(body?.category ?? "crypto").trim().toLowerCase()
    const end_date = String(body?.end_date ?? "").trim()
    const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : ""
    const issued_at = String(body?.issued_at ?? "").trim()
    const signature_base64 = String(body?.signature_base64 ?? "").trim()

    if (!wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (!question || question.length < 10) return NextResponse.json({ error: "Question must be at least 10 characters" }, { status: 400 })
    if (question.length > 500) return NextResponse.json({ error: "Question must be under 500 characters" }, { status: 400 })
    if (!end_date) return NextResponse.json({ error: "Missing end_date" }, { status: 400 })
    if (!issued_at) return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
    if (!signature_base64) return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })

    const endDateMs = Date.parse(end_date)
    if (!Number.isFinite(endDateMs)) return NextResponse.json({ error: "Invalid end_date format" }, { status: 400 })
    
    const now = Date.now()
    const minEndDate = now + 60 * 60 * 1000 // At least 1 hour from now
    const maxEndDate = now + 90 * 24 * 60 * 60 * 1000 // Max 90 days from now
    
    if (endDateMs < minEndDate) return NextResponse.json({ error: "End date must be at least 1 hour from now" }, { status: 400 })
    if (endDateMs > maxEndDate) return NextResponse.json({ error: "End date cannot be more than 90 days from now" }, { status: 400 })

    const nonceRequired = isPmNonceRequired()
    if (nonceRequired && nonce.length === 0) return NextResponse.json({ error: "Missing nonce" }, { status: 400 })

    const freshness = requireFreshIssuedAt(issued_at, 5 * 60 * 1000)
    if (!freshness.ok) return NextResponse.json({ error: freshness.error }, { status: 400 })

    const expectedMessage = buildPmMessage("NoCryCasino PM Prediction v1", {
      wallet_address,
      question,
      category,
      end_date,
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
        action: "pm_prediction_submit",
        issuedAt: issued_at,
      })
      if (!used.ok) return NextResponse.json({ error: used.error }, { status: used.status })
    }

    // Ensure user exists
    const { error: userErr } = await supabase
      .from("users")
      .upsert({ wallet_address }, { onConflict: "wallet_address" })

    if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 })

    // Insert the user prediction
    const { data: prediction, error: predErr } = await supabase
      .from("user_predictions")
      .insert({
        creator_wallet: wallet_address,
        question,
        category,
        end_date: new Date(endDateMs).toISOString(),
        status: "pending",
      })
      .select("prediction_id, question, category, end_date, status, created_at")
      .single()

    if (predErr) {
      // If table doesn't exist, return a helpful error
      if (predErr.code === "42P01") {
        return NextResponse.json({ error: "User predictions table not yet created. Run the migration." }, { status: 500 })
      }
      return NextResponse.json({ error: predErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, prediction })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
