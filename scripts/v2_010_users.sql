create table if not exists public.users (
  wallet_address text primary key,
  username text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.users enable row level security;

create policy "Anyone can view users"
  on public.users for select
  using (true);

create index if not exists users_wallet_address_idx on public.users(wallet_address);

drop trigger if exists update_users_updated_at on public.users;
create trigger update_users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at_column();
