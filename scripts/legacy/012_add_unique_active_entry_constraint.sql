-- Prevent users from having multiple active tournament entries
-- This is a partial unique index that only applies to active entries

-- First, let's check if there are any duplicate active entries and handle them
-- (Keep the oldest entry, mark others as cancelled)
WITH duplicate_entries AS (
  SELECT 
    user_id,
    MIN(joined_at) as first_entry_time
  FROM tournament_entries
  WHERE status = 'active'
  GROUP BY user_id
  HAVING COUNT(*) > 1
)
UPDATE tournament_entries te
SET status = 'cancelled'
FROM duplicate_entries de
WHERE te.user_id = de.user_id 
  AND te.status = 'active'
  AND te.joined_at > de.first_entry_time;

-- Create a partial unique index to prevent future duplicates
-- This allows users to have multiple 'completed' entries but only ONE 'active' entry
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_tournament_per_user 
ON tournament_entries (user_id) 
WHERE status = 'active';

-- Add a comment explaining the constraint
COMMENT ON INDEX idx_one_active_tournament_per_user IS 
'Ensures each user can only have one active tournament entry at a time. Users can have multiple completed/cancelled entries.';
