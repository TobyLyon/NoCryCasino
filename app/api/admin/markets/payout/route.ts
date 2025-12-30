import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { withRpcFallback } from "@/lib/solana/rpc"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { logEscrowOperation } from "@/lib/escrow/security"

type PayoutBody = {
  market_id: string
  dry_run?: boolean
  max_payouts?: number
  fee_bps?: number
}

type Market = {
  id: string
  status: "open" | "closed" | "settled" | "cancelled"
  escrow_wallet_address: string | null
  resolved_outcome: "yes" | "no" | null
  fee_bps: number | null
  fee_wallet_address: string | null
}

type Order = {
  id: string
  wallet_address: string
  outcome: "yes" | "no"
  side: "buy" | "sell"
  deposit_amount_sol: number | null
  deposit_signature: string | null
  payout_signature: string | null
  fee_amount_sol: number | null
  payout_state?: string | null
  payout_nonce?: string | null
}

type FeeConfig = {
  default_fee_bps: number
  fee_wallet_address: string | null
  min_payout_sol: number
}

const DEFAULT_FEE_CONFIG: FeeConfig = {
  default_fee_bps: 250, // 2.5%
  fee_wallet_address: null,
  min_payout_sol: 0.001,
}

let feeConfigCache: { config: FeeConfig; ts: number } | null = null

async function getFeeConfig(): Promise<FeeConfig> {
  const now = Date.now()
  if (feeConfigCache && now - feeConfigCache.ts < 60_000) {
    return feeConfigCache.config
  }

  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "fees")
      .maybeSingle()

    if (data?.value) {
      const config = { ...DEFAULT_FEE_CONFIG, ...data.value }
      feeConfigCache = { config, ts: now }
      return config
    }
  } catch {
    // Fall through to default
  }

  feeConfigCache = { config: DEFAULT_FEE_CONFIG, ts: now }
  return DEFAULT_FEE_CONFIG
}

export const runtime = "nodejs"

function parseSecretKey(raw: string): Uint8Array {
  const trimmed = raw.trim()
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed)
    if (!Array.isArray(arr)) throw new Error("SECRET_KEY_JSON_INVALID")
    const bytes = Uint8Array.from(arr)
    if (bytes.length !== 64) throw new Error("SECRET_KEY_LENGTH_INVALID")
    return bytes
  }

  // assume base64
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

  // If list is provided via ESCROW_WALLET_ADDRESSES, secrets are expected in the numbered vars.
  const secrets: Array<string | undefined> = [s1, s2, s3]

  return list.slice(0, 3).map((address, idx) => ({ address, secret: secrets[idx] }))
}

async function getKeypairForEscrowAddress(address: string) {
  const { Keypair, PublicKey } = await import("@solana/web3.js")

  // validate address
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

  // Use RPC fallback for resilience
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
  const limited = rateLimit({ request, key: "admin:markets:payout", limit: 60, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  const auth = requireBearerIfConfigured({ request, envVarName: "ADMIN_API_KEY" })
  if (auth) return auth

  const halted = await isEmergencyHaltActive()
  if (halted) return NextResponse.json({ error: "Emergency halt active" }, { status: 503 })

  try {
    const body = (await request.json().catch(() => ({}))) as PayoutBody
    if (!body?.market_id) return NextResponse.json({ error: "Missing market_id" }, { status: 400 })

    const dry_run = body?.dry_run === true
    const max_payouts = typeof body?.max_payouts === "number" && Number.isFinite(body.max_payouts) && body.max_payouts > 0 ? Math.floor(body.max_payouts) : 200

    const supabase = createServiceClient()

    const { data: market, error: marketError } = await supabase
      .from("wager_markets")
      .select("id, status, escrow_wallet_address, resolved_outcome, fee_bps, fee_wallet_address")
      .eq("id", body.market_id)
      .maybeSingle()

    if (marketError) return NextResponse.json({ error: marketError.message }, { status: 500 })
    if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 })

    const m = market as Market

    if (m.status !== "settled") return NextResponse.json({ error: "Market not settled" }, { status: 400 })
    if (!m.escrow_wallet_address) return NextResponse.json({ error: "Market missing escrow_wallet_address" }, { status: 500 })
    if (m.resolved_outcome !== "yes" && m.resolved_outcome !== "no") {
      return NextResponse.json({ error: "Market missing resolved_outcome" }, { status: 500 })
    }

    const { data: orders, error: ordersError } = await supabase
      .from("wager_orders")
      .select("id, wallet_address, outcome, side, deposit_amount_sol, deposit_signature, payout_signature, payout_state, payout_nonce")
      .eq("market_id", m.id)
      .eq("side", "buy")
      .not("deposit_signature", "is", null)
      .not("deposit_amount_sol", "is", null)
      .order("created_at", { ascending: true })
      .limit(5000)

    if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 })

    const allOrders = (orders ?? []) as unknown as Order[]
    const eligible = allOrders.filter((o) => !o.payout_signature && o.payout_state !== "processing")

    const grossPot = allOrders.reduce((sum, o) => sum + Number(o.deposit_amount_sol ?? 0), 0)
    const winners = allOrders.filter((o) => o.outcome === m.resolved_outcome)
    const winnerTotal = winners.reduce((sum, o) => sum + Number(o.deposit_amount_sol ?? 0), 0)

    if (grossPot <= 0) return NextResponse.json({ error: "No deposits found" }, { status: 400 })
    if (winnerTotal <= 0) return NextResponse.json({ error: "No winning deposits" }, { status: 400 })

    // Calculate fee
    const feeConfig = await getFeeConfig()
    const fee_bps = body?.fee_bps ?? m.fee_bps ?? feeConfig.default_fee_bps
    const feeRatio = fee_bps / 10000
    const totalFee = grossPot * feeRatio
    const pot = grossPot - totalFee
    const fee_wallet = m.fee_wallet_address ?? feeConfig.fee_wallet_address
    const min_payout = feeConfig.min_payout_sol

    const toPay = eligible
      .filter((o) => o.outcome === m.resolved_outcome)
      .slice(0, max_payouts)
      .map((o) => {
        const dep = Number(o.deposit_amount_sol ?? 0)
        const grossPayout = (dep / winnerTotal) * pot
        const fee = grossPayout * feeRatio
        const payout = grossPayout - fee
        return { ...o, payout_amount_sol: payout, fee_amount_sol: fee }
      })

    if (toPay.length === 0) {
      return NextResponse.json({ ok: true, dry_run, gross_pot: grossPot, pot, fee_bps, total_fee: totalFee, winner_total: winnerTotal, payouts: 0 })
    }

    if (dry_run) {
      return NextResponse.json({
        ok: true,
        dry_run,
        escrow_wallet_address: m.escrow_wallet_address,
        gross_pot: grossPot,
        pot,
        fee_bps,
        total_fee: totalFee,
        fee_wallet,
        winner_total: winnerTotal,
        payout_count: toPay.length,
        sample: toPay.slice(0, 5).map((p) => ({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, fee_sol: p.fee_amount_sol })),
      })
    }

    const keypair = await getKeypairForEscrowAddress(m.escrow_wallet_address)

    const results: Array<{ order_id: string; to: string; amount_sol: number; fee_sol?: number; signature?: string; error?: string }> = []

    let feeCollected = 0
    let feeTxSignature: string | null = null

    for (const p of toPay) {
      try {
        const payoutNonce = `${Date.now()}-${p.id}-${Math.random().toString(16).slice(2)}`

        const lamports = Math.floor(p.payout_amount_sol * 1e9)
        if (p.payout_amount_sol < min_payout) {
          results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, error: `Below min payout (${min_payout} SOL)` })
          continue
        }
        if (lamports <= 0) {
          results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, error: "Amount too low" })
          continue
        }

        // Atomically claim this order for payout to prevent double-send on retries.
        const { data: claimed, error: claimErr } = await supabase
          .from("wager_orders")
          .update({
            payout_state: "processing",
            payout_nonce: payoutNonce,
            payout_processing_at: new Date().toISOString(),
            payout_error: null,
          })
          .eq("id", p.id)
          .is("payout_signature", null)
          .or("payout_state.is.null,payout_state.neq.processing")
          .select("id")
          .maybeSingle()

        if (claimErr) {
          results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, error: claimErr.message })
          continue
        }

        if (!claimed) {
          results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, error: "Already processing/paid" })
          continue
        }

        const signature = await sendSol({ fromKeypair: keypair, toAddress: p.wallet_address, lamports })

        await logEscrowOperation({
          operation: "payout",
          escrow_address: m.escrow_wallet_address,
          market_id: m.id,
          order_id: p.id,
          amount_sol: p.payout_amount_sol,
          signature,
          to_wallet: p.wallet_address,
        })

        const { error: upErr } = await supabase
          .from("wager_orders")
          .update({
            payout_signature: signature,
            payout_amount_sol: p.payout_amount_sol,
            fee_amount_sol: p.fee_amount_sol,
            payout_sent_at: new Date().toISOString(),
            status: "filled",
            payout_state: "paid",
            payout_error: null,
          })
          .eq("id", p.id)
          .eq("payout_nonce", payoutNonce)

        if (upErr) {
          // NOTE: funds may have been sent but DB update failed. Leave row in processing state for reconciliation.
          await supabase
            .from("wager_orders")
            .update({ payout_error: upErr.message })
            .eq("id", p.id)
            .eq("payout_nonce", payoutNonce)
          results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, signature, error: upErr.message })
          continue
        }

        feeCollected += p.fee_amount_sol
        results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, fee_sol: p.fee_amount_sol, signature })
      } catch (e: any) {
        results.push({ order_id: p.id, to: p.wallet_address, amount_sol: p.payout_amount_sol, error: e?.message ?? String(e) })
      }
    }

    // Send collected fees to fee wallet if configured
    if (feeCollected > 0 && fee_wallet) {
      try {
        const feeLamports = Math.floor(feeCollected * 1e9)
        if (feeLamports > 0) {
          feeTxSignature = await sendSol({ fromKeypair: keypair, toAddress: fee_wallet, lamports: feeLamports })

          // Update market with fee collected
          await supabase
            .from("wager_markets")
            .update({ fee_collected_sol: feeCollected })
            .eq("id", m.id)
        }
      } catch (e: any) {
        // Log but don't fail the whole payout
        console.error("Fee transfer failed:", e?.message ?? String(e))
      }
    }

    return NextResponse.json({
      ok: true,
      dry_run,
      escrow_wallet_address: m.escrow_wallet_address,
      gross_pot: grossPot,
      pot,
      fee_bps,
      total_fee: totalFee,
      fee_collected: feeCollected,
      fee_wallet,
      fee_tx_signature: feeTxSignature,
      winner_total: winnerTotal,
      payout_count: results.length,
      results,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
