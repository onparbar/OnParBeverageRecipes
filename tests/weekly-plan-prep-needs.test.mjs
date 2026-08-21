import assert from "node:assert/strict";
import test from "node:test";

import { calculateWeeklyIngredientPrepNeed } from "../public/weekly-plan-prep-needs.mjs";

const recipes = new Map([
  ["tea", {
    yieldOz: 128,
    ingredients: [
      { name: "Simple Syrup", oz: 16 },
      { name: "Vodka", oz: 32 },
    ],
  }],
  ["sunset", {
    yieldOz: 64,
    ingredients: [{ name: "lime juice", oz: 8 }],
  }],
]);

test("scales an ingredient across planned batch sizes and quantities", () => {
  const result = calculateWeeklyIngredientPrepNeed({
    plannedItems: [
      { name: "tea", batchSizeOz: 256, quantity: 2 },
      { name: "sunset", batchSizeOz: 64, quantity: 3 },
    ],
    ingredientName: "simple syrup",
    resolveRecipe: (item) => recipes.get(item.name),
    getRecipeYieldOz: (recipe) => recipe.yieldOz,
  });

  assert.equal(result.totalOz, 64);
  assert.equal(result.gallons, 0.5);
  assert.equal(result.complete, true);
  assert.deepEqual(result.unmatched, []);
});

test("reports unresolved required recipes without treating missing data as zero", () => {
  const result = calculateWeeklyIngredientPrepNeed({
    plannedItems: [
      { name: "missing", batchSizeOz: 128, quantity: 1 },
      { name: "tea", batchSizeOz: 0, quantity: 1 },
    ],
    ingredientName: "simple syrup",
    resolveRecipe: (item) => recipes.get(item.name),
    getRecipeYieldOz: (recipe) => recipe.yieldOz,
  });

  assert.equal(result.totalOz, 0);
  assert.equal(result.complete, false);
  assert.deepEqual(result.unmatched, ["missing", "tea"]);
});
