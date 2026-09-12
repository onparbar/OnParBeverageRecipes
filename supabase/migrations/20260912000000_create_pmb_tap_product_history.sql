-- Product assignment history, separate from keg replacement timestamps.
create table if not exists public.pmb_tap_product_current (
  slot_key text primary key,
  data jsonb not null,
  observed_at timestamptz not null
);

create table if not exists public.pmb_tap_product_events (
  id bigint generated always as identity primary key,
  slot_key text not null,
  occurred_at timestamptz not null,
  source text not null check (source in ('baseline', 'detected', 'confirmed')),
  previous_product jsonb,
  product jsonb not null
);
create index if not exists pmb_tap_product_events_slot_time_idx
  on public.pmb_tap_product_events (slot_key, occurred_at desc);

alter table public.pmb_tap_product_current enable row level security;
alter table public.pmb_tap_product_events enable row level security;
revoke all on table public.pmb_tap_product_current from anon, authenticated;
revoke all on table public.pmb_tap_product_events from anon, authenticated;
grant select on table public.pmb_tap_product_current to service_role;
grant select on table public.pmb_tap_product_events to service_role;

create or replace function public.record_pmb_tap_product_observations(
  p_observations jsonb,
  p_observed_at timestamptz,
  p_source text default 'detected'
) returns setof public.pmb_tap_product_current
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  old_row public.pmb_tap_product_current%rowtype;
  product jsonb;
  next_data jsonb;
  transition_source text;
  seen_keys text[] := array[]::text[];
begin
  if p_source not in ('detected', 'confirmed') or p_source is null
    or p_observed_at is null or p_observed_at > now() + interval '5 minutes'
    or jsonb_typeof(p_observations) is distinct from 'array' then
    raise exception 'Invalid tap history observation';
  end if;
  if jsonb_array_length(p_observations) > 250 then
    raise exception 'Too many tap history observations';
  end if;

  -- One transaction for each read batch. Stale overlapping requests cannot
  -- replace newer observations, and concurrent requests cannot duplicate events.
  perform pg_catalog.pg_advisory_xact_lock(910423, 20260912);
  for item in select value from jsonb_array_elements(p_observations)
  loop
    if coalesce(item->>'slotKey', '') !~ '^[1-9][0-9]*:[1-9][0-9]*:[1-9][0-9]*$'
      or coalesce(item->>'plu', '') !~ '^[1-9][0-9]*$'
      or coalesce(item->>'name', '') = '' or coalesce(item->>'nameKey', '') = ''
      or item->>'slotKey' = any(seen_keys) then
      raise exception 'Invalid or duplicate physical tap';
    end if;
    seen_keys := array_append(seen_keys, item->>'slotKey');
    select * into old_row from public.pmb_tap_product_current c
      where c.slot_key = item->>'slotKey';
    if found and old_row.observed_at >= p_observed_at then
      continue;
    end if;
    product := item - 'tappedOn';
    if old_row.slot_key is null then
      transition_source := 'baseline';
      next_data := product || jsonb_build_object(
        'firstSeenAt', p_observed_at, 'changedAt', null, 'source', 'baseline', 'previousProduct', null
      );
    elsif old_row.data->>'plu' is distinct from item->>'plu'
      or old_row.data->>'nameKey' is distinct from item->>'nameKey' then
      transition_source := p_source;
      next_data := product || jsonb_build_object(
        'firstSeenAt', p_observed_at, 'changedAt', p_observed_at, 'source', p_source,
        'previousProduct', jsonb_build_object('plu', old_row.data->'plu', 'name', old_row.data->>'name')
      );
    else
      transition_source := null;
      next_data := old_row.data || product;
    end if;

    if transition_source is not null then
      insert into public.pmb_tap_product_events (slot_key, occurred_at, source, previous_product, product)
      values (item->>'slotKey', p_observed_at, transition_source, next_data->'previousProduct', product);
    end if;
    next_data := next_data || jsonb_build_object('lastSeenAt', p_observed_at);
    if coalesce(item->>'tappedOn', '') <> '' then
      next_data := next_data || jsonb_build_object('lastTappedOn', item->>'tappedOn', 'lastTappedObservedAt', p_observed_at);
    end if;
    insert into public.pmb_tap_product_current (slot_key, data, observed_at)
    values (item->>'slotKey', next_data, p_observed_at)
    on conflict (slot_key) do update set data = excluded.data, observed_at = excluded.observed_at;
  end loop;
  return query select c.* from public.pmb_tap_product_current c where c.slot_key = any(seen_keys);
end;
$$;
revoke all on function public.record_pmb_tap_product_observations(jsonb, timestamptz, text) from public, anon, authenticated;
grant execute on function public.record_pmb_tap_product_observations(jsonb, timestamptz, text) to service_role;
