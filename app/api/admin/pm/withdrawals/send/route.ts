import { NextResponse, type NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { enforceMaxBodyBytes, rateLimit, requireBearerIfConfigured } from "@/lib/api/guards"
import { isEmergencyHaltActive } from "@/lib/escrow/security"
import { withRpcFallback } from "@/lib/solana/rpc"
import { createSquadsSolTransferProposal } from "@/lib/solana/squads"

export const runtime = "nodejs"

type Body = {
  withdrawal_id: string
  vault_index?: number
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

  const custody = typeof process.env.CUSTODY_MODE === "string" ? process.env.CUSTODY_MODE.trim().toLowerCase() : ""
  if (custody !== "squads") {
    return NextResponse.json(
      { error: "CUSTODY_MODE must be 'squads' for this endpoint" },
      { status: 500 },
    )
  }

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
