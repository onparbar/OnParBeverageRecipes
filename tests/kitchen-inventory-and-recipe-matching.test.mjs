import { buildProofPrepOrderContext } from "../public/proof-prep-replacements.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { applyInventoryCountPolicy, getUncountedInventoryAmount, isInventoryCountExcluded } from "../public/inventory-count-policy.mjs";
import { getInventoryCountSections } from "../public/inventory-weekly-counts.mjs";
import { answerLocalInventoryQuestion } from "../public/local-inventory-questions.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildRecipeInventoryContributions } from "../lib/inventory-contributions.mjs";

const kitchen = ["Cold Brew", "Cold Brew Coffee", "Cold Brew Concentrate", "Vanilla", "Vanilla Syrup"];

test("kitchen items have no assumed beverage balance, count requirement, value, or order", () => {
  for (const name of kitchen) {
    const original = { id: name.toLowerCase().replaceAll(" ", "-"), name, group: "Mixer Cabinet", onHand: 3, onHandDisplay: "3", parDisplay: "12", assumedOnHand: 3, orderUnits: 9, totalValue: 150, orderHoldReason: "Old hold" };
    const item = applyInventoryCountPolicy(original);
    assert.equal(getUncountedInventoryAmount(item), null);
    assert.equal(isInventoryCountExcluded(item), true);
    assert.equal(item.onHand, null);
    assert.equal(item.onHandDisplay, "");
    assert.equal(item.assumedOnHand, null);
    assert.equal(item.orderUnits, 0);
    assert.equal(item.totalValue, 0);
    assert.equal(item.orderHoldReason, "");
    assert.equal(item.excludeFromOrderList, true);
    assert.deepEqual(getInventoryCountSections([item]), []);
    assert.equal(original.onHand, 3, "historical source data is not erased");
  }
});

test("cocktail forecasts do not calculate kitchen requirements or create kitchen orders", () => {
  const names = ["Cold Brew", "Vanilla Syrup", "Jack Daniels"];
  const catalog = names.map((name, i) => ({ id: String(i), name, group: "Mixer Cabinet", onHand: 0, hasCurrentCount: true, bottleOz: 25, baseline: 0 }));
  const recipe = { title: "Example", ingredients: names.map(name => ({ name, oz: 25, packageCount: 1 })) };
  const result = buildRollingCocktailIngredientOrders({ inventoryItems: catalog, recipes: [recipe], tapInputs: [{ tapNumber: 47, name: "Example", currentStockKegs: 0, avgWeeklyKegs: 2 }] });
  for (const item of result.slice(0, 2)) {
    assert.equal(item.cocktailPrepRequiredBottles, 0);
    assert.equal(item.rollingReserveUnits, 0);
    assert.equal(item.orderUnits, 0);
    assert.equal(item.onHand, null);
  }
  assert.ok(result[2].cocktailPrepRequiredBottles > 0);
  assert.deepEqual(buildRecipeInventoryContributions(recipe, catalog), [{ id: "2", quantity: -1, baseline: 0 }]);
});

test("inventory questions label kitchen responsibility instead of reporting assumed quantities", () => {
  const result = answerLocalInventoryQuestion("How much Cold Brew do we have in stock?", [{ id: "cold-brew", name: "Cold Brew", onHandDisplay: "3" }]);
  assert.match(result.rows[0].text, /Kitchen managed/);
  assert.doesNotMatch(result.rows[0].text, /3|assumed|count has not/);
});

test("Jacked Up Strawberry Lemonade matches the saved recipe with attached or spaced wall suffixes", () => {
  for (const name of ["Jacked Up Strawberry Lemonade (Jack Daniel's)1", "Jacked Up Strawberry Lemonade (Jack Daniel's) 1", "JACKED UP STRAWBERRY LEMONADE (JACK DANIELS) 2", "Jacked Up Strawberry Lemonade"]) {
    const [result] = buildRollingCocktailIngredientOrders({
      inventoryItems: [{ id: "jack-daniels", name: "Jack Daniels", group: "Liquor Cabinet", onHand: 10, hasCurrentCount: true, bottleOz: 59.2 }],
      recipes: [{ id: "jacked-up-strawberry-lemonade-whiskey", title: "Jacked Up Strawberry Lemonade (Whiskey)", ingredients: [{ name: "Jack Daniels", oz: 592 }] }],
      tapInputs: [{ tapNumber: 68, name, currentStockKegs: 0, avgWeeklyKegs: 1 }],
    });
    assert.equal(result.orderHoldReason, "", name);
    assert.ok(result.cocktailPrepRequiredBottles > 0, name);
  }
});

test("the matching fix still flags genuinely missing recipes", () => {
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [{ id: "jack", name: "Jack Daniels", group: "Liquor Cabinet", onHand: 10, hasCurrentCount: true }], recipes: [], tapInputs: [{ tapNumber: 68, name: "Unknown Lemonade (Whiskey)1", currentStockKegs: 0, avgWeeklyKegs: 1 }] });
  assert.match(result.orderHoldReason, /recipe.*missing/);
});


test("kitchen syrup cannot re-enter beverage ordering through an old Proof supplier mapping", () => {
  const result = buildProofPrepOrderContext({
    cocktails: [{ name: "Example", quantity: 2 }],
    recipes: [{ title: "Example", ingredients: [{ name: "Vanilla Syrup", oz: 50 }] }],
    inventoryItems: [{ id: "vanilla", name: "Vanilla Syrup", vendor: "Proof", bottleOz: 25, onHand: 0, hasCurrentCount: true, casePackaged: true, packSize: 6, vendorSku: "old-syrup", unitCost: 5 }],
    savedInventoryItems: [],
  });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.requirement, "not-required");
});
