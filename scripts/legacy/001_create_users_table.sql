-- Create users table to store wallet addresses and user info
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique not null,
  username text,
  total_winnings numeric default 0,
  total_tournaments_entered integer default 0,
  total_tournaments_won integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table public.users enable row level security;

-- RLS Policies for users table
create policy "Users can view all profiles"
  on public.users for select
  using (true);

create policy "Users can insert their own profile"
  on public.users for insert
  with check (true);

create policy "Users can update their own profile"
  on public.users for update
  using (wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address');

-- Create index on wallet_address for faster lookups
create index if not exists users_wallet_address_idx on public.users(wallet_address);
