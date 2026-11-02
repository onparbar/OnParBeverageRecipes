import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyActionPlan, refreshWeeklyPlanMetadata, groupWeeklyPlanOrdersByVendor } from "../public/weekly-action-plan.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildVendorOrderDrafts } from "../public/vendor-order-drafts.mjs";
import { renderWeeklyIngredientPrep } from "../public/weekly-plan-view.mjs";
import { isInventoryCountExcluded } from "../public/inventory-count-policy.mjs";
import { refreshWeeklyIngredientPrep } from "../public/in-house-ingredient-prep.mjs";

const syrup = { id: "simple-syrup", name: "Simple Syrup", group: "Other", onHand: 0, hasCurrentCount: true, bottleOz: 128, unitCost: 3.84, baseline: 0 };
const recipe = { title: "Example Cocktail", ingredients: [{ name: "Simple Syrup", oz: 640 }] };
function calculated(onHand = 0) {
  return buildRollingCocktailIngredientOrders({ inventoryItems: [{ ...syrup, onHand }], recipes: [recipe], tapInputs: [{ name: recipe.title, tapNumber: 47, currentStockKegs: 0, avgWeeklyKegs: 0.1 }] });
}

test("Simple Syrup becomes a five-gallon prep task, with no purchase or vendor requirement", () => {
  const plan = buildWeeklyActionPlan({ inventoryItems: calculated() });
  assert.equal(plan.prep.ingredients[0].quantity, 5);
  assert.equal(plan.prep.ingredients[0].unit, "gallons");
  assert.equal(plan.summary.orderLineCount, 0);
  assert.equal(plan.summary.estimatedKnownPurchaseCost, 0);
  assert.equal(plan.summary.missingPriceCount, 0);
  assert.deepEqual(groupWeeklyPlanOrdersByVendor(plan), []);
  assert.deepEqual(buildVendorOrderDrafts(plan).drafts, []);
  assert.equal(isInventoryCountExcluded(syrup), false);
});

test("prep nets available syrup and disappears when enough is on hand", () => {
  assert.equal(buildWeeklyActionPlan({ inventoryItems: calculated(2) }).prep.ingredients[0].quantity, 3);
  assert.deepEqual(buildWeeklyActionPlan({ inventoryItems: calculated(5) }).prep.ingredients, []);
});

test("old saved Simple Syrup purchase lines migrate to prep and purchase totals update", () => {
  const legacy = { orders: { beerKegs: [], liquorTapBottles: [], liquor: [], mixers: [], supplies: [{ ...syrup, quantity: 5, estimatedCost: 19.2, hasKnownPrice: true }] }, prep: { cocktails: [] }, review: { excludedInventory: [] }, summary: { orderLineCount: 1, estimatedKnownPurchaseCost: 19.2 } };
  const updated = refreshWeeklyPlanMetadata(legacy);
  assert.equal(updated.prep.ingredients[0].quantity, 5);
  assert.deepEqual(updated.orders.supplies, []);
  assert.equal(updated.summary.estimatedKnownPurchaseCost, 0);
  assert.equal(updated.summary.orderLineCount, 0);
  assert.deepEqual(refreshWeeklyPlanMetadata(updated), updated);
  assert.equal(legacy.orders.supplies.length, 1);
  assert.deepEqual(buildVendorOrderDrafts(legacy).drafts, []);
});

test("a stale Proof mapping or minimum-order candidate cannot buy Simple Syrup", () => {
  const raspberry = { id: "raspberry-schnapps", name: "Raspberry Schnapps", group: "Mixer Cabinet", par: 8, orderUnits: 12, vendor: "Proof", vendorSku: "293371", unitCost: 12.03, hasKnownPrice: true, estimatedCost: 144.36 };
  const plan = buildWeeklyActionPlan({ inventoryItems: [raspberry, { ...calculated()[0], vendor: "Proof", vendorSku: "old-syrup" }] });
  const result = buildVendorOrderDrafts(plan, { proofPrepRequirement: "required", proofMinimumCandidates: [{ ...syrup, vendor: "Proof", vendorSku: "old-syrup", shelfStable: true, projectedPrepUseUnits: 100, replacementNeedUnits: 100, packSize: 1 }] });
  assert.equal(result.drafts[0].lines.length, 1);
  assert.equal(result.drafts[0].lines[0].internalId, "raspberry-schnapps");
});

test("the prep notice is explicit and holds unknown quantities for verification", () => {
  const plan = buildWeeklyActionPlan({ inventoryItems: calculated() });
  const html = renderWeeklyIngredientPrep(plan.prep.ingredients);
  assert.match(html, /Prep required before cocktail batching/);
  assert.match(html, /Prep 5 gallons of Simple Syrup/);
  assert.doesNotMatch(html, /<details|Order|vendor/);
  const unknown = buildWeeklyActionPlan({ inventoryItems: [{ ...syrup, hasCurrentCount: false }] });
  assert.match(renderWeeklyIngredientPrep(unknown.prep.ingredients), /Verify the Simple Syrup count/);
  assert.doesNotMatch(renderWeeklyIngredientPrep(unknown.prep.ingredients), /Prep 0 gallons/);
});

const lemonDrop = { title: "Lemon Drop Martini(Vodka)", ingredients: [
  { name: "Vodka", oz: 828 }, { name: "Lemon Juice", oz: 300 }, { name: "Simple Syrup", oz: 320 },
] };
const exactOptions = {
  resolveRecipe: item => item.name === "Lemon Drop" ? lemonDrop : null,
  getRecipeYieldOz: recipe => recipe.ingredients.reduce((total, ingredient) => total + ingredient.oz, 0),
  onHandGallons: "0",
};

test("current syrup prep uses exact Lemon Drop ounces and preserves unrelated plan data", () => {
  const other = { id: "other-prep", name: "Other prep", quantity: 1 };
  const plan = { orders: { supplies: [{ id: "cups", quantity: 10 }] }, summary: { saved: true }, prep: {
    note: "Keep chilled", ingredients: [other, { id: "simple-syrup", quantity: 99 }],
    cocktails: [{ name: "Lemon Drop", quantity: 1, batchSizeOz: 1448 }],
  } };
  const before = structuredClone(plan);
  const updated = refreshWeeklyIngredientPrep(plan, exactOptions);
  assert.deepEqual(updated.prep.ingredients, [other, {
    id: "simple-syrup", name: "Simple Syrup", quantity: 2.5, unit: "gallons",
    requiredGallons: 2.5, onHandGallons: 0, holdReason: "",
  }]);
  assert.equal(updated.prep.note, "Keep chilled");
  assert.deepEqual(updated.orders, plan.orders);
  assert.deepEqual(updated.summary, plan.summary);
  assert.deepEqual(plan, before);
  assert.equal(refreshWeeklyIngredientPrep(plan, { ...exactOptions, onHandGallons: 1 }).prep.ingredients[1].quantity, 1.5);
  assert.deepEqual(refreshWeeklyIngredientPrep(plan, { ...exactOptions, onHandGallons: 3 }).prep.ingredients, [other]);
});

test("current syrup prep scales quantities and retains completed cocktail demand against unchanged counts", () => {
  const plan = { prep: { ingredients: [{ id: "simple-syrup", quantity: 99 }], cocktails: [
    { name: "Lemon Drop", quantity: 2, batchSizeOz: 724 },
    { name: "Lemon Drop", quantity: 3, batchSizeOz: 1448, completed: true },
  ] } };
  assert.equal(refreshWeeklyIngredientPrep(plan, exactOptions).prep.ingredients[0].quantity, 10);
  assert.deepEqual(refreshWeeklyIngredientPrep(plan, { ...exactOptions, plannedItems: [] }).prep.ingredients, []);
});

test("completing one of two batches cannot erase a syrup shortage when counts are not deducted", () => {
  const plan = { prep: { cocktails: [
    { name: "Lemon Drop", quantity: 1, batchSizeOz: 1448, completed: true },
    { name: "Lemon Drop", quantity: 1, batchSizeOz: 1448, completed: false },
  ] } };
  const result = refreshWeeklyIngredientPrep(plan, { ...exactOptions, onHandGallons: 3 });
  assert.equal(result.prep.ingredients[0].requiredGallons, 5);
  assert.equal(result.prep.ingredients[0].quantity, 2);
});

test("current syrup prep holds missing recipes and missing or invalid counts", () => {
  const plan = { prep: { cocktails: [{ name: "Lemon Drop", quantity: 1, batchSizeOz: 1448 }] } };
  for (const onHandGallons of [undefined, null, "", " ", "invalid", -1, Infinity]) {
    const result = refreshWeeklyIngredientPrep(plan, { ...exactOptions, onHandGallons });
    assert.match(result.prep.ingredients[0].holdReason, /Verify the Simple Syrup count/);
    assert.equal(result.prep.ingredients[0].onHandGallons, null);
    assert.doesNotMatch(renderWeeklyIngredientPrep(result.prep.ingredients), /Prep 0 gallons/);
  }
  assert.match(refreshWeeklyIngredientPrep(plan, { ...exactOptions, hasCurrentCount: false }).prep.ingredients[0].holdReason, /Verify/);
  const unresolved = refreshWeeklyIngredientPrep(plan, { ...exactOptions, resolveRecipe: () => null });
  assert.match(unresolved.prep.ingredients[0].holdReason, /Review cocktail recipes.*Lemon Drop/);
  assert.deepEqual(refreshWeeklyIngredientPrep({ prep: { cocktails: [] } }).prep.ingredients, []);
});
