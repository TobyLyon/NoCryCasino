import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { withRpcFallback } from "@/lib/solana/rpc"
import { buildPmMessage, requireFreshIssuedAt, requireSignedBody } from "@/lib/pm/signing"
import { consumePmNonce, isPmNonceRequired } from "@/lib/pm/nonce"

export const runtime = "nodejs"

type Body = {
  wallet_address: string
  tx_sig: string
  min_amount_sol?: number
  mint?: string
  round_scope?: string | null
  nonce?: string
  issued_at?: string
  signature_base64?: string
  message?: string
}

function isAdminRequest(request: NextRequest): boolean {
  const key = typeof process.env.ADMIN_API_KEY === "string" ? process.env.ADMIN_API_KEY.trim() : ""
  if (!key) return false
  const auth = request.headers.get("authorization")
  if (!auth) return false
  return auth === `Bearer ${key}`
}

function getAllowedEscrowWallets(): string[] {
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

async function verifySolDeposit(args: { txSig: string; fromWallet: string; allowedEscrows: string[]; minLamports: number }) {
  const { SystemProgram } = await import("@solana/web3.js")

  return withRpcFallback(async (connection) => {
    const tx = await connection.getParsedTransaction(args.txSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
    if (!tx) return { ok: false as const, error: "Deposit transaction not found" }
    if (tx.meta?.err) return { ok: false as const, error: "Deposit transaction failed" }

    const instructions: any[] = Array.isArray(tx.transaction.message.instructions) ? (tx.transaction.message.instructions as any[]) : []

    let matchedLamports = 0
    for (const ix of instructions) {
      if (ix?.programId?.toBase58?.() !== SystemProgram.programId.toBase58()) continue
      const parsed = ix?.parsed
      if (parsed?.type !== "transfer") continue
      const info = parsed?.info
      const src = info?.source
      const dst = info?.destination
      const lamports = Number(info?.lamports)
      if (src === args.fromWallet && args.allowedEscrows.includes(dst) && Number.isFinite(lamports) && lamports > 0) {
        matchedLamports += lamports
      }
    }

    if (matchedLamports < args.minLamports) return { ok: false as const, error: "Deposit amount too low" }

    return { ok: true as const, lamports: matchedLamports }
  })
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "pm:deposits:credit", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as Body

    const wallet_address = String(body?.wallet_address ?? "").trim()
    const tx_sig = String(body?.tx_sig ?? "").trim()

    const isAdmin = isAdminRequest(request)

    const nonce = typeof body?.nonce === "string" ? body.nonce.trim() : ""
    const issued_at = typeof body?.issued_at === "string" ? body.issued_at.trim() : ""
    const signature_base64 = typeof body?.signature_base64 === "string" ? body.signature_base64.trim() : ""

    if (!wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (!tx_sig || tx_sig.length < 20) return NextResponse.json({ error: "Missing tx_sig" }, { status: 400 })

    const round_scope = typeof body?.round_scope === "string" && body.round_scope.trim().length > 0 ? body.round_scope.trim() : null

    const minAmountSol =
      typeof body?.min_amount_sol === "number" && Number.isFinite(body.min_amount_sol) && body.min_amount_sol > 0
        ? body.min_amount_sol
        : 0

    if (!isAdmin) {
      if (!round_scope) return NextResponse.json({ error: "Missing round_scope" }, { status: 400 })
      if (!issued_at) return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
      if (!signature_base64) return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })
      if (!Number.isFinite(minAmountSol) || minAmountSol <= 0) {
        return NextResponse.json({ error: "Invalid min_amount_sol" }, { status: 400 })
      }

      const nonceRequired = isPmNonceRequired()
      if (nonceRequired && nonce.length === 0) return NextResponse.json({ error: "Missing nonce" }, { status: 400 })
      if (nonce.length > 0 && nonce.length < 8) return NextResponse.json({ error: "Invalid nonce" }, { status: 400 })

      const freshness = requireFreshIssuedAt(issued_at, 5 * 60 * 1000)
      if (!freshness.ok) return NextResponse.json({ error: freshness.error }, { status: 400 })

      const expectedMessage = buildPmMessage("NoCryCasino PM Deposit Credit v1", {
        wallet_address,
        tx_sig,
        min_amount_sol: String(minAmountSol),
        mint: typeof body?.mint === "string" && body.mint.length > 0 ? body.mint : "SOL",
        round_scope: round_scope ?? "",
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
    }

    let allowedEscrows = getAllowedEscrowWallets()
    if (allowedEscrows.length === 0) return NextResponse.json({ error: "Missing ESCROW_WALLET_ADDRESSES" }, { status: 500 })

    const supabase = createServiceClient()

    if (!isAdmin && nonce.length > 0) {
      const used = await consumePmNonce({
        supabase,
        walletAddress: wallet_address,
        nonce,
        action: "pm_deposit_credit",
        issuedAt: issued_at,
      })
      if (!used.ok) return NextResponse.json({ error: used.error }, { status: used.status })
    }

    if (round_scope) {
      const { data: round, error: roundErr } = await supabase
        .from("market_rounds")
        .select("round_id, escrow_wallet_pubkey")
        .eq("round_id", round_scope)
        .maybeSingle()

      if (roundErr) return NextResponse.json({ error: roundErr.message }, { status: 500 })

      const escrow_wallet_pubkey = typeof (round as any)?.escrow_wallet_pubkey === "string" ? String((round as any).escrow_wallet_pubkey).trim() : ""
      if (!escrow_wallet_pubkey) return NextResponse.json({ error: "Round missing escrow_wallet_pubkey" }, { status: 500 })

      allowedEscrows = [escrow_wallet_pubkey]
    }
    const minLamports = Math.floor(minAmountSol * 1e9)

    const verified = await verifySolDeposit({ txSig: tx_sig, fromWallet: wallet_address, allowedEscrows, minLamports })
    if (!verified.ok) return NextResponse.json({ error: verified.error }, { status: 400 })

    const amountSol = verified.lamports / 1e9
    const mint = typeof body?.mint === "string" && body.mint.length > 0 ? body.mint : "SOL"

    const { data, error } = await supabase.rpc("pm_credit_deposit", {
      p_user_pubkey: wallet_address,
      p_amount: amountSol,
      p_mint: mint,
      p_tx_sig: tx_sig,
      p_round_scope: round_scope,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ...data, credited_amount_sol: amountSol })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
