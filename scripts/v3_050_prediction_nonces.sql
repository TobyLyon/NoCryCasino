create table if not exists public.pm_request_nonces (
  id uuid primary key default gen_random_uuid(),
  user_pubkey text not null references public.users(wallet_address) on delete cascade,
  nonce text not null,
  action text not null,
  issued_at timestamp with time zone not null,
  created_at timestamp with time zone not null default now()
);

create unique index if not exists pm_request_nonces_user_nonce_uniq
  on public.pm_request_nonces(user_pubkey, nonce);

create index if not exists pm_request_nonces_created_at_idx on public.pm_request_nonces(created_at);

alter table public.pm_request_nonces enable row level security;

drop policy if exists "No public read pm_request_nonces" on public.pm_request_nonces;
create policy "No public read pm_request_nonces"
  on public.pm_request_nonces for select
  using (false);

create or replace function public.pm_use_nonce(
  p_user_pubkey text,
  p_nonce text,
  p_action text,
  p_issued_at timestamp with time zone
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_user_pubkey is null or length(trim(p_user_pubkey)) = 0 then
    raise exception 'MISSING_USER_PUBKEY';
  end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then
    raise exception 'MISSING_NONCE';
  end if;
  if p_action is null or length(trim(p_action)) = 0 then
    raise exception 'MISSING_ACTION';
  end if;
  if p_issued_at is null then
    raise exception 'MISSING_ISSUED_AT';
  end if;

  insert into public.users (wallet_address)
  values (p_user_pubkey)
  on conflict (wallet_address) do nothing;

  insert into public.pm_request_nonces (user_pubkey, nonce, action, issued_at)
  values (p_user_pubkey, p_nonce, p_action, p_issued_at)
  on conflict (user_pubkey, nonce) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'NONCE_REUSED');
  end if;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function public.pm_use_nonce(text, text, text, timestamp with time zone) from public;
grant execute on function public.pm_use_nonce(text, text, text, timestamp with time zone) to service_role;
