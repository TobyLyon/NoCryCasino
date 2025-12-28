-- Migration: Fee/house edge configuration
-- Addresses audit recommendation for fee deduction

-- Add fee columns to wager_markets
alter table if exists public.wager_markets add column if not exists fee_bps integer not null default 0;
alter table if exists public.wager_markets add column if not exists fee_collected_sol numeric;
alter table if exists public.wager_markets add column if not exists fee_wallet_address text;

-- Add fee tracking to wager_orders
alter table if exists public.wager_orders add column if not exists fee_amount_sol numeric;

-- Insert default fee config
insert into public.system_config (key, value) values 
  ('fees', '{
    "default_fee_bps": 250,
    "fee_wallet_address": null,
    "min_payout_sol": 0.001
  }'::jsonb)
on conflict (key) do nothing;
