# Real Blockchain Data Integration Guide

This guide explains how to switch between **mock data** (for development/demo) and **real blockchain data** (for production).

## 🎯 Quick Start

### Use Mock Data (Default - Fastest)

```bash
# No configuration needed - works out of the box
bun run dev
```

### Use Real Blockchain Data

```bash
# 1. Add RPC endpoint to .env.local
echo "NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com" >> .env.local
echo "NEXT_PUBLIC_USE_MOCK_DATA=false" >> .env.local

# 2. Restart server
bun run dev
```

---

## 📊 Data Sources

### Mock Data (Current Default)
- **Location**: `/src/lib/kol-data.ts`
- **Speed**: Instant (no API calls)
- **Cost**: Free
- **Accuracy**: Static sample data
- **Best for**: Development, testing, demos

### Real Blockchain Data
- **Source**: Actual Solana blockchain via RPC
- **Speed**: 2-5 seconds per load
- **Cost**: Depends on RPC provider
- **Accuracy**: Real-time, 100% accurate
- **Best for**: Production deployment

### Scraped Real Data
- **Location**: `/src/lib/real-kol-data.ts`
- **Source**: Scraped from kolscan.io
- **Contains**: 30+ real KOL wallets
- **Usage**: Used as seed data for real tracking

---

## 🔧 Configuration Options

### Option 1: Environment Variables (Recommended)

```env
# .env.local

# Use real data instead of mock
NEXT_PUBLIC_USE_MOCK_DATA=false

# Solana RPC endpoint
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Optional: Use premium RPC for better performance
# NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### Option 2: API Query Parameter

```typescript
// Fetch real data for specific request
const response = await fetch('/api/leaderboard?timeframe=daily&mock=false');

// Fetch mock data
const response = await fetch('/api/leaderboard?timeframe=daily&mock=true');
```

### Option 3: Code-level Toggle

```typescript
import { useKOLData } from '@/lib/use-kol-data';

function MyComponent() {
  // Use mock data
  const { kols } = useKOLData('daily', true);

  // Use real data
  const { kols } = useKOLData('daily', false);
}
```

---

## 🚀 RPC Provider Options

### Free Options

#### 1. Public Solana RPC (Free, Rate Limited)
```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```
- **Pros**: Free, no signup
- **Cons**: Slow, rate limits, unreliable
- **Best for**: Testing only

### Paid Options (Recommended for Production)

#### 2. Helius (Best for KOL Tracking)
```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```
- **Cost**: Free tier (100K requests/day), Pro $49/month
- **Pros**: Fast, reliable, transaction webhooks
- **Sign up**: https://helius.dev

#### 3. Alchemy
```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/YOUR_KEY
```
- **Cost**: Free tier (300M compute units/month)
- **Pros**: Great developer tools, reliable
- **Sign up**: https://alchemy.com

#### 4. QuickNode
```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_TOKEN/
```
- **Cost**: Starts at $9/month
- **Pros**: Fast, dedicated endpoints
- **Sign up**: https://quicknode.com

---

## 📝 Implementation Details

### How Real Data Fetching Works

1. **API Route** (`/api/leaderboard`)
   - Checks if mock mode is enabled
   - If real mode: Fetches wallet transactions from Solana blockchain
   - Analyzes trades to calculate wins/losses/profit
   - Returns ranked leaderboard

2. **Wallet Tracker** (`/src/lib/solana-tracker.ts`)
   ```typescript
   // Fetches transaction signatures
   getSignaturesForAddress(publicKey, { limit: 100 })

   // Gets transaction details
   getParsedTransaction(signature)

   // Identifies DEX swaps (Jupiter, Raydium, Orca, etc.)
   isDEXSwap(transaction)

   // Calculates profit from balance changes
   calculateProfit(transaction)
   ```

3. **Caching Strategy**
   - Leaderboard cached for 5 minutes
   - Reduces blockchain API calls
   - Configurable in `/src/lib/use-kol-data.ts`

### Real KOL Wallets (Scraped from kolscan.io)

All real wallet addresses are stored in `/src/lib/real-kol-data.ts`:

```typescript
export const realDailyKOLs: KOL[] = [
  {
    rank: 1,
    name: 'Jijo',
    fullWallet: '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk',
    // ... real stats
  },
  // ... 30+ more real KOLs
];

export const ALL_KOL_WALLETS = realDailyKOLs.map(kol => kol.fullWallet);
```

These wallets are actively tracked when real mode is enabled.

---

## 🧪 Testing Real Data

### Test Individual Wallet

```bash
curl "http://localhost:3000/api/wallet/4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk?timeframe=daily"
```

Expected response:
```json
{
  "success": true,
  "address": "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk",
  "timeframe": "daily",
  "stats": {
    "wins": 9,
    "losses": 7,
    "totalProfit": 530.95,
    "totalProfitUsd": 66081.8,
    "totalTrades": 15,
    "winRate": 60.0,
    "trades": [...]
  }
}
```

### Test Full Leaderboard

```bash
# Real data
curl "http://localhost:3000/api/leaderboard?timeframe=daily&mock=false"

# Mock data
curl "http://localhost:3000/api/leaderboard?timeframe=daily&mock=true"
```

---

## ⚡ Performance Optimization

### 1. Enable Caching

The app automatically caches leaderboard data for 5 minutes. Adjust in:

```typescript:src/lib/use-kol-data.ts
const CACHE_DURATION = 5 * 60 * 1000; // Change to your needs
```

### 2. Batch Processing

Wallet stats are fetched in batches of 5 to avoid rate limiting:

```typescript:src/lib/solana-tracker.ts
const batchSize = 5; // Increase if your RPC allows
```

### 3. Limit Transaction Lookback

```typescript:src/lib/solana-tracker.ts
const signatures = await fetchWalletSignatures(walletAddress, 100); // Reduce for faster loads
```

---

## 🐛 Troubleshooting

### Error: "Rate limit exceeded"

**Solution**: Use a paid RPC provider or enable caching

```env
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### Error: "Failed to fetch wallet data"

**Solutions**:
1. Check RPC endpoint is correct
2. Verify wallet address is valid
3. Try with mock data first: `NEXT_PUBLIC_USE_MOCK_DATA=true`

### Slow Performance

**Solutions**:
1. Use Helius or Alchemy instead of public RPC
2. Enable caching (default: 5 minutes)
3. Reduce transaction lookback limit

---

## 📊 Cost Estimation

### Development (Mock Data)
- **Cost**: $0
- **Performance**: Instant
- **Recommended**: ✅ Yes

### Production (Real Data + Free RPC)
- **Cost**: $0
- **Performance**: Slow (5-10s per load)
- **Recommended**: ⚠️ For testing only

### Production (Real Data + Helius Free)
- **Cost**: $0 (up to 100K requests/day)
- **Performance**: Fast (1-2s per load)
- **Recommended**: ✅ Yes for small projects

### Production (Real Data + Helius Pro)
- **Cost**: $49/month
- **Performance**: Very fast (<1s per load)
- **Recommended**: ✅ Yes for production

---

## 🔄 Migration Path

### Phase 1: Development (Mock Data)
```env
NEXT_PUBLIC_USE_MOCK_DATA=true
```
- Develop features
- Test UI/UX
- Perfect the design

### Phase 2: Testing (Real Data + Free RPC)
```env
NEXT_PUBLIC_USE_MOCK_DATA=false
NEXT_PUBLIC_SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
```
- Verify blockchain integration works
- Test with real wallet addresses
- Identify performance issues

### Phase 3: Staging (Real Data + Helius Free)
```env
NEXT_PUBLIC_USE_MOCK_DATA=false
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```
- Test with production-like performance
- Verify caching strategy
- Measure actual costs

### Phase 4: Production (Real Data + Helius Pro)
```env
NEXT_PUBLIC_USE_MOCK_DATA=false
NEXT_PUBLIC_SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_PRO_KEY
```
- Launch to users
- Monitor performance
- Optimize as needed

---

## 📚 Related Files

- `/src/lib/solana-tracker.ts` - Blockchain tracking implementation
- `/src/lib/real-kol-data.ts` - Scraped KOL wallet addresses
- `/src/lib/use-kol-data.ts` - React hooks for data fetching
- `/src/app/api/leaderboard/route.ts` - Leaderboard API endpoint
- `/src/app/api/wallet/[address]/route.ts` - Individual wallet API
- `.env.example` - Environment variable template

---

## 🎓 Learning Resources

- [Solana Web3.js Documentation](https://solana-labs.github.io/solana-web3.js/)
- [Helius Developer Docs](https://docs.helius.dev/)
- [Alchemy Solana Docs](https://docs.alchemy.com/reference/solana-api-quickstart)
- [DEX Program IDs](https://solscan.io/programs)

---

**Pro Tip**: Start with mock data for development, then gradually transition to real data as you approach production. This saves costs and speeds up development while ensuring the real implementation is battle-tested.
