import type { NextRequest } from "next/server"

function decodeBase64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"))
}

export function requireFreshIssuedAt(issuedAtIso: string, maxSkewMs: number): { ok: true } | { ok: false; error: string } {
  const t = Date.parse(issuedAtIso)
  if (!Number.isFinite(t)) return { ok: false, error: "Invalid issued_at" }
  if (Math.abs(Date.now() - t) > maxSkewMs) return { ok: false, error: "Signature expired" }
  return { ok: true }
}

export async function verifyEd25519Signature(message: string, signatureB64: string, walletAddress: string): Promise<boolean> {
  const { PublicKey } = await import("@solana/web3.js")
  const naclMod: any = await import("tweetnacl")
  const nacl = naclMod?.default ?? naclMod

  const pk = new PublicKey(walletAddress)
  const sig = decodeBase64(signatureB64)
  const msg = new TextEncoder().encode(message)

  return nacl.sign.detached.verify(msg, sig, pk.toBytes())
}

export function buildPmMessage(title: string, fields: Record<string, string>): string {
  const lines = [title]
  for (const [k, v] of Object.entries(fields)) {
    lines.push(`${k}=${v}`)
  }
  return lines.join("\n")
}

export async function requireSignedBody(args: {
  request: NextRequest
  expectedMessage: string
  walletAddress: string
  signatureB64: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const valid = await verifyEd25519Signature(args.expectedMessage, args.signatureB64, args.walletAddress)
  if (!valid) return { ok: false, status: 401, error: "Invalid signature" }
  return { ok: true }
}
