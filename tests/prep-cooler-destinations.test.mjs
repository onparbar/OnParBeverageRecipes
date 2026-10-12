import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPrepKegCounts } from '../lib/prep-keg-counts.mjs';
import { buildStaffPrepPlan, applyStaffPrepPlanUpdate } from '../lib/staff-prep-plan.mjs';

const main = 'main-58-boozy-cucumber-lemonade-ketel-one-1';
const karaoke = 'karaoke-98-boozy-cucumber-lemonade-ketel-one-2';
const addition = 'prep-addition:test';
function fixture(extra = {}) {
  return { onHandOverrides: { [main]: '0', [karaoke]: '2' }, onDeckOverrides: {}, recommendations: {
    generatedAt: '2026-10-07T16:07:17.557Z', items: [{ key: addition, prepAdditionId: 'test',
      name: 'Boozy Cucumber Lemonade (Ketel One) 1', wall: 'Main', tapNumber: 58,
      actionType: 'make', isKegTap: true, orderQty: 1, ...extra }],
  } };
}
function check(state, completed = true) {
  const target = buildStaffPrepPlan(state.recommendations).items[0];
  const update = { itemId: target.id, generatedAt: state.recommendations.generatedAt, completed, preparedBy: 'Molly Adams' };
  const recommendations = applyStaffPrepPlanUpdate(state.recommendations, update);
  return applyPrepKegCounts(state, recommendations, [{ target, update }]);
}

test('an added batch credits its physical cooler, retains the checkoff, and retries only once', () => {
  const state = fixture({ inventoryKey: main });
  const next = check(state);
  assert.equal(next.onHandOverrides[main], '1');
  assert.equal(next.onHandOverrides[karaoke], '2');
  assert.equal(next.onHandOverrides[addition], undefined);
  assert.equal(buildStaffPrepPlan(next.recommendations).items[0].preparedBy, 'Molly Adams');
  assert.deepEqual(check(next).onHandOverrides, next.onHandOverrides);
  assert.equal(check(next, false).onHandOverrides[main], '0');
  assert.equal(state.onHandOverrides[main], '0');
});

test('existing added rows resolve the same tap even when it was absent from the original prep list', () => {
  assert.equal(check(fixture()).onHandOverrides[main], '1');
});

test('Washington Apple credits its own main cooler entry', () => {
  const key = 'main-71-washington-apple-crown-royal-apple-1';
  const state = fixture({ name: 'Washington Apple (Crown Royal Apple) 1', tapNumber: 71 });
  state.onHandOverrides[key] = '0';
  const next = check(state);
  assert.equal(next.onHandOverrides[key], '1');
  assert.equal(next.onHandOverrides[main], '0');
});

test('ambiguous or missing destinations block completion without creating invisible inventory', () => {
  const ambiguous = fixture();
  ambiguous.onHandOverrides['main-58-other-product'] = '0';
  for (const state of [ambiguous, fixture({ tapNumber: 0 }), fixture({ inventoryKey: karaoke })]) {
    const original = structuredClone(state);
    assert.throws(() => check(state), /cooler destination/);
    assert.deepEqual(state, original);
  }
});

test('an On Deck added batch credits the physical On Deck count', () => {
  const state = fixture({ inventoryKey: main, onDeckProduct: { name: 'Boozy Cucumber Lemonade (Ketel One) 1' } });
  state.onDeckOverrides[main] = { name: 'Boozy Cucumber Lemonade (Ketel One) 1', onHand: '2' };
  const next = check(state);
  assert.equal(next.onDeckOverrides[main].onHand, '3');
  assert.equal(next.onHandOverrides[main], '0');
  assert.equal(check(next, false).onDeckOverrides[main].onHand, '2');
});

test('reopening an old misplaced completion reverses its original credit safely', () => {
  const state = fixture();
  const target = buildStaffPrepPlan(state.recommendations).items[0];
  state.recommendations = applyStaffPrepPlanUpdate(state.recommendations, {
    itemId: target.id, generatedAt: state.recommendations.generatedAt, completed: true, preparedBy: 'Molly Adams',
  });
  state.recommendations.prepKegContributions = { [target.id]: { quantity: 1 } };
  state.onHandOverrides[addition] = '1';
  const reopened = check(state, false);
  assert.equal(reopened.onHandOverrides[addition], '0');
  assert.equal(reopened.onHandOverrides[main], '0');
  assert.equal(check(reopened).onHandOverrides[main], '1');
});
