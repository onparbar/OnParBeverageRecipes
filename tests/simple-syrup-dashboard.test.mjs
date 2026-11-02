import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { isInHousePrepIngredient, refreshWeeklyIngredientPrep } from "../public/in-house-ingredient-prep.mjs";
import { calculateWeeklyIngredientPrepNeed } from "../public/weekly-plan-prep-needs.mjs";
import { renderSavedWeeklySnapshot } from "../public/weekly-snapshot-view.mjs";
import { escapeHtml, formatNumber, money } from "../public/dashboard-formatters.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const functionSource = (name) => source.slice(source.indexOf(`function ${name}(`)).split(/\n(?:async )?function /)[0];
const generatedAt = "2026-11-02T16:57:27.987Z";
const cocktail = { name: "Lemon Drop Martini (Absolut Citron) 1", quantity: 1, batchSizeOz: 1448, prepAdditionId: "lemon-addition" };
const recipe = { ingredients: [{ name: "Simple Syrup", oz: 320 }], yieldOz: 1448 };

function harness({ count = "0", completed = false } = {}) {
  const plan = { prep: { cocktails: [cocktail], ingredients: [], liquorRefills: [{ name: "Existing refill" }] }, orders: { beerKegs: [{ name: "Existing order", quantity: 2 }] } };
  const snapshot = { generatedAt, plan };
  const context = vm.createContext({
    parAgentState: { recommendations: { weeklyPlanSnapshot: snapshot } },
    inventoryItems: [{ id: "simple-syrup", name: "Simple Syrup", onHandDisplay: count }],
    dashboardStaffPrepPlan: { available: true, generatedAt, items: [{ ...cocktail, completed }] },
    getCurrentWeeklyPlanSnapshot: (recommendations) => recommendations?.weeklyPlanSnapshot,
    hydrateWeeklyPlanLiquorTapPricing: (value) => value,
    refreshWeeklyPlanMetadata: (value) => value,
    isInHousePrepIngredient, refreshWeeklyIngredientPrep, calculateWeeklyIngredientPrepNeed,
    getActiveRecipes: () => [recipe],
    findRecipeForWallProduct: (recipes) => recipes[0],
    getRecipeTotals: (value) => ({ oz: value.yieldOz }),
    normalizeIngredientAlias: (value) => String(value).toLowerCase(),
    clean: (value) => String(value ?? "").trim(),
    formatNumber,
  });
  for (const name of ["getWeeklyPlanModel", "getWeeklySimpleSyrupNeed", "getInventorySnapshotSimpleSyrupNeed", "formatInventorySnapshotSimpleSyrupNeed", "getCurrentSnapshotSimpleSyrupNeed", "formatSimpleSyrupNeed"]) {
    vm.runInContext(functionSource(name), context);
  }
  return { context, plan };
}

test("existing saved prep with an empty ingredient list immediately shows exact Lemon Drop syrup", () => {
  const { context, plan } = harness();
  const before = structuredClone(plan);
  const result = context.getWeeklyPlanModel();
  assert.equal(result.prep.ingredients[0].quantity, 2.5);
  assert.equal(result.prep.ingredients[0].requiredGallons, 2.5);
  assert.deepEqual(result.orders, before.orders);
  assert.deepEqual(result.prep.liquorRefills, before.prep.liquorRefills);
  assert.deepEqual(plan, before, "display hydration does not rewrite the saved plan");
});

test("dashboard syrup reminder nets the current count without treating completion as a syrup stock deduction", () => {
  assert.equal(harness({ count: "1" }).context.getWeeklyPlanModel().prep.ingredients[0].quantity, 1.5);
  assert.equal(harness({ count: "3" }).context.getWeeklyPlanModel().prep.ingredients.length, 0);
  assert.equal(harness({ completed: true }).context.getWeeklyPlanModel().prep.ingredients[0].quantity, 2.5);
  assert.match(harness({ count: "" }).context.getWeeklyPlanModel().prep.ingredients[0].holdReason, /count/i);
});

test("snapshot syrup remains frozen and current additions are labeled separately for the matching week only", () => {
  const { context } = harness();
  const snapshot = { summary: { simpleSyrupNeed: { totalOz: 0, gallons: 0, complete: true } }, kegPlanSnapshot: { generatedAt, items: [] } };
  const saved = context.formatInventorySnapshotSimpleSyrupNeed(snapshot);
  const current = context.getCurrentSnapshotSimpleSyrupNeed(snapshot);
  assert.equal(saved, "0 gal");
  assert.equal(current, "2.5 gal");
  assert.equal(context.getCurrentSnapshotSimpleSyrupNeed({ kegPlanSnapshot: { generatedAt: "2026-10-26T16:00:00.000Z" } }), "");
  context.parAgentState.recommendations.weeklyPlanSnapshot = null;
  assert.equal(context.getCurrentSnapshotSimpleSyrupNeed(snapshot), "");
  const helpers = { escapeHtml, formatNumber, money, formatUpdatedAt: String, dateLabel: "Nov 2", simpleSyrupNeed: saved };
  const html = renderSavedWeeklySnapshot(snapshot, { ...helpers, currentSimpleSyrupNeed: current });
  assert.match(html, /Simple syrup for this week's cocktails<\/span><strong>2.5 gal/);
  assert.match(html, /Simple syrup planned when saved<\/span><strong>0 gal/);
  assert.doesNotMatch(renderSavedWeeklySnapshot(snapshot, helpers), /this week's cocktails/);
  assert.equal(snapshot.summary.simpleSyrupNeed.totalOz, 0);
});
