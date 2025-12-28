-- Migration: Escrow audit logging
-- Addresses audit item 8.6: Escrow security audit trail

-- Create escrow audit log table
create table if not exists public.escrow_audit_log (
  id uuid primary key default gen_random_uuid(),
  operation text not null check (operation in ('deposit', 'payout', 'fee_transfer')),
  escrow_address text not null,
  market_id uuid references public.wager_markets(id) on delete set null,
  order_id uuid references public.wager_orders(id) on delete set null,
  amount_sol numeric not null,
  signature text not null,
  from_wallet text,
  to_wallet text,
  created_at timestamp with time zone not null default now()
);

alter table public.escrow_audit_log enable row level security;

create policy "Anyone can view escrow_audit_log"
  on public.escrow_audit_log for select
  using (true);

create index if not exists escrow_audit_log_escrow_idx on public.escrow_audit_log(escrow_address);
create index if not exists escrow_audit_log_market_idx on public.escrow_audit_log(market_id);
create index if not exists escrow_audit_log_created_idx on public.escrow_audit_log(created_at);
create unique index if not exists escrow_audit_log_signature_uniq on public.escrow_audit_log(signature);
