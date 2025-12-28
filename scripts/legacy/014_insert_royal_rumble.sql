-- Insert Royal Rumble tournament
INSERT INTO tournaments (
  title,
  description,
  tournament_type,
  entry_fee,
  prize_pool,
  max_participants,
  current_participants,
  target_value,
  target_count,
  start_date,
  end_date,
  status
) VALUES (
  'Royal Rumble',
  'Battle it out with 50 traders - first to reach 30 SOL profit wins the entire prize pool',
  'pnl_absolute',
  1.0,
  0,
  50,
  0,
  30,
  NULL,
  NOW(),
  NOW() + INTERVAL '30 days',
  'active'
);
