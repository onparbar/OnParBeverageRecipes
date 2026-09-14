import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconcileWeeklyUsageData } from '../public/weekly-usage-reconciliation.mjs';
import { buildWeeklyUsagePerformance } from '../public/weekly-usage-performance.mjs';
import { getTapAssignmentUsageStart } from '../public/confirmed-tap-starts.mjs';

const copy = (value) => structuredClone(value);
const latest = '8/31/26 - 9/6/26';
const prior = '8/24/26 - 8/30/26';
const capture = (label, value, extra = {}) => ({ label, value, volumeOz: value, source: 'PMB', hasValue: true, ...extra });
const goose = () => ({ id: '83-grey-goose-vodka-2', tapNumber: 83, plu: 196542, name: 'Grey Goose Vodka 2', displayUnit: 'oz', average: 7.52, history: [capture(latest, 7.52), capture(prior, 0)] });
const state = () => ({ activeItems: [goose()], archivedItems: [], historyOverrides: { '83-grey-goose-vodka-2': goose().history }, currentOverrides: {}, lastSyncAt: '2026-09-13T20:00:00Z' });
const verified = { zeroUsageVerified: true, reportComplete: true, historicalAssignmentVerified: true, usageUnknownReason: '', zeroUsageEvidence: { source: 'owner-confirmed-assignment', tapNumber: 83, plu: 196542 } };

test('concurrent recapture and verified zero merge in active rows and overrides', () => {
  const base = state(), local = copy(base), remote = copy(base);
  for (const rows of [local.activeItems[0].history, local.historyOverrides[goose().id]]) {
    Object.assign(rows[1], { priceCapturedAt: '2026-09-13T22:00:00Z', sellingPricePerOz: 6.7, zeroUsageVerified: false, reportComplete: false, historicalAssignmentVerified: false });
  }
  for (const rows of [remote.activeItems[0].history, remote.historyOverrides[goose().id]]) Object.assign(rows[1], verified);
  local.lastSyncAt = '2026-09-13T22:00:00Z';
  remote.lastSyncAt = '2026-09-13T21:00:00Z';
  const result = reconcileWeeklyUsageData(base, local, remote);
  assert.equal(result.ok, true, JSON.stringify(result.conflicts));
  for (const rows of [result.data.activeItems[0].history, result.data.historyOverrides[goose().id]]) {
    assert.equal(rows[1].zeroUsageVerified, true);
    assert.equal(rows[1].sellingPricePerOz, 6.7);
  }
  assert.equal(result.data.lastSyncAt, local.lastSyncAt);
  assert.equal(buildWeeklyUsagePerformance(result.data.activeItems).trendComplete, true);
  assert.equal(base.activeItems[0].history[1].zeroUsageVerified, undefined);
});

test('different products and weeks can merge without losing either report', () => {
  const base = state(), local = copy(base), remote = copy(base);
  local.activeItems[0].history.push(capture('8/17/26 - 8/23/26', 16.61));
  Object.assign(remote.activeItems[0].history[1], verified);
  const result = reconcileWeeklyUsageData(base, local, remote);
  assert.equal(result.ok, true);
  assert.equal(result.data.activeItems[0].history.length, 3);
  assert.equal(result.data.activeItems[0].history[1].zeroUsageVerified, true);
});

test('conflicting poured measurements remain blocked', () => {
  const base = state(), local = copy(base), remote = copy(base);
  Object.assign(local.activeItems[0].history[0], { value: 8, volumeOz: 8 });
  Object.assign(remote.activeItems[0].history[0], { value: 9, volumeOz: 9 });
  const result = reconcileWeeklyUsageData(base, local, remote);
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
});

test('missing baselines and simultaneous assignments are not silently accepted', () => {
  assert.equal(reconcileWeeklyUsageData(null, state(), state()).ok, false);
  const base = state(), local = copy(base), remote = copy(base);
  local.activeItems.push({ id: '79-a', tapNumber: 79, name: 'A', history: [] });
  remote.activeItems.push({ id: '79-b', tapNumber: 79, name: 'B', history: [] });
  assert.equal(reconcileWeeklyUsageData(base, local, remote).ok, false);
});

test('Triple Jam does not create missing history before its saved tap transition', () => {
  const rows = [goose(), { id: '79-triple-jam', tapNumber: 79, plu: 121584, name: 'Triple Jam Cider 2', history: [] }];
  Object.assign(rows[0].history[1], verified);
  const result = buildWeeklyUsagePerformance(rows, { getCurrentAssignment: (item) => item.tapNumber === 79
    ? { ...item, productHistory: { source: 'detected', changedAt: '2026-09-13T04:42:56.789Z' } } : item });
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.currentComplete, true);
  assert.equal(result.trendComplete, true);
  assert.deepEqual(result.excludedComparisonTaps, []);
});

test('baseline sightings and refill dates do not masquerade as introductions', () => {
  assert.equal(getTapAssignmentUsageStart({ name: 'Existing beer', productHistory: { source: 'baseline', changedAt: '2026-09-12T18:00:00Z', firstSeenAt: '2026-09-12T18:00:00Z' }, tappedOn: '09/12/2026' }), '');
  assert.equal(getTapAssignmentUsageStart({ name: 'New beer', productHistory: { source: 'confirmed', changedAt: '2026-09-13T02:00:00Z' } }), '2026-09-12');
});

test('a newly introduced product with current usage does not require a pre-installation comparison', () => {
  const existing = goose();
  Object.assign(existing.history[1], verified);
  const newProduct = { id: '79-new', tapNumber: 79, name: 'New beer', history: [capture(latest, 20)], productHistory: { source: 'confirmed', changedAt: '2026-09-02T16:00:00Z' } };
  const result = buildWeeklyUsagePerformance([existing, newProduct]);
  assert.equal(result.currentComplete, true);
  assert.deepEqual(result.excludedComparisonTaps, []);
  assert.equal(result.comparableCount, 1);
});

test('keg layout keeps repair actions after the header and rehearsal unavailable', () => {
  const dashboard = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(dashboard, /ORDER_REHEARSAL_AVAILABLE = false/);
  assert.match(dashboard, /headerContent: wallHeader \+ kegRepairActions/);
  assert.match(dashboard, /kegSummary\.hidden = true/);
  assert.match(css, /#keg-levels-panel \.keg-layout\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});
