import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");

function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return source.slice(start, end + 2);
}

test("snapshot save reuses one trusted inventory read through calculation and commit", () => {
  const coordinator = functionSource("saveInventorySnapshot");
  const attempt = functionSource("saveInventorySnapshotAttempt");

  assert.match(coordinator, /snapshotBaseState: latest/);
  assert.match(attempt, /calculationBaseState = snapshotBaseState \|\| await refreshInventoryRevisionForSnapshot\(\)/);
  assert.match(attempt, /snapshotBaseState: calculationBaseState/);
  assert.equal((attempt.match(/refreshInventoryRevisionForSnapshot\(\)/g) || []).length, 1);
});

test("snapshot actions receive a stable id before entering durable recovery", () => {
  const stage = functionSource("stageInventoryActionOutbox");
  assert.match(stage, /entry\.payload\.captureId = entry\.id/);
});

test("inventory and usage transfers allow time for shared storage and the response body", async () => {
  const requests = [];
  const scope = vm.createContext({
    SHARED_HISTORY_REQUEST_TIMEOUT_MS: 60_000,
    requestOperationalSharedJson: async (path, options, timeout) => {
      requests.push({ path, method: options.method, timeout });
      return { response: { ok: true }, result: { revision: 8 } };
    },
  });
  vm.runInContext([functionSource("requestSharedInventory"), functionSource("requestSharedWeeklyUsage")].join("\n"), scope);
  for (const [request, action] of [
    [scope.requestSharedInventory, "batch-update-fields"],
    [scope.requestSharedInventory, "save-snapshot"],
    [scope.requestSharedWeeklyUsage, "replace"],
  ]) {
    await request();
    await request({ action });
  }
  assert.match(source, /const SHARED_HISTORY_REQUEST_TIMEOUT_MS = 60_000/);
  assert.deepEqual(requests.map(({ method }) => method), ["GET", "POST", "GET", "POST", "GET", "POST"]);
  assert.ok(requests.every(({ timeout }) => timeout === 60_000));
});

test("guided final save captures previously verified counts and waits for a published plan", async () => {
  let attempts = 0;
  const scope = vm.createContext({
    clean: value => String(value).trim(), parAgentState: {}, document: { querySelector: () => null },
    getCurrentWeeklyPlanSnapshot: () => attempts === 2,
    runWeeklyPlanUpdate: async () => { attempts++; },
    weeklyPlanOutsideMondayReason: "", weeklyPlanRefreshMessage: "", inventorySharedMessage: "",
  });
  vm.runInContext(functionSource("saveWeeklyOrderPlan"), scope);
  await assert.rejects(scope.saveWeeklyOrderPlan(""), /counts are saved/i);
  await scope.saveWeeklyOrderPlan(" verified Tuesday ");
  assert.equal(scope.weeklyPlanOutsideMondayReason, "verified Tuesday");
  assert.equal(attempts, 2);
});

test("snapshot pricing verification joins an ongoing live read and can retry after failure", async () => {
  let calls = 0;
  let finish;
  const scope = vm.createContext({ tapPricingReadPromise: null, runTapPricingSyncAttempt: () => {
    calls++;
    return new Promise(resolve => { finish = resolve; });
  } });
  vm.runInContext(functionSource("runTapPricingSync"), scope);
  const initial = scope.runTapPricingSync();
  const joined = scope.runTapPricingSync();
  assert.equal(calls, 1);
  finish(false);
  assert.deepEqual(await Promise.all([initial, joined]), [false, false]);
  const retry = scope.runTapPricingSync();
  assert.equal(calls, 2);
  finish(true);
  assert.equal(await retry, true);
  assert.match(functionSource("saveInventorySnapshotAttempt"), /if \(!liveTapPricingUpdatedAt\) await runTapPricingSync\(\);\s*if \(!liveTapPricingUpdatedAt\)/);
});
