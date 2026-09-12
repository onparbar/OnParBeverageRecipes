-- Run after SAVEPOINT history_test and roll back to it: no retained test records.
do $$
declare
  fixture text := 'history-fixture-' || gen_random_uuid()::text;
  original jsonb;
  fresh jsonb;
  other jsonb;
  state jsonb;
  origin timestamptz := now() - interval '8 minutes';
  events bigint;
begin
  if exists (select 1 from public.pmb_tap_product_current where slot_key in ('900002:900002:1', '900003:900003:1')) then
    raise exception 'Test tap already in use';
  end if;
  original := jsonb_build_object('slotKey', '900002:900002:1', 'tapNumber', 900002, 'deviceId', 900002, 'lineNum', 1, 'plu', 900002, 'name', fixture || ' old 1', 'nameKey', fixture || ' old 1');
  fresh := original || jsonb_build_object('name', fixture || ' new 1', 'nameKey', fixture || ' new 1');
  other := original || jsonb_build_object('name', fixture || ' other 1', 'nameKey', fixture || ' other 1');
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original), now() - interval '10 minutes');
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original || '{"name":"Coming Soon","nameKey":"coming soon"}'), now() - interval '9 minutes');
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original), now() - interval '850 seconds');
  select count(*) into events from public.pmb_tap_product_events where slot_key = '900002:900002:1';
  if events <> 1 then raise exception 'Coming Soon created a false product introduction'; end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(fresh), origin, 'confirmed');
  select data into state from public.pmb_tap_product_current where slot_key = '900002:900002:1';
  if state->>'introductionSource' is distinct from 'confirmed'
    or (state->>'introducedAt')::timestamptz is distinct from origin
    or state->'introductionPreviousProduct'->>'name' is distinct from original->>'name' then
    raise exception 'New product introduction was not recorded accurately';
  end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(other), now() - interval '7 minutes');
  perform public.record_pmb_tap_product_observations(jsonb_build_array(fresh || '{"plu":900099}'), now() - interval '6 minutes');
  select data into state from public.pmb_tap_product_current where slot_key = '900002:900002:1';
  if (state->>'introducedAt')::timestamptz is distinct from origin
    or state->'introductionPreviousProduct'->>'name' is distinct from original->>'name' then
    raise exception 'Returning product reset its age or original previous product';
  end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(fresh || jsonb_build_object('slotKey', '900003:900003:1', 'tapNumber', 900003, 'deviceId', 900003, 'name', fixture || ' new 2', 'nameKey', fixture || ' new 2')), now() - interval '5 minutes');
  select data into state from public.pmb_tap_product_current where slot_key = '900003:900003:1';
  if (state->>'introducedAt')::timestamptz is distinct from origin then raise exception 'Moving walls reset product age'; end if;
  perform public.record_pmb_tap_product_observations(jsonb_build_array(original), now() - interval '4 minutes');
  select data into state from public.pmb_tap_product_current where slot_key = '900002:900002:1';
  if state->>'introductionSource' is distinct from 'baseline' then raise exception 'Unknown-age returning product was labeled new'; end if;
end;
$$;
