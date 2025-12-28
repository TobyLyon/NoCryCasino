export interface KOL {
  rank: number;
  name: string;
  avatar: string;
  wallet: string;
  fullWallet: string;
  wins: number;
  losses: number;
  profit: number;
  profitUsd: number;
  hasTelegram: boolean;
  hasTwitter: boolean;
}

// Daily leaderboard data (last 24 hours)
export const dailyKOLs: KOL[] = [
  {
    rank: 1,
    name: 'Jijo',
    avatar: 'https://ext.same-assets.com/3959085109/2900370585.png',
    wallet: '4BdKax',
    fullWallet: '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk',
    wins: 9,
    losses: 7,
    profit: 332.12,
    profitUsd: 41142.6,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 2,
    name: 'ram',
    avatar: 'https://ext.same-assets.com/3959085109/1240592860.png',
    wallet: '57rXqa',
    fullWallet: '57rXqaQsvgyBKwebP2StfqQeCBjBS4jsrZFJN5aU2V9b',
    wins: 1,
    losses: 0,
    profit: 97.72,
    profitUsd: 12106.0,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 3,
    name: 'Ducky',
    avatar: 'https://ext.same-assets.com/3959085109/1856251214.png',
    wallet: 'ADC1QV',
    fullWallet: 'ADC1QV9raLnGGDbnWdnsxazeZ4Tsiho4vrWadYswA2ph',
    wins: 4,
    losses: 10,
    profit: 74.09,
    profitUsd: 9178.6,
    hasTelegram: false,
    hasTwitter: true,
  },
  {
    rank: 4,
    name: 'Dior',
    avatar: 'https://ext.same-assets.com/3959085109/3065719139.png',
    wallet: '87rRds',
    fullWallet: '87rRdssFiTJKY4MGARa4G5vQ31hmR7MxSmhzeaJ5AAxJ',
    wins: 5,
    losses: 6,
    profit: 53.11,
    profitUsd: 6579.2,
    hasTelegram: false,
    hasTwitter: true,
  },
  {
    rank: 5,
    name: 'Leck',
    avatar: 'https://ext.same-assets.com/3959085109/3617297792.png',
    wallet: '98T65w',
    fullWallet: '98T65wcMEjoNLDTJszBHGZEX75QRe8QaANXokv4yw3Mp',
    wins: 43,
    losses: 47,
    profit: 49.26,
    profitUsd: 6102.6,
    hasTelegram: true,
    hasTwitter: true,
  },
];

// Weekly leaderboard data (last 7 days)
export const weeklyKOLs: KOL[] = [
  {
    rank: 1,
    name: 'Cupsey',
    avatar: 'https://ext.same-assets.com/3959085109/2435280882.png',
    wallet: '2fg5QD',
    fullWallet: '2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f',
    wins: 147,
    losses: 108,
    profit: 892.45,
    profitUsd: 110543.2,
    hasTelegram: false,
    hasTwitter: true,
  },
  {
    rank: 2,
    name: 'Leck',
    avatar: 'https://ext.same-assets.com/3959085109/3617297792.png',
    wallet: '98T65w',
    fullWallet: '98T65wcMEjoNLDTJszBHGZEX75QRe8QaANXokv4yw3Mp',
    wins: 215,
    losses: 189,
    profit: 756.33,
    profitUsd: 93684.8,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 3,
    name: 'decu',
    avatar: 'https://ext.same-assets.com/3959085109/2142037646.png',
    wallet: '4vw54B',
    fullWallet: '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9',
    wins: 289,
    losses: 201,
    profit: 645.78,
    profitUsd: 79996.1,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 4,
    name: 'Jijo',
    avatar: 'https://ext.same-assets.com/3959085109/2900370585.png',
    wallet: '4BdKax',
    fullWallet: '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk',
    wins: 52,
    losses: 38,
    profit: 534.21,
    profitUsd: 66190.2,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 5,
    name: 'theo',
    avatar: 'https://ext.same-assets.com/3959085109/1076433734.png',
    wallet: 'Bi4rd5',
    fullWallet: 'Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt',
    wins: 198,
    losses: 312,
    profit: 421.89,
    profitUsd: 52254.1,
    hasTelegram: false,
    hasTwitter: true,
  },
];

// Monthly leaderboard data (last 30 days)
export const monthlyKOLs: KOL[] = [
  {
    rank: 1,
    name: 'decu',
    avatar: 'https://ext.same-assets.com/3959085109/2142037646.png',
    wallet: '4vw54B',
    fullWallet: '4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9',
    wins: 1247,
    losses: 856,
    profit: 3421.67,
    profitUsd: 423886.4,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 2,
    name: 'Cupsey',
    avatar: 'https://ext.same-assets.com/3959085109/2435280882.png',
    wallet: '2fg5QD',
    fullWallet: '2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f',
    wins: 892,
    losses: 634,
    profit: 2987.34,
    profitUsd: 370094.2,
    hasTelegram: false,
    hasTwitter: true,
  },
  {
    rank: 3,
    name: 'Loopierr',
    avatar: 'https://ext.same-assets.com/3959085109/1881611580.png',
    wallet: '9yYya3',
    fullWallet: '9yYya3F5EJoLnBNKW6z4bZvyQytMXzDcpU5D6yYr4jqL',
    wins: 645,
    losses: 523,
    profit: 2543.98,
    profitUsd: 315197.5,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 4,
    name: 'Leck',
    avatar: 'https://ext.same-assets.com/3959085109/3617297792.png',
    wallet: '98T65w',
    fullWallet: '98T65wcMEjoNLDTJszBHGZEX75QRe8QaANXokv4yw3Mp',
    wins: 1156,
    losses: 978,
    profit: 2234.12,
    profitUsd: 276748.9,
    hasTelegram: true,
    hasTwitter: true,
  },
  {
    rank: 5,
    name: 'bandit',
    avatar: 'https://ext.same-assets.com/3959085109/2133612207.png',
    wallet: '5B79fM',
    fullWallet: '5B79fMkcFeRTiwm7ehsZsFiKsC7m7n1Bgv9yLxPp9q2X',
    wins: 789,
    losses: 912,
    profit: 1876.54,
    profitUsd: 232480.1,
    hasTelegram: false,
    hasTwitter: true,
  },
];

export function getKOLsByTimeframe(timeframe: 'daily' | 'weekly' | 'monthly'): KOL[] {
  switch (timeframe) {
    case 'daily':
      return dailyKOLs;
    case 'weekly':
      return weeklyKOLs;
    case 'monthly':
      return monthlyKOLs;
    default:
      return dailyKOLs;
  }
}
