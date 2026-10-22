import assert from "node:assert/strict";
import test from "node:test";
import { completeRecipeIngredientInventory, findRecipeIngredientInventory, includeMissingRecipeInventory, getIngredientPurchaseGaps, recipeIngredientQuantityIssue } from "../public/recipe-ingredient-inventory.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { applyInventoryCountPolicy, isInventoryCountExcluded } from "../public/inventory-count-policy.mjs";
import { buildRecipeInventoryContributions, findCatalogItem } from "../lib/inventory-contributions.mjs";

const fire = { id: "jack-daniel-s-fire", name: "Jack Daniel's Fire", group: "Liquor Cabinet", bottleOz: 59.17, onHand: 0, hasCurrentCount: true, unitCost: 47 };
const apple = { title: "Apple Jack", ingredients: [{ id: fire.id, name: fire.name, raw: "Jack Daniels Fire =4 bottles (1.75L)", oz: 236 }, { name: "Lemonade", oz: 704 }, { name: "Vanilla Syrup", oz: 50 }, { name: "Water", oz: 256 }] };
const product = { vendor: "OHLQ", productName: "Jack Daniel's Tennessee Fire 1.75L", preferredSku: "4982D", bottleOz: 59.17, unitPrice: 47 };

test("every purchased recipe ingredient gets an entry without inventing a count", () => {
  const items = completeRecipeIngredientInventory([], [apple], { productFor: () => product });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, fire.id);
  assert.equal(items[0].onHandDisplay, "");
  assert.equal(items[0].group, "Liquor Cabinet");
  const [held] = buildRollingCocktailIngredientOrders({ inventoryItems: items.map(item => ({ ...item, hasCurrentCount: false })), recipes: [apple], cocktails: [{ name: "Apple Jack", quantity: 1 }] });
  assert.match(held.orderHoldReason, /count is missing/);
  assert.equal(held.cocktailPrepRequiredBottles, 4);
  assert.equal(held.orderUnits, 0);
  assert.equal(completeRecipeIngredientInventory(items, [apple], { productFor: () => product }).length, 1);
});

test("newly counted zero-par Jack Fire joins older Monday inputs and orders four bottles", () => {
  const original = [{ id: "jack-daniel-s", name: "Jack Daniel's", onHandDisplay: "10" }];
  const current = [{ ...fire, onHandDisplay: "0" }];
  const source = includeMissingRecipeInventory(original, current);
  assert.equal(source.length, 2);
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [source[1]], recipes: [apple], cocktails: [{ name: "Apple Jack", quantity: 1 }] });
  assert.equal(result.orderUnits, 4);
  assert.equal(result.estimatedCost, 188);
  assert.equal(result.orderHoldReason, "");
  assert.deepEqual(original, [{ id: "jack-daniel-s", name: "Jack Daniel's", onHandDisplay: "10" }]);
});

test("saved prep quantities win even when a separate average forecast would skip a scheduled batch", () => {
  const recipe = { title: "Vodka Cran", ingredients: [{ name: "Tito's", raw: "Tito's=6 bottles (1.75L)", oz: 355 }, { name: "Cranberry Juice", oz: 1024 }] };
  const inventory = [{ id: "tito-s", name: "Tito's", group: "Liquor Cabinet", bottleOz: 59.17, onHand: 12, hasCurrentCount: true }];
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: inventory, recipes: [recipe],
    tapInputs: [{ name: "Vodka Cran", tapNumber: 57, currentStockKegs: 2, avgWeeklyKegs: 0.1 }],
    cocktails: [{ name: "Vodka Cran", quantity: 2, tapNumbers: [57, 58] }],
  });
  assert.equal(result.cocktailPrepRequiredBottles, 12);
  assert.equal(result.orderUnits, 12);
  assert.deepEqual(result.rollingPrepTapNumbers, [57, 58]);
});

test("an absent or ambiguous ingredient is visible instead of silently ignored", () => {
  const recipe = { title: "Example", ingredients: [{ name: "New syrup", oz: 25 }] };
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [fire], recipes: [recipe], cocktails: [{ name: "Example", quantity: 1 }] });
  assert.match(result.orderHoldReason, /New syrup: add or link/);
  assert.equal(result.orderUnits, 0);
  assert.equal(findRecipeIngredientInventory({ name: "Mint" }, [{ id: "mint", name: "Mint Syrup" }, { id: "another", name: "Mint" }]), null);
  assert.equal(findRecipeIngredientInventory({ inventoryItemId: "missing", name: fire.name }, [fire]), null);
  assert.equal(findRecipeIngredientInventory({ name: "Fireball" }, [fire]), null);
  assert.equal(findRecipeIngredientInventory({ name: "Jack Daniel's" }, [fire]), null);
});

test("the five soda machine ingredients never require counts, orders or deductions", () => {
  for (const name of ["Lemonade", "Strawberry Lemonade", "Cranberry Juice", "Sweet Tea", "Blue Dot Juice"]) {
    const item = applyInventoryCountPolicy({ id: name.toLowerCase().replaceAll(" ", "-"), name, group: "Mixer Cabinet", onHand: 0, orderUnits: 9 });
    assert.equal(isInventoryCountExcluded(item), true);
    assert.equal(item.countSource, "soda-machine");
    assert.equal(item.orderUnits, 0);
    assert.deepEqual(buildRecipeInventoryContributions({ title: "Example", ingredients: [{ name, oz: 128 }] }, []), []);
  }
});

test("Mint and Mint Syrup resolve to the same counted stock", () => {
  const item = { id: "mint", name: "Mint Syrup", group: "Mixer Cabinet", bottleOz: 12.68, onHandDisplay: "0", baseline: 0 };
  assert.equal(findRecipeIngredientInventory({ name: "Mint" }, [item]), item);
  assert.equal(findCatalogItem([item], { name: "Mint" }), item);
  assert.equal(completeRecipeIngredientInventory([item], [{ ingredients: [{ name: "Mint", oz: 25 }] }]).length, 1);
});

test("remaining prep gaps subtract outstanding orders and clear with an actual receipt", () => {
  const before = structuredClone(fire);
  const vendors = [{ ordered: true, items: [{ inventoryItemId: fire.id, quantity: 2, receivedQuantity: 0 }] }];
  const [planned] = buildRollingCocktailIngredientOrders({ inventoryItems: [fire], recipes: [apple], cocktails: [{ name: "Apple Jack", quantity: 1 }] });
  assert.equal(getIngredientPurchaseGaps([planned], vendors)[0].quantity, 2);
  const [received] = buildRollingCocktailIngredientOrders({ inventoryItems: [{ ...fire, onHand: 4 }], recipes: [apple], cocktails: [{ name: "Apple Jack", quantity: 1 }] });
  assert.deepEqual(getIngredientPurchaseGaps([received], []), []);
  assert.deepEqual(fire, before);
  assert.equal(vendors[0].items[0].receivedQuantity, 0);
});

test("Mint Syrup is deducted from its counted stock, and conflicting recipe quantities require review", () => {
  const catalog = [{ id: "mint", name: "Mint Syrup", bottleOz: 12.68, baseline: 4 }];
  const ingredient = { name: "Mint", raw: "Mint 2 bottles (375ml)", oz: 25.36 };
  assert.deepEqual(buildRecipeInventoryContributions({ ingredients: [ingredient] }, catalog), [{ id: "mint", quantity: -2, baseline: 4 }]);
  const inconsistent = { ...ingredient, raw: "Mint= 2 bottles 25 oz", oz: 25 };
  assert.match(recipeIngredientQuantityIssue(inconsistent), /disagree/);
  assert.throws(() => buildRecipeInventoryContributions({ ingredients: [inconsistent] }, catalog), /disagree/);
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [{ ...catalog[0], group: "Mixer Cabinet", onHand: 0 }],
    recipes: [{ title: "Whiskey Smash", ingredients: [inconsistent] }], cocktails: [{ name: "Whiskey Smash", quantity: 1 }],
  });
  assert.match(result.orderHoldReason, /confirm the recipe/);
  assert.equal(result.orderUnits, 0);
});

test("batch-total ounces cannot be mistaken for the size of each Kahlua bottle", () => {
  const [result] = buildRollingCocktailIngredientOrders({
    inventoryItems: [{ id: "kahlua", name: "Kahlua", group: "Mixer Cabinet", bottleOz: 33.814, onHand: 0, hasCurrentCount: true }],
    recipes: [{ title: "Espresso Martini", ingredients: [{ name: "Kahlua", raw: "Kahlua= 6 bottles (liter) 203 oz", oz: 203 }] }],
    cocktails: [{ name: "Espresso Martini", quantity: 1 }],
  });
  assert.equal(result.cocktailPrepRequiredBottles, 6);
  assert.equal(result.orderUnits, 6);
  assert.equal(result.orderHoldReason, "");
});

test("a short or rejected delivery cannot hide a remaining ingredient shortage", () => {
  const [planned] = buildRollingCocktailIngredientOrders({ inventoryItems: [fire], recipes: [apple], cocktails: [{ name: "Apple Jack", quantity: 1 }] });
  for (const status of ["not-received", "rejected", "partial"]) {
    const gaps = getIngredientPurchaseGaps([planned], [{ ordered: true, items: [{ inventoryItemId: fire.id, quantity: 4, receivedQuantity: 0, status }] }]);
    assert.equal(gaps[0].quantity, 4, status);
  }
});

test("the confirmed 50-ounce Mint Syrup batch orders four configured 375ml bottles", () => {
  const [result] = buildRollingCocktailIngredientOrders({
    inventoryItems: [{ id: "mint", name: "Mint Syrup", group: "Mixer Cabinet", bottleOz: 12.68, onHand: 0, hasCurrentCount: true, packSize: 1, casePackaged: false }],
    recipes: [{ title: "Whiskey Smash", ingredients: [{ name: "Mint Syrup", raw: "Mint Syrup=50 oz", oz: 50 }] }],
    cocktails: [{ name: "Whiskey Smash", quantity: 1 }],
  });
  assert.equal(result.cocktailPrepRequiredBottles, 4);
  assert.equal(result.orderUnits, 4);
  assert.equal(result.orderHoldReason, "");
});

test("the recipe catalog resolves repeated base/new recipes once for prep checkoffs", async () => {
  const { readPrepRecipes, findPrepRecipe } = await import("../lib/inventory-contributions.mjs");
  const recipes = await readPrepRecipes();
  for (const [id, name] of [["apple-jack-whiskey", "Apple Jack (Jack Fire) 1"], ["whiskey-smash", "Whiskey Smash (Jim Beam) 1"], ["on-par-tee", "On Par Tee (Crown Royal) 1"]]) {
    assert.equal(recipes.filter(recipe => recipe.id === id).length, 1);
    assert.ok(findPrepRecipe(recipes, { name }), name);
  }
});
