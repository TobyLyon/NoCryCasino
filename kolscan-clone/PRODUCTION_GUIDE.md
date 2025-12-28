# Production Deployment Guide

This guide explains how to deploy the KOL Leaderboard with real blockchain data tracking.

## Prerequisites

- [ ] Solana RPC endpoint (Helius, Alchemy, or QuickNode)
- [ ] Database (PostgreSQL recommended)
- [ ] Hosting platform (Vercel, Netlify, or custom)
- [ ] Domain name (optional)

---

## Step 1: Set Up Database

### PostgreSQL Setup

```bash
# Install PostgreSQL
sudo apt-get install postgresql

# Create database
createdb kolscan

# Run migration
psql -d kolscan -f database/schema.sql
```

### Database Schema

See `database/schema.sql` for the complete schema including:
- `kols` table - KOL profiles
- `trades` table - Transaction history
- `leaderboard_cache` table - Precomputed rankings

---

## Step 2: Configure RPC Provider

### Option A: Helius (Recommended)

1. Sign up at [helius.dev](https://helius.dev)
2. Create a new project
3. Copy your API key
4. Add to `.env.local`:

```env
HELIUS_API_KEY=your-helius-key-here
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=your-helius-key-here
```

### Option B: Alchemy

1. Sign up at [alchemy.com](https://alchemy.com)
2. Create Solana app
3. Get API key
4. Add to `.env.local`:

```env
ALCHEMY_API_KEY=your-alchemy-key
SOLANA_RPC_URL=https://solana-mainnet.g.alchemy.com/v2/your-alchemy-key
```

### Option C: QuickNode

```env
SOLANA_RPC_URL=https://your-endpoint.solana-mainnet.quiknode.pro/your-token/
```

---

## Step 3: Set Up Transaction Monitoring

### Using Helius Webhooks

```typescript
// scripts/setup-webhooks.ts
import { setupHeliusWebhook } from '@/lib/helius';

const KOL_WALLETS = [
  '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk', // Jijo
  '57rXqaQsvgyBKwebP2StfqQeCBjBS4jsrZFJN5aU2V9b', // ram
  // ... add all KOL wallets
];

async function main() {
  await setupHeliusWebhook({
    wallets: KOL_WALLETS,
    webhookUrl: process.env.WEBHOOK_URL!,
    transactionTypes: ['SWAP', 'TRANSFER']
  });
}

main();
```

Run setup:
```bash
bun run scripts/setup-webhooks.ts
```

---

## Step 4: Create API Endpoints

### 1. Webhook Handler

```typescript
// src/app/api/webhook/transactions/route.ts
import { NextRequest } from 'next/server';
import { processTransaction } from '@/lib/transaction-processor';
import { db } from '@/lib/db';

export async function POST(req: NextRequest) {
  // Verify webhook signature
  const signature = req.headers.get('x-helius-signature');
  if (!verifySignature(signature, await req.text())) {
    return Response.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const transactions = await req.json();

  for (const tx of transactions) {
    // Process each transaction
    const analysis = await processTransaction(tx);

    // Store in database
    await db.trades.create({
      kol_wallet: tx.feePayer,
      signature: tx.signature,
      timestamp: new Date(tx.timestamp * 1000),
      profit_sol: analysis.profitSol,
      profit_usd: analysis.profitUsd,
      is_win: analysis.profitSol > 0,
      input_token: analysis.inputToken,
      output_token: analysis.outputToken,
    });
  }

  // Update leaderboard cache
  await updateLeaderboardCache();

  return Response.json({ success: true });
}
```

### 2. Leaderboard API

```typescript
// src/app/api/leaderboard/[timeframe]/route.ts
import { db } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: { timeframe: string } }
) {
  const { timeframe } = params;

  const leaderboard = await db.query(`
    SELECT
      k.*,
      l.rank,
      l.wins,
      l.losses,
      l.total_profit_sol,
      l.total_profit_usd
    FROM leaderboard_cache l
    JOIN kols k ON k.wallet_address = l.wallet_address
    WHERE l.timeframe = $1
    ORDER BY l.rank ASC
    LIMIT 50
  `, [timeframe]);

  return Response.json(leaderboard);
}
```

---

## Step 5: Deploy Application

### Vercel Deployment

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Add environment variables
vercel env add HELIUS_API_KEY
vercel env add DATABASE_URL
vercel env add WEBHOOK_SECRET
```

### Netlify Deployment

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod

# Add environment variables via Netlify UI
```

---

## Step 6: Set Up Background Jobs

### Leaderboard Cache Update (Every 5 minutes)

```typescript
// src/lib/cron/update-leaderboard.ts
import { CronJob } from 'cron';
import { updateLeaderboardCache } from '@/lib/leaderboard';

export const leaderboardUpdateJob = new CronJob(
  '*/5 * * * *', // Every 5 minutes
  async () => {
    console.log('Updating leaderboard cache...');
    await updateLeaderboardCache();
    console.log('Leaderboard cache updated');
  },
  null,
  true,
  'America/New_York'
);
```

### Using Vercel Cron

```typescript
// vercel.json
{
  "crons": [{
    "path": "/api/cron/update-leaderboard",
    "schedule": "*/5 * * * *"
  }]
}
```

---

## Step 7: Monitoring & Logging

### Sentry Integration

```bash
npm install @sentry/nextjs
```

```typescript
// sentry.client.config.ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});
```

### Logging

```typescript
// src/lib/logger.ts
import winston from 'winston';

export const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

---

## Step 8: Performance Optimization

### Caching Strategy

```typescript
// Implement Redis caching
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export async function getCachedLeaderboard(timeframe: string) {
  const cached = await redis.get(`leaderboard:${timeframe}`);

  if (cached) {
    return JSON.parse(cached);
  }

  const fresh = await fetchLeaderboard(timeframe);
  await redis.setex(`leaderboard:${timeframe}`, 60, JSON.stringify(fresh));

  return fresh;
}
```

### Database Indexing

```sql
-- Add these indexes for better performance
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_kol_profit ON trades(kol_wallet, profit_sol DESC);
CREATE INDEX idx_leaderboard_rank ON leaderboard_cache(timeframe, rank);
```

---

## Step 9: Security

### Rate Limiting

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, "10 s"),
});

export async function middleware(req: NextRequest) {
  const ip = req.ip ?? "127.0.0.1";
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }
}
```

### Webhook Verification

```typescript
function verifyWebhookSignature(
  signature: string,
  body: string,
  secret: string
): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(body).digest('hex');
  return signature === digest;
}
```

---

## Step 10: Testing Production

### Health Check Endpoint

```typescript
// src/app/api/health/route.ts
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    rpc: await checkRPC(),
    cache: await checkCache(),
  };

  const healthy = Object.values(checks).every(c => c === true);

  return Response.json({
    status: healthy ? 'healthy' : 'unhealthy',
    checks,
  }, {
    status: healthy ? 200 : 503
  });
}
```

---

## Estimated Costs

### Monthly Operating Costs

| Service | Tier | Cost |
|---------|------|------|
| Helius RPC | Free | $0 (100K requests/day) |
| Helius Pro | Paid | $49/month (unlimited) |
| Vercel | Hobby | $0 (non-commercial) |
| Vercel Pro | Commercial | $20/month |
| PostgreSQL | Supabase Free | $0 (500MB) |
| PostgreSQL | Supabase Pro | $25/month |
| Redis | Upstash Free | $0 (10K commands/day) |
| **Total** | **Startup** | **$0-25/month** |
| **Total** | **Production** | **$94/month** |

---

## Maintenance

### Daily Tasks
- Monitor error logs
- Check webhook delivery status
- Verify leaderboard accuracy

### Weekly Tasks
- Review database performance
- Optimize slow queries
- Update KOL wallet list

### Monthly Tasks
- Database backup
- Security updates
- Cost analysis

---

## Troubleshooting

### Webhooks Not Firing

1. Check webhook URL is publicly accessible
2. Verify SSL certificate
3. Check Helius dashboard for errors
4. Test webhook manually:

```bash
curl -X POST https://your-app.com/api/webhook/transactions \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Leaderboard Not Updating

1. Check cron job logs
2. Verify database connection
3. Check transaction processing
4. Manually trigger update:

```bash
curl https://your-app.com/api/cron/update-leaderboard
```

### High RPC Costs

1. Implement request caching
2. Batch RPC calls
3. Use websockets instead of polling
4. Consider switching to Helius free tier

---

## Support

For production issues:
- Check logs in Vercel/Netlify dashboard
- Monitor Sentry for errors
- Review Helius webhook logs
- Contact support@same.new

---

**Next Steps**: See `API_INTEGRATION.md` for detailed API documentation.
