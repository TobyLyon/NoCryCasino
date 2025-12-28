import { useState, useEffect } from 'react';
import { getKOLsByTimeframe, type KOL } from './kol-data';
import { realDailyKOLs } from './real-kol-data';
import type { WalletStats } from './solana-tracker';

/**
 * Hook to fetch KOL data - can use mock data or real API
 *
 * Usage:
 * const { kols, loading, error } = useKOLData('daily', false); // Use real API
 * const { kols, loading, error } = useKOLData('daily', true);  // Use mock data
 */
export function useKOLData(
  timeframe: 'daily' | 'weekly' | 'monthly',
  useMock: boolean = true
) {
  const [kols, setKOLs] = useState<KOL[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        if (useMock) {
          // Use mock data (instant, no API calls)
          const mockData = getKOLsByTimeframe(timeframe);
          setKOLs(mockData);
          setLoading(false);
        } else {
          // Fetch real data from API
          const response = await fetch(`/api/leaderboard?timeframe=${timeframe}&mock=false`);

          if (!response.ok) {
            throw new Error('Failed to fetch leaderboard data');
          }

          const data = await response.json();

          if (data.success) {
            setKOLs(data.kols);
          } else {
            throw new Error(data.error || 'Unknown error');
          }

          setLoading(false);
        }
      } catch (err) {
        console.error('Error fetching KOL data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');

        // Fallback to mock data on error
        const fallbackData = getKOLsByTimeframe(timeframe);
        setKOLs(fallbackData);
        setLoading(false);
      }
    }

    fetchData();
  }, [timeframe, useMock]);

  return { kols, loading, error };
}

/**
 * Hook to fetch individual wallet stats
 */
export function useWalletStats(walletAddress: string, timeframe: 'daily' | 'weekly' | 'monthly') {
  const [stats, setStats] = useState<WalletStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      if (!walletAddress) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/wallet/${walletAddress}?timeframe=${timeframe}`);

        if (!response.ok) {
          throw new Error('Failed to fetch wallet stats');
        }

        const data = await response.json();

        if (data.success) {
          setStats(data.stats);
        } else {
          throw new Error(data.error || 'Unknown error');
        }

        setLoading(false);
      } catch (err) {
        console.error('Error fetching wallet stats:', err);
        setError(err instanceof Error ? err.message : 'Failed to load stats');
        setLoading(false);
      }
    }

    fetchStats();
  }, [walletAddress, timeframe]);

  return { stats, loading, error };
}

/**
 * Check if we're using real or mock data (based on env variable)
 */
export function isUsingMockData(): boolean {
  // Check environment variable
  if (typeof window !== 'undefined') {
    return process.env.NEXT_PUBLIC_USE_MOCK_DATA !== 'false';
  }
  return process.env.USE_MOCK_DATA !== 'false';
}

/**
 * Get real-time KOLs (cached for 5 minutes)
 */
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
let cachedData: { kols: KOL[]; timestamp: number } | null = null;

export async function getCachedKOLs(
  timeframe: 'daily' | 'weekly' | 'monthly',
  forceRefresh = false
): Promise<KOL[]> {
  const now = Date.now();

  // Return cached data if fresh
  if (!forceRefresh && cachedData && now - cachedData.timestamp < CACHE_DURATION) {
    return cachedData.kols;
  }

  try {
    // Fetch fresh data
    const response = await fetch(`/api/leaderboard?timeframe=${timeframe}&mock=false`);
    const data = await response.json();

    if (data.success) {
      cachedData = {
        kols: data.kols,
        timestamp: now,
      };
      return data.kols;
    }
  } catch (error) {
    console.error('Error fetching cached KOLs:', error);
  }

  // Fallback to real daily KOLs
  return realDailyKOLs;
}
