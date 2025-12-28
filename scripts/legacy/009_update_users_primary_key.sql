-- Update users table to use wallet_address as primary key
-- Drop existing foreign key constraints first
alter table if exists public.tournament_entries drop constraint if exists tournament_entries_user_id_fkey;
alter table if exists public.user_missions drop constraint if exists user_missions_user_id_fkey;
alter table if exists public.escrow drop constraint if exists escrow_user_id_fkey;

-- Drop the old id column and make wallet_address the primary key
alter table public.users drop constraint if exists users_pkey;
alter table public.users drop column if exists id;
alter table public.users add primary key (wallet_address);

-- Update tournament_entries to use wallet_address instead of user_id
alter table public.tournament_entries drop column if exists user_id;
alter table public.tournament_entries add column wallet_address text not null references public.users(wallet_address) on delete cascade;
alter table public.tournament_entries drop constraint if exists tournament_entries_tournament_id_user_id_key;
alter table public.tournament_entries add constraint tournament_entries_tournament_wallet_unique unique(tournament_id, wallet_address);

-- Update user_missions to use wallet_address
alter table public.user_missions drop column if exists user_id;
alter table public.user_missions add column wallet_address text not null references public.users(wallet_address) on delete cascade;
alter table public.user_missions drop constraint if exists user_missions_user_id_mission_id_key;
alter table public.user_missions add constraint user_missions_wallet_mission_unique unique(wallet_address, mission_id);

-- Update escrow to use wallet_address
alter table public.escrow drop column if exists user_id;
alter table public.escrow add column wallet_address text not null references public.users(wallet_address) on delete cascade;

-- Recreate indexes
drop index if exists tournament_entries_user_idx;
create index tournament_entries_wallet_idx on public.tournament_entries(wallet_address);

drop index if exists user_missions_user_idx;
create index user_missions_wallet_idx on public.user_missions(wallet_address);

drop index if exists escrow_user_idx;
create index escrow_wallet_idx on public.escrow(wallet_address);

-- Update RLS policies
drop policy if exists "Users can create their own entries" on public.tournament_entries;
create policy "Users can create their own entries"
  on public.tournament_entries for insert
  with check (true);

drop policy if exists "Users can update their own entries" on public.tournament_entries;
create policy "Users can update their own entries"
  on public.tournament_entries for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

drop policy if exists "Users can view their own missions" on public.user_missions;
create policy "Users can view their own missions"
  on public.user_missions for select
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

drop policy if exists "Users can update their own missions" on public.user_missions;
create policy "Users can update their own missions"
  on public.user_missions for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

drop policy if exists "Users can view their own escrow" on public.escrow;
create policy "Users can view their own escrow"
  on public.escrow for select
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

drop policy if exists "Users can create their own escrow" on public.escrow;
create policy "Users can create their own escrow"
  on public.escrow for insert
  with check (true);
