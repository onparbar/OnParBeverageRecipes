import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const functions = ["runUnifiedPmbRefresh", "runKegConfigUpdate"].map((name) => {
  const match = source.match(new RegExp(`async function ${name}\\(\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, name);
  return match[0];
}).join("\n");
function harness({ refresh = true, repair = true, lock = true, confirm = true } = {}) {
  const stages = [];
  let writes = 0;
  const context = vm.createContext({
    isEmployeeDashboard: false, unifiedPmbRefreshRunning: false,
    kegConfigUpdateRunning: false, kegRepairStatus: null,
    kegSyncMessage: "", weeklyPlanRefreshMessage: "", tapRepairRefreshTimer: null,
    weeklyUsageSharedOutbox: null,
    document: { querySelector: () => null }, window: { clearTimeout() {} },
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
  return { context, stages, writes: () => writes };
}

test("repair confirmation appears only after configuration and PMB refresh succeed", async () => {
  const h = harness();
  await h.context.runKegConfigUpdate();
  assert.equal(h.context.kegRepairStatus.message, "Taps have been configured and PMB has been refreshed.");
  assert.ok(Date.parse(h.context.kegRepairStatus.completedAt));
  assert.match(h.stages[0], /Configuring taps/);
  assert.match(h.stages[1], /Refreshing PMB now/);
  assert.equal(h.writes(), 1);
  assert.equal(h.context.kegConfigUpdateRunning, false);
  assert.match(source, /id="keg-repair-status" role="status" aria-live="polite"/);
});

test("partial refresh or another tab's lock never reports repair-plus-refresh success", async () => {
  for (const options of [{ refresh: false }, { lock: false }]) {
    const h = harness(options);
    await h.context.runKegConfigUpdate();
    assert.equal(h.context.kegRepairStatus.warning, true);
    assert.match(h.context.kegRepairStatus.message, /refresh could not be confirmed/);
    assert.equal(h.context.kegRepairStatus.completedAt, undefined);
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
