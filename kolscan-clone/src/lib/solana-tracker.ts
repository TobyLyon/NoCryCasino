// Real Solana wallet tracker - fetches actual blockchain data
import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';

// DEX program IDs for identifying swaps
const DEX_PROGRAMS = {
  JUPITER: 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  RAYDIUM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  METEORA: 'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB',
  PHOENIX: 'PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY',
};

export interface Trade {
  signature: string;
  timestamp: number;
  inputToken: string;
  outputToken: string;
  inputAmount: number;
  outputAmount: number;
  profitSol: number;
  profitUsd: number;
  isWin: boolean;
  dexProgram: string;
}

export interface WalletStats {
  wins: number;
  losses: number;
  totalProfit: number;
  totalProfitUsd: number;
  totalTrades: number;
  winRate: number;
  trades: Trade[];
}

/**
 * Get Solana connection - uses env variable or public RPC
 */
export function getSolanaConnection(): Connection {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
                 process.env.SOLANA_RPC_URL ||
                 'https://api.mainnet-beta.solana.com';

  return new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 60000,
  });
}

/**
 * Fetch transaction signatures for a wallet
 */
export async function fetchWalletSignatures(
  walletAddress: string,
  limit: number = 100
): Promise<string[]> {
  try {
    const connection = getSolanaConnection();
    const publicKey = new PublicKey(walletAddress);

    const signatures = await connection.getSignaturesForAddress(publicKey, {
      limit,
    });

    return signatures.map(sig => sig.signature);
  } catch (error) {
    console.error('Error fetching signatures:', error);
    return [];
  }
}

/**
 * Fetch full transaction details
 */
export async function fetchTransaction(
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  try {
    const connection = getSolanaConnection();

    const transaction = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    return transaction;
  } catch (error) {
    console.error(`Error fetching transaction ${signature}:`, error);
    return null;
  }
}

/**
 * Check if transaction is a DEX swap
 */
export function isDEXSwap(transaction: ParsedTransactionWithMeta): boolean {
  if (!transaction?.transaction) return false;

  const programIds = transaction.transaction.message.accountKeys
    .map(key => key.pubkey.toString());

  return Object.values(DEX_PROGRAMS).some(dexProgram =>
    programIds.includes(dexProgram)
  );
}

/**
 * Identify which DEX was used
 */
export function identifyDEX(transaction: ParsedTransactionWithMeta): string {
  if (!transaction?.transaction) return 'unknown';

  const programIds = transaction.transaction.message.accountKeys
    .map(key => key.pubkey.toString());

  for (const [name, programId] of Object.entries(DEX_PROGRAMS)) {
    if (programIds.includes(programId)) {
      return name.toLowerCase();
    }
  }

  return 'unknown';
}

/**
 * Calculate profit from transaction balance changes
 */
export function calculateProfit(
  transaction: ParsedTransactionWithMeta,
  walletAddress: string
): number {
  if (!transaction?.meta) return 0;

  try {
    const accountKeys = transaction.transaction.message.accountKeys;
    const walletIndex = accountKeys.findIndex(
      key => key.pubkey.toString() === walletAddress
    );

    if (walletIndex === -1) return 0;

    const preBalance = transaction.meta.preBalances[walletIndex] || 0;
    const postBalance = transaction.meta.postBalances[walletIndex] || 0;

    // Convert lamports to SOL
    const profitLamports = postBalance - preBalance;
    const profitSol = profitLamports / 1e9;

    return profitSol;
  } catch (error) {
    console.error('Error calculating profit:', error);
    return 0;
  }
}

/**
 * Analyze a single transaction
 */
export async function analyzeTrade(
  signature: string,
  walletAddress: string,
  solPrice: number = 124.0 // Default SOL price in USD
): Promise<Trade | null> {
  try {
    const transaction = await fetchTransaction(signature);

    if (!transaction || !isDEXSwap(transaction)) {
      return null;
    }

    const profitSol = calculateProfit(transaction, walletAddress);
    const profitUsd = profitSol * solPrice;
    const dexProgram = identifyDEX(transaction);

    return {
      signature,
      timestamp: transaction.blockTime || Date.now() / 1000,
      inputToken: 'UNKNOWN', // Would need more complex parsing
      outputToken: 'UNKNOWN',
      inputAmount: 0,
      outputAmount: 0,
      profitSol,
      profitUsd,
      isWin: profitSol > 0,
      dexProgram,
    };
  } catch (error) {
    console.error(`Error analyzing trade ${signature}:`, error);
    return null;
  }
}

/**
 * Get wallet statistics for a timeframe
 */
export async function getWalletStats(
  walletAddress: string,
  timeframe: 'daily' | 'weekly' | 'monthly' = 'daily',
  limit: number = 100
): Promise<WalletStats> {
  try {
    // Calculate cutoff time
    const now = Date.now() / 1000;
    let cutoffTime = now;

    switch (timeframe) {
      case 'daily':
        cutoffTime = now - 24 * 60 * 60;
        break;
      case 'weekly':
        cutoffTime = now - 7 * 24 * 60 * 60;
        break;
      case 'monthly':
        cutoffTime = now - 30 * 24 * 60 * 60;
        break;
    }

    // Fetch signatures
    const signatures = await fetchWalletSignatures(walletAddress, limit);

    // Analyze trades
    const trades: Trade[] = [];

    for (const signature of signatures.slice(0, 50)) { // Limit to 50 for performance
      const trade = await analyzeTrade(signature, walletAddress);

      if (trade && trade.timestamp >= cutoffTime) {
        trades.push(trade);
      }
    }

    // Calculate statistics
    const wins = trades.filter(t => t.isWin).length;
    const losses = trades.filter(t => !t.isWin).length;
    const totalProfit = trades.reduce((sum, t) => sum + t.profitSol, 0);
    const totalProfitUsd = trades.reduce((sum, t) => sum + t.profitUsd, 0);
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

    return {
      wins,
      losses,
      totalProfit,
      totalProfitUsd,
      totalTrades: trades.length,
      winRate,
      trades,
    };
  } catch (error) {
    console.error(`Error getting stats for ${walletAddress}:`, error);
    return {
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalProfitUsd: 0,
      totalTrades: 0,
      winRate: 0,
      trades: [],
    };
  }
}

/**
 * Batch fetch stats for multiple wallets
 */
export async function batchGetWalletStats(
  wallets: string[],
  timeframe: 'daily' | 'weekly' | 'monthly' = 'daily'
): Promise<Map<string, WalletStats>> {
  const statsMap = new Map<string, WalletStats>();

  // Process in batches to avoid rate limiting
  const batchSize = 5;

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    const promises = batch.map(wallet =>
      getWalletStats(wallet, timeframe)
        .then(stats => ({ wallet, stats }))
    );

    const results = await Promise.all(promises);

    results.forEach(({ wallet, stats }) => {
      statsMap.set(wallet, stats);
    });

    // Small delay to avoid rate limiting
    if (i + batchSize < wallets.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return statsMap;
}

/**
 * Get current SOL price from CoinGecko
 */
export async function getSolPrice(): Promise<number> {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
    );

    const data = await response.json();
    return data.solana?.usd || 124.0;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    return 124.0; // Default fallback
  }
}
