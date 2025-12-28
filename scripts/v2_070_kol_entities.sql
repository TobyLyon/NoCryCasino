-- Migration: Multi-wallet KOL entities + wallet versioning
-- Addresses audit items 8.3 and 8.4

-- Create kol_entities table (the "identity" of a KOL, separate from wallets)
create table if not exists public.kol_entities (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  avatar_url text,
  twitter_handle text,
  twitter_url text,
  telegram_url text,
  website_url text,
  is_active boolean not null default true,
  is_tracked boolean not null default false,
  tracked_rank integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.kol_entities enable row level security;

create policy "Anyone can view kol_entities"
  on public.kol_entities for select
  using (true);

create index if not exists kol_entities_is_tracked_idx on public.kol_entities(is_tracked);
create index if not exists kol_entities_tracked_rank_idx on public.kol_entities(tracked_rank);

-- Create kol_wallets join table (links wallets to KOL entities with versioning)
create table if not exists public.kol_wallets (
  id uuid primary key default gen_random_uuid(),
  kol_entity_id uuid not null references public.kol_entities(id) on delete cascade,
  wallet_address text not null,
  is_primary boolean not null default false,
  tracked_from timestamp with time zone not null default now(),
  tracked_until timestamp with time zone, -- null = still active
  created_at timestamp with time zone not null default now()
);

alter table public.kol_wallets enable row level security;

create policy "Anyone can view kol_wallets"
  on public.kol_wallets for select
  using (true);

create unique index if not exists kol_wallets_address_active_uniq 
  on public.kol_wallets(wallet_address) 
  where tracked_until is null;

create index if not exists kol_wallets_entity_idx on public.kol_wallets(kol_entity_id);
create index if not exists kol_wallets_address_idx on public.kol_wallets(wallet_address);
create index if not exists kol_wallets_tracked_from_idx on public.kol_wallets(tracked_from);
create index if not exists kol_wallets_tracked_until_idx on public.kol_wallets(tracked_until);

-- Add wallet versioning columns to existing kols table for backward compatibility
alter table if exists public.kols add column if not exists tracked_from timestamp with time zone default now();
alter table if exists public.kols add column if not exists tracked_until timestamp with time zone;
alter table if exists public.kols add column if not exists kol_entity_id uuid references public.kol_entities(id) on delete set null;

create index if not exists kols_tracked_from_idx on public.kols(tracked_from);
create index if not exists kols_tracked_until_idx on public.kols(tracked_until);
create index if not exists kols_entity_id_idx on public.kols(kol_entity_id);
