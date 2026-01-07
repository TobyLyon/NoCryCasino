import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { withRpcFallback } from "@/lib/solana/rpc"
import { logEscrowOperation } from "@/lib/escrow/security"

export const runtime = "nodejs"

type Body = {
  withdrawal_id: string
  vault_index?: number
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

function getPmCustodyEscrowAddress(): string {
  const explicit = process.env.PM_ESCROW_WALLET_ADDRESS
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim()
  const a1 = process.env.ESCROW_WALLET_1_ADDRESS
  if (typeof a1 === "string" && a1.trim().length > 0) return a1.trim()
  const list = process.env.ESCROW_WALLET_ADDRESSES
  if (typeof list === "string" && list.trim().length > 0) {
    const first = list
      .split(",")
      .map((s) => s.trim())
      .find((s) => s.length > 0)
    if (first) return first
  }
  return ""
}

function getEscrowWalletConfigs(): Array<{ address: string; secret?: string }> {
  const rawList = process.env.ESCROW_WALLET_ADDRESSES
  const addresses =
    typeof rawList === "string" && rawList.trim().length > 0
      ? rawList.split(",").map((s) => s.trim())
      : []

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

async function pickKeypairForWithdrawalLamports(lamports: number): Promise<{ address: string; keypair: any }> {
  const { Keypair, PublicKey } = await import("@solana/web3.js")

  const requested = getPmCustodyEscrowAddress()
  const all = getEscrowWalletConfigs()
    .filter((c) => typeof c.address === "string" && c.address.trim().length > 0)
    .filter((c) => typeof c.secret === "string" && c.secret.trim().length > 0)

  const candidates = requested ? all.filter((c) => c.address === requested) : all
  if (candidates.length === 0) {
    throw new Error(requested ? "PM_ESCROW_SECRET_MISSING" : "ESCROW_SECRET_MISSING")
  }

  const parsed = candidates.map((c) => {
    new PublicKey(c.address)
    let secret: Uint8Array
    try {
      secret = parseSecretKey(String(c.secret))
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (msg === "SECRET_KEY_LENGTH_INVALID") throw new Error("ESCROW_SECRET_KEY_INVALID_LENGTH")
      throw new Error("ESCROW_SECRET_KEY_INVALID_FORMAT")
    }
    return { address: c.address, keypair: Keypair.fromSecretKey(secret) }
  })

  const feeBufferLamports = 50_000
  const needed = Math.max(0, Math.floor(lamports)) + feeBufferLamports

  return withRpcFallback(async (connection) => {
    for (const p of parsed) {
      const bal = await connection.getBalance(new PublicKey(p.address), "confirmed")
      if (typeof bal === "number" && Number.isFinite(bal) && bal >= needed) {
        return p
      }
    }
    // Fallback: return the first keypair even if low; upstream will likely fail with insufficient funds.
    return parsed[0]!
  }, { maxRetries: 2, retryDelayMs: 500 })
}

async function sendSol(args: { fromKeypair: any; toAddress: string; lamports: number }): Promise<string> {
  const { PublicKey, SystemProgram, Transaction } = await import("@solana/web3.js")
  const toPubkey = new PublicKey(args.toAddress)

  return withRpcFallback(async (connection) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed")
    const tx = new Transaction({ feePayer: args.fromKeypair.publicKey, recentBlockhash: blockhash })
    tx.add(
      SystemProgram.transfer({
        fromPubkey: args.fromKeypair.publicKey,
        toPubkey,
        lamports: args.lamports,
      }),
    )

    tx.sign(args.fromKeypair)
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 })
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed")
    return sig
  }, { maxRetries: 3, retryDelayMs: 1000 })
}

export async function POST(request: NextRequest) {
  const limited = rateLimit({ request, key: "admin:pm:withdrawals:send", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  const custody = typeof process.env.CUSTODY_MODE === "string" ? process.env.CUSTODY_MODE.trim().toLowerCase() : "single"

  try {
    const body = (await request.json().catch(() => ({}))) as Body
    const withdrawal_id = String(body?.withdrawal_id ?? "").trim()
    if (!withdrawal_id) return NextResponse.json({ error: "Missing withdrawal_id" }, { status: 400 })

    const processing_nonce = `${Date.now()}-${withdrawal_id}-${Math.random().toString(16).slice(2)}`

    const supabase = createServiceClient()
    const { data: begin, error: beginErr } = await supabase.rpc("pm_begin_withdrawal_send", {
      p_withdrawal_id: withdrawal_id,
      p_processing_nonce: processing_nonce,
    })

    if (beginErr) return NextResponse.json({ error: beginErr.message }, { status: 500 })
    if (!begin?.ok) return NextResponse.json({ error: "Failed to begin withdrawal" }, { status: 500 })

    const status = String(begin?.status ?? "")
    if (status !== "SENDING") {
      return NextResponse.json({ ok: true, status, note: "Not in REQUESTED state" })
    }

    const toAddress = String(begin?.destination_pubkey ?? "")
    const amount = Number(begin?.amount)

    if (!toAddress) return NextResponse.json({ error: "Missing destination_pubkey" }, { status: 500 })
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 500 })

    try {
      const lamports = Math.floor(amount * 1e9)

      if (custody === "squads") {
        const { createSquadsSolTransferProposal } = await import("@/lib/solana/squads")

        const vaultIndex =
          typeof body?.vault_index === "number" && Number.isFinite(body.vault_index) && body.vault_index >= 0
            ? Math.floor(body.vault_index)
            : typeof process.env.SQUADS_VAULT_INDEX === "string" && process.env.SQUADS_VAULT_INDEX.trim().length > 0
              ? Math.max(0, Math.floor(Number(process.env.SQUADS_VAULT_INDEX)))
              : 0

        const proposal = await withRpcFallback(async (connection) => {
          return createSquadsSolTransferProposal({
            connection,
            toAddress,
            lamports,
            vaultIndex,
            memo: `nocrycasino withdrawal ${withdrawal_id}`,
          })
        }, { maxRetries: 3, retryDelayMs: 1000 })

        const { error: markErr } = await supabase.rpc("pm_mark_withdrawal_proposed", {
          p_withdrawal_id: withdrawal_id,
          p_processing_nonce: processing_nonce,
          p_custody_mode: "squads",
          p_squads_multisig_pda: proposal.multisigPda,
          p_squads_vault_index: proposal.vaultIndex,
          p_squads_transaction_index: proposal.transactionIndex,
          p_squads_proposal_pda: proposal.proposalPda,
          p_squads_create_sig: proposal.createSig,
          p_squads_proposal_create_sig: proposal.proposalCreateSig,
          p_custody_ref: proposal,
        })

        if (markErr) {
          return NextResponse.json({ ok: false, error: markErr.message, proposal }, { status: 500 })
        }

        return NextResponse.json({ ok: true, withdrawal_id, status: "PROPOSED", custody_mode: "squads", proposal })
      }

      const { address: escrowAddress, keypair } = await pickKeypairForWithdrawalLamports(lamports)
      const sig = await sendSol({ fromKeypair: keypair, toAddress, lamports })

      await logEscrowOperation({
        operation: "payout",
        escrow_address: escrowAddress,
        amount_sol: amount,
        signature: sig,
        from_wallet: keypair.publicKey?.toBase58?.() ?? undefined,
        to_wallet: toAddress,
      })

      const { error: markErr } = await supabase.rpc("pm_mark_withdrawal_sent", {
        p_withdrawal_id: withdrawal_id,
        p_processing_nonce: processing_nonce,
        p_tx_sig: sig,
      })

      if (markErr) {
        return NextResponse.json({ ok: false, error: markErr.message, tx_sig: sig }, { status: 500 })
      }

      return NextResponse.json({ ok: true, withdrawal_id, status: "SENT", custody_mode: "single", tx_sig: sig })
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      await supabase.rpc("pm_fail_withdrawal", {
        p_withdrawal_id: withdrawal_id,
        p_processing_nonce: processing_nonce,
        p_error: msg,
      })
      return NextResponse.json({ ok: false, error: msg }, { status: 500 })
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
