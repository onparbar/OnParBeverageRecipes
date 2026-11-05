import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";

const source = await readFile(new URL("../public/dashboard.js", import.meta.url), "utf8");
test("opening the dashboard never posts an ingredient migration for the saved week", () => {
  const initStart = source.indexOf("async function init(");
  assert.ok(initStart >= 0);
  const init = source.slice(initStart, source.indexOf("\n}\n", initStart) + 2);
  assert.doesNotMatch(init, /refreshCurrentWeeklyIngredientOrders|refresh-ingredients/);
  assert.doesNotMatch(source, /refreshCurrentWeeklyIngredientOrders|refresh-ingredients|retry-weekly-ingredient-orders/);
});

test("newly published plans retain the two-Thursday ingredient policy version", () => {
  const snapshot = createWeeklyPlanSnapshot({
    generatedAt: "2026-11-09T16:57:00.000Z", inventoryItems: [], recommendations: [],
  });
  assert.equal(snapshot.ingredientPlanningVersion, 2);
});

test("opening a legacy saved plan preserves its supplier actions and does not require a migration", () => {
  const modelStart = source.indexOf("function getVendorOrderDraftModel(");
  const declaration = source.slice(modelStart, source.indexOf("\n}\n", modelStart) + 2);
  const snapshot = { generatedAt: "2026-11-02T16:57:00.000Z" };
  const model = { canApproveAll: true, drafts: [
    { vendor: "OHLQ", blockers: [], canApprove: true, status: "ready" },
    { vendor: "Bonbright", blockers: [], canApprove: true, status: "ready" },
  ] };
  const before = structuredClone({ snapshot, model });
  const context = {
    parAgentState: { recommendations: {} }, getCurrentWeeklyPlanSnapshot: () => snapshot,
    buildUnifiedVendorOrderModel: () => model, getCurrentVendorOrderPolicy: () => ({}),
    weeklyOrderTracking: { vendors: [{ vendor: "Bonbright", ordered: true }], adjustments: [], adjustmentCatalog: [] },
    orderRehearsalMode: false,
  };
  runInNewContext(declaration, context);
  assert.equal(context.getVendorOrderDraftModel({}, { readiness: {} }), model);
  assert.deepEqual({ snapshot, model }, before);
  assert.doesNotMatch(source, /INGREDIENT_ORDERS_REFRESH_REQUIRED/);
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
