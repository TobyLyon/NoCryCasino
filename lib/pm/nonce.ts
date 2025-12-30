import type { SupabaseClient } from "@supabase/supabase-js"

export function isPmNonceRequired(): boolean {
  const v = process.env.PM_REQUIRE_NONCE
  if (typeof v !== "string") return false
  const s = v.trim().toLowerCase()
  return s === "1" || s === "true" || s === "yes"
}

export async function consumePmNonce(args: {
  supabase: SupabaseClient
  walletAddress: string
  nonce: string
  action: string
  issuedAt: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const issuedAtMs = Date.parse(args.issuedAt)
  if (!Number.isFinite(issuedAtMs)) return { ok: false, status: 400, error: "Invalid issued_at" }

  const { data, error } = await args.supabase.rpc("pm_use_nonce", {
    p_user_pubkey: args.walletAddress,
    p_nonce: args.nonce,
    p_action: args.action,
    p_issued_at: new Date(issuedAtMs).toISOString(),
  })

  if (error) return { ok: false, status: 500, error: error.message }

  if (!data?.ok) {
    const msg = typeof data?.error === "string" && data.error.length > 0 ? data.error : "NONCE_REUSED"
    return { ok: false, status: 409, error: msg }
  }

  return { ok: true }
}
