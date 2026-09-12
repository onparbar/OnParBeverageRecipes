import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const functions = ["runUnifiedPmbRefresh", "runUnifiedPmbRefreshAttempt", "runKegConfigUpdate"].map((name) => {
  const match = source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\n[\\s\\S]*?\\n\\}`));
  assert.ok(match, name);
  return match[0];
}).join("\n");
function harness({ refresh = true, repair = true, lock = true, confirm = true } = {}) {
  const stages = [];
  let writes = 0;
  let retries = 0;
  const context = vm.createContext({
    isEmployeeDashboard: false, unifiedPmbRefreshRunning: false, mondayPmbRefreshPromise: null,
    kegConfigUpdateRunning: false, kegRepairStatus: null,
    kegSyncMessage: "", weeklyPlanRefreshMessage: "", tapRepairRefreshTimer: null,
    weeklyUsageSharedOutbox: null,
    document: { querySelector: () => null },
    window: {
      clearTimeout() {},
      setTimeout(resolve, delay) {
        assert.equal(delay, 30_000);
        assert.equal(context.kegRepairStatus.completedAt, undefined);
        assert.match(context.kegRepairStatus.message, /Retrying the PMB refresh/);
        retries += 1;
        refresh = true;
        lock = true;
        resolve();
      },
    },
    kegWallItems: Array.from({ length: 102 }, (_, index) => ({ tapNumber: index + 1 })),
    waitForPmbTapReadiness: async ({ expectedTapNumbers, onProgress }) => {
      assert.equal(expectedTapNumbers.length, 102);
      onProgress("Checking tap readiness...");
      return { ready: true };
    },
    confirmDashboardAction: () => confirm,
    acquireOwnerLoginSyncLock: () => lock, releaseOwnerLoginSyncLock() {},
    dashboardRenderCoordinator: { batch: (fn) => fn() },
    flushPendingSharedWeeklyUsageSave: async () => true,
    loadSharedWeeklyUsageState: async () => {},
    runKegLevelSync: async () => refresh, runTapPricingSync: async () => true,
    runPmbWeeklyUsageSync: async () => ({ ok: true }), checkPmbQueueConnection: async () => {},
    flushPendingInventoryFieldSyncs: async () => true,
    flushPendingParAgentStateSync: async () => true,
    getCurrentMondayKegPlanSnapshot: () => true,
    hasPublishedWeeklyPlanRecommendations: () => true,
    renderWeeklyPlan() {}, renderDashboardOverview() {},
    renderKegLevels: () => stages.push(context.kegRepairStatus?.message),
    fetch: async () => { writes += 1; return { ok: repair }; },
    parseJsonResponse: async () => ({ message: "Configuration update sent.", error: "Repair failed" }),
    getPmbConnectionErrorMessage: (error) => error.message,
  });
  vm.runInContext(functions, context);
  return { context, stages, writes: () => writes, retries: () => retries };
}

test("repair confirmation appears only after configuration and PMB refresh succeed", async () => {
  const h = harness();
  await h.context.runKegConfigUpdate();
  assert.equal(h.context.kegRepairStatus.message, "Tap repair verified: all 102 taps are responding and PMB has been refreshed.");
  assert.ok(Date.parse(h.context.kegRepairStatus.completedAt));
  assert.match(h.stages[0], /Configuring taps/);
  assert.ok(h.stages.some(message => /All 102 taps are responding\. Refreshing PMB now/.test(message)));
  assert.equal(h.writes(), 1);
  assert.equal(h.context.kegConfigUpdateRunning, false);
  assert.match(source, /id="keg-repair-status" role="status" aria-live="polite"/);
});

test("partial refresh or another tab's lock retries before reporting success without repeating repair", async () => {
  for (const options of [{ refresh: false }, { lock: false }]) {
    const h = harness(options);
    await h.context.runKegConfigUpdate();
    assert.equal(h.retries(), 1);
    assert.match(h.context.kegRepairStatus.message, /Tap repair verified/);
    assert.ok(Date.parse(h.context.kegRepairStatus.completedAt));
    assert.equal(h.writes(), 1);
  }
});

test("failed repair reports uncertainty rather than completion", async () => {
  const h = harness({ repair: false });
  await h.context.runKegConfigUpdate();
  assert.equal(h.context.kegRepairStatus.warning, true);
  assert.match(h.context.kegRepairStatus.message, /configuration could not be confirmed/);
  assert.equal(h.context.kegConfigUpdateRunning, false);
});

test("canceling the disruption warning does not repair or show a completion", async () => {
  const h = harness({ confirm: false });
  await h.context.runKegConfigUpdate();
  assert.equal(h.writes(), 0);
  assert.equal(h.context.kegRepairStatus, null);
});
