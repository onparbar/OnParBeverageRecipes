import assert from "node:assert/strict";
import test from "node:test";
import { buildRollingCocktailIngredientOrders, netRollingLiquorTapRecommendations } from "../public/rolling-cocktail-ingredients.mjs";
import { buildWeeklyUsageSellerRankings } from "../public/weekly-usage-seller-rankings.mjs";
import { buildProofPrepOrderContext } from "../public/proof-prep-replacements.mjs";

const recipe = { title: "Example", ingredients: [{ name: "Tito's", oz: 6 }, { name: "Lime Juice", oz: 8 }] };
const tap = { key: "main:57", tapNumber: 57, name: "Example", currentStockKegs: 0.5, avgWeeklyKegs: 0.3 };
const cabinet = [
  { id: "tito-s", name: "Tito's", group: "Liquor Cabinet", bottleOz: 1, onHand: 24, hasCurrentCount: true, unitCost: 10, packSize: 1 },
  { id: "lime-juice", name: "Lime Juice", group: "Mixer Cabinet", bottleOz: 1, onHand: 3, hasCurrentCount: true, unitCost: 5, packSize: 12, casePackaged: true },
];

test("two Thursdays include later prep, agreed reserves, and whole-case rounding", () => {
  const items = buildRollingCocktailIngredientOrders({ inventoryItems: cabinet, recipes: [recipe], tapInputs: [tap] });
  assert.deepEqual(items[0].rollingPrepWeeks, [0, 6]);
  assert.equal(items[0].cocktailPrepRequiredBottles, 6);
  assert.equal(items[0].rollingReserveUnits, 12);
  assert.equal(items[0].orderUnits, 0);
  assert.equal(items[1].orderUnits, 24);
  assert.equal(items[1].estimatedCost, 120);
});

test("a spare keg on another wall cannot satisfy this tap's prep demand", () => {
  const items = buildRollingCocktailIngredientOrders({ inventoryItems: cabinet, recipes: [recipe], tapInputs: [tap, { ...tap, key: "karaoke:95", tapNumber: 95, currentStockKegs: 2 }] });
  assert.equal(items[0].cocktailPrepRequiredBottles, 6);
});

test("liquor refills use only cabinet stock left after rolling prep and reserve", () => {
  const items = buildRollingCocktailIngredientOrders({ inventoryItems: cabinet, recipes: [recipe], tapInputs: [tap] });
  const orders = netRollingLiquorTapRecommendations([
    { name: "Tito's", isLiquorTap: true, actionType: "order", orderQty: 8 },
    { name: "Tito's", isLiquorTap: true, actionType: "order", orderQty: 2 },
  ], items);
  assert.equal(orders[0].cabinetUsedQty, 6);
  assert.equal(orders[0].orderQty, 2);
  assert.equal(orders[1].cabinetUsedQty, 0);
  assert.equal(orders[1].orderQty, 2);
});

test("unknown tap stock holds rolling purchases instead of treating it as zero", () => {
  const items = buildRollingCocktailIngredientOrders({ inventoryItems: cabinet, recipes: [recipe], tapInputs: [{ ...tap, currentStockKegs: null }] });
  assert.match(items[0].orderHoldReason, /missing/);
  assert.equal(items[0].orderUnits, 0);
});

test("Proof looks beyond two weeks and subtracts inventory rather than old pars", () => {
  const context = buildProofPrepOrderContext({
    tapInputs: [{ ...tap, currentStockKegs: 0.9 }], recipes: [recipe],
    inventoryItems: [{ ...cabinet[1], vendor: "Proof", vendorSku: "lime", onHandDisplay: "3", parDisplay: "40" }],
  });
  assert.equal(context.requirement, "not-required");
  assert.equal(context.candidates[0].replacementNeedUnits, 5);
  assert.equal(context.candidates[0].forecastDemands.find((entry) => entry.units > 3).week, 2);
});

test("margin is revenue-weighted across weeks and uses the profit estimate's selling rate", () => {
  const result = buildWeeklyUsageSellerRankings([{
    name: "Example Beer", tapNumber: 21, type: "beer",
    history: [{ label: "8/31/26 - 9/6/26", volumeOz: 10 }, { label: "8/24/26 - 8/30/26", volumeOz: 90 }],
  }], {
    metric: "margin", wall: "all",
    getGrossProfitPerOz: (_item, { entry }) => ({ grossProfitPerOz: entry.volumeOz === 10 ? 0.8 : 0.5, sellingPricePerOz: entry.volumeOz === 10 ? 1 : 2 }),
  });
  assert.equal(result.recent.top[0].averageProfitMargin, 27.89);
  assert.equal(result.metricMetadata.unit, "%");
});
