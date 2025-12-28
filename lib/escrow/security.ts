/**
 * Escrow Security Utilities
 * Addresses audit item 8.6: Escrow security documentation and validation
 * 
 * SECURITY RECOMMENDATIONS:
 * 
 * 1. Multi-Signature Wallets (Recommended for Production)
 *    - Use Squads Protocol (https://squads.so) for multi-sig escrow
 *    - Require 2-of-3 or 3-of-5 signatures for payouts
 *    - Store individual signer keys separately
 * 
 * 2. Hardware Security Modules (HSM)
 *    - Use AWS CloudHSM or Azure Key Vault for key storage
 *    - Never store raw private keys in environment variables in production
 * 
 * 3. Key Rotation
 *    - Rotate escrow wallets periodically
 *    - Use deterministic wallet assignment per round (already implemented)
 *    - Archive old wallets after all payouts complete
 * 
 * 4. Access Control
 *    - Separate admin keys for different operations
 *    - Implement role-based access (settle vs payout)
 *    - Log all admin actions with timestamps
 * 
 * 5. Emergency Controls
 *    - Implement emergency halt switch
 *    - Have recovery procedures documented
 *    - Monitor escrow balances for anomalies
 */

import { createServiceClient } from "@/lib/supabase/service"

export type EscrowWalletStatus = {
  address: string
  has_secret: boolean
  is_valid: boolean
  validation_error?: string
}

export type EscrowSecurityAudit = {
  timestamp: string
  wallets: EscrowWalletStatus[]
  warnings: string[]
  is_production_ready: boolean
}

/**
 * Validate that an escrow secret key is properly formatted
 */
export function validateSecretKeyFormat(raw: string): { valid: boolean; error?: string } {
  if (!raw || raw.trim().length === 0) {
    return { valid: false, error: "Empty secret key" }
  }

  const trimmed = raw.trim()

  try {
    let bytes: Uint8Array

    if (trimmed.startsWith("[")) {
      // JSON array format
      const arr = JSON.parse(trimmed)
      if (!Array.isArray(arr)) {
        return { valid: false, error: "Invalid JSON array format" }
      }
      bytes = Uint8Array.from(arr)
    } else {
      // Base64 format
      bytes = Uint8Array.from(Buffer.from(trimmed, "base64"))
    }

    if (bytes.length !== 64) {
      return { valid: false, error: `Invalid key length: ${bytes.length} bytes (expected 64)` }
    }

    return { valid: true }
  } catch (e: any) {
    return { valid: false, error: e?.message ?? "Failed to parse secret key" }
  }
}

/**
 * Get escrow wallet configurations from environment
 */
export function getEscrowWalletConfigs(): Array<{ address: string; secret?: string }> {
  const rawList = process.env.ESCROW_WALLET_ADDRESSES
  const addresses =
    typeof rawList === "string" && rawList.trim().length > 0
      ? rawList.split(",").map((s) => s.trim())
      : []

  const a1 = process.env.ESCROW_WALLET_1_ADDRESS
  const a2 = process.env.ESCROW_WALLET_2_ADDRESS
  const a3 = process.env.ESCROW_WALLET_3_ADDRESS

  const list =
    addresses.length > 0
      ? addresses
      : [a1, a2, a3].filter((v): v is string => typeof v === "string" && v.length > 0)

  const s1 = process.env.ESCROW_WALLET_1_SECRET_KEY
  const s2 = process.env.ESCROW_WALLET_2_SECRET_KEY
  const s3 = process.env.ESCROW_WALLET_3_SECRET_KEY

  const secrets: Array<string | undefined> = [s1, s2, s3]

  return list.slice(0, 3).map((address, idx) => ({ address, secret: secrets[idx] }))
}

/**
 * Perform a security audit of escrow wallet configuration
 */
export async function auditEscrowSecurity(): Promise<EscrowSecurityAudit> {
  const configs = getEscrowWalletConfigs()
  const warnings: string[] = []
  const wallets: EscrowWalletStatus[] = []

  if (configs.length === 0) {
    warnings.push("No escrow wallets configured")
  }

  if (configs.length < 3) {
    warnings.push(`Only ${configs.length} escrow wallet(s) configured (recommended: 3)`)
  }

  for (const cfg of configs) {
    const status: EscrowWalletStatus = {
      address: cfg.address,
      has_secret: !!cfg.secret,
      is_valid: false,
    }

    if (!cfg.secret) {
      status.validation_error = "Missing secret key"
      warnings.push(`Escrow wallet ${cfg.address.slice(0, 8)}... missing secret key`)
    } else {
      const validation = validateSecretKeyFormat(cfg.secret)
      status.is_valid = validation.valid
      if (!validation.valid) {
        status.validation_error = validation.error
        warnings.push(`Escrow wallet ${cfg.address.slice(0, 8)}... has invalid secret: ${validation.error}`)
      }
    }

    wallets.push(status)
  }

  // Check for production readiness
  const allValid = wallets.length >= 1 && wallets.every((w) => w.is_valid)

  // Additional production warnings
  if (process.env.NODE_ENV === "production") {
    warnings.push("SECURITY: Using single-key escrow in production. Consider multi-sig.")
    warnings.push("SECURITY: Ensure secret keys are stored securely (not in plain env vars).")
  }

  return {
    timestamp: new Date().toISOString(),
    wallets,
    warnings,
    is_production_ready: allValid && warnings.filter((w) => w.startsWith("SECURITY")).length === 0,
  }
}

/**
 * Log an escrow operation for audit trail
 */
export async function logEscrowOperation(args: {
  operation: "deposit" | "payout" | "fee_transfer"
  escrow_address: string
  market_id?: string
  order_id?: string
  amount_sol: number
  signature: string
  from_wallet?: string
  to_wallet?: string
}): Promise<void> {
  try {
    const supabase = createServiceClient()

    await supabase.from("escrow_audit_log").insert({
      operation: args.operation,
      escrow_address: args.escrow_address,
      market_id: args.market_id,
      order_id: args.order_id,
      amount_sol: args.amount_sol,
      signature: args.signature,
      from_wallet: args.from_wallet,
      to_wallet: args.to_wallet,
      created_at: new Date().toISOString(),
    })
  } catch {
    // Silently fail - audit logging should not break operations
    console.error("Failed to log escrow operation")
  }
}

/**
 * Check if emergency halt is active
 */
export async function isEmergencyHaltActive(): Promise<boolean> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from("system_config")
      .select("value")
      .eq("key", "emergency_halt")
      .maybeSingle()

    return data?.value?.active === true
  } catch {
    return false
  }
}

/**
 * Activate emergency halt
 */
export async function activateEmergencyHalt(reason: string): Promise<void> {
  const supabase = createServiceClient()

  await supabase.from("system_config").upsert(
    {
      key: "emergency_halt",
      value: {
        active: true,
        reason,
        activated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  )
}

/**
 * Deactivate emergency halt
 */
export async function deactivateEmergencyHalt(): Promise<void> {
  const supabase = createServiceClient()

  await supabase.from("system_config").upsert(
    {
      key: "emergency_halt",
      value: {
        active: false,
        deactivated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" }
  )
}
