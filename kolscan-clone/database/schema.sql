-- Kolscan Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- KOLs table
CREATE TABLE IF NOT EXISTS kols (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    wallet_address VARCHAR(44) UNIQUE NOT NULL,
    avatar_url TEXT,
    twitter_handle VARCHAR(100),
    telegram_handle VARCHAR(100),
    bio TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kol_id UUID REFERENCES kols(id) ON DELETE CASCADE,
    transaction_signature VARCHAR(88) UNIQUE NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    block_number BIGINT,

    -- Token information
    input_token VARCHAR(44),
    output_token VARCHAR(44),
    input_amount DECIMAL(30, 9),
    output_amount DECIMAL(30, 9),

    -- Profit tracking
    profit_sol DECIMAL(20, 9),
    profit_usd DECIMAL(20, 2),
    is_win BOOLEAN,

    -- DEX information
    dex_program VARCHAR(44),
    dex_name VARCHAR(50),

    -- Metadata
    raw_transaction JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Leaderboard cache for performance
CREATE TABLE IF NOT EXISTS leaderboard_cache (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kol_id UUID REFERENCES kols(id) ON DELETE CASCADE,
    timeframe VARCHAR(20) NOT NULL, -- 'daily', 'weekly', 'monthly', 'all-time'
    rank INTEGER NOT NULL,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    total_trades INTEGER DEFAULT 0,
    total_profit_sol DECIMAL(20, 9) DEFAULT 0,
    total_profit_usd DECIMAL(20, 2) DEFAULT 0,
    win_rate DECIMAL(5, 2), -- Percentage
    avg_profit_per_trade DECIMAL(20, 9),
    best_trade_sol DECIMAL(20, 9),
    worst_trade_sol DECIMAL(20, 9),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(kol_id, timeframe)
);

-- Tokens table (for tracking popular tokens)
CREATE TABLE IF NOT EXISTS tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    address VARCHAR(44) UNIQUE NOT NULL,
    symbol VARCHAR(20),
    name VARCHAR(100),
    decimals INTEGER,
    logo_url TEXT,
    coingecko_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- KOL followers (for future social features)
CREATE TABLE IF NOT EXISTS followers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kol_id UUID REFERENCES kols(id) ON DELETE CASCADE,
    follower_wallet VARCHAR(44) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(kol_id, follower_wallet)
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_wallet VARCHAR(44) NOT NULL,
    kol_id UUID REFERENCES kols(id),
    type VARCHAR(50) NOT NULL, -- 'new_trade', 'milestone', 'alert'
    title VARCHAR(200),
    message TEXT,
    read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Webhook logs for debugging
CREATE TABLE IF NOT EXISTS webhook_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    webhook_id VARCHAR(100),
    payload JSONB,
    status INTEGER, -- HTTP status code
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Trades indexes
CREATE INDEX IF NOT EXISTS idx_trades_kol_id ON trades(kol_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_kol_timestamp ON trades(kol_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_trades_signature ON trades(transaction_signature);
CREATE INDEX IF NOT EXISTS idx_trades_profit ON trades(profit_sol DESC);
CREATE INDEX IF NOT EXISTS idx_trades_tokens ON trades(input_token, output_token);

-- KOLs indexes
CREATE INDEX IF NOT EXISTS idx_kols_wallet ON kols(wallet_address);
CREATE INDEX IF NOT EXISTS idx_kols_active ON kols(is_active);

-- Leaderboard cache indexes
CREATE INDEX IF NOT EXISTS idx_leaderboard_timeframe_rank ON leaderboard_cache(timeframe, rank);
CREATE INDEX IF NOT EXISTS idx_leaderboard_kol_timeframe ON leaderboard_cache(kol_id, timeframe);

-- Notifications indexes
CREATE INDEX IF NOT EXISTS idx_notifications_wallet ON notifications(user_wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_wallet, read) WHERE read = false;

-- Followers indexes
CREATE INDEX IF NOT EXISTS idx_followers_kol ON followers(kol_id);
CREATE INDEX IF NOT EXISTS idx_followers_wallet ON followers(follower_wallet);

-- Tokens indexes
CREATE INDEX IF NOT EXISTS idx_tokens_address ON tokens(address);
CREATE INDEX IF NOT EXISTS idx_tokens_symbol ON tokens(symbol);

-- ============================================
-- VIEWS FOR COMMON QUERIES
-- ============================================

-- Top performers by timeframe
CREATE OR REPLACE VIEW v_daily_leaders AS
SELECT
    k.*,
    l.rank,
    l.wins,
    l.losses,
    l.total_profit_sol,
    l.total_profit_usd,
    l.win_rate
FROM leaderboard_cache l
JOIN kols k ON k.id = l.kol_id
WHERE l.timeframe = 'daily'
ORDER BY l.rank ASC;

CREATE OR REPLACE VIEW v_weekly_leaders AS
SELECT
    k.*,
    l.rank,
    l.wins,
    l.losses,
    l.total_profit_sol,
    l.total_profit_usd,
    l.win_rate
FROM leaderboard_cache l
JOIN kols k ON k.id = l.kol_id
WHERE l.timeframe = 'weekly'
ORDER BY l.rank ASC;

CREATE OR REPLACE VIEW v_monthly_leaders AS
SELECT
    k.*,
    l.rank,
    l.wins,
    l.losses,
    l.total_profit_sol,
    l.total_profit_usd,
    l.win_rate
FROM leaderboard_cache l
JOIN kols k ON k.id = l.kol_id
WHERE l.timeframe = 'monthly'
ORDER BY l.rank ASC;

-- Recent trades with KOL info
CREATE OR REPLACE VIEW v_recent_trades AS
SELECT
    t.*,
    k.name as kol_name,
    k.avatar_url,
    k.twitter_handle
FROM trades t
JOIN kols k ON k.id = t.kol_id
ORDER BY t.timestamp DESC;

-- ============================================
-- FUNCTIONS
-- ============================================

-- Function to update KOL statistics
CREATE OR REPLACE FUNCTION update_kol_stats(
    p_kol_id UUID,
    p_timeframe VARCHAR
) RETURNS void AS $$
DECLARE
    v_cutoff_time TIMESTAMP;
    v_stats RECORD;
BEGIN
    -- Determine cutoff time based on timeframe
    CASE p_timeframe
        WHEN 'daily' THEN
            v_cutoff_time := NOW() - INTERVAL '1 day';
        WHEN 'weekly' THEN
            v_cutoff_time := NOW() - INTERVAL '7 days';
        WHEN 'monthly' THEN
            v_cutoff_time := NOW() - INTERVAL '30 days';
        ELSE
            v_cutoff_time := '1970-01-01'::TIMESTAMP; -- all-time
    END CASE;

    -- Calculate statistics
    SELECT
        COUNT(*) as total_trades,
        COUNT(*) FILTER (WHERE is_win = true) as wins,
        COUNT(*) FILTER (WHERE is_win = false) as losses,
        COALESCE(SUM(profit_sol), 0) as total_profit_sol,
        COALESCE(SUM(profit_usd), 0) as total_profit_usd,
        COALESCE(AVG(profit_sol), 0) as avg_profit,
        COALESCE(MAX(profit_sol), 0) as best_trade,
        COALESCE(MIN(profit_sol), 0) as worst_trade
    INTO v_stats
    FROM trades
    WHERE kol_id = p_kol_id
        AND timestamp > v_cutoff_time;

    -- Calculate win rate
    DECLARE v_win_rate DECIMAL(5, 2);
    BEGIN
        IF v_stats.total_trades > 0 THEN
            v_win_rate := (v_stats.wins::DECIMAL / v_stats.total_trades) * 100;
        ELSE
            v_win_rate := 0;
        END IF;
    END;

    -- Insert or update leaderboard cache
    INSERT INTO leaderboard_cache (
        kol_id,
        timeframe,
        rank, -- Will be updated by separate ranking function
        wins,
        losses,
        total_trades,
        total_profit_sol,
        total_profit_usd,
        win_rate,
        avg_profit_per_trade,
        best_trade_sol,
        worst_trade_sol,
        updated_at
    ) VALUES (
        p_kol_id,
        p_timeframe,
        999, -- Temporary rank
        v_stats.wins,
        v_stats.losses,
        v_stats.total_trades,
        v_stats.total_profit_sol,
        v_stats.total_profit_usd,
        v_win_rate,
        v_stats.avg_profit,
        v_stats.best_trade,
        v_stats.worst_trade,
        NOW()
    )
    ON CONFLICT (kol_id, timeframe) DO UPDATE
    SET wins = v_stats.wins,
        losses = v_stats.losses,
        total_trades = v_stats.total_trades,
        total_profit_sol = v_stats.total_profit_sol,
        total_profit_usd = v_stats.total_profit_usd,
        win_rate = v_win_rate,
        avg_profit_per_trade = v_stats.avg_profit,
        best_trade_sol = v_stats.best_trade,
        worst_trade_sol = v_stats.worst_trade,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to update all ranks for a timeframe
CREATE OR REPLACE FUNCTION update_ranks(p_timeframe VARCHAR) RETURNS void AS $$
BEGIN
    WITH ranked_kols AS (
        SELECT
            id,
            ROW_NUMBER() OVER (ORDER BY total_profit_sol DESC) as new_rank
        FROM leaderboard_cache
        WHERE timeframe = p_timeframe
    )
    UPDATE leaderboard_cache l
    SET rank = r.new_rank,
        updated_at = NOW()
    FROM ranked_kols r
    WHERE l.id = r.id
        AND l.timeframe = p_timeframe;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS
-- ============================================

-- Auto-update timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER kols_updated_at
    BEFORE UPDATE ON kols
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER tokens_updated_at
    BEFORE UPDATE ON tokens
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- ============================================
-- SEED DATA (Sample KOLs)
-- ============================================

INSERT INTO kols (name, wallet_address, avatar_url, twitter_handle, telegram_handle) VALUES
('Jijo', '4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk', 'https://ext.same-assets.com/3959085109/2900370585.png', '@jijo', 'jijo'),
('ram', '57rXqaQsvgyBKwebP2StfqQeCBjBS4jsrZFJN5aU2V9b', 'https://ext.same-assets.com/3959085109/1240592860.png', '@ram', 'ram'),
('Ducky', 'ADC1QV9raLnGGDbnWdnsxazeZ4Tsiho4vrWadYswA2ph', 'https://ext.same-assets.com/3959085109/1856251214.png', '@ducky', NULL),
('Dior', '87rRdssFiTJKY4MGARa4G5vQ31hmR7MxSmhzeaJ5AAxJ', 'https://ext.same-assets.com/3959085109/3065719139.png', '@dior', NULL),
('Leck', '98T65wcMEjoNLDTJszBHGZEX75QRe8QaANXokv4yw3Mp', 'https://ext.same-assets.com/3959085109/3617297792.png', '@leck', 'leck')
ON CONFLICT (wallet_address) DO NOTHING;

-- ============================================
-- GRANTS (Adjust based on your setup)
-- ============================================

-- For application user
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
-- GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_user;

-- ============================================
-- MAINTENANCE QUERIES
-- ============================================

-- Vacuum and analyze (run periodically)
-- VACUUM ANALYZE trades;
-- VACUUM ANALYZE leaderboard_cache;

-- Check table sizes
-- SELECT
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
