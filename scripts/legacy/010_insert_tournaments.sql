-- Insert sample tournaments for each entry fee tier
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
) VALUES
-- 0.05 SOL Tournaments
(
  'Micro Stakes P&L Challenge',
  'First to achieve 20% ROI wins the pot',
  'pnl_percentage',
  0.05,
  0,
  50,
  0,
  20,
  NULL,
  NOW(),
  NOW() + INTERVAL '7 days',
  'active'
),
(
  'Micro Streak Master',
  'Hit 5 consecutive profitable trades',
  'consecutive_wins',
  0.05,
  0,
  30,
  0,
  NULL,
  5,
  NOW(),
  NOW() + INTERVAL '5 days',
  'active'
),

-- 0.1 SOL Tournaments
(
  'Low Stakes Trading War',
  'First to 30% ROI takes all',
  'pnl_percentage',
  0.1,
  0,
  40,
  0,
  30,
  NULL,
  NOW(),
  NOW() + INTERVAL '7 days',
  'active'
),
(
  'Quick Win Challenge',
  'Complete 3 winning trades in a row',
  'consecutive_wins',
  0.1,
  0,
  25,
  0,
  NULL,
  3,
  NOW(),
  NOW() + INTERVAL '3 days',
  'active'
),

-- 0.2 SOL Tournaments
(
  'Medium Stakes Battle',
  'Reach 40% ROI to claim victory',
  'pnl_percentage',
  0.2,
  0,
  30,
  0,
  40,
  NULL,
  NOW(),
  NOW() + INTERVAL '10 days',
  'active'
),
(
  'Momentum Trader',
  'Achieve 7 consecutive wins',
  'consecutive_wins',
  0.2,
  0,
  20,
  0,
  NULL,
  7,
  NOW(),
  NOW() + INTERVAL '7 days',
  'active'
),

-- 0.5 SOL Tournaments
(
  'High Stakes Championship',
  'First to 50% ROI wins the prize pool',
  'pnl_percentage',
  0.5,
  0,
  20,
  0,
  50,
  NULL,
  NOW(),
  NOW() + INTERVAL '14 days',
  'active'
),
(
  'Elite Consistency Test',
  'Hit 10 profitable trades in a row',
  'consecutive_wins',
  0.5,
  0,
  15,
  0,
  NULL,
  10,
  NOW(),
  NOW() + INTERVAL '10 days',
  'active'
),

-- 1 SOL Tournaments
(
  'Ultimate Trading Arena',
  'Achieve 75% ROI to dominate',
  'pnl_percentage',
  1.0,
  0,
  15,
  0,
  75,
  NULL,
  NOW(),
  NOW() + INTERVAL '21 days',
  'active'
),
(
  'Legendary Streak',
  'Complete 15 consecutive winning trades',
  'consecutive_wins',
  1.0,
  0,
  10,
  0,
  NULL,
  15,
  NOW(),
  NOW() + INTERVAL '14 days',
  'active'
);
