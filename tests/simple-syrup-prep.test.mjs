import assert from "node:assert/strict";
import test from "node:test";
import { buildWeeklyActionPlan, refreshWeeklyPlanMetadata, groupWeeklyPlanOrdersByVendor } from "../public/weekly-action-plan.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildVendorOrderDrafts } from "../public/vendor-order-drafts.mjs";
import { renderWeeklyIngredientPrep } from "../public/weekly-plan-view.mjs";
import { isInventoryCountExcluded } from "../public/inventory-count-policy.mjs";

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
