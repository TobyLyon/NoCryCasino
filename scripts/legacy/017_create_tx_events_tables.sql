create table if not exists public.tx_events (
  signature text primary key,
  block_time timestamp with time zone,
  slot bigint,
  source text not null default 'helius',
  raw jsonb not null,
  created_at timestamp with time zone default now()
);

alter table public.tx_events enable row level security;

create policy "Anyone can view tx events"
  on public.tx_events for select
  using (true);

create table if not exists public.tx_event_wallets (
  signature text not null references public.tx_events(signature) on delete cascade,
  wallet_address text not null references public.kols(wallet_address) on delete cascade,
  primary key (signature, wallet_address)
);

alter table public.tx_event_wallets enable row level security;

create policy "Anyone can view tx event wallets"
  on public.tx_event_wallets for select
  using (true);

create index if not exists tx_events_block_time_idx on public.tx_events(block_time);
create index if not exists tx_event_wallets_wallet_idx on public.tx_event_wallets(wallet_address);
