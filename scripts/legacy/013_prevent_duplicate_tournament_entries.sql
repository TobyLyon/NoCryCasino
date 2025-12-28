-- Prevent the same user from entering the same tournament multiple times
-- This ensures one entry per user per tournament

-- Add unique constraint: user can only have one entry per tournament
ALTER TABLE tournament_entries 
ADD CONSTRAINT unique_user_tournament_entry 
UNIQUE (user_id, tournament_id);
