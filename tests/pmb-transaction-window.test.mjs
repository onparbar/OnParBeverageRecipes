import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPmbTransactionWindow } from '../lib/pmb-transaction-window.mjs';
import { pmbLocalMidnight } from '../lib/pmb-first-pour-report.mjs';

const window = { start_time: '2025-12-01T00:00:00-05:00', end_time: '2025-12-08T00:00:00-05:00' };
const row = (date, milliseconds = false) => ({ tst_start: Date.parse(date) / (milliseconds ? 1 : 1000), volume_amount: 3 });
test('PMB boundary pours belong to exactly one week, with seconds or milliseconds', () => {
  const before = row('2025-12-01T04:59:59Z');
  const first = row('2025-12-01T05:00:00Z');
  const last = row('2025-12-08T04:59:59Z', true);
  const next = row('2025-12-08T05:00:00Z', true);
  assert.deepEqual(filterPmbTransactionWindow([before, first, last, next], window), [first, last]);
  assert.deepEqual(filterPmbTransactionWindow([last, next], { start_time: window.end_time, end_time: '2025-12-15T00:00:00-05:00' }), [next]);
});
test('a PMB week spanning DST uses Eastern calendar midnights', () => {
  const bounds = { start_time: pmbLocalMidnight(Date.parse('2026-03-02')), end_time: pmbLocalMidnight(Date.parse('2026-03-09')) };
  assert.equal((Date.parse(bounds.end_time) - Date.parse(bounds.start_time)) / 3600000, 167);
  const last = row('2026-03-09T03:59:59Z');
  assert.deepEqual(filterPmbTransactionWindow([last, row('2026-03-09T04:00:00Z')], bounds), [last]);
});
test('pre-delivery totals exclude Thursday at and after 9am', () => {
  const before = row('2025-12-04T13:59:59Z');
  assert.deepEqual(filterPmbTransactionWindow([before, row('2025-12-04T14:00:00Z')], { ...window, end_time: '2025-12-04T09:00:00-05:00' }), [before]);
});
test('missing or malformed pour timestamps fail instead of inventing report membership', () => {
  for (const tst_start of [null, undefined, '', 'no date', -1, 0, Infinity, '9'.repeat(30)]) {
    assert.throws(() => filterPmbTransactionWindow([{ tst_start }], window), /timestamp/);
  }
  assert.throws(() => filterPmbTransactionWindow([], { start_time: 'invalid', end_time: window.end_time }));
});
test('filtering preserves legitimate identical pours and does not mutate the source', () => {
  const pour = Object.freeze(row('2025-12-03T20:00:00Z'));
  const rows = Object.freeze([pour, pour]);
  assert.deepEqual(filterPmbTransactionWindow(rows, window), [pour, pour]);
});
