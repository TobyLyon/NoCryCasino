-- Create user missions progress table
create table if not exists public.user_missions (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.missions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  progress numeric default 0,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed', 'failed')),
  started_at timestamp with time zone default now(),
  completed_at timestamp with time zone,
  unique(mission_id, user_id)
);

-- Enable RLS
alter table public.user_missions enable row level security;

-- RLS Policies
create policy "Users can view their own mission progress"
  on public.user_missions for select
  using (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

create policy "Users can create their own mission progress"
  on public.user_missions for insert
  with check (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

create policy "Users can update their own mission progress"
  on public.user_missions for update
  using (user_id = (select id from public.users where wallet_address = current_setting('request.jwt.claims', true)::json->>'wallet_address'));

-- Create indexes
create index if not exists user_missions_user_idx on public.user_missions(user_id);
create index if not exists user_missions_mission_idx on public.user_missions(mission_id);
create index if not exists user_missions_status_idx on public.user_missions(status);
