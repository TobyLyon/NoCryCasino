import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { withRpcFallback } from "@/lib/solana/rpc"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive, logEscrowOperation } from "@/lib/escrow/security"

export const runtime = "nodejs"

type Body = {
  tournament_id?: string
  dry_run?: boolean
  payout_nonce?: string
}

function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed)
    if (!Array.isArray(arr)) throw new Error("SECRET_KEY_JSON_INVALID")
    const bytes = Uint8Array.from(arr)
    if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
    return bytes
  }

  const bytes = Uint8Array.from(Buffer.from(trimmed, "base64"))
  if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
  return bytes
}

function getEscrowWalletConfigs(): Array<{ address: string; secret?: string }> {
  const rawList = process.env.ESCROW_WALLET_ADDRESSES
  const addresses = typeof rawList === "string" && rawList.trim().length > 0 ? rawList.split(",").map((s) => s.trim()) : []

  const a1 = process.env.ESCROW_WALLET_1_ADDRESS
  const a2 = process.env.ESCROW_WALLET_2_ADDRESS
  const a3 = process.env.ESCROW_WALLET_3_ADDRESS

  const list = addresses.length > 0 ? addresses : [a1, a2, a3].filter((v): v is string => typeof v === "string" && v.length > 0)

  const s1 = process.env.ESCROW_WALLET_1_SECRET_KEY
  const s2 = process.env.ESCROW_WALLET_2_SECRET_KEY
  const s3 = process.env.ESCROW_WALLET_3_SECRET_KEY

  const secrets: Array<string | undefined> = [s1, s2, s3]

  return list.slice(0, 3).map((address, idx) => ({ address, secret: secrets[idx] }))
}

async function getKeypairForEscrowAddress(address: string) {
  const { Keypair, PublicKey } = await import("@solana/web3.js")

  new PublicKey(address)

  const cfg = getEscrowWalletConfigs().find((c) => c.address === address)
  if (!cfg?.secret) throw new Error("ESCROW_SECRET_MISSING")

  let secret: Uint8Array
  try {
    secret = parseSecretKey(cfg.secret)
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    if (msg === "SECRET_KEY_LENGTH_INVALID") {
      throw new Error("ESCROW_SECRET_KEY_INVALID_LENGTH")
    }
    throw new Error("ESCROW_SECRET_KEY_INVALID_FORMAT")
  }

  return Keypair.fromSecretKey(secret)
}

async function sendSol(args: { fromKeypair: any; toAddress: string; lamports: number }): Promise<string> {
  const { PublicKey, SystemProgram, Transaction } = await import("@solana/web3.js")

  const toPubkey = new PublicKey(args.toAddress)

  return withRpcFallback(async (connection) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed")

    const tx = new Transaction({
      feePayer: args.fromKeypair.publicKey,
      recentBlockhash: blockhash,
    })

    tx.add(
      SystemProgram.transfer({
        fromPubkey: args.fromKeypair.publicKey,
        toPubkey,
        lamports: args.lamports,
      }),
    )

    tx.sign(args.fromKeypair)

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    })

    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed")

    return sig
  }, { maxRetries: 3, retryDelayMs: 1000 })
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:tournaments:payout", limit: 20, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const supabase = createServiceClient()
    const body = (await request.json().catch(() => ({}))) as Body

    const tournament_id = typeof body?.tournament_id === "string" ? body.tournament_id.trim() : ""
    if (!tournament_id) return NextResponse.json({ error: "Missing tournament_id" }, { status: 400 })

    const dry_run = body?.dry_run === true

    let t: any = null
    let tErr: any = null

    {
      const r = await supabase
        .from("tournaments")
        .select("id, status, prize_pool, escrow_wallet_address, winner_wallet_address, payout_signature, payout_state")
        .eq("id", tournament_id)
        .maybeSingle()
      t = r.data
      tErr = r.error
    }

    if (tErr) {
      const msg = typeof tErr?.message === "string" ? tErr.message.toLowerCase() : ""
      if (msg.includes("payout_state") && msg.includes("does not exist")) {
        const r = await supabase
          .from("tournaments")
          .select("id, status, prize_pool, escrow_wallet_address, winner_wallet_address, payout_signature")
          .eq("id", tournament_id)
          .maybeSingle()
        t = r.data
        tErr = r.error
      }
    }

    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
    if (!t) return NextResponse.json({ error: "Tournament not found" }, { status: 404 })

    const status = String((t as any).status ?? "")
    if (status !== "completed") return NextResponse.json({ error: "Tournament not completed" }, { status: 400 })

    const escrow = typeof (t as any).escrow_wallet_address === "string" ? (t as any).escrow_wallet_address.trim() : ""
    if (!escrow) return NextResponse.json({ error: "Tournament missing escrow_wallet_address" }, { status: 500 })

    const winner = typeof (t as any).winner_wallet_address === "string" ? (t as any).winner_wallet_address.trim() : ""
    if (!winner) return NextResponse.json({ error: "Tournament missing winner_wallet_address" }, { status: 500 })

    const alreadySig = typeof (t as any).payout_signature === "string" ? (t as any).payout_signature : null
    if (alreadySig) {
      return NextResponse.json({ ok: true, dry_run, tournament_id, already_paid: true, payout_signature: alreadySig })
    }

    const prize = Number((t as any).prize_pool ?? 0)
    if (!Number.isFinite(prize) || prize <= 0) return NextResponse.json({ error: "Invalid prize_pool" }, { status: 400 })

    if (dry_run) {
      return NextResponse.json({ ok: true, dry_run, tournament_id, to: winner, amount_sol: prize, escrow_wallet_address: escrow })
    }

    const payoutNonce =
      typeof body?.payout_nonce === "string" && body.payout_nonce.trim().length > 0
        ? body.payout_nonce.trim()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`

    const nowIso = new Date().toISOString()

    const { data: claimed, error: claimErr } = await supabase
      .from("tournaments")
      .update({
        payout_state: "processing",
        payout_nonce: payoutNonce,
        payout_processing_at: nowIso,
        payout_error: null,
        payout_amount: prize,
      })
      .eq("id", tournament_id)
      .is("payout_signature", null)
      .or("payout_state.is.null,payout_state.neq.processing")
      .select("id")
      .maybeSingle()

    if (claimErr) {
      const msg = typeof claimErr?.message === "string" ? claimErr.message.toLowerCase() : ""
      if (msg.includes("payout_") && msg.includes("does not exist")) {
        return NextResponse.json(
          { error: "Database missing tournament payout columns. Apply scripts/v2_130_tournaments.sql" },
          { status: 500 },
        )
      }
      return NextResponse.json({ error: claimErr.message }, { status: 500 })
    }
    if (!claimed) return NextResponse.json({ error: "Already processing/paid" }, { status: 409 })

    const keypair = await getKeypairForEscrowAddress(escrow)

    try {
      const lamports = Math.floor(prize * 1e9)
      if (lamports <= 0) throw new Error("Amount too low")

      const sig = await sendSol({ fromKeypair: keypair, toAddress: winner, lamports })

      await logEscrowOperation({
        operation: "payout",
        escrow_address: escrow,
        tournament_id,
        amount_sol: prize,
        signature: sig,
        from_wallet: keypair.publicKey.toBase58?.() ?? undefined,
        to_wallet: winner,
      })

      const { error: upErr } = await supabase
        .from("tournaments")
        .update({ payout_signature: sig, payout_at: new Date().toISOString(), payout_state: "paid", payout_error: null })
        .eq("id", tournament_id)
        .eq("payout_nonce", payoutNonce)

      if (upErr) {
        await supabase
          .from("tournaments")
          .update({ payout_state: "error", payout_error: upErr.message })
          .eq("id", tournament_id)
          .eq("payout_nonce", payoutNonce)
        return NextResponse.json({ error: upErr.message, payout_signature: sig }, { status: 500 })
      }

      const { data: u, error: uErr } = await supabase
        .from("users")
        .select("wallet_address, total_winnings, total_tournaments_won")
        .eq("wallet_address", winner)
        .maybeSingle()

      if (!uErr) {
        const total_winnings = Number((u as any)?.total_winnings ?? 0)
        const total_tournaments_won = Number((u as any)?.total_tournaments_won ?? 0)

        await supabase
          .from("users")
          .update({
            total_winnings: (Number.isFinite(total_winnings) ? total_winnings : 0) + prize,
            total_tournaments_won: (Number.isFinite(total_tournaments_won) ? total_tournaments_won : 0) + 1,
          })
          .eq("wallet_address", winner)
      }

      return NextResponse.json({ ok: true, tournament_id, payout_signature: sig, to: winner, amount_sol: prize })
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      await supabase
        .from("tournaments")
        .update({ payout_state: "error", payout_error: msg })
        .eq("id", tournament_id)
        .eq("payout_nonce", payoutNonce)

      return NextResponse.json({ error: msg }, { status: 500 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
