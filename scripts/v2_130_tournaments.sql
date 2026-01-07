alter table if exists public.users add column if not exists total_winnings numeric not null default 0;
alter table if exists public.users add column if not exists total_tournaments_entered integer not null default 0;
alter table if exists public.users add column if not exists total_tournaments_won integer not null default 0;

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  tournament_type text not null check (tournament_type in ('pnl_race','pnl_percentage','consecutive_wins','roi_challenge','volume_race','pnl_absolute')),
  entry_fee numeric not null default 0,
  prize_pool numeric not null default 0,
  max_participants integer,
  current_participants integer not null default 0,
  target_value numeric,
  target_count integer,
  status text not null default 'upcoming' check (status in ('upcoming','active','completed','cancelled')),
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  duration text,
  rules jsonb,
  escrow_wallet_address text,
  winner_wallet_address text references public.users(wallet_address),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table if exists public.tournaments add column if not exists payout_signature text;
alter table if exists public.tournaments add column if not exists payout_nonce text;
alter table if exists public.tournaments add column if not exists payout_amount numeric;
alter table if exists public.tournaments add column if not exists payout_at timestamp with time zone;

alter table if exists public.tournaments add column if not exists payout_state text;
alter table if exists public.tournaments add column if not exists payout_processing_at timestamp with time zone;
alter table if exists public.tournaments add column if not exists payout_error text;

create index if not exists tournaments_payout_state_idx on public.tournaments(payout_state);

create unique index if not exists tournaments_payout_nonce_unique
  on public.tournaments(payout_nonce)
  where payout_nonce is not null;

alter table public.tournaments enable row level security;

drop policy if exists "Anyone can view tournaments" on public.tournaments;
create policy "Anyone can view tournaments"
  on public.tournaments for select
  using (true);

create index if not exists tournaments_status_idx on public.tournaments(status);
create index if not exists tournaments_start_date_idx on public.tournaments(start_date);
create index if not exists tournaments_type_idx on public.tournaments(tournament_type);
create index if not exists tournaments_entry_fee_idx on public.tournaments(entry_fee);
create index if not exists tournaments_escrow_wallet_idx on public.tournaments(escrow_wallet_address);

alter table if exists public.escrow_audit_log add column if not exists tournament_id uuid references public.tournaments(id) on delete set null;
create index if not exists escrow_audit_log_tournament_idx on public.escrow_audit_log(tournament_id);

drop trigger if exists update_tournaments_updated_at on public.tournaments;
create trigger update_tournaments_updated_at
  before update on public.tournaments
  for each row execute function public.update_updated_at_column();

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  wallet_address text not null references public.users(wallet_address) on delete cascade,
  entry_amount numeric not null,
  current_pnl numeric not null default 0,
  current_roi numeric not null default 0,
  current_volume numeric not null default 0,
  consecutive_wins integer not null default 0,
  rank integer,
  status text not null default 'active' check (status in ('active','eliminated','winner')),
  joined_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique(tournament_id, wallet_address)
);

alter table public.tournament_entries enable row level security;

drop policy if exists "Anyone can view tournament entries" on public.tournament_entries;
create policy "Anyone can view tournament entries"
  on public.tournament_entries for select
  using (true);

create index if not exists tournament_entries_tournament_idx on public.tournament_entries(tournament_id);
create index if not exists tournament_entries_wallet_idx on public.tournament_entries(wallet_address);
create index if not exists tournament_entries_rank_idx on public.tournament_entries(rank);

create unique index if not exists idx_one_active_tournament_per_wallet
  on public.tournament_entries(wallet_address)
  where status = 'active';

drop trigger if exists update_tournament_entries_updated_at on public.tournament_entries;
create trigger update_tournament_entries_updated_at
  before update on public.tournament_entries
  for each row execute function public.update_updated_at_column();

create table if not exists public.escrow (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  wallet_address text not null references public.users(wallet_address) on delete cascade,
  amount numeric not null,
  transaction_signature text unique not null,
  status text not null default 'pending' check (status in ('pending','confirmed','released','refunded')),
  created_at timestamp with time zone not null default now(),
  confirmed_at timestamp with time zone
);

alter table public.escrow enable row level security;

drop policy if exists "Anyone can view escrow" on public.escrow;
create policy "Anyone can view escrow"
  on public.escrow for select
  using (false);

create index if not exists escrow_tournament_idx on public.escrow(tournament_id);
create index if not exists escrow_wallet_idx on public.escrow(wallet_address);
create index if not exists escrow_status_idx on public.escrow(status);
create index if not exists escrow_tx_sig_idx on public.escrow(transaction_signature);

create or replace function public.increment_tournament_participants()
returns trigger as $$
begin
  update public.tournaments
  set current_participants = current_participants + 1,
      prize_pool = prize_pool + new.entry_amount
  where id = new.tournament_id;
  return new;
end;
$$ language plpgsql;

drop trigger if exists on_tournament_entry_created on public.tournament_entries;
create trigger on_tournament_entry_created
  after insert on public.tournament_entries
  for each row execute function public.increment_tournament_participants();

create table if not exists public.tracked_wallets (
  wallet_address text primary key,
  source text not null default 'tournament',
  tracked_until timestamp with time zone,
  is_active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.tracked_wallets enable row level security;

drop policy if exists "Anyone can view tracked_wallets" on public.tracked_wallets;
create policy "Anyone can view tracked_wallets"
  on public.tracked_wallets for select
  using (false);

create index if not exists tracked_wallets_is_active_idx on public.tracked_wallets(is_active);
create index if not exists tracked_wallets_tracked_until_idx on public.tracked_wallets(tracked_until);

drop trigger if exists update_tracked_wallets_updated_at on public.tracked_wallets;
create trigger update_tracked_wallets_updated_at
  before update on public.tracked_wallets
  for each row execute function public.update_updated_at_column();

create table if not exists public.tx_event_tracked_wallets (
  signature text not null references public.tx_events(signature) on delete cascade,
  wallet_address text not null references public.tracked_wallets(wallet_address) on delete cascade,
  primary key (signature, wallet_address)
);

alter table public.tx_event_tracked_wallets enable row level security;

drop policy if exists "Anyone can view tx_event_tracked_wallets" on public.tx_event_tracked_wallets;
create policy "Anyone can view tx_event_tracked_wallets"
  on public.tx_event_tracked_wallets for select
  using (false);

create index if not exists tx_event_tracked_wallets_wallet_idx on public.tx_event_tracked_wallets(wallet_address);
