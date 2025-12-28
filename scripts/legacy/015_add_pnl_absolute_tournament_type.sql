-- Add 'pnl_absolute' to the tournament_type check constraint
ALTER TABLE public.tournaments 
DROP CONSTRAINT IF EXISTS tournaments_tournament_type_check;

ALTER TABLE public.tournaments 
ADD CONSTRAINT tournaments_tournament_type_check 
CHECK (tournament_type IN ('pnl_race', 'consecutive_wins', 'roi_challenge', 'volume_race', 'pnl_absolute'));
