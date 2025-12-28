create table if not exists public.kols (
  wallet_address text primary key,
  display_name text,
  avatar_url text,
  twitter_handle text,
  twitter_url text,
  telegram_url text,
  website_url text,
  is_active boolean not null default true,
  is_tracked boolean not null default false,
  tracked_rank integer,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

alter table public.kols add column if not exists is_tracked boolean not null default false;
alter table public.kols add column if not exists tracked_rank integer;

alter table public.kols enable row level security;

drop policy if exists "Anyone can view KOLs" on public.kols;

create policy "Anyone can view KOLs"
  on public.kols for select
  using (true);

create index if not exists kols_is_active_idx on public.kols(is_active);
create index if not exists kols_is_tracked_idx on public.kols(is_tracked);
create index if not exists kols_tracked_rank_idx on public.kols(tracked_rank);
create index if not exists kols_display_name_idx on public.kols(display_name);
create index if not exists kols_twitter_handle_idx on public.kols(twitter_handle);

drop trigger if exists update_kols_updated_at on public.kols;
create trigger update_kols_updated_at
  before update on public.kols
  for each row execute function public.update_updated_at_column();
