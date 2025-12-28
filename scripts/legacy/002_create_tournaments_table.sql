-- Create tournaments table
create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  tournament_type text not null check (tournament_type in ('pnl_race', 'consecutive_wins', 'roi_challenge', 'volume_race')),
  entry_fee numeric not null default 0,
  prize_pool numeric not null default 0,
  max_participants integer,
  current_participants integer default 0,
  target_value numeric, -- Target P&L, ROI percentage, or volume
  target_count integer, -- For consecutive wins (e.g., 5 consecutive 5x plays)
  status text not null default 'upcoming' check (status in ('upcoming', 'active', 'completed', 'cancelled')),
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  winner_id uuid references public.users(id),
  created_by uuid references public.users(id),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.tournaments enable row level security;

-- RLS Policies for tournaments
create policy "Anyone can view tournaments"
  on public.tournaments for select
  using (true);

create policy "Authenticated users can create tournaments"
  on public.tournaments for insert
  with check (true);

create policy "Tournament creators can update their tournaments"
  on public.tournaments for update
  using (created_by = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- Create indexes
create index if not exists tournaments_status_idx on public.tournaments(status);
create index if not exists tournaments_start_date_idx on public.tournaments(start_date);
create index if not exists tournaments_type_idx on public.tournaments(tournament_type);
