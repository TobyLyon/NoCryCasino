create or replace function public.pm_place_order(
  p_outcome_id uuid,
  p_user_pubkey text,
  p_side public.pm_order_side,
  p_price numeric,
  p_quantity numeric,
  p_tif public.pm_order_tif,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id text;
  v_round_status public.pm_round_status;
  v_outcome_status public.pm_outcome_status;
  v_rake_bps integer;
  v_fee_account text;
  v_order_id uuid;
  v_remaining numeric;
  v_reserved numeric;
  v_now timestamp with time zone;
  v_best record;
  v_trade_qty numeric;
  v_trade_price numeric;
  v_buyer_limit_price numeric;
  v_buyer_reserved_debit numeric;
  v_buyer_refund numeric;
  v_trade_notional numeric;
  v_match_id text;
  v_fee numeric;
  v_total_filled numeric;
  v_refund numeric;
  v_buyer text;
  v_seller text;
  v_buyer_is_taker boolean;
  v_seller_is_taker boolean;
  v_buyer_charge numeric;
  v_seller_credit numeric;
  v_fee_credit numeric;
  v_taker_order_id uuid;
  v_maker_order_id uuid;
  v_fill jsonb;
  v_fills jsonb := '[]'::jsonb;
  v_order jsonb;
  v_existing_id uuid;
  v_existing jsonb;
begin
  if p_outcome_id is null then
    raise exception 'MISSING_OUTCOME_ID';
  end if;
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then
    raise exception 'MISSING_USER_PUBKEY';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'MISSING_IDEMPOTENCY_KEY';
  end if;
  if p_price is null or p_price <= 0 or p_price >= 1 then
    raise exception 'INVALID_PRICE';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select o.order_id
    into v_existing_id
  from public.orders o
  where o.user_pubkey = p_user_pubkey
    and o.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing_id is not null then
    select jsonb_build_object(
      'ok', true,
      'order', to_jsonb(o),
      'fills', '[]'::jsonb
    )
    into v_existing
    from public.orders o
    where o.order_id = v_existing_id;

    return v_existing;
  end if;

  v_now := now();

  select m.round_id, m.status, o.status, coalesce(m.rake_bps, 0), m.escrow_wallet_pubkey
    into v_round_id, v_round_status, v_outcome_status, v_rake_bps, v_fee_account
  from public.outcome_markets o
  join public.market_rounds m on m.round_id = o.round_id
  where o.outcome_id = p_outcome_id;

  if v_round_id is null then
    raise exception 'OUTCOME_NOT_FOUND';
  end if;

  if v_round_status <> 'OPEN' then
    raise exception 'ROUND_NOT_OPEN';
  end if;

  if v_outcome_status <> 'ACTIVE' then
    raise exception 'OUTCOME_NOT_ACTIVE';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_outcome_id::text));

  insert into public.users (wallet_address)
  values (p_user_pubkey)
  on conflict (wallet_address) do nothing;

  insert into public.user_balances (user_pubkey)
  values (p_user_pubkey)
  on conflict (user_pubkey) do nothing;

  insert into public.users (wallet_address)
  values (v_fee_account)
  on conflict (wallet_address) do nothing;

  insert into public.user_balances (user_pubkey)
  values (v_fee_account)
  on conflict (user_pubkey) do nothing;

  if p_side = 'BUY' then
    v_reserved := p_price * p_quantity;
    update public.user_balances
    set available_collateral = available_collateral - v_reserved,
        reserved_collateral = reserved_collateral + v_reserved
    where user_pubkey = p_user_pubkey
      and available_collateral >= v_reserved;

    if not found then
      raise exception 'INSUFFICIENT_COLLATERAL';
    end if;
  else
    insert into public.positions (user_pubkey, outcome_id)
    values (p_user_pubkey, p_outcome_id)
    on conflict (user_pubkey, outcome_id) do nothing;

    update public.positions
    set reserved_yes_shares = reserved_yes_shares + p_quantity
    where user_pubkey = p_user_pubkey
      and outcome_id = p_outcome_id
      and (yes_shares - reserved_yes_shares) >= p_quantity;

    if not found then
      raise exception 'INSUFFICIENT_SHARES';
    end if;
  end if;

  insert into public.orders (
    outcome_id,
    user_pubkey,
    side,
    price,
    quantity,
    tif,
    idempotency_key,
    reserved_collateral,
    status,
    created_at
  ) values (
    p_outcome_id,
    p_user_pubkey,
    p_side,
    p_price,
    p_quantity,
    p_tif,
    p_idempotency_key,
    case when p_side = 'BUY' then v_reserved else 0 end,
    'OPEN',
    v_now
  )
  returning order_id into v_order_id;

  insert into public.ledger_entries (
    event_key,
    user_pubkey,
    outcome_id,
    delta_available,
    delta_reserved,
    delta_yes_shares,
    ref_type,
    ref_id,
    created_at
  ) values (
    concat('order:', v_order_id::text, ':place'),
    p_user_pubkey,
    p_outcome_id,
    case when p_side = 'BUY' then -v_reserved else 0 end,
    case when p_side = 'BUY' then v_reserved else 0 end,
    0,
    'order_place',
    v_order_id::text,
    v_now
  )
  on conflict (event_key) do nothing;

  v_remaining := p_quantity;
  v_total_filled := 0;

  while v_remaining > 0 loop
    if p_side = 'BUY' then
      select o.order_id, o.user_pubkey, o.price, o.quantity, o.filled_quantity, o.created_at
        into v_best
      from public.orders o
      where o.outcome_id = p_outcome_id
        and o.side = 'SELL'
        and o.status in ('OPEN','PARTIALLY_FILLED')
        and o.price <= p_price
      order by o.price asc, o.created_at asc
      limit 1
      for update skip locked;

      if v_best.order_id is null then
        exit;
      end if;

      v_trade_price := v_best.price;
      v_trade_qty := least(v_remaining, (v_best.quantity - v_best.filled_quantity));
      if v_trade_qty <= 0 then
        exit;
      end if;

      v_taker_order_id := v_order_id;
      v_maker_order_id := v_best.order_id;
      v_buyer := p_user_pubkey;
      v_seller := v_best.user_pubkey;
      v_buyer_is_taker := true;
      v_seller_is_taker := false;
    else
      select o.order_id, o.user_pubkey, o.price, o.quantity, o.filled_quantity, o.created_at
        into v_best
      from public.orders o
      where o.outcome_id = p_outcome_id
        and o.side = 'BUY'
        and o.status in ('OPEN','PARTIALLY_FILLED')
        and o.price >= p_price
      order by o.price desc, o.created_at asc
      limit 1
      for update skip locked;

      if v_best.order_id is null then
        exit;
      end if;

      v_trade_price := v_best.price;
      v_trade_qty := least(v_remaining, (v_best.quantity - v_best.filled_quantity));
      if v_trade_qty <= 0 then
        exit;
      end if;

      v_taker_order_id := v_order_id;
      v_maker_order_id := v_best.order_id;
      v_buyer := v_best.user_pubkey;
      v_seller := p_user_pubkey;
      v_buyer_is_taker := false;
      v_seller_is_taker := true;
    end if;

    v_match_id := concat(
      p_outcome_id::text,
      ':',
      v_taker_order_id::text,
      ':',
      v_maker_order_id::text,
      ':',
      (extract(epoch from v_now) * 1000)::bigint::text,
      ':',
      v_total_filled::text
    );

    v_trade_notional := v_trade_qty * v_trade_price;
    v_fee := v_trade_notional * (v_rake_bps::numeric / 10000::numeric);
    if v_fee < 0 then v_fee := 0; end if;

    v_buyer_limit_price := case when v_buyer = p_user_pubkey then p_price else v_best.price end;
    if v_buyer_limit_price is null then
      v_buyer_limit_price := v_trade_price;
    end if;

    v_buyer_reserved_debit := v_trade_qty * v_buyer_limit_price;
    v_buyer_refund := (v_buyer_limit_price - v_trade_price) * v_trade_qty;
    if v_buyer_refund < 0 then
      v_buyer_refund := 0;
    end if;

    v_buyer_charge := v_buyer_reserved_debit;
    v_seller_credit := v_trade_notional - v_fee;
    v_fee_credit := v_fee;

    insert into public.user_balances (user_pubkey)
    values (v_seller)
    on conflict (user_pubkey) do nothing;

    update public.user_balances
    set reserved_collateral = reserved_collateral - v_buyer_charge,
        available_collateral = available_collateral + v_buyer_refund
    where user_pubkey = v_buyer
      and reserved_collateral >= v_buyer_charge;

    if not found then
      raise exception 'BUYER_RESERVED_INSUFFICIENT';
    end if;

    update public.user_balances
    set available_collateral = available_collateral + v_seller_credit
    where user_pubkey = v_seller;

    if v_fee_credit > 0 then
      update public.user_balances
      set available_collateral = available_collateral + v_fee_credit
      where user_pubkey = v_fee_account;
    end if;

    insert into public.positions (user_pubkey, outcome_id)
    values (v_buyer, p_outcome_id)
    on conflict (user_pubkey, outcome_id) do nothing;

    insert into public.positions (user_pubkey, outcome_id)
    values (v_seller, p_outcome_id)
    on conflict (user_pubkey, outcome_id) do nothing;

    update public.positions
    set yes_shares = yes_shares + v_trade_qty
    where user_pubkey = v_buyer
      and outcome_id = p_outcome_id;

    update public.positions
    set yes_shares = yes_shares - v_trade_qty,
        reserved_yes_shares = greatest(0, reserved_yes_shares - v_trade_qty)
    where user_pubkey = v_seller
      and outcome_id = p_outcome_id;

    update public.orders
    set filled_quantity = filled_quantity + v_trade_qty,
        status = case
          when (filled_quantity + v_trade_qty) >= quantity then 'FILLED'
          when (filled_quantity + v_trade_qty) > 0 then 'PARTIALLY_FILLED'
          else status
        end
    where order_id = v_taker_order_id;

    update public.orders
    set filled_quantity = filled_quantity + v_trade_qty,
        status = case
          when (filled_quantity + v_trade_qty) >= quantity then 'FILLED'
          when (filled_quantity + v_trade_qty) > 0 then 'PARTIALLY_FILLED'
          else status
        end
    where order_id = v_maker_order_id;

    insert into public.fills (
      outcome_id,
      taker_order_id,
      maker_order_id,
      price,
      quantity,
      fee_bps,
      fee_amount,
      match_id,
      created_at
    ) values (
      p_outcome_id,
      v_taker_order_id,
      v_maker_order_id,
      v_trade_price,
      v_trade_qty,
      v_rake_bps,
      v_fee,
      v_match_id,
      v_now
    )
    on conflict (match_id) do nothing;

    v_fill := jsonb_build_object(
      'match_id', v_match_id,
      'taker_order_id', v_taker_order_id,
      'maker_order_id', v_maker_order_id,
      'price', v_trade_price,
      'quantity', v_trade_qty,
      'fee_bps', v_rake_bps,
      'fee_amount', v_fee
    );

    v_fills := v_fills || jsonb_build_array(v_fill);

    insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
    values (
      concat('fill:', v_match_id, ':buyer'),
      v_buyer,
      p_outcome_id,
      v_buyer_refund,
      -v_buyer_charge,
      v_trade_qty,
      'fill',
      v_match_id,
      v_now
    )
    on conflict (event_key) do nothing;

    insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
    values (
      concat('fill:', v_match_id, ':seller'),
      v_seller,
      p_outcome_id,
      v_seller_credit,
      0,
      -v_trade_qty,
      'fill',
      v_match_id,
      v_now
    )
    on conflict (event_key) do nothing;

    if v_fee_credit > 0 then
      insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
      values (
        concat('fill:', v_match_id, ':fee'),
        v_fee_account,
        p_outcome_id,
        v_fee_credit,
        0,
        0,
        'fee',
        v_match_id,
        v_now
      )
      on conflict (event_key) do nothing;
    end if;

    v_remaining := v_remaining - v_trade_qty;
    v_total_filled := v_total_filled + v_trade_qty;
  end loop;

  if p_side = 'BUY' then
    v_refund := (p_price * v_remaining);
    if v_refund > 0 then
      update public.user_balances
      set available_collateral = available_collateral + v_refund,
          reserved_collateral = reserved_collateral - v_refund
      where user_pubkey = p_user_pubkey
        and reserved_collateral >= v_refund;

      update public.orders
      set reserved_collateral = reserved_collateral - v_refund
      where order_id = v_order_id;
    end if;
  else
    if v_remaining <= 0 then
      null;
    else
      update public.positions
      set reserved_yes_shares = reserved_yes_shares - v_remaining
      where user_pubkey = p_user_pubkey
        and outcome_id = p_outcome_id
        and reserved_yes_shares >= v_remaining;
    end if;
  end if;

  if p_tif = 'IOC' and v_remaining > 0 then
    update public.orders
    set status = case when filled_quantity > 0 then 'PARTIALLY_FILLED' else 'EXPIRED' end
    where order_id = v_order_id;

    if p_side = 'BUY' then
      update public.user_balances
      set available_collateral = available_collateral + (p_price * v_remaining),
          reserved_collateral = reserved_collateral - (p_price * v_remaining)
      where user_pubkey = p_user_pubkey;
    else
      update public.positions
      set reserved_yes_shares = reserved_yes_shares - v_remaining
      where user_pubkey = p_user_pubkey
        and outcome_id = p_outcome_id;
    end if;
  end if;

  select to_jsonb(o)
    into v_order
  from public.orders o
  where o.order_id = v_order_id;

  return jsonb_build_object(
    'ok', true,
    'order', v_order,
    'fills', v_fills
  );
end;
$$;

create or replace function public.pm_cancel_order(
  p_order_id uuid,
  p_user_pubkey text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_outcome_id uuid;
  v_remaining numeric;
  v_release numeric;
begin
  if p_order_id is null then
    raise exception 'MISSING_ORDER_ID';
  end if;
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then
    raise exception 'MISSING_USER_PUBKEY';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'MISSING_IDEMPOTENCY_KEY';
  end if;

  select * into v_order
  from public.orders
  where order_id = p_order_id
    and user_pubkey = p_user_pubkey
  for update;

  if v_order.order_id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  v_outcome_id := v_order.outcome_id;
  perform pg_advisory_xact_lock(hashtext(v_outcome_id::text));

  if v_order.status in ('CANCELLED','FILLED','EXPIRED') then
    return jsonb_build_object('ok', true, 'status', v_order.status);
  end if;

  v_remaining := v_order.quantity - v_order.filled_quantity;
  if v_remaining < 0 then v_remaining := 0; end if;

  update public.orders
  set status = 'CANCELLED'
  where order_id = p_order_id;

  if v_order.side = 'BUY' then
    v_release := v_order.price * v_remaining;
    if v_release > 0 then
      update public.user_balances
      set available_collateral = available_collateral + v_release,
          reserved_collateral = reserved_collateral - v_release
      where user_pubkey = p_user_pubkey
        and reserved_collateral >= v_release;

      update public.orders
      set reserved_collateral = greatest(0, reserved_collateral - v_release)
      where order_id = p_order_id;
    end if;
  else
    if v_remaining > 0 then
      update public.positions
      set reserved_yes_shares = reserved_yes_shares - v_remaining
      where user_pubkey = p_user_pubkey
        and outcome_id = v_outcome_id
        and reserved_yes_shares >= v_remaining;
    end if;
  end if;

  insert into public.ledger_entries (
    event_key,
    user_pubkey,
    outcome_id,
    delta_available,
    delta_reserved,
    delta_yes_shares,
    ref_type,
    ref_id,
    created_at
  ) values (
    concat('order:', p_order_id::text, ':cancel:', p_idempotency_key),
    p_user_pubkey,
    v_outcome_id,
    case when v_order.side = 'BUY' then (v_order.price * v_remaining) else 0 end,
    case when v_order.side = 'BUY' then -(v_order.price * v_remaining) else 0 end,
    0,
    'order_cancel',
    p_order_id::text,
    now()
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pm_credit_deposit(
  p_user_pubkey text,
  p_amount numeric,
  p_mint text,
  p_tx_sig text,
  p_round_scope text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then
    raise exception 'MISSING_USER_PUBKEY';
  end if;
  if p_tx_sig is null or length(trim(p_tx_sig)) < 20 then
    raise exception 'MISSING_TX_SIG';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_mint is null or length(trim(p_mint)) = 0 then
    raise exception 'MISSING_MINT';
  end if;

  select deposit_id into v_existing
  from public.escrow_deposits
  where tx_sig = p_tx_sig
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('ok', true, 'deposit_id', v_existing);
  end if;

  insert into public.users (wallet_address)
  values (p_user_pubkey)
  on conflict (wallet_address) do nothing;

  insert into public.user_balances (user_pubkey)
  values (p_user_pubkey)
  on conflict (user_pubkey) do nothing;

  insert into public.escrow_deposits (user_pubkey, round_scope, amount, mint, tx_sig, status)
  values (p_user_pubkey, p_round_scope, p_amount, p_mint, p_tx_sig, 'CONFIRMED')
  returning deposit_id into v_existing;

  update public.user_balances
  set available_collateral = available_collateral + p_amount
  where user_pubkey = p_user_pubkey;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
  values (
    concat('deposit:', v_existing::text),
    p_user_pubkey,
    null,
    p_amount,
    0,
    0,
    'deposit',
    v_existing::text,
    now()
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'deposit_id', v_existing);
end;
$$;

create or replace function public.pm_claim_settlement(
  p_user_pubkey text,
  p_outcome_id uuid,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_id text;
  v_round_status public.pm_round_status;
  v_final boolean;
  v_yes numeric;
  v_claim numeric;
  v_claim_id uuid;
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then
    raise exception 'MISSING_USER_PUBKEY';
  end if;
  if p_outcome_id is null then
    raise exception 'MISSING_OUTCOME_ID';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then
    raise exception 'MISSING_IDEMPOTENCY_KEY';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_outcome_id::text));

  select m.round_id, m.status, o.final_outcome
    into v_round_id, v_round_status, v_final
  from public.outcome_markets o
  join public.market_rounds m on m.round_id = o.round_id
  where o.outcome_id = p_outcome_id;

  if v_round_id is null then
    raise exception 'OUTCOME_NOT_FOUND';
  end if;
  if v_round_status <> 'SETTLED' then
    raise exception 'ROUND_NOT_SETTLED';
  end if;
  if v_final is null then
    raise exception 'OUTCOME_NOT_RESOLVED';
  end if;

  insert into public.users (wallet_address)
  values (p_user_pubkey)
  on conflict (wallet_address) do nothing;

  insert into public.user_balances (user_pubkey)
  values (p_user_pubkey)
  on conflict (user_pubkey) do nothing;

  insert into public.positions (user_pubkey, outcome_id)
  values (p_user_pubkey, p_outcome_id)
  on conflict (user_pubkey, outcome_id) do nothing;

  select yes_shares into v_yes
  from public.positions
  where user_pubkey = p_user_pubkey
    and outcome_id = p_outcome_id
  for update;

  if v_yes is null then
    v_yes := 0;
  end if;

  if v_final then
    v_claim := v_yes;
  else
    v_claim := 0;
  end if;

  insert into public.settlement_claims (
    user_pubkey,
    outcome_id,
    round_id,
    yes_shares,
    final_outcome,
    claimable_amount,
    status,
    claimed_at,
    idempotency_key
  ) values (
    p_user_pubkey,
    p_outcome_id,
    v_round_id,
    v_yes,
    v_final,
    v_claim,
    'CLAIMED',
    now(),
    p_idempotency_key
  )
  on conflict (user_pubkey, outcome_id, round_id) do nothing
  returning claim_id into v_claim_id;

  if v_claim_id is null then
    select claim_id into v_claim_id
    from public.settlement_claims
    where user_pubkey = p_user_pubkey
      and outcome_id = p_outcome_id
      and round_id = v_round_id
    limit 1;

    return jsonb_build_object('ok', true, 'claim_id', v_claim_id);
  end if;

  update public.user_balances
  set available_collateral = available_collateral + v_claim
  where user_pubkey = p_user_pubkey;

  update public.positions
  set yes_shares = 0,
      reserved_yes_shares = 0
  where user_pubkey = p_user_pubkey
    and outcome_id = p_outcome_id;

  insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
  values (
    concat('claim:', v_claim_id::text),
    p_user_pubkey,
    p_outcome_id,
    v_claim,
    0,
    -v_yes,
    'claim',
    v_claim_id::text,
    now()
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object('ok', true, 'claim_id', v_claim_id, 'claimable_amount', v_claim);
end;
$$;
