import { type Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js"
import type { SendTransactionOptions } from "@solana/wallet-adapter-base"

// Escrow wallet address
export const ESCROW_WALLET_ADDRESS = "ABNktzUGgEaoT7SBvmt8geRuAuataVwPr7sGvEWZpoaz"

const CUSTOM_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || ""
const RPC_ENDPOINTS = CUSTOM_RPC
  ? [CUSTOM_RPC]
  : ["https://mainnet.helius-rpc.com/v0/public", "https://api.mainnet-beta.solana.com"]

/**
 * Try multiple RPC endpoints until one works
 */
async function getBlockhashWithFallback(
  connection: Connection,
): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const { Connection: SolanaConnection } = await import("@solana/web3.js")

  const errors: string[] = []

  for (const rpcUrl of RPC_ENDPOINTS) {
    try {
      console.log(`[v0] Getting blockhash from RPC...`)
      const testConnection = new SolanaConnection(rpcUrl, "confirmed")
      const result = await testConnection.getLatestBlockhash("confirmed")
      console.log("[v0] ✅ Got blockhash successfully!")
      return result
    } catch (error: any) {
      const errorMsg = error?.message || String(error)
      errors.push(errorMsg)
      console.log(`[v0] RPC failed: ${errorMsg.slice(0, 100)}`)
      continue
    }
  }

  throw new Error(`All RPC endpoints failed. Errors: ${errors.join("; ")}`)
}

/**
 * Deposits SOL to the escrow wallet - simplified based on working example
 */
export async function depositToEscrow(
  connection: Connection,
  fromPubkey: PublicKey,
  amount: number,
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ) => Promise<string>,
): Promise<string> {
  return depositToEscrowAddress(connection, fromPubkey, amount, ESCROW_WALLET_ADDRESS, sendTransaction)
}

export async function depositToEscrowAddress(
  connection: Connection,
  fromPubkey: PublicKey,
  amount: number,
  escrowAddress: string,
  sendTransaction: (
    transaction: Transaction,
    connection: Connection,
    options?: SendTransactionOptions,
  ) => Promise<string>,
): Promise<string> {
  console.log("[v0] Creating escrow deposit for", amount, "SOL")

  if (!escrowAddress || escrowAddress.trim().length === 0) {
    throw new Error("Missing escrow wallet address")
  }

  const escrowPubkey = new PublicKey(escrowAddress)
  const lamports = Math.floor(amount * LAMPORTS_PER_SOL)

  let blockhash: string
  let lastValidBlockHeight: number

  try {
    const result = await getBlockhashWithFallback(connection)
    blockhash = result.blockhash
    lastValidBlockHeight = result.lastValidBlockHeight
    console.log("[v0] Got blockhash successfully")
  } catch (error) {
    console.error("[v0] Failed to get blockhash:", error)
    throw new Error("Network connection failed. Please check your internet connection and try again.")
  }

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: fromPubkey,
  })

  transaction.add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: escrowPubkey,
      lamports,
    }),
  )

  console.log("[v0] Transaction created, sending to wallet for signature...")
  console.log("[v0] ⚠️ YOUR WALLET POPUP SHOULD APPEAR NOW ⚠️")

  try {
    const signature = await sendTransaction(transaction, connection, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    })

    console.log("[v0] ✅ Transaction signed and sent! Signature:", signature)
    return signature
  } catch (error: any) {
    console.error("[v0] Transaction send failed:", error)

    if (error?.message?.includes("not been authorized")) {
      throw new Error("Wallet authorization required. Please reconnect your wallet.")
    }
    throw error
  }
}

/**
 * Verifies transaction on-chain
 */
export async function verifyTransaction(connection: Connection, signature: string): Promise<boolean> {
  try {
    console.log("[v0] Verifying transaction:", signature)
    const confirmation = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    })
    return confirmation !== null && confirmation.meta?.err === null
  } catch (error) {
    console.error("[v0] Error verifying transaction:", error)
    return false
  }
}
