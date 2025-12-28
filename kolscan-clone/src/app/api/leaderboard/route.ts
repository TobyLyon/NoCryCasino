import { NextRequest, NextResponse } from 'next/server';
import { batchGetWalletStats, getSolPrice } from '@/lib/solana-tracker';
import { realDailyKOLs, ALL_KOL_WALLETS } from '@/lib/real-kol-data';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') || 'daily') as 'daily' | 'weekly' | 'monthly';
    const useMock = searchParams.get('mock') === 'true' ||
                    process.env.NEXT_PUBLIC_USE_MOCK_DATA === 'true';

    if (useMock) {
      // Return mock data (faster for development)
      return NextResponse.json({
        success: true,
        timeframe,
        mock: true,
        kols: realDailyKOLs,
      });
    }

    // Fetch real data from blockchain
    console.log(`Fetching real leaderboard data for ${timeframe}...`);

    // Get current SOL price
    const solPrice = await getSolPrice();

    // Fetch stats for all KOL wallets
    const statsMap = await batchGetWalletStats(ALL_KOL_WALLETS, timeframe);

    // Update KOL data with real stats
    const updatedKOLs = realDailyKOLs.map((kol, index) => {
      const stats = statsMap.get(kol.fullWallet);

      if (stats && stats.totalTrades > 0) {
        return {
          ...kol,
          wins: stats.wins,
          losses: stats.losses,
          profit: stats.totalProfit,
          profitUsd: stats.totalProfitUsd,
        };
      }

      return kol;
    });

    // Sort by profit and update ranks
    const sortedKOLs = updatedKOLs
      .sort((a, b) => b.profit - a.profit)
      .map((kol, index) => ({
        ...kol,
        rank: index + 1,
      }));

    return NextResponse.json({
      success: true,
      timeframe,
      mock: false,
      solPrice,
      kols: sortedKOLs,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);

    // Fallback to mock data on error
    return NextResponse.json({
      success: true,
      timeframe: 'daily',
      mock: true,
      error: 'Fell back to mock data',
      kols: realDailyKOLs,
    });
  }
}

// Enable edge runtime for faster cold starts (optional)
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
