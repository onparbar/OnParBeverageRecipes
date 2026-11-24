import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPriorWeekWorkAlert } from '../public/prep-carry-forward.mjs';
import { getWeeklySnapshotCompletionSummary } from '../public/weekly-snapshot-view.mjs';
import { buildThirtySecondBriefing } from '../public/thirty-second-briefing.mjs';
import { applySharedDashboardPatch, createEmptySharedDashboardData } from '../lib/shared-dashboard-store.mjs';
const prior = { id: 'last-week' };
const current = { id: 'this-week' };
const completion = { cocktailCompleted: 5, cocktailTotal: 8, deliveryChecked: 2, deliveryTotal: 2 };
const moved = { 'last-week': { fromSnapshotId: 'last-week', toSnapshotId: 'this-week', acknowledgedAt: '2026-10-12T20:00:00Z', acknowledgedBy: 'Manager' } };
test('Home counts signed checkoffs in the selected weekly snapshot', () => {
  const saved = {
    generatedAt: '2026-10-05T16:00:00Z',
    deliveries: [{ id: 'supplier', vendor: 'Proof', items: [
      { id: 'juice', name: 'Juice', status: 'partial', handledBy: 'Staff' },
      { id: 'lime', name: 'Lime', status: 'received' },
    ] }],
    cocktails: [{ id: 'batch', name: 'Margarita', completed: true, preparedBy: 'Staff' }],
    liquorRefills: [null, { id: 'refill', name: 'Vodka', completed: false }],
  };
  const summary = getWeeklySnapshotCompletionSummary({ ...prior, completion: saved });
  assert.deepEqual(summary, { deliveryChecked: 1, deliveryTotal: 2, deliveryExceptions: 1,
    cocktailCompleted: 1, cocktailTotal: 1, liquorRefillCompleted: 0, liquorRefillTotal: 1 });
  assert.match(buildPriorWeekWorkAlert(prior, summary, current).message, /1 of 2 checked/);
});
test('carry-forward button clears only the old prep warning and preserves historical completion', () => {
  const before = structuredClone(completion);
  const alert = buildPriorWeekWorkAlert(prior, completion, current);
  const lines = buildThirtySecondBriefing({ overview: { alerts: [alert] } }).lines;
  assert.equal(lines[0].actionLabel, 'Prep moved to this week');
  assert.equal(lines[0].target, 'prep-carried-forward:last-week');
  assert.equal(buildPriorWeekWorkAlert(prior, completion, current, moved), null);
  assert.deepEqual(completion, before);
  const deliveryAlert = buildPriorWeekWorkAlert(prior, { ...completion, deliveryChecked: 1 }, current, moved);
  assert.match(deliveryAlert.message, /Deliveries/);
  assert.doesNotMatch(deliveryAlert.message, /Cocktails/);
  assert.equal(deliveryAlert.actionLabel, undefined);
});
test('acknowledgement is scoped to the old snapshot and requires a distinct destination', () => {
  assert.ok(buildPriorWeekWorkAlert({ id: 'another-week' }, completion, current, moved));
  assert.ok(buildPriorWeekWorkAlert(prior, completion, current, { 'last-week': { ...moved['last-week'], toSnapshotId: 'last-week' } }));
  assert.equal(buildPriorWeekWorkAlert(prior, completion, null).actionLabel, undefined);
});
test('carry-forward review persists through the shared dashboard patch', () => {
  const data = applySharedDashboardPatch(createEmptySharedDashboardData(), { monitoring: { prepCarryForwards: moved } });
  assert.deepEqual(data.monitoring.prepCarryForwards, moved);
});
