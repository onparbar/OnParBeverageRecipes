import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyIngredientInventory, refreshIngredientPurchases } from "../lib/weekly-ingredient-refresh.mjs";
import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";

function fixture() {
  const tap = { key: "main-60-lemon-drop", name: "Lemon Drop", wall: "Main", tapNumber: 60,
    currentStockKegs: 0.433, avgWeeklyKegs: 0.128, preThursdayUsageSharePct: 0 };
  const recipes = [{ id: "lemon-drop", title: "Lemon Drop", ingredients: [
    { name: "Absolut Citron", raw: "Absolut Citron=14 bottles (1.75L)", oz: 828 },
    { name: "Gallons Strawberry lemonade", oz: 320 },
  ] }];
  const snapshot = { generatedAt: "2026-11-02T16:57:27.987Z", plan: buildWeeklyActionPlan(), orderCatalog: [
    { id: "absolut-citron", name: "Absolut Citron", vendor: "OHLQ", vendorSku: "0028D",
      vendorProductName: "Absolut Citron Vodka 1.75L", packSize: 1, casePackaged: false, unitCost: 32.9, orderCategory: "liquor" },
  ] };
  const savedCounts = { items: [{ id: "absolut-citron", name: "Absolut Citron", group: "Liquor Cabinet",
    onHandDisplay: "0", parDisplay: "14" }], kegPlanSnapshot: { tapInputs: [tap] } };
  const inventory = { current: { onHandOverrides: { "absolut-citron": "99" }, customItems: [] } };
  return { recipes, snapshot, savedCounts, inventory };
}

test("legacy saved catalog recovers the exact purchased bottle size and retains Monday counts", () => {
  const context = fixture();
  const original = structuredClone(context);
  const [item] = buildWeeklyIngredientInventory(context);
  assert.equal(item.bottleOz, 59.1745);
  assert.equal(item.onHand, 0);
  assert.equal(item.hasCurrentCount, true);
  assert.equal(item.vendorSku, "0028D");
  assert.deepEqual(context, original);
});

test("saved explicit package metadata wins over the legacy product label", () => {
  const context = fixture();
  context.snapshot.orderCatalog[0].bottleOz = 33.814;
  assert.equal(buildWeeklyIngredientInventory(context)[0].bottleOz, 33.814);
});

test("missing and malformed counts stay unknown instead of becoming zero", () => {
  for (const count of ["", "bad", null, -1]) {
    const context = fixture();
    context.savedCounts.items[0].onHandDisplay = count;
    assert.equal(buildWeeklyIngredientInventory(context)[0].hasCurrentCount, false);
  }
});

test("server refresh buys future Citron while respecting soda-machine ingredients parsed with gallon prefixes", () => {
  const context = fixture();
  const recommendations = { generatedAt: context.snapshot.generatedAt, items: [], weeklyPlanSnapshot: context.snapshot };
  const updated = refreshIngredientPurchases(context, recommendations);
  assert.equal(updated.weeklyPlanSnapshot.plan.orders.liquor[0].quantity, 14);
  assert.equal(updated.weeklyPlanSnapshot.ingredientPlanningVersion, 2);
  assert.deepEqual(updated.weeklyPlanSnapshot.ingredientOrderReview, []);
  assert.deepEqual(updated.weeklyPlanSnapshot.plan.prep, recommendations.weeklyPlanSnapshot.plan.prep);
});

test("missing saved tap evidence cannot silently publish a current-only ingredient repair", () => {
  const context = fixture();
  context.savedCounts.kegPlanSnapshot.tapInputs = [];
  assert.throws(() => refreshIngredientPurchases(context, { weeklyPlanSnapshot: context.snapshot }),
    error => error.code === "INGREDIENT_FORECAST_INPUTS_MISSING");
});
