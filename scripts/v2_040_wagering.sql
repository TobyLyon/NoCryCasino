create table if not exists public.wager_markets (
  id uuid primary key default gen_random_uuid(),
  window_key text not null check (window_key in ('daily','weekly','monthly')),
  kol_wallet_address text not null references public.kols(wallet_address) on delete cascade,
  closes_at timestamp with time zone not null,
  status text not null default 'open' check (status in ('open','closed','settled','cancelled')),
  created_at timestamp with time zone not null default now()
);

alter table public.wager_markets enable row level security;
create policy "Anyone can view wager markets"
  on public.wager_markets for select
  using (true);

create unique index if not exists wager_markets_unique_window_kol_close
  on public.wager_markets(window_key, kol_wallet_address, closes_at);

create table if not exists public.wager_orders (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.wager_markets(id) on delete cascade,
  wallet_address text not null references public.users(wallet_address) on delete cascade,
  outcome text not null check (outcome in ('yes','no')),
  side text not null check (side in ('buy','sell')),
  price numeric not null check (price >= 0 and price <= 1),
  quantity numeric not null check (quantity > 0),
  filled_quantity numeric not null default 0,
  status text not null default 'open' check (status in ('open','partially_filled','filled','cancelled')),
  client_order_id text,
  created_at timestamp with time zone not null default now()
);

alter table public.wager_orders enable row level security;
create policy "Users can view their own orders"
  on public.wager_orders for select
  using (true);

create index if not exists wager_orders_market_idx on public.wager_orders(market_id);
create index if not exists wager_orders_wallet_idx on public.wager_orders(wallet_address);
create index if not exists wager_orders_status_idx on public.wager_orders(status);

create table if not exists public.wager_fills (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.wager_markets(id) on delete cascade,
  buy_order_id uuid not null references public.wager_orders(id) on delete restrict,
  sell_order_id uuid not null references public.wager_orders(id) on delete restrict,
  outcome text not null check (outcome in ('yes','no')),
  price numeric not null check (price >= 0 and price <= 1),
  quantity numeric not null check (quantity > 0),
  fee_bps integer not null,
  fee_amount numeric not null,
  created_at timestamp with time zone not null default now()
);

alter table public.wager_fills enable row level security;
create policy "Users can view wager fills"
  on public.wager_fills for select
  using (true);

create index if not exists wager_fills_market_idx on public.wager_fills(market_id);

create table if not exists public.escrow_deposits (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null references public.users(wallet_address) on delete cascade,
  amount numeric not null check (amount > 0),
  transaction_signature text unique not null,
  status text not null default 'pending' check (status in ('pending','confirmed','credited','rejected')),
  created_at timestamp with time zone not null default now(),
  confirmed_at timestamp with time zone
);

alter table public.escrow_deposits enable row level security;
create policy "Users can view their own escrow deposits"
  on public.escrow_deposits for select
  using (true);

create index if not exists escrow_deposits_wallet_idx on public.escrow_deposits(wallet_address);
create index if not exists escrow_deposits_status_idx on public.escrow_deposits(status);
