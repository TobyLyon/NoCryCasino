do $$ begin
  alter type public.pm_withdrawal_status add value if not exists 'SENDING';
exception when others then null;
end $$;

alter table if exists public.escrow_withdrawals add column if not exists idempotency_key text;
alter table if exists public.escrow_withdrawals add column if not exists processing_nonce text;
alter table if exists public.escrow_withdrawals add column if not exists processing_at timestamp with time zone;
alter table if exists public.escrow_withdrawals add column if not exists error text;

create unique index if not exists escrow_withdrawals_user_idempotency_uniq
  on public.escrow_withdrawals(user_pubkey, idempotency_key)
  where idempotency_key is not null;

create unique index if not exists escrow_withdrawals_processing_nonce_uniq
  on public.escrow_withdrawals(processing_nonce)
  where processing_nonce is not null;

create or replace function public.pm_request_withdrawal(
  p_user_pubkey text,
  p_amount numeric,
  p_mint text,
  p_destination_pubkey text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_withdrawal uuid;
  v_now timestamp with time zone;
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then
    raise exception 'MISSING_USER_PUBKEY';
  end if;
  if p_destination_pubkey is null or length(trim(p_destination_pubkey)) = 0 then
    raise exception 'MISSING_DESTINATION';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'MISSING_IDEMPOTENCY_KEY';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_mint is null or length(trim(p_mint)) = 0 then
    raise exception 'MISSING_MINT';
  end if;

  select withdrawal_id into v_existing
  from public.escrow_withdrawals
  where user_pubkey = p_user_pubkey
    and idempotency_key = p_idempotency_key
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'withdrawal_id', v_existing);
  end if;

  v_now := now();

  insert into public.users (wallet_address)
  values (p_user_pubkey)
  on conflict (wallet_address) do nothing;

  insert into public.user_balances (user_pubkey)
  values (p_user_pubkey)
  on conflict (user_pubkey) do nothing;

  update public.user_balances
  set available_collateral = available_collateral - p_amount
  where user_pubkey = p_user_pubkey
    and available_collateral >= p_amount;

  if not found then
    raise exception 'INSUFFICIENT_COLLATERAL';
  end if;

  insert into public.escrow_withdrawals (user_pubkey, amount, mint, destination_pubkey, status, created_at, idempotency_key)
  values (p_user_pubkey, p_amount, p_mint, p_destination_pubkey, 'REQUESTED', v_now, p_idempotency_key)
  returning withdrawal_id into v_withdrawal;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
  values (
    concat('withdraw_request:', v_withdrawal::text),
    p_user_pubkey,
    null,
    -p_amount,
    0,
    0,
    'withdraw_request',
    v_withdrawal::text,
    v_now
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'withdrawal_id', v_withdrawal);
end;
$$;

create or replace function public.pm_begin_withdrawal_send(
  p_withdrawal_id uuid,
  p_processing_nonce text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_withdrawal_id is null then
    raise exception 'MISSING_WITHDRAWAL_ID';
  end if;
  if p_processing_nonce is null or length(trim(p_processing_nonce)) < 8 then
    raise exception 'MISSING_PROCESSING_NONCE';
  end if;

  update public.escrow_withdrawals
  set status = 'SENDING',
      processing_nonce = p_processing_nonce,
      processing_at = now(),
      error = null
  where withdrawal_id = p_withdrawal_id
    and status = 'REQUESTED'
    and tx_sig is null
    and (processing_nonce is null or length(processing_nonce) = 0);

  if not found then
    select * into v_row
    from public.escrow_withdrawals
    where withdrawal_id = p_withdrawal_id;

    if v_row.withdrawal_id is null then
      raise exception 'WITHDRAWAL_NOT_FOUND';
    end if;

    return jsonb_build_object('ok', true, 'status', v_row.status, 'withdrawal_id', v_row.withdrawal_id);
  end if;

  select * into v_row
  from public.escrow_withdrawals
  where withdrawal_id = p_withdrawal_id;

  return jsonb_build_object(
    'ok', true,
    'withdrawal_id', v_row.withdrawal_id,
    'user_pubkey', v_row.user_pubkey,
    'amount', v_row.amount,
    'mint', v_row.mint,
    'destination_pubkey', v_row.destination_pubkey,
    'status', v_row.status,
    'processing_nonce', v_row.processing_nonce
  );
end;
$$;

create or replace function public.pm_mark_withdrawal_sent(
  p_withdrawal_id uuid,
  p_processing_nonce text,
  p_tx_sig text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_withdrawal_id is null then
    raise exception 'MISSING_WITHDRAWAL_ID';
  end if;
  if p_processing_nonce is null or length(trim(p_processing_nonce)) < 8 then
    raise exception 'MISSING_PROCESSING_NONCE';
  end if;
  if p_tx_sig is null or length(trim(p_tx_sig)) < 20 then
    raise exception 'MISSING_TX_SIG';
  end if;

  update public.escrow_withdrawals
  set status = 'SENT',
      tx_sig = p_tx_sig,
      error = null
  where withdrawal_id = p_withdrawal_id
    and processing_nonce = p_processing_nonce;

  if not found then
    raise exception 'WITHDRAWAL_NOT_CLAIMED';
  end if;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
  select
    concat('withdraw_sent:', w.withdrawal_id::text),
    w.user_pubkey,
    null,
    0,
    0,
    0,
    'withdraw_sent',
    w.withdrawal_id::text,
    now()
  from public.escrow_withdrawals w
  where w.withdrawal_id = p_withdrawal_id
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pm_fail_withdrawal(
  p_withdrawal_id uuid,
  p_processing_nonce text,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if p_withdrawal_id is null then
    raise exception 'MISSING_WITHDRAWAL_ID';
  end if;
  if p_processing_nonce is null or length(trim(p_processing_nonce)) < 8 then
    raise exception 'MISSING_PROCESSING_NONCE';
  end if;

  select * into v_row
  from public.escrow_withdrawals
  where withdrawal_id = p_withdrawal_id
    and processing_nonce = p_processing_nonce
  for update;

  if v_row.withdrawal_id is null then
    raise exception 'WITHDRAWAL_NOT_CLAIMED';
  end if;

  if v_row.status = 'SENT' then
    return jsonb_build_object('ok', true, 'status', 'SENT');
  end if;

  update public.escrow_withdrawals
  set status = 'FAILED',
      error = p_error
  where withdrawal_id = p_withdrawal_id
    and processing_nonce = p_processing_nonce;

  update public.user_balances
  set available_collateral = available_collateral + v_row.amount
  where user_pubkey = v_row.user_pubkey;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
  values (
    concat('withdraw_fail:', v_row.withdrawal_id::text),
    v_row.user_pubkey,
    null,
    v_row.amount,
    0,
    0,
    'withdraw_fail',
    v_row.withdrawal_id::text,
    now()
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'status', 'FAILED');
end;
$$;
