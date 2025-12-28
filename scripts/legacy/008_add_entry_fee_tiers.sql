-- Add entry fee tier enum and update tournaments table
-- Standard entry fee tiers: 0.05, 0.1, 0.2, 0.5, 1 SOL

-- Add check constraint for entry fee tiers
alter table public.tournaments 
  drop constraint if exists tournaments_entry_fee_check;

alter table public.tournaments
  add constraint tournaments_entry_fee_check 
  check (entry_fee in (0.05, 0.1, 0.2, 0.5, 1.0));

-- Create index on entry_fee for filtering
create index if not exists tournaments_entry_fee_idx on public.tournaments(entry_fee);

-- Insert sample tournaments for each tier
insert into public.tournaments (title, description, tournament_type, entry_fee, prize_pool, max_participants, target_value, status, start_date, end_date)
values
  -- 0.05 SOL Tier (Micro Stakes)
  ('Micro Grinder', 'Perfect for beginners - reach +50% P&L to win', 'pnl_race', 0.05, 0.5, 20, 50, 'active', now(), now() + interval '24 hours'),
  ('Quick Flip Challenge', 'Fast-paced 12h tournament for micro stakes', 'pnl_race', 0.05, 0.4, 15, 30, 'upcoming', now() + interval '2 hours', now() + interval '14 hours'),
  
  -- 0.1 SOL Tier (Low Stakes)
  ('Starter Tournament', 'Low risk, high reward - first to +100% wins', 'pnl_race', 0.1, 1.5, 20, 100, 'active', now(), now() + interval '48 hours'),
  ('5x Streak Master', 'Hit 5 consecutive 5x plays to win', 'consecutive_wins', 0.1, 1.2, 15, 5, 'active', now(), now() + interval '72 hours'),
  
  -- 0.2 SOL Tier (Medium Stakes)
  ('Weekend Warrior', 'Compete all weekend for the prize pool', 'pnl_race', 0.2, 3.0, 20, 150, 'active', now(), now() + interval '72 hours'),
  ('ROI Challenge', 'Best ROI percentage wins - 48h tournament', 'roi_challenge', 0.2, 2.5, 15, 200, 'upcoming', now() + interval '6 hours', now() + interval '54 hours'),
  
  -- 0.5 SOL Tier (High Stakes)
  ('High Roller Sprint', 'Big stakes, bigger rewards - 24h race', 'pnl_race', 0.5, 7.5, 20, 200, 'active', now(), now() + interval '24 hours'),
  ('Volume King', 'Highest trading volume wins the pot', 'volume_race', 0.5, 6.0, 12, 100000, 'upcoming', now() + interval '12 hours', now() + interval '60 hours'),
  
  -- 1 SOL Tier (Elite Stakes)
  ('Elite Championship', 'Top traders only - first to +300% P&L', 'pnl_race', 1.0, 15.0, 20, 300, 'active', now(), now() + interval '7 days'),
  ('Whale Wars', 'The ultimate trading showdown', 'pnl_race', 1.0, 12.0, 15, 250, 'upcoming', now() + interval '1 day', now() + interval '8 days'),
  ('Consecutive Wins Pro', 'Hit 10 consecutive 3x plays', 'consecutive_wins', 1.0, 10.0, 10, 10, 'upcoming', now() + interval '2 days', now() + interval '9 days');
