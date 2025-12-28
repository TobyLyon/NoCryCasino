alter table if exists public.wager_markets add column if not exists escrow_wallet_address text;
create index if not exists wager_markets_escrow_wallet_idx on public.wager_markets(escrow_wallet_address);

alter table if exists public.wager_orders add column if not exists deposit_signature text;
alter table if exists public.wager_orders add column if not exists deposit_amount_sol numeric;
alter table if exists public.wager_orders add column if not exists deposit_confirmed_at timestamp with time zone;
alter table if exists public.wager_orders add column if not exists payout_signature text;
alter table if exists public.wager_orders add column if not exists payout_amount_sol numeric;
alter table if exists public.wager_orders add column if not exists payout_sent_at timestamp with time zone;

create unique index if not exists wager_orders_deposit_signature_uniq on public.wager_orders(deposit_signature);
create unique index if not exists wager_orders_payout_signature_uniq on public.wager_orders(payout_signature);
