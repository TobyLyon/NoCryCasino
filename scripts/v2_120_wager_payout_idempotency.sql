alter table if exists public.wager_orders add column if not exists payout_state text check (payout_state in ('processing','paid','failed'));
alter table if exists public.wager_orders add column if not exists payout_nonce text;
alter table if exists public.wager_orders add column if not exists payout_processing_at timestamp with time zone;
alter table if exists public.wager_orders add column if not exists payout_error text;

create unique index if not exists wager_orders_payout_nonce_uniq on public.wager_orders(payout_nonce) where payout_nonce is not null;
create index if not exists wager_orders_payout_state_idx on public.wager_orders(payout_state);
