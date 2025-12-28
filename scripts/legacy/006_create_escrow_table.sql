-- Create escrow table to track SOL deposits
create table if not exists public.escrow (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references public.tournaments(id) on delete cascade,
  mission_id uuid references public.missions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  amount numeric not null,
  transaction_signature text unique not null, -- Solana transaction signature
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'released', 'refunded')),
  created_at timestamp with time zone default now(),
  released_at timestamp with time zone,
  check ((tournament_id is not null and mission_id is null) or (tournament_id is null and mission_id is not null))
);

-- Enable RLS
alter table public.escrow enable row level security;

-- RLS Policies
create policy "Users can view their own escrow"
  on public.escrow for select
  using (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

create policy "Users can create their own escrow"
  on public.escrow for insert
  with check (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- Create indexes
create index if not exists escrow_user_idx on public.escrow(user_id);
create index if not exists escrow_tournament_idx on public.escrow(tournament_id);
create index if not exists escrow_mission_idx on public.escrow(mission_id);
create index if not exists escrow_status_idx on public.escrow(status);
create index if not exists escrow_tx_sig_idx on public.escrow(transaction_signature);
