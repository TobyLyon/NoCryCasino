-- Create missions/quests table
create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  mission_type text not null check (mission_type in ('consecutive_wins', 'profit_target', 'volume_target', 'win_rate', 'daily_streak')),
  reward_amount numeric not null default 0,
  target_value numeric not null, -- Target to hit (e.g., 5 for 5 consecutive wins)
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  time_limit_hours integer, -- Optional time limit in hours
  max_completions integer, -- Max number of users who can complete this mission
  current_completions integer default 0,
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone
);

-- Enable RLS
alter table public.missions enable row level security;

-- RLS Policies
create policy "Anyone can view active missions"
  on public.missions for select
  using (true);

create policy "Admins can create missions"
  on public.missions for insert
  with check (true);

-- Create indexes
create index if not exists missions_status_idx on public.missions(status);
create index if not exists missions_difficulty_idx on public.missions(difficulty);
