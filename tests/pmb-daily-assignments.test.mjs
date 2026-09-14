import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileDailyReportAssignments } from '../lib/pmb-daily-assignments.mjs';

const row = { tapNumber: null, suggestedTapNumber: 22, plu: 38111, product: 'Miller Lite 1',
  pours: 1, volumeOz: 11, moneyRaw: 4.18, costPerOz: 0.065,
  assignmentEvidence: 'Current product match; historical tap unverified' };
const report = (day = '2026-09-12') => ({ day, rows: [{ ...row }], coverage: 'matching-overlapping-reads' });
const observation = (occurred_at, changes = {}) => ({ occurred_at, slot_key: '22:8:1',
  product: { tapNumber: 22, plu: 38111, name: 'Miller Lite 1', ...changes } });
function snapshot() {
  return { id: 'inventory-2026-09-07', savedAt: '2026-09-07T19:59:26Z',
    summary: { tapCount: 2, liveTapCount: 2, pmbUpdatedAt: '2026-09-07T19:59:18Z' },
    captureMetadata: { sourceFreshness: { pmb: 'verified' }, sourceTimestamps: { pmb: '2026-09-07T19:59:18Z' } },
    kegPlanSnapshot: { generatedAt: '2026-09-07T19:59:23Z', items: [], tapInputs: [
      { tapNumber: 22, name: 'Miller Lite 1' }, { tapNumber: 24, name: 'Pabst Blue Ribbon 1' },
    ] } };
}
test('an earlier verified snapshot resolves the midnight gap without changing pour totals or source records', () => {
  const input = report();
  const before = structuredClone(input);
  const result = reconcileDailyReportAssignments(input, { snapshots: [snapshot()], events: [observation('2026-09-12T04:48:00Z')] });
  assert.equal(result.rows[0].tapNumber, 22);
  assert.equal(result.rows[0].suggestedTapNumber, null);
  for (const key of ['pours', 'volumeOz', 'moneyRaw', 'costPerOz']) assert.equal(result.rows[0][key], row[key]);
  assert.equal(result.rows[0].assignmentResolution.sources[0].reference, 'inventory-2026-09-07');
  assert.deepEqual(input, before);
});
test('a later baseline alone is not backdated over earlier pours', () => {
  const input = report();
  assert.deepEqual(reconcileDailyReportAssignments(input, { events: [observation('2026-09-12T04:48:00Z')] }), input);
});
test('reports older than available history keep their unknown tap', () => {
  assert.equal(reconcileDailyReportAssignments(report('2026-09-06'), { snapshots: [snapshot()] }).rows[0].tapNumber, null);
});
test('the suggested tap never overrides the saved historical tap', () => {
  const input = report(); input.rows[0].suggestedTapNumber = 99;
  assert.equal(reconcileDailyReportAssignments(input, { snapshots: [snapshot()] }).rows[0].tapNumber, 22);
});
test('same names on multiple historical taps remain ambiguous', () => {
  const saved = snapshot(); saved.kegPlanSnapshot.tapInputs[1].name = 'Miller Lite 1';
  assert.equal(reconcileDailyReportAssignments(report(), { snapshots: [saved] }).rows[0].tapNumber, null);
});
test('wall suffixes and explicit historical PLUs must agree', () => {
  const saved = snapshot(); saved.kegPlanSnapshot.tapInputs[0].name = 'Miller Lite 2';
  assert.equal(reconcileDailyReportAssignments(report(), { snapshots: [saved] }).rows[0].tapNumber, null);
  saved.kegPlanSnapshot.tapInputs[0] = { tapNumber: 22, name: 'Miller Lite 1', plu: 999 };
  assert.equal(reconcileDailyReportAssignments(report(), { snapshots: [saved] }).rows[0].tapNumber, null);
});
test('a product change during the report day cannot resolve a whole-day aggregate', () => {
  assert.equal(reconcileDailyReportAssignments(report(), { snapshots: [snapshot()],
    events: [observation('2026-09-12T16:00:00Z', { plu: 999, name: 'New Beer 1' })] }).rows[0].tapNumber, null);
});
test('conflicting simultaneous history entries do not become a confirmed assignment', () => {
  assert.equal(reconcileDailyReportAssignments(report(), { events: [observation('2026-09-11T16:00:00Z'),
    observation('2026-09-11T16:00:00Z', { plu: 999, name: 'New Beer 1' })] }).rows[0].tapNumber, null);
});
test('incomplete or stale snapshots are not historical proof', () => {
  for (const invalidate of [
    saved => { saved.summary.liveTapCount = 1; },
    saved => { saved.captureMetadata.sourceFreshness.pmb = 'stale'; },
    saved => { saved.kegPlanSnapshot.tapInputs.pop(); },
    saved => { saved.savedAt = '2026-09-07T18:00:00Z'; },
  ]) {
    const saved = snapshot(); invalidate(saved);
    assert.equal(reconcileDailyReportAssignments(report(), { snapshots: [saved] }).rows[0].tapNumber, null);
  }
});
test('a PMB-recorded tap remains authoritative', () => {
  const input = report(); input.rows[0].tapNumber = 12;
  assert.deepEqual(reconcileDailyReportAssignments(input, { snapshots: [snapshot()] }), input);
});
test('Eastern midnight uses the correct offset on both daylight-saving transitions', () => {
  const fall = reconcileDailyReportAssignments(report('2026-11-01'), { events: [observation('2026-11-01T04:30:00Z')] });
  assert.equal(fall.rows[0].tapNumber, null);
  const spring = reconcileDailyReportAssignments(report('2026-03-08'), { events: [observation('2026-03-08T04:30:00Z')] });
  assert.equal(spring.rows[0].tapNumber, 22);
});
test('malformed report dates are left untouched', () => {
  const input = report('2026-02-30');
  assert.deepEqual(reconcileDailyReportAssignments(input, { snapshots: [snapshot()] }), input);
});
