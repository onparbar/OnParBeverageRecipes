-- Run inside a transaction with SAVEPOINT history_test, then ROLLBACK TO it.
-- No real tap or retained fixture data is modified.
do $$
declare
  key text := '900001:900001:1';
  original jsonb := '{"slotKey":"900001:900001:1","tapNumber":900001,"deviceId":900001,"lineNum":1,"plu":900001,"name":"History test original","nameKey":"history test original","tappedOn":"09/10/2026 21:34:13"}';
  changed jsonb;
  state jsonb;
  events bigint;
begin
  if exists (select 1 from public.pmb_tap_product_current where slot_key = key)
    or exists (select 1 from public.pmb_tap_product_events where slot_key = key) then
    raise exception 'History test identity is already in use';
  end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original), now() - interval '10 minutes');
  select data into state from public.pmb_tap_product_current where slot_key = key;
  if state->>'source' <> 'baseline' or state->>'changedAt' is not null then
    raise exception 'Baseline invented a product-change date';
  end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original || '{"tappedOn":"09/12/2026 00:00:00"}'), now() - interval '9 minutes');
  select count(*) into events from public.pmb_tap_product_events where slot_key = key;
  if events <> 1 then raise exception 'Same-product keg replacement created an event'; end if;

  changed := original || '{"name":"Bacardi Sunset","nameKey":"bacardi sunset","tappedOn":""}';
  perform public.record_pmb_tap_product_observations(jsonb_build_array(changed), now() - interval '8 minutes', 'confirmed');
  select data into state from public.pmb_tap_product_current where slot_key = key;
  if state->>'name' <> 'Bacardi Sunset' or state->>'source' <> 'confirmed'
    or state->'previousProduct'->>'name' <> 'History test original' or state->>'lastTappedOn' is not null then
    raise exception 'Reused PLU transition did not preserve accurate product history';
  end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original), now() - interval '9 minutes');
  perform public.record_pmb_tap_product_observations(jsonb_build_array(changed), now() - interval '7 minutes');
  select count(*) into events from public.pmb_tap_product_events where slot_key = key;
  select data into state from public.pmb_tap_product_current where slot_key = key;
  if events <> 2 or state->>'name' <> 'Bacardi Sunset' then
    raise exception 'Stale/repeated observation changed history';
  end if;
  begin
    perform public.record_pmb_tap_product_observations(jsonb_build_array(original, original), now());
    raise exception 'Duplicate observations unexpectedly succeeded';
  exception when others then
    if sqlerrm <> 'Invalid or duplicate physical tap' then raise; end if;
  end;
  select count(*) into events from public.pmb_tap_product_events where slot_key = key;
  if events <> 2 then raise exception 'Rejected batch was not rolled back atomically'; end if;
  if has_function_privilege('anon', 'public.record_pmb_tap_product_observations(jsonb,timestamptz,text)', 'execute')
    or has_function_privilege('authenticated', 'public.record_pmb_tap_product_observations(jsonb,timestamptz,text)', 'execute') then
    raise exception 'History write function is exposed to browser roles';
  end if;
end;
$$;
