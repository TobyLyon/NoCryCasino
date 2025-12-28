import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit } from "@/lib/api/guards"

export const runtime = "nodejs"

type Outcome = "yes" | "no"
type Side = "buy" | "sell"

type PlaceOrderBody = {
  wallet_address: string
  outcome: Outcome
  side: Side
  price: number
  quantity: number
  client_order_id: string
  issued_at: string
  message?: string
  signature_base64: string
  deposit_signature: string
  deposit_amount_sol: number
}

function nowIso() {
  return new Date().toISOString()
}

function decodeBase64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"))
}

function buildOrderMessage(input: {
  market_id: string
  wallet_address: string
  outcome: Outcome
  side: Side
  price: number
  quantity: number
  client_order_id: string
  issued_at: string
}): string {
  return [
    "NoCryCasino Wager Order v1",
    `market_id=${input.market_id}`,
    `wallet_address=${input.wallet_address}`,
    `outcome=${input.outcome}`,
    `side=${input.side}`,
    `price=${input.price}`,
    `quantity=${input.quantity}`,
    `client_order_id=${input.client_order_id}`,
    `issued_at=${input.issued_at}`,
  ].join("\n")
}

async function verifyEd25519Signature(message: string, signatureB64: string, walletAddress: string): Promise<boolean> {
  const { PublicKey } = await import("@solana/web3.js")
  const naclMod: any = await import("tweetnacl")
  const nacl = naclMod?.default ?? naclMod

  const pk = new PublicKey(walletAddress)
  const sig = decodeBase64(signatureB64)
  const msg = new TextEncoder().encode(message)

  return nacl.sign.detached.verify(msg, sig, pk.toBytes())
}

async function verifyEscrowDeposit(args: {
  signature: string
  from_wallet: string
  escrow_wallet: string
  min_lamports: number
}): Promise<{ ok: boolean; lamports?: number; blockTime?: number | null; error?: string }> {
  const { PublicKey, SystemProgram } = await import("@solana/web3.js")
  const { withRpcFallback } = await import("@/lib/solana/rpc")

  try {
    const result = await withRpcFallback(async (connection) => {
      const tx = await connection.getParsedTransaction(args.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      })

      if (!tx) return { ok: false as const, error: "Deposit transaction not found" }
      if (tx.meta?.err) return { ok: false as const, error: "Deposit transaction failed" }

      const from = args.from_wallet
      const to = args.escrow_wallet

      const instructions: any[] = Array.isArray(tx.transaction.message.instructions)
        ? (tx.transaction.message.instructions as any[])
        : []

      let matchedLamports = 0

      for (const ix of instructions) {
        if (ix?.programId?.toBase58?.() !== SystemProgram.programId.toBase58()) continue

        const parsed = ix?.parsed
        if (parsed?.type !== "transfer") continue
        const info = parsed?.info
        const src = info?.source
        const dst = info?.destination
        const lamports = Number(info?.lamports)

        if (src === from && dst === to && Number.isFinite(lamports) && lamports > 0) {
          matchedLamports += lamports
        }
      }

      if (matchedLamports < args.min_lamports) {
        return { ok: false as const, error: "Deposit amount too low" }
      }

      // basic sanity that addresses are valid
      try {
        new PublicKey(from)
        new PublicKey(to)
      } catch {
        return { ok: false as const, error: "Invalid wallet address" }
      }

      return { ok: true as const, lamports: matchedLamports, blockTime: tx.blockTime }
    }, { maxRetries: 3, retryDelayMs: 1000 })

    return result
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "RPC verification failed" }
  }
}

export async function GET(request: NextRequest, context: { params: Promise<{ marketId: string }> }) {
  try {
    const { marketId } = await context.params
    if (!marketId) return NextResponse.json({ error: "Missing marketId" }, { status: 400 })

    const url = new URL(request.url)
    const wallet = url.searchParams.get("wallet")

    const supabase = createServiceClient()

    let q = supabase
      .from("wager_orders")
      .select("id, market_id, wallet_address, outcome, side, price, quantity, filled_quantity, status, client_order_id, created_at")
      .eq("market_id", marketId)
      .order("created_at", { ascending: false })
      .limit(200)

    if (wallet) q = q.eq("wallet_address", wallet)

    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true, orders: data ?? [] })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ marketId: string }> }) {
  const limited = rateLimit({ request, key: "markets:orders", limit: 120, windowMs: 60_000 })
  if (limited) return limited

  const tooLarge = enforceMaxBodyBytes(request, 50_000)
  if (tooLarge) return tooLarge

  try {
    const { marketId } = await context.params
    if (!marketId) return NextResponse.json({ error: "Missing marketId" }, { status: 400 })

    const body = (await request.json()) as PlaceOrderBody

    if (!body?.wallet_address) return NextResponse.json({ error: "Missing wallet_address" }, { status: 400 })
    if (body?.outcome !== "yes" && body?.outcome !== "no") return NextResponse.json({ error: "Invalid outcome" }, { status: 400 })
    if (body?.side !== "buy" && body?.side !== "sell") return NextResponse.json({ error: "Invalid side" }, { status: 400 })

    // Escrow MVP: only BUY orders are supported (SELL requires an orderbook / matching)
    if (body.side !== "buy") return NextResponse.json({ error: "Sell not supported yet" }, { status: 400 })

    const price = Number(body?.price)
    const quantity = Number(body?.quantity)

    if (!Number.isFinite(price) || price < 0 || price > 1) {
      return NextResponse.json({ error: "Invalid price" }, { status: 400 })
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Invalid quantity" }, { status: 400 })
    }

    if (typeof body?.client_order_id !== "string" || body.client_order_id.length < 8) {
      return NextResponse.json({ error: "Missing client_order_id" }, { status: 400 })
    }

    if (typeof body?.issued_at !== "string" || body.issued_at.length === 0) {
      return NextResponse.json({ error: "Missing issued_at" }, { status: 400 })
    }

    const issuedAtMs = Date.parse(body.issued_at)
    if (!Number.isFinite(issuedAtMs)) {
      return NextResponse.json({ error: "Invalid issued_at" }, { status: 400 })
    }

    // 5 minute window to reduce replay risk
    if (Math.abs(Date.now() - issuedAtMs) > 5 * 60 * 1000) {
      return NextResponse.json({ error: "Signature expired" }, { status: 400 })
    }

    if (typeof body?.signature_base64 !== "string" || body.signature_base64.length === 0) {
      return NextResponse.json({ error: "Missing signature_base64" }, { status: 400 })
    }

    const depositAmountSol = Number(body?.deposit_amount_sol)
    if (!Number.isFinite(depositAmountSol) || depositAmountSol <= 0) {
      return NextResponse.json({ error: "Invalid deposit_amount_sol" }, { status: 400 })
    }

    if (typeof body?.deposit_signature !== "string" || body.deposit_signature.length < 20) {
      return NextResponse.json({ error: "Missing deposit_signature" }, { status: 400 })
    }

    const expectedMessage = buildOrderMessage({
      market_id: marketId,
      wallet_address: body.wallet_address,
      outcome: body.outcome,
      side: body.side,
      price,
      quantity,
      client_order_id: body.client_order_id,
      issued_at: body.issued_at,
    })

    if (typeof body?.message === "string" && body.message.length > 0 && body.message !== expectedMessage) {
      return NextResponse.json({ error: "Message mismatch" }, { status: 400 })
    }

    const verified = await verifyEd25519Signature(expectedMessage, body.signature_base64, body.wallet_address)
    if (!verified) return NextResponse.json({ error: "Invalid signature" }, { status: 401 })

    const supabase = createServiceClient()

    const { error: userError } = await supabase
      .from("users")
      .upsert({ wallet_address: body.wallet_address }, { onConflict: "wallet_address" })

    if (userError) return NextResponse.json({ error: userError.message }, { status: 500 })

    const { data: market, error: marketError } = await supabase
      .from("wager_markets")
      .select("id, status, closes_at, escrow_wallet_address")
      .eq("id", marketId)
      .maybeSingle()

    if (marketError) return NextResponse.json({ error: marketError.message }, { status: 500 })
    if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 })

    if (!market.escrow_wallet_address) {
      return NextResponse.json({ error: "Market missing escrow wallet" }, { status: 500 })
    }

    if (market.status !== "open") {
      return NextResponse.json({ error: "Market not open" }, { status: 400 })
    }

    if (new Date(market.closes_at).getTime() <= Date.now()) {
      return NextResponse.json({ error: "Market closed" }, { status: 400 })
    }

    const minLamports = Math.floor(depositAmountSol * 1e9)
    const dep = await verifyEscrowDeposit({
      signature: body.deposit_signature,
      from_wallet: body.wallet_address,
      escrow_wallet: market.escrow_wallet_address,
      min_lamports: minLamports,
    })

    if (!dep.ok) return NextResponse.json({ error: dep.error ?? "Deposit verification failed" }, { status: 400 })

    const { data: inserted, error: insertError } = await supabase
      .from("wager_orders")
      .insert({
        market_id: marketId,
        wallet_address: body.wallet_address,
        outcome: body.outcome,
        side: body.side,
        price,
        quantity,
        client_order_id: body.client_order_id,
        deposit_signature: body.deposit_signature,
        deposit_amount_sol: dep.lamports ? dep.lamports / 1e9 : depositAmountSol,
        deposit_confirmed_at: new Date().toISOString(),
        created_at: nowIso(),
      })
      .select(
        "id, market_id, wallet_address, outcome, side, price, quantity, filled_quantity, status, client_order_id, created_at",
      )
      .single()

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

    return NextResponse.json({ ok: true, order: inserted })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 })
  }
}
