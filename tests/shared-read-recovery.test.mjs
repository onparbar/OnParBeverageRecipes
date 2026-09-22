import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('let failedSharedReadRecoveryPromise'), source.indexOf('async function runOwnerLoginSync()'));
function setup(overrides = {}) {
  const calls = { dashboard: 0, inventory: 0, kegs: 0, render: 0, reads: 0 };
  const state = { initialized: true, revision: 7 };
  const context = vm.createContext({
    isEmployeeDashboard: false, dashboardBriefingInitialLoadPending: false,
    unifiedPmbRefreshRunning: false, weeklyPlanUpdating: false, parAgentRunning: false,
    document: { activeElement: { matches: () => false } },
    dashboardSharedPatchScheduled: false, dashboardSharedPendingSlices: new Set(),
    hasDashboardSharedOutbox: () => false, dashboardSharedSyncStatus: 'offline',
    dashboardSharedMutationGeneration: 0, dashboardSharedState: { revision: 0 },
    dashboardSharedProvisioned: false, dashboardSharedWritesPaused: true,
    dashboardSharedWritePauseReason: 'offline',
    inventorySharedSaving: false, inventoryFieldSyncPendingCount: 0,
    inventoryFieldSyncTimers: new Map(), getPendingInventoryOperations: () => [],
    inventorySharedProvisioned: false, inventorySharedInitialized: false,
    inventorySharedRevision: 0, inventoryOutboxClientOrder: 0,
    inventorySharedSaveError: 'timeout', inventorySharedMessage: 'unavailable',
    parAgentState: null, parAgentStateOutbox: null, parAgentStateSyncTimer: null,
    parAgentInputsChangedAt: '', parAgentStateMutationVersion: 0, parAgentError: 'timeout',
    requestDashboardSharedState: async () => { calls.reads++; return { state }; },
    requestSharedInventory: async () => { calls.reads++; return state; },
    requestParAgentState: async () => { calls.reads++; return state; },
    CSV_PATH: '/active.csv', NEW_COCKTAILS_CSV_PATH: '/new.csv', NEW_RECIPE_ORDER: [],
    fetchCsv: async () => '', parseCsv: () => [], parseRecipes: value => value,
    applyMenuOrder: value => value, applyRecipeOrder: value => value, applyRecipeEdits: value => value,
    customRecipes: [], recipes: [],
    applySharedDashboardState: value => { calls.dashboard++; context.dashboardSharedState = value; },
    applySharedInventoryState: value => { calls.inventory++; context.inventorySharedRevision = value.revision; },
    applyParAgentState: value => { calls.kegs++; context.parAgentState = value; },
    setDashboardSharedSyncStatus: value => { context.dashboardSharedSyncStatus = value; },
    render: () => { calls.render++; }, ...overrides,
  });
  vm.runInContext(code, context);
  return { context, calls };
}
test('failed startup reads recover all three sources without reloading or writing', async () => {
  const { context, calls } = setup();
  assert.equal(await context.retryFailedSharedReads(), true);
  assert.deepEqual(calls, { dashboard: 1, inventory: 1, kegs: 1, render: 1, reads: 3 });
  assert.equal(context.dashboardSharedSyncStatus, 'saved');
  assert.equal(context.inventorySharedSaveError, '');
  assert.equal(context.parAgentError, '');
  assert.equal(await context.retryFailedSharedReads(), false);
  assert.equal(calls.reads, 3, 'healthy sources are not polled again');
});
test('another failure remains visible and later retry can recover', async () => {
  const { context, calls } = setup({ requestSharedInventory: async () => { throw Error('offline'); } });
  await context.retryFailedSharedReads();
  assert.equal(calls.inventory, 0);
  assert.equal(context.inventorySharedSaveError, 'timeout');
  context.requestSharedInventory = async () => ({ initialized: true, revision: 7 });
  assert.equal(await context.retryFailedSharedReads(), true);
  assert.equal(calls.inventory, 1);
});
test('pending edits and conflicts block reads of their respective sources', async () => {
  const { context, calls } = setup({ hasDashboardSharedOutbox: () => true,
    getPendingInventoryOperations: () => [{ conflict: true }], parAgentStateOutbox: { conflict: true } });
  assert.equal(await context.retryFailedSharedReads(), false);
  assert.equal(calls.reads, 0);
});
test('edits made and saved during a read prevent stale replacement', async () => {
  let resolve;
  const { context, calls } = setup({ requestSharedInventory: () => new Promise(r => { resolve = r; }) });
  const pending = context.retryFailedSharedReads();
  context.dashboardSharedMutationGeneration++;
  context.inventoryOutboxClientOrder++;
  context.parAgentStateMutationVersion++;
  resolve({ initialized: true, revision: 7 });
  assert.equal(await pending, false);
  assert.equal(calls.dashboard + calls.inventory + calls.kegs, 0);
});
test('focus and timer share one in-flight retry; applying waits until all reads finish', async () => {
  let resolve;
  const { context, calls } = setup({ requestSharedInventory: () => new Promise(r => { resolve = r; }) });
  const first = context.retryFailedSharedReads();
  assert.equal(first, context.retryFailedSharedReads());
  await Promise.resolve();
  assert.equal(calls.dashboard, 0);
  resolve({ initialized: true, revision: 7 });
  await first;
  assert.equal(calls.render, 1);
});
test('editing a form while requests are in flight preserves that form and warning', async () => {
  let resolve;
  const { context, calls } = setup({ requestSharedInventory: () => new Promise(r => { resolve = r; }) });
  const pending = context.retryFailedSharedReads();
  context.document.activeElement.matches = () => true;
  resolve({ initialized: true, revision: 7 });
  assert.equal(await pending, false);
  assert.equal(calls.render, 0);
  assert.equal(context.inventorySharedSaveError, 'timeout');
});
test('uninitialized storage does not erase browser inventory or pretend setup is saved', async () => {
  const { context, calls } = setup({ requestSharedInventory: async () => ({ initialized: false }),
    requestDashboardSharedState: async () => ({ state: { initialized: false } }) });
  await context.retryFailedSharedReads();
  assert.equal(calls.inventory, 0);
  assert.equal(context.inventorySharedInitialized, false);
  assert.equal(context.inventorySharedProvisioned, true);
  assert.equal(context.dashboardSharedSyncStatus, 'setup');
});
test('startup, employees, active saves and typing defer retries', async () => {
  for (const overrides of [{ isEmployeeDashboard: true }, { dashboardBriefingInitialLoadPending: true },
    { unifiedPmbRefreshRunning: true }, { weeklyPlanUpdating: true }, { parAgentRunning: true },
    { document: { activeElement: { matches: () => true } } }]) {
    const { context, calls } = setup(overrides);
    assert.equal(await context.retryFailedSharedReads(), false);
    assert.equal(calls.reads, 0);
  }
});
test('recovery is connected to startup completion, focus, visibility, online and visible timer', () => {
  assert.match(source, /dashboardBriefingInitialLoadPending = false;\s*renderDashboardOverview\(\);\s*void retryFailedSharedReads\(\)/);
  for (const event of ['focus', 'visibilitychange', 'online']) {
    assert.match(source, new RegExp(`addEventListener\\("${event}", \\(\\) => \\{[^}]*retryFailedSharedReads\\(\\)`));
  }
  assert.match(source, /setInterval\(\(\) => \{[^}]*visibilityState[^}]*retryFailedSharedReads\(\)/);
});
