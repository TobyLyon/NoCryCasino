do $$ begin
  alter type public.pm_withdrawal_status add value if not exists 'PROPOSED';
exception when others then null;
end $$;

alter table if exists public.escrow_withdrawals add column if not exists custody_mode text;
alter table if exists public.escrow_withdrawals add column if not exists squads_multisig_pda text;
alter table if exists public.escrow_withdrawals add column if not exists squads_vault_index integer;
alter table if exists public.escrow_withdrawals add column if not exists squads_transaction_index bigint;
alter table if exists public.escrow_withdrawals add column if not exists squads_proposal_pda text;
alter table if exists public.escrow_withdrawals add column if not exists squads_create_sig text;
alter table if exists public.escrow_withdrawals add column if not exists squads_proposal_create_sig text;
alter table if exists public.escrow_withdrawals add column if not exists custody_ref jsonb;

create index if not exists escrow_withdrawals_squads_proposal_idx on public.escrow_withdrawals(squads_proposal_pda);
create index if not exists escrow_withdrawals_squads_tx_idx on public.escrow_withdrawals(squads_transaction_index);

create or replace function public.pm_mark_withdrawal_proposed(
  p_withdrawal_id uuid,
  p_processing_nonce text,
  p_custody_mode text,
  p_squads_multisig_pda text,
  p_squads_vault_index integer,
  p_squads_transaction_index bigint,
  p_squads_proposal_pda text,
  p_squads_create_sig text,
  p_squads_proposal_create_sig text,
  p_custody_ref jsonb
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

  update public.escrow_withdrawals
  set status = 'PROPOSED',
      custody_mode = p_custody_mode,
      squads_multisig_pda = p_squads_multisig_pda,
      squads_vault_index = p_squads_vault_index,
      squads_transaction_index = p_squads_transaction_index,
      squads_proposal_pda = p_squads_proposal_pda,
      squads_create_sig = p_squads_create_sig,
      squads_proposal_create_sig = p_squads_proposal_create_sig,
      custody_ref = p_custody_ref,
      error = null
  where withdrawal_id = p_withdrawal_id
    and processing_nonce = p_processing_nonce
    and status = 'SENDING'
    and tx_sig is null;

  if not found then
    raise exception 'WITHDRAWAL_NOT_CLAIMED';
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.pm_mark_withdrawal_proposed(uuid, text, text, text, integer, bigint, text, text, text, jsonb) from public;
grant execute on function public.pm_mark_withdrawal_proposed(uuid, text, text, text, integer, bigint, text, text, text, jsonb) to service_role;

create or replace function public.pm_mark_withdrawal_sent_admin(
  p_withdrawal_id uuid,
  p_tx_sig text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nonce text;
begin
  if p_withdrawal_id is null then
    raise exception 'MISSING_WITHDRAWAL_ID';
  end if;
  if p_tx_sig is null or length(trim(p_tx_sig)) < 20 then
    raise exception 'MISSING_TX_SIG';
  end if;

  select processing_nonce into v_nonce
  from public.escrow_withdrawals
  where withdrawal_id = p_withdrawal_id;

  if v_nonce is null or length(trim(v_nonce)) < 8 then
    raise exception 'WITHDRAWAL_NOT_CLAIMED';
  end if;

  return public.pm_mark_withdrawal_sent(p_withdrawal_id, v_nonce, p_tx_sig);
end;
$$;

revoke execute on function public.pm_mark_withdrawal_sent_admin(uuid, text) from public;
grant execute on function public.pm_mark_withdrawal_sent_admin(uuid, text) to service_role;

create or replace function public.pm_fail_withdrawal_admin(
  p_withdrawal_id uuid,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nonce text;
begin
  if p_withdrawal_id is null then
    raise exception 'MISSING_WITHDRAWAL_ID';
  end if;

  select processing_nonce into v_nonce
  from public.escrow_withdrawals
  where withdrawal_id = p_withdrawal_id;

  if v_nonce is null or length(trim(v_nonce)) < 8 then
    raise exception 'WITHDRAWAL_NOT_CLAIMED';
  end if;

  return public.pm_fail_withdrawal(p_withdrawal_id, v_nonce, coalesce(p_error, 'FAILED_BY_ADMIN'));
end;
$$;

revoke execute on function public.pm_fail_withdrawal_admin(uuid, text) from public;
grant execute on function public.pm_fail_withdrawal_admin(uuid, text) to service_role;
