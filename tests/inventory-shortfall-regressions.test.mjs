import assert from 'node:assert/strict';
import test from 'node:test';
import { applyInventoryStateAction, createEmptyInventoryState, normalizeInventoryState } from '../lib/inventory-store.mjs';
import { InventoryBackedOperationError, executeInventoryBackedOperation } from '../lib/inventory-backed-operation.mjs';

const start = (amount = 1) => applyInventoryStateAction(createEmptyInventoryState(), 'initialize', { onHandOverrides: { vodka: String(amount) } });
const change = (state, sourceId, quantity, options = {}) => applyInventoryStateAction(state, 'apply-contributions', {
  sources: [{ sourceId, ...options, contributions: quantity ? [{ id: 'vodka', quantity, baseline: 1 }] : [] }],
});
const balance = state => Number(state.current.onHandOverrides.vodka);
const shortfall = state => state.current.contributionShortfalls.vodka || 0;

test('short prep deductions undo exactly after persistence and repeated retries', () => {
  let state = change(start(), 'prep', -2);
  assert.equal(balance(state), 0);
  assert.equal(shortfall(state), 1);
  state = normalizeInventoryState(JSON.parse(JSON.stringify(state)));
  state = change(state, 'prep', -2);
  assert.equal(shortfall(state), 1);
  state = change(state, 'prep', 0);
  assert.equal(balance(state), 1);
  assert.equal(shortfall(state), 0);
  assert.equal(balance(change(state, 'prep', 0)), 1);
});

test('partial corrections preserve the signed balance instead of repeatedly clamping it', () => {
  let state = change(start(), 'prep', -3);
  state = change(state, 'prep', -2);
  assert.equal(balance(state), 0);
  assert.equal(shortfall(state), 1);
  state = change(state, 'prep', -0.5);
  assert.equal(balance(state), 0.5);
  assert.equal(shortfall(state), 0);
  assert.equal(balance(change(state, 'prep', 0)), 1);
});

test('a receipt between prep and undo is retained exactly once', () => {
  let state = change(start(), 'prep', -2);
  state = change(state, 'delivery', 5);
  assert.equal(balance(state), 4, 'receipt offsets the recorded one-bottle shortage');
  state = change(state, 'delivery', 5);
  state = change(state, 'prep', 0);
  assert.equal(balance(state), 6);
});

test('undoing a consumed receipt and then undoing prep does not create stock', () => {
  let state = change(start(0), 'delivery', 5);
  state = change(state, 'prep', -5);
  state = change(state, 'delivery', 0);
  assert.equal(balance(state), 0);
  assert.equal(shortfall(state), 5);
  state = change(state, 'prep', 0);
  assert.equal(balance(state), 0);
  assert.equal(shortfall(state), 0);
});

test('manual counts replace the shortage baseline without losing retry identity', () => {
  for (const action of ['update-field', 'batch-update-fields']) {
    let state = change(start(), 'prep', -2);
    const field = { id: 'vodka', field: 'onHand', value: '7' };
    state = applyInventoryStateAction(state, action, action === 'update-field' ? field : { changes: [field] });
    assert.equal(shortfall(state), 0);
    assert.equal(balance(change(state, 'prep', -2)), 7);
    assert.equal(balance(change(state, 'delivery', 1)), 8);
  }
});

test('historical contributions before a physical count do not recreate a shortage', () => {
  let state = change(start(), 'prep', -2);
  state = applyInventoryStateAction(state, 'update-field', { id: 'vodka', field: 'onHand', value: '7' }, 'owner', new Date('2026-09-17T12:00:00Z'));
  state = change(state, 'prep', -4, { effectiveAt: '2026-09-16T12:00:00Z' });
  assert.equal(balance(state), 7);
  assert.equal(shortfall(state), 0);
});

test('independent prep and receipt corrections are order-independent below zero', () => {
  const events = [['a', -2], ['b', -3], ['delivery', 2]];
  for (const order of [events, [...events].reverse(), [events[1], events[2], events[0]]]) {
    let state = start();
    for (const [id, quantity] of order) state = change(state, id, quantity);
    assert.equal(balance(state), 0);
    assert.equal(shortfall(state), 2);
    for (const [id] of order) state = change(state, id, 0);
    assert.equal(balance(state), 1);
    assert.equal(shortfall(state), 0);
  }
});

test('older clamped deductions require a recount rather than guessing a stock credit', () => {
  let state = start(0);
  state.current.inventoryContributions = {
    'prep::vodka': { sourceId: 'prep', itemId: 'vodka', quantity: -2, baseline: 1, updatedAt: '2026-09-16T12:00:00Z' },
  };
  state = change(state, 'prep', -2);
  assert.equal(state.current.inventoryContributions['prep::vodka'].balanceVersion, 0, 'a retry cannot silently upgrade unverified accounting');
  assert.throws(() => change(state, 'prep', 0), error => {
    assert.equal(error.code, 'INVENTORY_RECOUNT_REQUIRED');
    assert.match(new InventoryBackedOperationError('inventory', error).message, /waiting for a recount.*vodka/);
    return true;
  });
  state = applyInventoryStateAction(state, 'update-field', { id: 'vodka', field: 'onHand', value: '7' }, 'owner', new Date('2026-09-17T12:00:00Z'));
  state = change(state, 'prep', -2);
  assert.equal(state.current.inventoryContributions['prep::vodka'].balanceVersion, 0);
  state = change(state, 'prep', 0);
  assert.equal(balance(state), 7, 'a physical recount settles the old, unverified deduction');
});

test('a physical recount clears shortages while future movements use the new count', () => {
  let state = change(start(), 'prep', -2);
  state = applyInventoryStateAction(state, 'update-field', { id: 'vodka', field: 'onHand', value: '7' });
  state = change(state, 'prep', 0);
  assert.equal(balance(state), 9, 'a verified post-count reversal returns the two recorded bottles');
  assert.equal(shortfall(state), 0);
});

test('a recount requirement survives the checklist recovery path without being masked by retries', async () => {
  let writes = 0;
  let attempts = 0;
  await assert.rejects(executeInventoryBackedOperation({
    plan: {}, assertPlan() {}, persist: async () => { writes++; return {}; },
    applyInventory: async () => {
      attempts++;
      throw Object.assign(new Error('Recount vodka before correcting this older prep entry.'), { code: 'INVENTORY_RECOUNT_REQUIRED', status: 409 });
    },
    wait: async () => { assert.fail('manual recount cannot be resolved by retrying'); },
    recordActivity: async () => {},
  }), /inventory correction is waiting for a recount.*vodka/);
  assert.equal(writes, 1);
  assert.equal(attempts, 1);
});
