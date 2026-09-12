import assert from "node:assert/strict";
import test from "node:test";
import { applyInventoryCountPolicy, getUncountedInventoryAmount } from "../public/inventory-count-policy.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildRecipeInventoryContributions } from "../lib/inventory-contributions.mjs";

test("uncounted mixers use fixed units despite blank, zero, or stale saved counts", () => {
  for (const [name, amount] of [["Sour Mix", 16], ["Sweet and Sour", 16], ["Cold Brew", 3], ["Cold Brew Concentrate", 3], ["Vanilla Syrup", 2]]) {
    for (const saved of ["", "0", "99"]) {
      const original = { name, group: "Mixer Cabinet", onHandDisplay: saved, onHand: Number(saved), hasCurrentCount: false };
      const result = applyInventoryCountPolicy(original);
      assert.equal(result.onHand, amount);
      assert.equal(result.group, "Other");
      assert.equal(result.countSource, "assumed");
      assert.equal(result.hasCurrentCount, true);
      assert.equal(original.onHandDisplay, saved);
    }
  }
});

test("vanilla liquor and other counted inventory are not treated as uncounted syrup", () => {
  for (const name of ["Absolut Vanilla", "Absolut Vanilia", "Bulleit Bourbon", "Simple Syrup"]) {
    const item = { name, onHand: 7 };
    assert.equal(getUncountedInventoryAmount(item), null);
    assert.equal(applyInventoryCountPolicy(item), item);
  }
});

test("weekly planning reapplies assumptions to old inventory snapshots", () => {
  const result = buildRollingCocktailIngredientOrders({
    inventoryItems: [{ id: "vanilla", name: "Vanilla Syrup", group: "Other", onHand: 0, hasCurrentCount: false, bottleOz: 25 }],
    tapInputs: [{ tapNumber: 47, name: "Example", currentStockKegs: 1, avgWeeklyKegs: 0 }],
  });
  assert.equal(result[0].onHand, 2);
  assert.equal(result[0].orderHoldReason, "");
  assert.equal(result[0].orderUnits, 0);
});

test("recipe prep does not deduct assumed ingredients but still deducts counted ones", () => {
  const catalog = ["Sour Mix", "Cold Brew", "Vanilla Syrup", "Lime Juice"].map((name, i) => ({ id: String(i), name, bottleOz: 25, baseline: 9 }));
  const recipe = { ingredients: catalog.map((item) => ({ name: item.name, oz: 25, packageCount: 1 })) };
  const contributions = buildRecipeInventoryContributions(recipe, catalog);
  assert.deepEqual(contributions, [{ id: "3", quantity: -1, baseline: 9 }]);
});
