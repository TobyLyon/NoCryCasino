do $$ begin
  create type public.pm_market_type as enum ('DAILY','WEEKLY','MONTHLY');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_round_status as enum ('OPEN','LOCKED','SETTLING','SETTLED','CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_outcome_status as enum ('ACTIVE','LOCKED','SETTLED','CANCELLED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_order_side as enum ('BUY','SELL');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_order_status as enum ('OPEN','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_order_tif as enum ('GTC','IOC');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_deposit_status as enum ('CONFIRMED','REJECTED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_withdrawal_status as enum ('REQUESTED','SENT','FAILED');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.pm_claim_status as enum ('CLAIMABLE','CLAIMED','REJECTED');
exception when duplicate_object then null;
end $$;

create table if not exists public.market_rounds (
  round_id text primary key,
  market_type public.pm_market_type not null,
  start_ts timestamp with time zone not null,
  lock_ts timestamp with time zone not null,
  settle_ts timestamp with time zone not null,
  status public.pm_round_status not null default 'OPEN',
  collateral_mint text not null,
  escrow_wallet_pubkey text not null,
  rake_bps integer not null default 0,
  inputs_hash text,
  snapshot_hash text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (rake_bps >= 0 and rake_bps <= 1000),
  check (start_ts < lock_ts),
  check (lock_ts <= settle_ts)
);

alter table public.market_rounds enable row level security;

drop policy if exists "Anyone can view market_rounds" on public.market_rounds;
create policy "Anyone can view market_rounds"
  on public.market_rounds for select
  using (true);

create index if not exists market_rounds_type_lock_idx on public.market_rounds(market_type, lock_ts);
create index if not exists market_rounds_status_idx on public.market_rounds(status);

create table if not exists public.outcome_markets (
  outcome_id uuid primary key default gen_random_uuid(),
  round_id text not null references public.market_rounds(round_id) on delete cascade,
  kol_wallet_address text not null references public.kols(wallet_address) on delete cascade,
  question_text text not null,
  status public.pm_outcome_status not null default 'ACTIVE',
  final_outcome boolean,
  created_at timestamp with time zone not null default now()
);

alter table public.outcome_markets enable row level security;

drop policy if exists "Anyone can view outcome_markets" on public.outcome_markets;
create policy "Anyone can view outcome_markets"
  on public.outcome_markets for select
  using (true);

create unique index if not exists outcome_markets_round_kol_uniq on public.outcome_markets(round_id, kol_wallet_address);
create index if not exists outcome_markets_round_idx on public.outcome_markets(round_id);
create index if not exists outcome_markets_status_idx on public.outcome_markets(status);

create table if not exists public.user_balances (
  user_pubkey text primary key references public.users(wallet_address) on delete cascade,
  available_collateral numeric not null default 0,
  reserved_collateral numeric not null default 0,
  updated_at timestamp with time zone not null default now(),
  check (available_collateral >= 0),
  check (reserved_collateral >= 0)
);

alter table public.user_balances enable row level security;

drop policy if exists "Users can view their own user_balances" on public.user_balances;
create policy "Users can view their own user_balances"
  on public.user_balances for select
  using (false);

create table if not exists public.positions (
  position_id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  outcome_id uuid not null references public.outcome_markets(outcome_id) on delete cascade,
  yes_shares numeric not null default 0,
  reserved_yes_shares numeric not null default 0,
  avg_cost numeric,
  updated_at timestamp with time zone not null default now(),
  check (yes_shares >= 0),
  check (reserved_yes_shares >= 0),
  check (yes_shares >= reserved_yes_shares)
);

alter table public.positions enable row level security;

drop policy if exists "Users can view their own positions" on public.positions;
create policy "Users can view their own positions"
  on public.positions for select
  using (false);

create unique index if not exists positions_user_outcome_uniq on public.positions(user_pubkey, outcome_id);
create index if not exists positions_outcome_idx on public.positions(outcome_id);

create table if not exists public.orders (
  order_id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references public.outcome_markets(outcome_id) on delete cascade,
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  side public.pm_order_side not null,
  price numeric not null,
  quantity numeric not null,
  filled_quantity numeric not null default 0,
  status public.pm_order_status not null default 'OPEN',
  tif public.pm_order_tif not null default 'GTC',
  idempotency_key text not null,
  reserved_collateral numeric not null default 0,
  created_at timestamp with time zone not null default now(),
  check (price > 0 and price < 1),
  check (quantity > 0),
  check (filled_quantity >= 0),
  check (filled_quantity <= quantity)
);

alter table public.orders enable row level security;

drop policy if exists "Users can view their own orders" on public.orders;
create policy "Users can view their own orders"
  on public.orders for select
  using (false);

create unique index if not exists orders_user_idempotency_uniq on public.orders(user_pubkey, idempotency_key);
create index if not exists orders_outcome_side_price_created_idx on public.orders(outcome_id, side, price, created_at);
create index if not exists orders_user_status_idx on public.orders(user_pubkey, status);

create table if not exists public.fills (
  fill_id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references public.outcome_markets(outcome_id) on delete cascade,
  taker_order_id uuid not null references public.orders(order_id) on delete restrict,
  maker_order_id uuid not null references public.orders(order_id) on delete restrict,
  price numeric not null,
  quantity numeric not null,
  fee_bps integer not null,
  fee_amount numeric not null,
  match_id text not null,
  created_at timestamp with time zone not null default now(),
  check (price > 0 and price < 1),
  check (quantity > 0),
  check (fee_bps >= 0 and fee_bps <= 1000),
  check (fee_amount >= 0)
);

alter table public.fills enable row level security;

drop policy if exists "Anyone can view fills" on public.fills;
create policy "Anyone can view fills"
  on public.fills for select
  using (true);

create unique index if not exists fills_match_id_uniq on public.fills(match_id);
create index if not exists fills_outcome_created_idx on public.fills(outcome_id, created_at);

do $$ begin
  if to_regclass('public.escrow_deposits') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'escrow_deposits'
        and column_name = 'transaction_signature'
    ) then
      alter table public.escrow_deposits rename to escrow_deposits_legacy;
    end if;
  end if;
exception when others then
  null;
end $$;

create table if not exists public.escrow_deposits (
  deposit_id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  round_scope text references public.market_rounds(round_id) on delete set null,
  amount numeric not null,
  mint text not null,
  tx_sig text unique not null,
  status public.pm_deposit_status not null default 'CONFIRMED',
  created_at timestamp with time zone not null default now(),
  check (amount > 0)
);

alter table public.escrow_deposits enable row level security;

drop policy if exists "Users can view their own escrow_deposits" on public.escrow_deposits;
create policy "Users can view their own escrow_deposits"
  on public.escrow_deposits for select
  using (false);

create index if not exists escrow_deposits_user_idx on public.escrow_deposits(user_pubkey);
create index if not exists escrow_deposits_round_scope_idx on public.escrow_deposits(round_scope);
create index if not exists escrow_deposits_created_idx on public.escrow_deposits(created_at);

create table if not exists public.escrow_withdrawals (
  withdrawal_id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  amount numeric not null,
  mint text not null,
  destination_pubkey text not null,
  tx_sig text unique,
  status public.pm_withdrawal_status not null default 'REQUESTED',
  created_at timestamp with time zone not null default now(),
  check (amount > 0)
);

alter table public.escrow_withdrawals enable row level security;

drop policy if exists "Users can view their own escrow_withdrawals" on public.escrow_withdrawals;
create policy "Users can view their own escrow_withdrawals"
  on public.escrow_withdrawals for select
  using (false);

create index if not exists escrow_withdrawals_user_idx on public.escrow_withdrawals(user_pubkey);
create index if not exists escrow_withdrawals_status_idx on public.escrow_withdrawals(status);

create table if not exists public.settlement_claims (
  claim_id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  outcome_id uuid not null references public.outcome_markets(outcome_id) on delete cascade,
  round_id text not null references public.market_rounds(round_id) on delete cascade,
  yes_shares numeric not null,
  final_outcome boolean not null,
  claimable_amount numeric not null,
  status public.pm_claim_status not null default 'CLAIMABLE',
  claimed_at timestamp with time zone,
  idempotency_key text,
  created_at timestamp with time zone not null default now(),
  check (claimable_amount >= 0)
);

alter table public.settlement_claims enable row level security;

drop policy if exists "Users can view their own settlement_claims" on public.settlement_claims;
create policy "Users can view their own settlement_claims"
  on public.settlement_claims for select
  using (false);

create unique index if not exists settlement_claims_user_outcome_round_uniq on public.settlement_claims(user_pubkey, outcome_id, round_id);
create index if not exists settlement_claims_status_idx on public.settlement_claims(status);

create table if not exists public.ledger_entries (
  entry_id uuid primary key default gen_random_uuid(),
  event_key text not null,
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  outcome_id uuid references public.outcome_markets(outcome_id) on delete set null,
  delta_available numeric not null default 0,
  delta_reserved numeric not null default 0,
  delta_yes_shares numeric not null default 0,
  ref_type text not null,
  ref_id text not null,
  created_at timestamp with time zone not null default now()
);

alter table public.ledger_entries enable row level security;

drop policy if exists "Users can view their own ledger_entries" on public.ledger_entries;
create policy "Users can view their own ledger_entries"
  on public.ledger_entries for select
  using (false);

create unique index if not exists ledger_entries_event_key_uniq on public.ledger_entries(event_key);
create index if not exists ledger_entries_user_created_idx on public.ledger_entries(user_pubkey, created_at);
create index if not exists ledger_entries_outcome_created_idx on public.ledger_entries(outcome_id, created_at);

drop trigger if exists update_market_rounds_updated_at on public.market_rounds;
create trigger update_market_rounds_updated_at
  before update on public.market_rounds
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_user_balances_updated_at on public.user_balances;
create trigger update_user_balances_updated_at
  before update on public.user_balances
  for each row execute function public.update_updated_at_column();

drop trigger if exists update_positions_updated_at on public.positions;
create trigger update_positions_updated_at
  before update on public.positions
  for each row execute function public.update_updated_at_column();
