import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { clean, toNumber } from "../public/dashboard-formatters.mjs";
import { applyInventoryCountPolicy } from "../public/inventory-count-policy.mjs";
import { normalizePackSize } from "../public/inventory-calculations.mjs";
import { getLiquorCabinetWeeklyBottleNeeds, getLiquorCabinetOrderQuantity } from "../public/liquor-cabinet-netting.mjs";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { includeMissingRecipeInventory } from "../public/recipe-ingredient-inventory.mjs";
import { applyMappedInventoryPackageRule } from "../public/inventory-product-rules.mjs";
const source = await readFile(new URL("../public/dashboard.js", import.meta.url), "utf8");
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
}

test("dashboard orders every saved batch and includes a newly counted ingredient without rewriting Monday", () => {
  const tito = { id: "tito-s", name: "Tito's", group: "Liquor Cabinet", onHandDisplay: "12", parDisplay: "0", orderDisplay: "0", unitCost: 34.78 };
  const fire = { id: "jack-daniel-s-fire", name: "Jack Daniel's Fire", group: "Liquor Cabinet", onHandDisplay: "0", parDisplay: "0", orderDisplay: "0", unitCost: 47 };
  const recipe = (name, ingredient, count) => ({ title: name, ingredients: [{ name: ingredient.name, raw: `${ingredient.name}=${count} bottles (1.75L)`, oz: Math.round(count * 59.17) }] });
  const frozen = { items: [{ key: "apple", name: "Apple Jack", actionType: "make", orderQty: 1 }, { key: "cran", name: "Vodka Cran", actionType: "make", orderQty: 2 }], tapInputs: [{ tapNumber: 57, name: "Vodka Cran", currentStockKegs: 2, avgWeeklyKegs: 0.1 }] };
  const original = { items: [tito] };
  const context = {
    clean, toNumber, normalizePackSize, applyInventoryCountPolicy, getLiquorCabinetWeeklyBottleNeeds, getLiquorCabinetOrderQuantity,
    includeMissingRecipeInventory, buildRollingCocktailIngredientOrders, inventoryHistory: [original],
    getCurrentMondayInventorySnapshot: () => original, getCurrentMondayKegPlanSnapshot: () => frozen,
    getInventorySnapshotItems: () => [{ ...tito, onHandDisplay: "6" }, fire],
    inventoryItems: [tito, fire].map(item => ({ ...item, bottleOz: 59.17, vendorProduct: { vendor: "OHLQ", bottleOz: 59.17, preferredSku: item.id } })),
    recipes: [recipe("Apple Jack", fire, 4), recipe("Vodka Cran", tito, 6)],
    getVendorMapping: () => null, getRecipeBuilderPackageConfig: () => null, isKitchenManagedInventoryItem: () => false, isFoodDepartmentOrderedInventoryItem: () => false,
    MENU_ORDER: [], NEW_RECIPE_ORDER: [], liveParRecommendations: null,
    parAgentState: null, getCurrentWeeklyPlanSnapshot: () => null,
  };
  runInNewContext(declaration("getWeeklyPlanInventoryItems"), context);
  const result = context.getWeeklyPlanInventoryItems();
  assert.equal(result.find(item => item.id === fire.id).orderUnits, 4);
  assert.equal(result.find(item => item.id === tito.id).orderUnits, 12);
  assert.equal(original.items.length, 1);
  assert.equal(original.items[0].onHandDisplay, "12");
});

test("saved prep additions drive ingredient orders while Monday tap stock and counts remain frozen", () => {
  const citron = { id: "absolut-citron", name: "Absolut Citron", group: "Liquor Cabinet", onHandDisplay: "0", parDisplay: "0", orderDisplay: "0", unitCost: 34 };
  const savedTap = { key: "main:57", tapNumber: 57, wall: "Main", name: "Lemon Drop", currentStockKegs: 2, avgWeeklyKegs: 0.2 };
  const frozen = { items: [], tapInputs: [savedTap] };
  const original = { items: [citron] };
  const context = {
    clean, toNumber, normalizePackSize, applyInventoryCountPolicy, getLiquorCabinetWeeklyBottleNeeds, getLiquorCabinetOrderQuantity,
    includeMissingRecipeInventory, buildRollingCocktailIngredientOrders, inventoryHistory: [original],
    getCurrentMondayInventorySnapshot: () => original, getCurrentMondayKegPlanSnapshot: () => frozen,
    getInventorySnapshotItems: () => [{ ...citron, onHandDisplay: "20" }],
    inventoryItems: [{ ...citron, bottleOz: 59.17, vendorProduct: { vendor: "OHLQ", bottleOz: 59.17, preferredSku: citron.id } }],
    recipes: [{ title: "Lemon Drop", ingredients: [{ name: citron.name, raw: "Absolut Citron=14 bottles (1.75L)", oz: 828 }] }],
    getVendorMapping: () => null, getRecipeBuilderPackageConfig: () => null, isKitchenManagedInventoryItem: () => false, isFoodDepartmentOrderedInventoryItem: () => false,
    MENU_ORDER: [], NEW_RECIPE_ORDER: [], liveParRecommendations: null,
    parAgentState: { recommendations: { items: [{ ...savedTap, prepAdditionId: "lemon-added", actionType: "make", orderQty: 1 }] } },
    getCurrentWeeklyPlanSnapshot: () => ({ ingredientPlanningVersion: 2 }),
  };
  runInNewContext(declaration("getWeeklyPlanInventoryItems"), context);
  const result = context.getWeeklyPlanInventoryItems();
  assert.equal(result[0].orderUnits, 14);
  assert.equal(result[0].onHand, 0);
  const liveInventory = context.getWeeklyPlanInventoryItems({ live: true });
  assert.equal(liveInventory[0].cocktailPrepRequiredBottles, 14);
  assert.equal(liveInventory[0].onHand, 20);
  assert.equal(frozen.items.length, 0);
  assert.equal(original.items[0].onHandDisplay, "0");
});

test("catalog pricing and display preserve an unknown count and individual Mint Syrup packaging", () => {
  const item = { id: "mint", name: "Mint Syrup", onHandDisplay: "", vendorProduct: { vendor: "Proof", bottleOz: 12.68, packSize: 12, casePackaged: false } };
  const context = { clean, ingredients: [], inventoryItems: [item], getVendorMapping: () => null,
    applyMappedInventoryPackageRule, getInventoryBottleCost: () => 3.67, getInventoryPriceSourceNote: () => "", recalculateInventoryItem: () => {},
  };
  runInNewContext(declaration("syncInventoryItemCatalogLinks") + "\n" + declaration("getInventoryDisplayValue"), context);
  context.syncInventoryItemCatalogLinks();
  assert.equal(item.onHandDisplay, "");
  assert.equal(context.getInventoryDisplayValue(item, "onHand"), "");
  assert.equal(item.vendorProduct.vendor, "Proof");
  assert.equal(item.packSize, 1);
  assert.equal(item.casePackaged, false);
});
