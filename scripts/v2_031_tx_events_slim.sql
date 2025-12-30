alter table public.tx_events
  add column if not exists description text generated always as ((raw->>'description')) stored;

alter table public.tx_events
  add column if not exists raw_source text generated always as ((raw->>'source')) stored;

alter table public.tx_events
  add column if not exists raw_type text generated always as ((raw->>'type')) stored;

create index if not exists tx_events_raw_source_idx on public.tx_events(raw_source);

revoke select(raw) on table public.tx_events from anon;
revoke select(raw) on table public.tx_events from authenticated;
