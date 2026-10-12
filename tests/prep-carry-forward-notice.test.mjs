import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPriorWeekWorkAlert } from '../public/prep-carry-forward.mjs';
import { buildThirtySecondBriefing } from '../public/thirty-second-briefing.mjs';
import { applySharedDashboardPatch, createEmptySharedDashboardData } from '../lib/shared-dashboard-store.mjs';
const prior = { id: 'last-week' };
const current = { id: 'this-week' };
const completion = { cocktailCompleted: 5, cocktailTotal: 8, deliveryChecked: 2, deliveryTotal: 2 };
const moved = { 'last-week': { fromSnapshotId: 'last-week', toSnapshotId: 'this-week', acknowledgedAt: '2026-10-12T20:00:00Z', acknowledgedBy: 'Manager' } };
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
