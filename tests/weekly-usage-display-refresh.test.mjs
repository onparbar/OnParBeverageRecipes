import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildWeeklyUsagePerformance } from '../public/weekly-usage-performance.mjs';
import { buildDashboardOverview } from '../public/dashboard-overview.mjs';

const source = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
const refreshSource = source.slice(source.indexOf('let weeklyUsageDisplayRefreshPromise = null;'), source.indexOf('async function loadSharedWeeklyUsageState()'));
function setup(overrides = {}) {
  const calls = { reads: 0, applies: 0, recoveries: 0 };
  const context = vm.createContext({
    isEmployeeDashboard: false, weeklyUsageSharedInitialized: true,
    weeklyUsageSharedOutbox: null, weeklyUsageSharedSaving: false,
    weeklyUsageSharedPendingWrites: 0, weeklyUsageSharedSaveTimer: null,
    weeklyUsageSyncLoading: false, weeklyUsageApplyingSharedState: false,
    unifiedPmbRefreshRunning: false, weeklyUsageSharedRevision: 10,
    weeklyUsageSharedSaveError: '', weeklyUsageSharedMessage: '',
    async requestSharedWeeklyUsage() { calls.reads++; return { initialized: true, revision: 11, data: { activeItems: ['all 102 taps'] } }; },
    applySharedWeeklyUsageState(state) { calls.applies++; context.weeklyUsageSharedInitialized = state.initialized; context.weeklyUsageSharedRevision = state.revision; },
    async queueSharedWeeklyUsageSave() { calls.recoveries++; return true; },
    dashboardRenderCoordinator: { batch: async callback => callback() },
    renderWeeklyUsage() {}, renderOnParInsights() {}, renderDashboardOverview() {},
    ...overrides,
  });
  vm.runInContext(refreshSource, context);
  return { context, calls };
}

test('a failed initial shared read retries on the next visible refresh', async () => {
  const { context, calls } = setup({ weeklyUsageSharedInitialized: false, weeklyUsageSharedRevision: 0 });
  assert.equal(await context.refreshSharedWeeklyUsageForDisplay(), true);
  assert.equal(calls.reads, 1);
  assert.equal(calls.applies, 1);
  assert.equal(context.weeklyUsageSharedInitialized, true);
});

test('a pending network-failed report is retried instead of permanently blocking shared refresh', async () => {
  const outbox = { conflict: false, baseRevision: 9, payload: { data: { activeItems: ['older 99-tap report'] } } };
  const { context, calls } = setup({ weeklyUsageSharedOutbox: outbox });
  assert.equal(await context.refreshSharedWeeklyUsageForDisplay(), true);
  assert.equal(calls.recoveries, 1);
  assert.equal(calls.applies, 0, 'recovery uses revision-checked queue, never overwrites pending work');
  assert.equal(context.weeklyUsageSharedOutbox, outbox);
});

test('a visible refresh must not replace an edit started while the read is in flight', async () => {
  let resolve;
  const { context, calls } = setup({ requestSharedWeeklyUsage: () => new Promise(r => { resolve = r; }) });
  const pending = context.refreshSharedWeeklyUsageForDisplay();
  context.weeklyUsageSharedSaveTimer = 123;
  resolve({ initialized: true, revision: 11 });
  assert.equal(await pending, false);
  assert.equal(calls.applies, 0);
});

test('a second unavailable read retains the last report and can retry again', async () => {
  const { context, calls } = setup({ weeklyUsageSharedInitialized: false, requestSharedWeeklyUsage: async () => { throw new Error('offline'); } });
  assert.equal(await context.refreshSharedWeeklyUsageForDisplay(), false);
  context.requestSharedWeeklyUsage = async () => ({ initialized: true, revision: 11 });
  assert.equal(await context.refreshSharedWeeklyUsageForDisplay(), true);
  assert.equal(calls.applies, 1);
});

test('active saves and employee sessions do not start background recovery', async () => {
  for (const overrides of [{ weeklyUsageSharedSaving: true }, { weeklyUsageSharedPendingWrites: 1 }, { isEmployeeDashboard: true }]) {
    const { context, calls } = setup(overrides);
    assert.equal(await context.refreshSharedWeeklyUsageForDisplay(), false);
    assert.deepEqual(calls, { reads: 0, applies: 0, recoveries: 0 });
  }
});

test('a stale 99-of-102 login recovers all 102 readings and clears only the coverage warning', async () => {
  const fresh = Array.from({ length: 102 }, (_, index) => ({
    id: `tap-${index + 1}`, tapNumber: index + 1, name: `Product ${index + 1}`,
    history: [{ label: '9/7/26 - 9/13/26', source: 'PMB', volumeOz: 10, hasValue: true }],
  }));
  let rows = fresh.map(item => [42, 70, 79].includes(item.tapNumber) ? { ...item, history: [] } : item);
  const coverageAlert = () => buildDashboardOverview({ usage: {
    initialized: true, lastSyncAt: '2026-09-17T22:17:18Z', performance: buildWeeklyUsagePerformance(rows),
  } }, { now: new Date('2026-09-17T23:00:00Z') }).alerts.find(alert => alert.id === 'weekly-usage-partial');
  assert.match(coverageAlert().message, /99 of 102/);
  const { context } = setup({
    weeklyUsageSharedInitialized: false,
    requestSharedWeeklyUsage: async () => ({ initialized: true, revision: 11, data: { activeItems: fresh } }),
    applySharedWeeklyUsageState: state => { rows = state.data.activeItems; },
  });
  assert.equal(await context.refreshSharedWeeklyUsageForDisplay(), true);
  assert.equal(buildWeeklyUsagePerformance(rows).capturedCount, 102);
  assert.equal(coverageAlert(), undefined);
  assert.equal(fresh[41].history[0].volumeOz, 10, 'no fabricated readings or zeros');
});

test('simultaneous focus and timer refreshes share one read', async () => {
  let resolve;
  let reads = 0;
  const { context, calls } = setup({ requestSharedWeeklyUsage: () => {
    reads++;
    return new Promise(r => { resolve = r; });
  } });
  const first = context.refreshSharedWeeklyUsageForDisplay();
  const second = context.refreshSharedWeeklyUsageForDisplay();
  assert.equal(first, second);
  resolve({ initialized: true, revision: 11 });
  await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.equal(calls.applies, 1);
});
