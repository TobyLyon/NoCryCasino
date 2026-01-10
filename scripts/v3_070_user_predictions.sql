-- User-submitted predictions table
create table if not exists public.user_predictions (
  prediction_id uuid primary key default gen_random_uuid(),
  creator_wallet text not null references public.users(wallet_address) on delete cascade,
  question text not null,
  category text not null default 'crypto',
  end_date timestamp with time zone not null,
  status text not null default 'pending', -- pending, approved, rejected, resolved_yes, resolved_no
  resolution_notes text,
  approved_by text,
  approved_at timestamp with time zone,
  resolved_at timestamp with time zone,
  total_volume numeric not null default 0,
  yes_pool numeric not null default 0,
  no_pool numeric not null default 0,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  check (end_date > created_at)
);

alter table public.user_predictions enable row level security;

drop policy if exists "Anyone can view approved user_predictions" on public.user_predictions;
create policy "Anyone can view approved user_predictions"
  on public.user_predictions for select
  using (status != 'rejected');

create index if not exists user_predictions_creator_idx on public.user_predictions(creator_wallet);
create index if not exists user_predictions_status_idx on public.user_predictions(status);
create index if not exists user_predictions_category_idx on public.user_predictions(category);
create index if not exists user_predictions_end_date_idx on public.user_predictions(end_date);

drop trigger if exists update_user_predictions_updated_at on public.user_predictions;
create trigger update_user_predictions_updated_at
  before update on public.user_predictions
  for each row execute function public.update_updated_at_column();

-- User prediction bets table
create table if not exists public.prediction_bets (
  bet_id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references public.user_predictions(prediction_id) on delete cascade,
  bettor_wallet text not null references public.users(wallet_address) on delete cascade,
  side text not null check (side in ('yes', 'no')),
  amount numeric not null check (amount > 0),
  potential_payout numeric,
  status text not null default 'active', -- active, won, lost, refunded
  tx_sig text,
  created_at timestamp with time zone not null default now()
);

alter table public.prediction_bets enable row level security;

drop policy if exists "Anyone can view prediction_bets" on public.prediction_bets;
create policy "Anyone can view prediction_bets"
  on public.prediction_bets for select
  using (true);

create index if not exists prediction_bets_prediction_idx on public.prediction_bets(prediction_id);
create index if not exists prediction_bets_bettor_idx on public.prediction_bets(bettor_wallet);
create index if not exists prediction_bets_status_idx on public.prediction_bets(status);
