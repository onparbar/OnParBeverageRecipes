import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReport, dailyWindows, projectDailyReport, reportDays } from '../lib/pmb-daily-report.mjs';
import { getTapFirstPour } from '../public/tap-first-pour.mjs';
const day = '2026-09-11', now = new Date('2026-09-13T12:00:00Z');
const pour = { tst_start: Date.parse('2026-09-11T21:00:00Z') / 1000, tst_stop: 1789160420, plu: 42, volume_amount: 10, money_amount: 500, price_per_unit: 50, device_id: 8, card_id: 'private-card', customer_hash: 'private-customer' };
const taps = [{ tapNumber: 12, plu: 42, deviceId: 8, lineNum: 1, product: 'Beer 1' }];
const make = (reads, extra = {}) => buildDailyReport({ day, reads, taps, now, ...extra });
test('daily windows pad PMB boundaries and reject incomplete days', () => {
  assert.equal(dailyWindows(day, now)[0].start_time, '2026-09-10T00:00:00-04:00');
  assert.equal(dailyWindows(day, now)[1].start_time, '2026-09-09T00:00:00-04:00');
  assert.throws(() => dailyWindows('2026-09-13', now));
  assert.throws(() => dailyWindows('2026-02-30', now));
  assert.throws(() => reportDays('2025-01-01', '2026-09-11'));
});
test('same pour across windows counts once without storing customer identity', () => {
  const result = make([[pour], [pour]]);
  assert.equal(result.rows[0].volumeOz, 10);
  assert.equal(result.coverage, 'matching-overlapping-reads');
  assert.doesNotMatch(JSON.stringify(result), /private-card|private-customer|card_id|customer_hash/);
});
test('identical records within one report retain multiplicity', () => {
  const result = make([[pour, pour], [pour, pour]]);
  assert.equal(result.rows[0].pours, 2);
  assert.equal(result.rows[0].volumeOz, 20);
});
test('boundary omissions are retained but marked partial', () => {
  const result = make([[], [pour]]);
  assert.equal(result.coverage, 'partial'); assert.equal(result.rows[0].volumeOz, 10);
});
test('empty reads are not confirmed zero days', () => { assert.equal(make([[], []]).coverage, 'empty-unverified'); });
test('malformed data fails rather than becoming zero', () => {
  assert.throws(() => make([[{ ...pour, volume_amount: null }], []]));
  assert.throws(() => make([[{ ...pour, tst_start: null }], []]));
  assert.throws(() => make([null, []]));
});
test('only original Eastern day is included, with midnight exclusive', () => {
  const rows = [pour, { ...pour, tst_start: Date.parse('2026-09-12T04:00:00Z') / 1000 }, { ...pour, tst_start: Date.parse('2026-09-11T03:59:59Z') / 1000 }];
  assert.equal(make([rows, rows]).rows[0].pours, 1);
});
test('current products never masquerade as historical assignments', () => {
  const row = make([[pour], [pour]]).rows[0];
  assert.equal(row.tapNumber, null); assert.equal(row.suggestedTapNumber, 12);
  assert.match(row.assignmentEvidence, /unverified/);
});
test('assignment history uses the event before the pour, not a later replacement', () => {
  const events = [
    { slot_key: '12:8:1', occurred_at: '2026-09-10T12:00:00Z', product: { tapNumber: 12, plu: 42, deviceId: 8, lineNum: 1, name: 'Beer 1' } },
    { slot_key: '12:8:1', occurred_at: '2026-09-12T12:00:00Z', product: { tapNumber: 12, plu: 43, deviceId: 8, lineNum: 1, name: 'New beer' } },
  ];
  const row = make([[pour], [pour]], { events }).rows[0];
  assert.equal(row.tapNumber, 12); assert.equal(row.product, 'Beer 1');
});
test('ambiguous products remain unassigned', () => {
  const row = make([[pour], [pour]], { taps: [...taps, { ...taps[0], tapNumber: 13 }] }).rows[0];
  assert.equal(row.tapNumber, null); assert.equal(row.suggestedTapNumber, null);
});
test('missing money and uncalibrated money do not invent revenue', () => {
  assert.equal(projectDailyReport(make([[pour], [pour]])).rows[0].revenue, null);
  const missing = { ...pour, money_amount: null };
  assert.equal(projectDailyReport(make([[missing], [missing]]), { divisor: 100 }).rows[0].revenue, null);
});
test('calibrated recorded charges and frozen cost snapshot produce an estimate', () => {
  const costs = [{ tapNumber: 12, plu: 42, product: 'Beer 1', costPerOz: 0.2 }];
  const report = make([[pour], [pour]], { costs });
  const row = projectDailyReport(report, { divisor: 100 }).rows[0];
  assert.equal(row.revenue, 5); assert.equal(row.estimatedCost, 2); assert.equal(row.estimatedGrossProfit, 3);
  const updated = make([[pour], [pour]], { previous: report, costs: [{ ...costs[0], costPerOz: 0.8 }] });
  assert.equal(updated.rows[0].costPerOz, 0.2);
});
test('zero charge is a real zero, but missing cost is not free stock', () => {
  const free = { ...pour, money_amount: 0 };
  const row = projectDailyReport(make([[free], [free]]), { divisor: 100 }).rows[0];
  assert.equal(row.revenue, 0); assert.equal(row.estimatedGrossProfit, null);
});
test('hover report never follows a changed PLU or product name', () => {
  const snapshot = { searchedEndDate: day, hasCoverageGaps: true, rows: [{ tapNumber: 12, plu: 42, product: 'Beer 1', firstRecordedPourAt: '2026-09-11T21:00:00Z' }] };
  assert.match(getTapFirstPour({ tapNumber: 12, plu: 42, name: 'Beer 1' }, snapshot).note, /unavailable/);
  assert.equal(getTapFirstPour({ tapNumber: 12, plu: 43, name: 'Beer 1' }, snapshot), null);
  assert.equal(getTapFirstPour({ tapNumber: 12, plu: 42, name: 'New beer' }, snapshot), null);
});
