create table if not exists public.kols (
  wallet_address text primary key,
  display_name text,
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.kols enable row level security;

create policy "Anyone can view KOLs"
  on public.kols for select
  using (true);

create index if not exists kols_is_active_idx on public.kols(is_active);
create index if not exists kols_display_name_idx on public.kols(display_name);
