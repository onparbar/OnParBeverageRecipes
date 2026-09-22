import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { getPmbWeeklyUsageRange } from '../public/pmb-weekly-usage-policy.mjs';
import { isUsableWeeklyUsageEntry, retainWeeklyUsageItems, retainWeeklyUsageOverrides, selectWeeklyUsageHistory, mergeWeeklyUsageCsvFallbackData } from '../public/weekly-usage-evidence.mjs';
import { buildWeeklyUsageSellerRankings } from '../public/weekly-usage-seller-rankings.mjs';
import { getEightWeekPeakUsage } from '../public/keg-demand-policy.mjs';
import { getWeeklyUsageEntryPouredOz, buildWeeklyUsagePerformance } from '../public/weekly-usage-performance.mjs';

const label = '9/7/26 - 9/13/26';
const pmb = { label, source: 'PMB', value: 0.5, volumeOz: 992 };
const legacy = { label: '8/31/26 - 9/6/26', value: 0.25, hasValue: true };

test('CSV fills missing weeks while PMB wins the same week in rankings and demand', () => {
  const csv = { ...pmb, source: 'CSV', value: 999, volumeOz: 999999 };
  const item = { id: 'beer', name: 'Beer', tapNumber: 21, displayUnit: 'kegs', history: [pmb, legacy, csv] };
  for (const entry of [legacy, csv]) {
    assert.equal(isUsableWeeklyUsageEntry(entry), true);
    assert.ok(getWeeklyUsageEntryPouredOz(item, entry, () => 1984) > 0);
  }
  const result = buildWeeklyUsageSellerRankings([item], { getFullOunces: () => 1984 });
  assert.equal(result.recordedWeekCount, 2);
  assert.equal(result.allTime.top[0].totalOz, 1488);
  assert.equal(result.quality.ignoredEntryCount, 1);
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

test('shared loads and pending-write recovery preserve CSV gaps and the original revision baseline', () => {
  const source = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  const declarations = ['applySharedWeeklyUsageState', 'restoreWeeklyUsageFromOutbox'].map(name => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf('\n}\n', start) + 2);
  }).join('\n');
  const data = { activeItems: [{ id: 'beer', average: 999, history: [pmb, legacy] }],
    archivedItems: [{ id: 'old', history: [legacy] }], historyOverrides: { beer: [pmb, legacy] }, currentOverrides: {}, lastSyncAt: '' };
  const context = vm.createContext({
    retainWeeklyUsageItems, retainWeeklyUsageOverrides, mergeWeeklyUsageCsvFallbackData, weeklyUsageCsvFallbackItems: [],
    clean: value => String(value || ''), cloneWeeklyUsageValue: value => structuredClone(value),
    saveWeeklyUsageCurrentOverrides() {}, saveWeeklyUsageHistoryOverrides() {}, saveWeeklyUsageArchivedItems() {}, saveWeeklyUsageLastSyncAt() {},
    weeklyUsageSharedOutbox: { payload: { data } },
  });
  vm.runInContext(declarations, context);
  context.applySharedWeeklyUsageState({ initialized: true, revision: 10, data });
  assert.equal(context.weeklyUsageItems[0].history.length, 2);
  assert.equal(context.weeklyUsageItems[0].average, 0.375);
  assert.equal(context.weeklyUsageArchivedItems[0].history.length, 1);
  assert.equal(context.weeklyUsageSharedBaseline.activeItems[0].history.length, 2, 'retain the original revision baseline for safe merging');
  assert.equal(context.restoreWeeklyUsageFromOutbox(), true);
  assert.equal(context.weeklyUsageItems[0].history.length, 2);
  assert.equal(context.weeklyUsageHistoryOverrides.beer.length, 2);
  assert.equal(data.activeItems[0].history.length, 2, 'source records are not mutated by display filtering');
  assert.match(source, /fetchOptionalCsv\(WEEKLY_USAGE_(?:EXTRA_)?CSV_PATH\)/);
});

test('PMB priority survives alternate labels, order, and verified zero readings', () => {
  const csv = { label: '09/07/2026-09/13/2026', source: 'CSV', value: 99, hasValue: true };
  for (const rows of [[csv, pmb], [pmb, csv]]) {
    const selected = selectWeeklyUsageHistory(rows);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].source, 'PMB');
    assert.equal(selected[0].volumeOz, 992);
  }
  assert.equal(selectWeeklyUsageHistory([csv, { ...pmb, value: 0, volumeOz: 0, zeroUsageVerified: true }])[0].value, 0);
});

test('unusable PMB readings fall back to CSV but blanks and uncertain zeros do not become answers', () => {
  const csv = { label, source: 'CSV', value: 2, hasValue: true };
  for (const missing of [{ ...pmb, hasValue: false }, { ...pmb, usageUnknownReason: 'Missing' }, { ...pmb, volumeOz: 0, value: 0 }]) {
    assert.equal(selectWeeklyUsageHistory([missing, csv])[0].source, 'CSV');
  }
  assert.equal(isUsableWeeklyUsageEntry({ ...csv, value: 0 }), true);
  for (const value of ['', null, -1, 'not a number']) assert.equal(isUsableWeeklyUsageEntry({ ...csv, value }), false);
  assert.equal(isUsableWeeklyUsageEntry({ ...csv, value: 0, hasValue: undefined }), false);
  assert.equal(isUsableWeeklyUsageEntry({ ...csv, source: 'GoTab sales' }), false);
});

test('CSV fallback never moves an old product onto the replacement or another wall', () => {
  const data = { activeItems: [{ id: 'new', tapNumber: 21, name: 'New Beer', history: [pmb] },
    { id: 'other-wall', tapNumber: 73, name: 'Old Beer', history: [] }], archivedItems: [], historyOverrides: {}, currentOverrides: { new: 3 }, lastSyncAt: 'unchanged' };
  const fallback = [{ id: 'old', tapNumber: 21, name: 'Old Beer', displayUnit: 'kegs', history: [legacy] }];
  const next = mergeWeeklyUsageCsvFallbackData(data, fallback);
  assert.equal(next.activeItems[0].history.length, 1);
  assert.equal(next.activeItems[1].history.length, 0);
  assert.equal(next.archivedItems[0].name, 'Old Beer');
  assert.equal(next.archivedItems[0].history[0].source, 'CSV');
  assert.deepEqual(next.currentOverrides, data.currentOverrides);
  assert.equal(next.lastSyncAt, 'unchanged');
  assert.equal(data.archivedItems.length, 0);
});

test('same-product CSV backfill merges both visible history and saved overrides without replacing PMB', () => {
  const data = { activeItems: [{ id: 'beer', tapNumber: 21, name: 'Beer', history: [pmb] }], archivedItems: [], historyOverrides: { beer: [pmb] } };
  const next = mergeWeeklyUsageCsvFallbackData(data, [{ id: 'beer', tapNumber: 21, name: 'Beer', history: [legacy, { label, source: 'CSV', value: 99 }] }]);
  assert.equal(next.activeItems[0].history.length, 2);
  assert.equal(next.activeItems[0].history[0].source, 'PMB');
  assert.deepEqual(next.activeItems[0].history, next.historyOverrides.beer);
  assert.deepEqual(mergeWeeklyUsageCsvFallbackData(next, [{ id: 'beer', tapNumber: 21, name: 'Beer', history: [legacy] }]), next);
});

test('PMB takes priority across active and archived observations before profit eligibility', () => {
  const current = { id: 'beer', name: 'Beer', tapNumber: 21, history: [pmb] };
  const archived = { ...current, id: 'old-beer', hidden: true, history: [{ label, source: 'CSV', value: 99, hasValue: true }] };
  for (const items of [[current, archived], [archived, current]]) {
    const result = buildWeeklyUsageSellerRankings(items, {
      metric: 'profit', getFullOunces: () => 1984,
      getGrossProfitPerOz: item => item.id === 'beer' ? 2 : null,
    });
    assert.equal(result.allTime.top[0].totalGrossProfit, 1984);
    assert.equal(result.quality.conflictingSampleCount, 0);
    assert.equal(result.quality.unavailableProfitSampleCount, 0);
  }
});

test('CSV bootstrap does not duplicate or override an already answered CSV week', () => {
  const current = { id: 'beer', name: 'Beer', tapNumber: 21, history: [legacy, pmb] };
  const saved = { activeItems: [current], archivedItems: [], historyOverrides: {} };
  const result = mergeWeeklyUsageCsvFallbackData(saved, [{ ...current, history: [{ ...legacy, value: 99, sourceFile: 'weekly-usage-history.csv' }] }]);
  assert.equal(result.activeItems[0].history.length, 2);
  assert.equal(result.activeItems[0].average, 0.375);
});

test('known CSV spelling variants fill the same product without creating duplicate archived sellers', () => {
  const cases = [
    ['MILLER LIGHT 1', 'Miller Lite 1'],
    ['Absolut-Raspberri (Vodka) 750ml 3', 'Absolut Raspberri Vodka 3'],
    ['STRAWBERRY SENORITA (JOSE CUERVO) 1', 'Strawberry Señorita (Jose Cuervo) 1'],
    ['Crown Apple (Whiskey) 3', 'Crown Royal Apple Whiskey 3'],
  ];
  for (const [csvName, savedName] of cases) {
    const data = { activeItems: [{ id: 'saved', name: savedName, tapNumber: 21, history: [pmb] }], archivedItems: [] };
    const next = mergeWeeklyUsageCsvFallbackData(data, [{ id: 'csv', name: csvName, tapNumber: 21, history: [legacy] }]);
    assert.equal(next.archivedItems.length, 0, csvName);
    assert.equal(next.activeItems[0].history.length, 2);
  }
  for (const [oldName, newName] of [['Garage Beer 1', 'Garage Beer Lime 1'], ["Lemon Drop Martini (Tito's) 1", 'Lemon Drop Martini (Absolut Citron) 1']]) {
    const next = mergeWeeklyUsageCsvFallbackData({ activeItems: [{ id: 'new', name: newName, tapNumber: 31, history: [pmb] }], archivedItems: [] }, [{ id: 'old', name: oldName, tapNumber: 31, history: [legacy] }]);
    assert.equal(next.archivedItems.length, 1);
    assert.equal(next.activeItems[0].history.length, 1);
  }
});
