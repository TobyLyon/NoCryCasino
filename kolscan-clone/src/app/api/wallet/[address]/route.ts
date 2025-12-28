import { NextRequest, NextResponse } from 'next/server';
import { getWalletStats } from '@/lib/solana-tracker';

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  try {
    const { address } = params;
    const { searchParams } = new URL(request.url);
    const timeframe = (searchParams.get('timeframe') || 'daily') as 'daily' | 'weekly' | 'monthly';

    // Validate Solana address (basic check)
    if (!address || address.length < 32) {
      return NextResponse.json(
        { error: 'Invalid wallet address' },
        { status: 400 }
      );
    }

    // Fetch real wallet stats from blockchain
    const stats = await getWalletStats(address, timeframe);

    return NextResponse.json({
      success: true,
      address,
      timeframe,
      stats,
    });
  } catch (error) {
    console.error('Error fetching wallet data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallet data', message: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
