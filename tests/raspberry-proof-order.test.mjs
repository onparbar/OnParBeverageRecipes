import assert from "node:assert/strict";
import test from "node:test";
import { findPlanningCocktailRecipe } from "../public/planning-cocktail-recipe.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildProofPrepOrderContext } from "../public/proof-prep-replacements.mjs";
import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";
import { buildVendorOrderDrafts } from "../public/vendor-order-drafts.mjs";

const sourceTitle = "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)";
const flavors = ["Blueberry", "Peach", "Raspberry", "Strawberry", "Watermelon"];
const recipes = flavors.map(flavor => ({
  id: `${flavor.toLowerCase()}-margarita`, title: `${flavor} Margarita`, sourceTitle,
  ingredients: [{ name: `${flavor} Schnapps`, oz: 270, raw: "Flavored Schnapps" }],
}));
const inventoryItems = flavors.map(flavor => ({
  id: `${flavor.toLowerCase()}-schnapps`, name: `${flavor} Schnapps`, group: "Liquor Cabinet",
  onHand: flavor === "Raspberry" ? 2 : 0, hasCurrentCount: true, bottleOz: 33.81,
  vendor: "Proof", vendorSku: flavor === "Raspberry" ? "293371" : `test-${flavor}`,
  vendorProductName: `DeKuyper ${flavor} Schnapps 1L`, casePackaged: true, packSize: 12,
  unitCost: 12.03, hasKnownPrice: true,
}));
const tapInputs = [
  { tapNumber: 52, wall: "Main", name: "RASPBERRY MARGARITA (JOSE CUERVO) 1", currentStockKegs: 0.676, avgWeeklyKegs: 0.131, preThursdayUsageSharePct: 0 },
  { tapNumber: 93, wall: "Karaoke", name: "RASPBERRY MARGARITA (JOSE CUERVO) 2", currentStockKegs: 0.274, avgWeeklyKegs: 0.069, preThursdayUsageSharePct: 0 },
];
const recipeAliases = Object.fromEntries(flavors.map(flavor => [`${flavor} Margarita`, sourceTitle]));

test("all five margaritas keep their own flavor regardless of menu order", () => {
  for (const flavor of flavors) {
    for (const menu of [recipes, [...recipes].reverse()]) {
      const recipe = findPlanningCocktailRecipe({ name: `${flavor.toUpperCase()} MARGARITA (JOSE CUERVO)2` }, menu, recipeAliases);
      assert.equal(recipe.ingredients[0].name, `${flavor} Schnapps`);
    }
  }
});

test("a raw shared formula specializes raspberry without changing the source", () => {
  const family = { id: "family", title: sourceTitle, ingredients: [{ name: "Blueberry Schnapps", raw: "Flavored Schnapps", oz: 270 }] };
  for (const recipeId of [undefined, "family"]) {
    const resolved = findPlanningCocktailRecipe({ name: tapInputs[1].name, recipeId }, [family], recipeAliases);
    assert.equal(resolved.ingredients[0].name, "Raspberry Schnapps");
    assert.equal(resolved.ingredients[0].inventoryId, "raspberry-schnapps");
  }
  assert.equal(family.ingredients[0].name, "Blueberry Schnapps");
});

test("missing raspberry cannot borrow a sibling flavor's formula", () => {
  assert.equal(findPlanningCocktailRecipe(tapInputs[1], [recipes[0]], recipeAliases), null);
  assert.equal(findPlanningCocktailRecipe(tapInputs[1], [recipes[0], recipes[1]], recipeAliases), null);
});

test("the saved two-bottle count produces a six-bottle raspberry shortage and one Proof case", () => {
  const results = buildRollingCocktailIngredientOrders({ inventoryItems, tapInputs, recipes, recipeAliases });
  const raspberry = results.find(item => item.id === "raspberry-schnapps");
  assert.equal(raspberry.cocktailPrepRequiredBottles, 8);
  assert.equal(raspberry.cocktailPrepShortageUnits, 6);
  assert.equal(raspberry.orderUnits, 12);
  assert.equal(raspberry.orderHoldReason, "");
  assert.deepEqual(raspberry.rollingPrepTapNumbers, [93]);
  assert.equal(results.find(item => item.id === "blueberry-schnapps").orderUnits, 0);
  const plan = buildWeeklyActionPlan({ inventoryItems: results });
  // An advisory forecast must not suppress a confirmed prep shortage.
  for (const proofPrepRequirement of ["required", "not-required"]) {
    const order = buildVendorOrderDrafts(plan, {
      generatedAt: "2026-10-12T17:00:00.000Z", sourceDate: "2026-10-12T17:00:00.000Z",
      now: new Date("2026-10-12T17:00:00.000Z"), proofPrepRequirement,
    });
    const proof = order.drafts.find(draft => draft.vendor === "Proof");
    assert.ok(proof);
    assert.equal(proof.lines.length, 1);
    assert.equal(proof.lines[0].internalId, "raspberry-schnapps");
    assert.equal(proof.lines[0].requestedUnits, 12);
    assert.equal(proof.lines[0].requestedCases, 1);
    assert.deepEqual(order.deferredOrders, []);
    assert.ok(proof.warnings.some(warning => warning.code === "PROOF_DELIVERY_FEE"));
  }
});

test("Proof prep forecast recognizes the planned raspberry batch shortage", () => {
  const context = buildProofPrepOrderContext({
    inventoryItems, tapInputs, recipes, recipeAliases,
    cocktails: [{ name: "Raspberry Margarita", quantity: 1, tapNumbers: [93], walls: ["Karaoke"] }],
  });
  assert.equal(context.requirement, "required");
  assert.ok(context.candidates.some(item => item.id === "raspberry-schnapps"));
  assert.ok(!context.candidates.some(item => item.id === "blueberry-schnapps"));
});
