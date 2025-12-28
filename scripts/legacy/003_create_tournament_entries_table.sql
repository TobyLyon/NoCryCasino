-- Create tournament entries table to track who joined which tournament
create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  entry_amount numeric not null,
  current_pnl numeric default 0,
  current_roi numeric default 0,
  current_volume numeric default 0,
  consecutive_wins integer default 0,
  rank integer,
  status text not null default 'active' check (status in ('active', 'eliminated', 'winner')),
  joined_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  unique(tournament_id, user_id)
);

-- Enable RLS
alter table public.tournament_entries enable row level security;

-- RLS Policies
create policy "Anyone can view tournament entries"
  on public.tournament_entries for select
  using (true);

create policy "Users can create their own entries"
  on public.tournament_entries for insert
  with check (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

create policy "Users can update their own entries"
  on public.tournament_entries for update
  using (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- Create indexes
create index if not exists tournament_entries_tournament_idx on public.tournament_entries(tournament_id);
create index if not exists tournament_entries_user_idx on public.tournament_entries(user_id);
create index if not exists tournament_entries_rank_idx on public.tournament_entries(rank);
