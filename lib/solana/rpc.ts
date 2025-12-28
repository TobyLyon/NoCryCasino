/**
 * RPC Resilience Layer
 * Addresses audit item 8.7: Fallback RPC list with retry logic
 */

import { Connection, type Finality } from "@solana/web3.js"

const DEFAULT_RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/v0/public",
  "https://api.mainnet-beta.solana.com",
  "https://solana-api.projectserum.com",
]

function getRpcEndpoints(): string[] {
  const primary = process.env.NEXT_PUBLIC_SOLANA_RPC_URL
  const fallbacks = process.env.SOLANA_RPC_FALLBACKS

  const endpoints: string[] = []

  if (primary && primary.trim().length > 0) {
    endpoints.push(primary.trim())
  }

  if (fallbacks && fallbacks.trim().length > 0) {
    const parsed = fallbacks.split(",").map((s) => s.trim()).filter((s) => s.length > 0)
    endpoints.push(...parsed)
  }

  if (endpoints.length === 0) {
    return DEFAULT_RPC_ENDPOINTS
  }

  return endpoints
}

export type RpcCallOptions = {
  maxRetries?: number
  retryDelayMs?: number
  commitment?: "processed" | "confirmed" | "finalized"
}

function toFinality(commitment: RpcCallOptions["commitment"] | undefined): Finality {
  if (commitment === "finalized") return "finalized"
  return "confirmed"
}

const DEFAULT_OPTIONS: Required<RpcCallOptions> = {
  maxRetries: 3,
  retryDelayMs: 1000,
  commitment: "confirmed",
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Execute an RPC call with fallback endpoints and retry logic
 */
export async function withRpcFallback<T>(
  fn: (connection: Connection) => Promise<T>,
  options?: RpcCallOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const endpoints = getRpcEndpoints()

  let lastError: Error | null = null

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    for (const endpoint of endpoints) {
      try {
        const connection = new Connection(endpoint, opts.commitment)
        return await fn(connection)
      } catch (e: any) {
        lastError = e instanceof Error ? e : new Error(String(e))
        // Continue to next endpoint
      }
    }

    // All endpoints failed, wait before retry
    if (attempt < opts.maxRetries - 1) {
      await sleep(opts.retryDelayMs * (attempt + 1)) // Exponential backoff
    }
  }

  throw lastError ?? new Error("All RPC endpoints failed")
}

/**
 * Get a connection to the primary RPC endpoint
 */
export function getConnection(commitment: "processed" | "confirmed" | "finalized" = "confirmed"): Connection {
  const endpoints = getRpcEndpoints()
  return new Connection(endpoints[0] ?? DEFAULT_RPC_ENDPOINTS[0], commitment)
}

/**
 * Verify a transaction exists and succeeded with fallback
 */
export async function verifyTransactionWithFallback(
  signature: string,
  options?: RpcCallOptions
): Promise<{
  exists: boolean
  success: boolean
  blockTime: number | null
  slot: number | null
  error?: string
}> {
  try {
    const result = await withRpcFallback(async (connection) => {
      const tx = await connection.getParsedTransaction(signature, {
        commitment: toFinality(options?.commitment),
        maxSupportedTransactionVersion: 0,
      })

      if (!tx) {
        return { exists: false, success: false, blockTime: null, slot: null }
      }

      return {
        exists: true,
        success: !tx.meta?.err,
        blockTime: tx.blockTime ?? null,
        slot: typeof tx.slot === "number" ? tx.slot : null,
      }
    }, options)

    return result
  } catch (e: any) {
    return {
      exists: false,
      success: false,
      blockTime: null,
      slot: null,
      error: e?.message ?? String(e),
    }
  }
}

/**
 * Get parsed transaction with fallback
 */
export async function getParsedTransactionWithFallback(
  signature: string,
  options?: RpcCallOptions
) {
  return withRpcFallback(async (connection) => {
    return connection.getParsedTransaction(signature, {
      commitment: toFinality(options?.commitment),
      maxSupportedTransactionVersion: 0,
    })
  }, options)
}

/**
 * Send and confirm transaction with fallback
 */
export async function sendAndConfirmWithFallback(
  serializedTx: Buffer | Uint8Array,
  options?: RpcCallOptions & { skipPreflight?: boolean }
): Promise<string> {
  return withRpcFallback(async (connection) => {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
      options?.commitment ?? "confirmed"
    )

    const sig = await connection.sendRawTransaction(serializedTx, {
      skipPreflight: options?.skipPreflight ?? false,
      maxRetries: 3,
    })

    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      options?.commitment ?? "confirmed"
    )

    return sig
  }, options)
}
