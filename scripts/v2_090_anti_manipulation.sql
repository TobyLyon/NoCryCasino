-- Migration: Anti-manipulation tracking
-- Addresses audit item 8.5

-- Add anti-manipulation columns to kols table
alter table if exists public.kols add column if not exists wallet_created_at timestamp with time zone;
alter table if exists public.kols add column if not exists min_wallet_age_days integer default 7;
alter table if exists public.kols add column if not exists is_verified boolean not null default false;

-- Create tx_event_analysis table for wash trading detection
create table if not exists public.tx_event_analysis (
  id uuid primary key default gen_random_uuid(),
  signature text not null references public.tx_events(signature) on delete cascade,
  wallet_address text not null,
  counterparty_address text,
  is_self_transfer boolean not null default false,
  is_wash_trade_suspect boolean not null default false,
  volume_sol numeric,
  created_at timestamp with time zone not null default now()
);

alter table public.tx_event_analysis enable row level security;

create policy "Anyone can view tx_event_analysis"
  on public.tx_event_analysis for select
  using (true);

create unique index if not exists tx_event_analysis_sig_wallet_uniq 
  on public.tx_event_analysis(signature, wallet_address);

create index if not exists tx_event_analysis_wallet_idx on public.tx_event_analysis(wallet_address);
create index if not exists tx_event_analysis_counterparty_idx on public.tx_event_analysis(counterparty_address);
create index if not exists tx_event_analysis_wash_trade_idx on public.tx_event_analysis(is_wash_trade_suspect);

-- Create kol_stats_daily table for volume tracking
create table if not exists public.kol_stats_daily (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  date date not null,
  tx_count integer not null default 0,
  volume_sol numeric not null default 0,
  unique_counterparties integer not null default 0,
  self_transfer_count integer not null default 0,
  wash_trade_suspect_count integer not null default 0,
  net_profit_sol numeric not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.kol_stats_daily enable row level security;

create policy "Anyone can view kol_stats_daily"
  on public.kol_stats_daily for select
  using (true);

create unique index if not exists kol_stats_daily_wallet_date_uniq 
  on public.kol_stats_daily(wallet_address, date);

create index if not exists kol_stats_daily_date_idx on public.kol_stats_daily(date);
create index if not exists kol_stats_daily_volume_idx on public.kol_stats_daily(volume_sol);

-- Add minimum volume threshold config
create table if not exists public.system_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamp with time zone not null default now()
);

alter table public.system_config enable row level security;

create policy "Anyone can view system_config"
  on public.system_config for select
  using (true);

-- Insert default anti-manipulation thresholds
insert into public.system_config (key, value) values 
  ('anti_manipulation', '{
    "min_wallet_age_days": 7,
    "min_volume_sol": 0.1,
    "min_unique_counterparties": 3,
    "max_self_transfer_ratio": 0.1,
    "max_wash_trade_ratio": 0.2
  }'::jsonb)
on conflict (key) do nothing;
