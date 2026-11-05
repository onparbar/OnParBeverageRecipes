import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";

const source = await readFile(new URL("../public/dashboard.js", import.meta.url), "utf8");
const start = source.indexOf("async function refreshCurrentWeeklyIngredientOrders(");
const refreshSource = source.slice(start, source.indexOf("\n}\n", start) + 2);

function fixture(overrides = {}) {
  const calls = [];
  const context = {
    isEmployeeDashboard: false, weeklyIngredientRefreshRunning: false, weeklyIngredientRefreshError: "",
    parAgentStateOutbox: null,
    parAgentState: { revision: 10, recommendations: { weeklyPlanSnapshot: { generatedAt: "2026-11-02T16:57:00.000Z" } } },
    getCurrentWeeklyPlanSnapshot: recommendations => recommendations?.weeklyPlanSnapshot,
    toNumber: value => Number(value) || 0,
    requestOperationalSharedJson: async (path, options) => {
      calls.push({ path, body: JSON.parse(options.body) });
      return { response: { ok: true, status: 200 }, result: { refreshed: true, revision: 11 } };
    },
    loadParAgentState: async () => {
      calls.push("state");
      context.parAgentState.revision += 1;
      context.parAgentState.recommendations.weeklyPlanSnapshot.ingredientPlanningVersion = 2;
    },
    loadWeeklyOrderTracking: async () => { calls.push("tracking"); },
    reconcileWeeklyOrderTrackingRevision: () => { calls.push("reconcile"); },
    ...overrides,
  };
  runInNewContext(refreshSource, context);
  return { context, calls };
}

test("opening a legacy current plan requests an ingredient refresh using only its revision and generation", async () => {
  const { context, calls } = fixture();
  assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), true);
  assert.deepEqual(calls[0], {
    path: "/api/weekly-prep-additions",
    body: { action: "refresh-ingredients", generatedAt: "2026-11-02T16:57:00.000Z", expectedRevision: 10 },
  });
  assert.deepEqual(calls.slice(1), ["state", "tracking", "reconcile"]);
  assert.equal(context.weeklyIngredientRefreshRunning, false);
  assert.equal(context.weeklyIngredientRefreshError, "");
  assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), false);
  assert.equal(calls.length, 4);
});

test("employee sessions and pending local keg edits never migrate or replace saved state", async () => {
  for (const overrides of [{ isEmployeeDashboard: true }, { parAgentStateOutbox: { edits: [{ id: "count" }] } }, { parAgentState: null }]) {
    const { context, calls } = fixture(overrides);
    assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), false);
    assert.deepEqual(calls, []);
  }
});

test("a newly published two-Thursday plan opens without requiring a migration request", async () => {
  const { context, calls } = fixture();
  context.parAgentState.recommendations.weeklyPlanSnapshot = createWeeklyPlanSnapshot({
    generatedAt: "2026-11-02T16:57:00.000Z", inventoryItems: [], recommendations: [],
  });
  assert.equal(context.parAgentState.recommendations.weeklyPlanSnapshot.ingredientPlanningVersion, 2);
  assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), false);
  assert.deepEqual(calls, []);
});

test("one revision conflict rereads the plan and retries with the new revision", async () => {
  const { context, calls } = fixture();
  let requests = 0;
  context.requestOperationalSharedJson = async (_path, options) => {
    calls.push(JSON.parse(options.body));
    requests += 1;
    return requests === 1
      ? { response: { ok: false, status: 409 }, result: { error: "The plan changed." } }
      : { response: { ok: true, status: 200 }, result: { refreshed: true, revision: 12 } };
  };
  context.loadParAgentState = async () => {
    context.parAgentState.revision += 1;
    if (requests === 2) context.parAgentState.recommendations.weeklyPlanSnapshot.ingredientPlanningVersion = 2;
  };
  assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), true);
  assert.equal(requests, 2);
  assert.equal(calls[0].expectedRevision, 10);
  assert.equal(calls[1].expectedRevision, 11);
});

test("a repeated conflict stops and leaves a visible, retryable order error", async () => {
  const { context } = fixture();
  let requests = 0;
  context.requestOperationalSharedJson = async () => {
    requests += 1;
    return { response: { ok: false, status: 409 }, result: { error: "The plan changed again." } };
  };
  context.loadParAgentState = async () => { context.parAgentState.revision += 1; };
  assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), false);
  assert.equal(requests, 2);
  assert.match(context.weeklyIngredientRefreshError, /this Thursday and next Thursday/);
  assert.match(context.weeklyIngredientRefreshError, /The plan changed again/);
  assert.equal(context.weeklyIngredientRefreshRunning, false);
  assert.match(source, /id="retry-weekly-ingredient-orders"/);
});

test("concurrent refresh attempts send only one migration request", async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { context, calls } = fixture({ requestOperationalSharedJson: () => pending });
  const first = context.refreshCurrentWeeklyIngredientOrders();
  assert.equal(await context.refreshCurrentWeeklyIngredientOrders(), false);
  finish({ response: { ok: true, status: 200 }, result: { refreshed: true, revision: 11 } });
  assert.equal(await first, true);
  assert.deepEqual(calls, ["state", "tracking", "reconcile"]);
});

test("an unresolved legacy ingredient refresh blocks unplaced supplier actions and preserves placed delivery access", () => {
  const modelStart = source.indexOf("function getVendorOrderDraftModel(");
  const declaration = source.slice(modelStart, source.indexOf("\n}\n", modelStart) + 2);
  const snapshot = { generatedAt: "2026-11-02T16:57:00.000Z" };
  const makeModel = () => ({ canApproveAll: true, drafts: [
    { vendor: "OHLQ", blockers: [], canApprove: true, status: "ready" },
    { vendor: "Bonbright", blockers: [], canApprove: true, status: "ready" },
  ] });
  const context = {
    parAgentState: { recommendations: {} }, getCurrentWeeklyPlanSnapshot: () => snapshot,
    buildUnifiedVendorOrderModel: makeModel, getCurrentVendorOrderPolicy: () => ({}),
    weeklyOrderTracking: { vendors: [{ vendor: "Bonbright", ordered: true }], adjustments: [], adjustmentCatalog: [] },
    toNumber: value => Number(value) || 0, orderRehearsalMode: false,
  };
  runInNewContext(declaration, context);
  const blocked = context.getVendorOrderDraftModel({}, { readiness: {} });
  assert.equal(blocked.drafts[0].canApprove, false);
  assert.equal(blocked.drafts[0].blockers[0].code, "INGREDIENT_ORDERS_REFRESH_REQUIRED");
  assert.equal(blocked.drafts[1].canApprove, true);
  assert.equal(blocked.canApproveAll, false);
  snapshot.ingredientPlanningVersion = 2;
  assert.equal(context.getVendorOrderDraftModel({}, { readiness: {} }).drafts[0].canApprove, true);
});

test("Proof ingredients needed next Thursday keep the new supplier order required", () => {
  const policyStart = source.indexOf("function getCurrentVendorOrderPolicy(");
  const declaration = source.slice(policyStart, source.indexOf("\n}\n", policyStart) + 2);
  const items = [{ id: "lime-juice", name: "Lime Juice", group: "Mixer Cabinet", vendor: "Proof", orderUnits: 12, orderHoldReason: "" }];
  const context = {
    toNumber: value => Number(value) || 0, clean: value => String(value ?? "").trim(),
    getWeeklyPlanInventoryItems: () => items, getCurrentMondayKegPlanSnapshot: () => ({ tapInputs: [] }),
    buildProofPrepOrderContext: () => ({ candidates: [], requirement: "not-required" }),
    normalizeVendorOrderPolicy: policy => policy, recipes: [], inventoryItems: [], MENU_ORDER: [], NEW_RECIPE_ORDER: [],
  };
  runInNewContext(declaration, context);
  assert.equal(context.getCurrentVendorOrderPolicy({ prep: { cocktails: [] } }).proofPrepRequirement, "required");
  items[0].orderHoldReason = "Saved count is missing.";
  assert.equal(context.getCurrentVendorOrderPolicy({ prep: { cocktails: [] } }).proofPrepRequirement, "not-required");
});
