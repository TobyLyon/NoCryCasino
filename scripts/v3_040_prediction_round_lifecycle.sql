create or replace function public.pm_expire_round_orders(
  p_round_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_remaining numeric;
  v_release numeric;
  v_count integer := 0;
  v_now timestamp with time zone;
begin
  if p_round_id is null or length(trim(p_round_id)) = 0 then
    raise exception 'MISSING_ROUND_ID';
  end if;

  v_now := now();

  perform pg_advisory_xact_lock(hashtext(p_round_id));

  for v_order in
    select o.order_id, o.user_pubkey, o.outcome_id, o.side, o.price, o.quantity, o.filled_quantity, o.status
    from public.orders o
    join public.outcome_markets om on om.outcome_id = o.outcome_id
    where om.round_id = p_round_id
      and o.status in ('OPEN','PARTIALLY_FILLED')
    for update
  loop
    v_remaining := v_order.quantity - v_order.filled_quantity;
    if v_remaining < 0 then v_remaining := 0; end if;

    update public.orders
    set status = 'EXPIRED'
    where order_id = v_order.order_id;

    if v_order.side = 'BUY' then
      v_release := v_order.price * v_remaining;
      if v_release > 0 then
        update public.user_balances
        set available_collateral = available_collateral + v_release,
            reserved_collateral = greatest(0, reserved_collateral - v_release)
        where user_pubkey = v_order.user_pubkey;

        update public.orders
        set reserved_collateral = greatest(0, reserved_collateral - v_release)
        where order_id = v_order.order_id;

        insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
        values (
          concat('order:', v_order.order_id::text, ':expire:', p_round_id),
          v_order.user_pubkey,
          v_order.outcome_id,
          v_release,
          -v_release,
          0,
          'order_expire',
          v_order.order_id::text,
          v_now
        )
        on conflict (event_key) do nothing;
      end if;
    else
      if v_remaining > 0 then
        update public.positions
        set reserved_yes_shares = reserved_yes_shares - v_remaining
        where user_pubkey = v_order.user_pubkey
          and outcome_id = v_order.outcome_id
          and reserved_yes_shares >= v_remaining;

        insert into public.ledger_entries (event_key, user_pubkey, outcome_id, delta_available, delta_reserved, delta_yes_shares, ref_type, ref_id, created_at)
        values (
          concat('order:', v_order.order_id::text, ':expire:', p_round_id),
          v_order.user_pubkey,
          v_order.outcome_id,
          0,
          0,
          0,
          'order_expire',
          v_order.order_id::text,
          v_now
        )
        on conflict (event_key) do nothing;
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'expired_orders', v_count);
end;
$$;

create or replace function public.pm_public_orderbook(
  p_outcome_id uuid,
  p_side public.pm_order_side,
  p_limit integer
) returns table(price numeric, open_quantity numeric)
language sql
security definer
set search_path = public
as $$
  select
    o.price,
    sum(greatest(0, o.quantity - o.filled_quantity)) as open_quantity
  from public.orders o
  where o.outcome_id = p_outcome_id
    and o.side = p_side
    and o.status in ('OPEN','PARTIALLY_FILLED')
  group by o.price
  order by
    case when p_side = 'BUY' then o.price end desc,
    case when p_side = 'SELL' then o.price end asc
  limit greatest(1, least(coalesce(p_limit, 50), 500));
$$;

grant execute on function public.pm_public_orderbook(uuid, public.pm_order_side, integer) to anon;
grant execute on function public.pm_public_orderbook(uuid, public.pm_order_side, integer) to authenticated;
