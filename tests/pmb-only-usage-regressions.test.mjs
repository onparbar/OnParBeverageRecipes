import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { getPmbWeeklyUsageRange } from '../public/pmb-weekly-usage-policy.mjs';
import { isUsableWeeklyUsageEntry, retainPmbWeeklyUsageItems, retainPmbWeeklyUsageOverrides } from '../public/weekly-usage-evidence.mjs';
import { buildWeeklyUsageSellerRankings } from '../public/weekly-usage-seller-rankings.mjs';
import { getEightWeekPeakUsage } from '../public/keg-demand-policy.mjs';
import { getWeeklyUsageEntryPouredOz, buildWeeklyUsagePerformance } from '../public/weekly-usage-performance.mjs';

const label = '9/7/26 - 9/13/26';
const pmb = { label, source: 'PMB', value: 0.5, volumeOz: 992 };
const legacy = { label: '8/31/26 - 9/6/26', value: 999 };

test('only valid PMB weekly readings reach usage, profit inputs, and order demand', () => {
  const csv = { ...pmb, source: 'CSV', value: 999, volumeOz: 999999 };
  const item = { id: 'beer', name: 'Beer', tapNumber: 21, displayUnit: 'kegs', history: [pmb, legacy, csv] };
  for (const entry of [legacy, csv]) {
    assert.equal(isUsableWeeklyUsageEntry(entry), false);
    assert.equal(getWeeklyUsageEntryPouredOz(item, entry, () => 1984), null);
  }
  const result = buildWeeklyUsageSellerRankings([item], { getFullOunces: () => 1984 });
  assert.equal(result.recordedWeekCount, 1);
  assert.equal(result.allTime.top[0].totalOz, 992);
  assert.equal(result.quality.ignoredEntryCount, 2);
  assert.equal(getEightWeekPeakUsage(item, new Date('2026-09-17T12:00:00Z'), 1984).targetStock, 0.625);
  assert.equal(isUsableWeeklyUsageEntry({ ...pmb, source: undefined }), true, 'older exact PMB captures remain readable');
  const performance = buildWeeklyUsagePerformance([{ ...item, history: [pmb, { ...pmb, label: '9/14/26 - 12/31/26' }] }]);
  assert.equal(performance.latestLabel, label);
});

test('PMB periods require two real dates and exactly Monday through Sunday', () => {
  for (const invalid of ['08/25/25-11/2/25', '11/25/25-12/01/25', '9/7/26', '9/7/26 - 9/14/26',
    '9/7/26 - 9/6/26', '2/30/26 - 3/8/26', '9/8/26 - 9/14/26', '9/7/26 - 9/13/26 extra']) {
    assert.equal(getPmbWeeklyUsageRange(invalid), null, invalid);
    assert.equal(isUsableWeeklyUsageEntry({ ...pmb, label: invalid }), false, invalid);
  }
  for (const valid of [label, '12/29/25 - 1/4/26', '2/26/24 - 3/3/24', '3/2/26 – 3/8/26', '10/26/2026—11/1/2026']) {
    assert.ok(getPmbWeeklyUsageRange(valid), valid);
  }
});

test('long and overlapping legacy periods cannot enter all-time averages even with PMB labels', () => {
  const history = ['08/25/25-11/2/25', '11/25/25-12/01/25', '12/1/25-12/7/25']
    .map(label => ({ label, source: 'PMB', volumeOz: 100 }));
  const result = buildWeeklyUsageSellerRankings([{ name: 'Beer', tapNumber: 21, history }]);
  assert.equal(result.recordedWeekCount, 1);
  assert.equal(result.allTime.top[0].totalOz, 100);
  assert.equal(result.quality.ignoredEntryCount, 2);
  const conflict = buildWeeklyUsageSellerRankings([{ name: 'Beer', tapNumber: 21, history: [pmb, { ...pmb, volumeOz: 2000 }] }]);
  assert.equal(conflict.quality.conflictingSampleCount, 1);
  assert.equal(conflict.allTime.eligibleCount, 0);
});

test('shared loads and pending-write recovery exclude CSV histories while preserving PMB evidence', () => {
  const source = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  const declarations = ['applySharedWeeklyUsageState', 'restoreWeeklyUsageFromOutbox'].map(name => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\n}\n', start) + 2);
  }).join('\n');
  const data = { activeItems: [{ id: 'beer', average: 999, history: [pmb, legacy] }],
    archivedItems: [{ id: 'old', history: [legacy] }], historyOverrides: { beer: [pmb, legacy] }, currentOverrides: {}, lastSyncAt: '' };
  const context = vm.createContext({
    retainPmbWeeklyUsageItems, retainPmbWeeklyUsageOverrides,
    clean: value => String(value || ''), cloneWeeklyUsageValue: value => structuredClone(value),
    saveWeeklyUsageCurrentOverrides() {}, saveWeeklyUsageHistoryOverrides() {}, saveWeeklyUsageArchivedItems() {}, saveWeeklyUsageLastSyncAt() {},
    weeklyUsageSharedOutbox: { payload: { data } },
  });
  vm.runInContext(declarations, context);
  context.applySharedWeeklyUsageState({ initialized: true, revision: 10, data });
  assert.equal(context.weeklyUsageItems[0].history.length, 1);
  assert.equal(context.weeklyUsageItems[0].average, 0.5);
  assert.equal(context.weeklyUsageArchivedItems[0].history.length, 0);
  assert.equal(context.weeklyUsageSharedBaseline.activeItems[0].history.length, 2, 'retain the original revision baseline for safe merging');
  assert.equal(context.restoreWeeklyUsageFromOutbox(), true);
  assert.equal(context.weeklyUsageItems[0].history.length, 1);
  assert.equal(context.weeklyUsageHistoryOverrides.beer.length, 1);
  assert.equal(data.activeItems[0].history.length, 2, 'source records are not mutated by display filtering');
  assert.doesNotMatch(source, /fetchOptionalCsv\(WEEKLY_USAGE_(?:EXTRA_)?CSV_PATH\)/);
});
