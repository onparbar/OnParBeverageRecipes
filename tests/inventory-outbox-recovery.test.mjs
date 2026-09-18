import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedKegParAgentStore, createEmptyKegParAgentData } from '../lib/keg-par-agent-shared-store.mjs';
import { createEmptyInventoryState } from '../lib/inventory-store.mjs';

test('durable recovery survives failure and restart, preserves queue, and replays corrections without duplicates', async () => {
  let time = Date.parse('2026-09-15T12:00:00Z');
  const inventoryData = createEmptyInventoryState();
  inventoryData.initialized = true;
  inventoryData.current.onHandOverrides = { juice: '10' };
  const rows = {
    keg_par_agent_shared_state: { id: 'keg-par-agent', revision: 1, initialized: true, data: createEmptyKegParAgentData(), updated_at: new Date(time).toISOString() },
    inventory_shared_state: { id: 'inventory-state', revision: 1, initialized: true, data: inventoryData, updated_at: new Date(time).toISOString() },
  };
  let failInventory = true;
  let loseAcknowledgment = false;
  const fakeFetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.hostname, 'example.invalid');
    const table = url.pathname.split('/').pop();
    assert.ok(Object.hasOwn(rows, table), `Unexpected table: ${table}`);
    if (table === 'inventory_shared_state' && failInventory) throw new Error('Simulated storage outage');
    if (init.method === 'PATCH') {
      const update = JSON.parse(init.body);
      if (table === 'keg_par_agent_shared_state' && loseAcknowledgment
        && !update.data?.inventoryOutbox?.lease) throw new Error('Simulated crash before acknowledgment');
      const revision = Number(url.searchParams.get('revision')?.replace('eq.', ''));
      if (revision !== rows[table].revision) return Response.json([]);
      rows[table] = { ...rows[table], ...update };
    }
    return Response.json([structuredClone(rows[table])]);
  };
  const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_SECRET_KEY: 'test-only-secret' };
  const originalFetch = globalThis.fetch;
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  globalThis.fetch = fakeFetch;
  const store = () => createSharedKegParAgentStore({ env, fetchImpl: fakeFetch, now: () => new Date(time) });
  const plan = quantity => ({ sources: [{ sourceId: 'prep:test-week:juice', contributions: [{ id: 'juice', quantity, baseline: 10 }] }], unmatched: [] });
  const save = async value => {
    const current = await store().read();
    return store().replace({ expectedRevision: current.revision, data: current.data }, 'employee', value);
  };
  try {
    await save(plan(-2));
    const current = await store().read();
    const originalId = current.data.inventoryOutbox.pending[0].id;
    await store().replace({ expectedRevision: current.revision, data: { ...current.data, inventoryOutbox: { pending: [] } } }, 'owner');
    assert.equal(rows.keg_par_agent_shared_state.data.inventoryOutbox.pending[0].id, originalId);
    await assert.rejects(store().recoverInventory());
    assert.equal(rows.keg_par_agent_shared_state.data.inventoryOutbox.pending.length, 1);
    await assert.rejects(store().recoverInventory(), error => error.code === 'INVENTORY_RECOVERY_RUNNING');
    failInventory = false;
    time += 300001;
    loseAcknowledgment = true;
    await assert.rejects(store().recoverInventory());
    assert.equal(rows.inventory_shared_state.data.current.onHandOverrides.juice, '8');
    loseAcknowledgment = false;
    await save(plan(-3));
    time += 300001;
    const recovered = await store().recoverInventory();
    assert.equal(recovered.pending, false);
    assert.equal(rows.inventory_shared_state.data.current.onHandOverrides.juice, '7');
    assert.equal(rows.keg_par_agent_shared_state.data.inventoryOutbox.pending.length, 0);
    await store().recoverInventory();
    assert.equal(rows.inventory_shared_state.data.current.onHandOverrides.juice, '7');
    await save(plan(-12));
    const shortage = await store().recoverInventory();
    assert.match(shortage.warning, /exceed stock.*juice.*Recount/);
    assert.equal(rows.inventory_shared_state.data.current.onHandOverrides.juice, '0');
    assert.equal(rows.inventory_shared_state.data.current.contributionShortfalls.juice, 2);
    await save(plan(0));
    const undone = await store().recoverInventory();
    assert.equal(undone.warning, undefined);
    assert.equal(rows.inventory_shared_state.data.current.onHandOverrides.juice, '10');
    assert.equal(rows.inventory_shared_state.data.current.contributionShortfalls.juice, undefined);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
