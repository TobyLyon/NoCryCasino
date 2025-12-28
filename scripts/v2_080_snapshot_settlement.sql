-- Migration: Snapshot locking + idempotent settlement
-- Addresses audit items 8.2 and 8.8

-- Add snapshot and settlement integrity columns to wager_markets
alter table if exists public.wager_markets add column if not exists snapshot_at timestamp with time zone;
alter table if exists public.wager_markets add column if not exists snapshot_hash text;
alter table if exists public.wager_markets add column if not exists settlement_hash text;
alter table if exists public.wager_markets add column if not exists settlement_nonce text;

create unique index if not exists wager_markets_settlement_nonce_uniq 
  on public.wager_markets(settlement_nonce) 
  where settlement_nonce is not null;

create index if not exists wager_markets_snapshot_at_idx on public.wager_markets(snapshot_at);

-- Create leaderboard_snapshots table for frozen rankings
create table if not exists public.leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  window_key text not null check (window_key in ('daily','weekly','monthly')),
  closes_at timestamp with time zone not null,
  snapshot_at timestamp with time zone not null default now(),
  snapshot_hash text not null,
  rankings jsonb not null, -- [{wallet_address, rank, profit_sol, profit_usd, wins, losses, tx_count}]
  created_at timestamp with time zone not null default now()
);

alter table public.leaderboard_snapshots enable row level security;

create policy "Anyone can view leaderboard_snapshots"
  on public.leaderboard_snapshots for select
  using (true);

create unique index if not exists leaderboard_snapshots_window_close_uniq 
  on public.leaderboard_snapshots(window_key, closes_at);

create index if not exists leaderboard_snapshots_closes_at_idx on public.leaderboard_snapshots(closes_at);
