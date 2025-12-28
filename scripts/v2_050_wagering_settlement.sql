alter table if exists public.wager_markets add column if not exists settled_at timestamp with time zone;
alter table if exists public.wager_markets add column if not exists resolved_outcome text check (resolved_outcome in ('yes','no'));
alter table if exists public.wager_markets add column if not exists resolved_rank integer;
alter table if exists public.wager_markets add column if not exists resolved_profit_sol numeric;
alter table if exists public.wager_markets add column if not exists resolved_profit_usd numeric;

create index if not exists wager_markets_closes_at_idx on public.wager_markets(closes_at);
create index if not exists wager_markets_status_idx on public.wager_markets(status);
