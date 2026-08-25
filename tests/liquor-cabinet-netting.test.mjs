import assert from "node:assert/strict";
import test from "node:test";

import {
  getLiquorCabinetOrderQuantity,
  getLiquorCabinetWeeklyBottleNeeds,
  netLiquorTapRecommendations,
} from "../public/liquor-cabinet-netting.mjs";

const titos = {
  id: "tito-s",
  name: "Tito's",
  group: "Liquor Cabinet",
  onHandDisplay: "8",
  bottleOz: 33.8,
};
const vodkaCran = {
  id: "vodka-cran",
  title: "Vodka Cran (Tito's) 1",
  ingredients: [{ inventoryId: "tito-s", name: "Tito's", oz: 40 }],
};
const refill = {
  key: "patio-4",
  name: "Tito's (Vodka) 3",
  orderProductName: "Tito's",
  isLiquorTap: true,
  actionType: "order",
  orderQty: 2,
  suggestedBottleOrderQty: 2,
  reason: "Order 2 bottles.",
};

test("uses cabinet liquor left after reserving bottles for this week's cocktails", () => {
  const result = netLiquorTapRecommendations({
    recommendations: [
      { name: "Vodka Cran (Tito's) 1", orderProductName: "Vodka Cran (Tito's) 1", actionType: "make", orderQty: 1 },
      refill,
    ],
    inventoryItems: [titos],
    recipes: [vodkaCran],
  });

  assert.equal(result[1].cabinetReservedForCocktails, 2);
  assert.equal(result[1].cabinetUsedQty, 2);
  assert.equal(result[1].orderQty, 0);
  assert.equal(result[1].actionType, "none");
});

test("keeps the refill order when all cabinet bottles are reserved for cocktails", () => {
  const result = netLiquorTapRecommendations({
    recommendations: [
      { name: "Vodka Cran (Tito's) 1", orderProductName: "Vodka Cran (Tito's) 1", actionType: "make", orderQty: 1 },
      refill,
    ],
    inventoryItems: [{ ...titos, onHandDisplay: "2" }],
    recipes: [vodkaCran],
  });

  assert.equal(result[1].orderQty, 2);
  assert.equal(result[1].cabinetUsedQty, 0);
});

test("does not infer availability from a missing cabinet count", () => {
  const result = netLiquorTapRecommendations({
    recommendations: [refill],
    inventoryItems: [{ ...titos, onHandDisplay: "" }],
    recipes: [],
  });

  assert.deepEqual(result, [refill]);
});

test("allocates shared cabinet stock only once across matching liquor taps", () => {
  const result = netLiquorTapRecommendations({
    recommendations: [refill, { ...refill, key: "karaoke-84" }],
    inventoryItems: [{ ...titos, onHandDisplay: "3" }],
    recipes: [],
  });

  assert.equal(result[0].orderQty, 0);
  assert.equal(result[1].orderQty, 1);
});

test("recognizes a flavored margarita from the shared margarita recipe without disabling other liquor netting", () => {
  const result = netLiquorTapRecommendations({
    recommendations: [
      { name: "Blueberry Margarita (Jose Cuervo) 1", actionType: "make", orderQty: 1 },
      refill,
    ],
    inventoryItems: [titos],
    recipes: [{
      title: "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)",
      ingredients: [{ name: "Jose Cuervo", oz: 40 }],
    }],
  });

  assert.equal(result[1].cabinetUsedQty, 2);
  assert.equal(result[1].orderQty, 0);
});

test("calculates weekly liquor bottle needs without turning an unused par gap into an order", () => {
  const bulleit = {
    id: "bulleit-bourbon",
    name: "Bulleit Bourbon",
    group: "Liquor Cabinet",
    onHandDisplay: "14",
    bottleOz: 33.8,
  };
  const needs = getLiquorCabinetWeeklyBottleNeeds({
    recommendations: [
      { name: "Vodka Cran (Tito's) 1", orderProductName: "Vodka Cran (Tito's) 1", actionType: "make", orderQty: 1 },
    ],
    inventoryItems: [titos, bulleit],
    recipes: [vodkaCran],
  });

  assert.equal(needs.get("tito-s").requiredBottles, 2);
  assert.equal(needs.get("bulleit-bourbon").requiredBottles, 0);
});

test("preserves cabinet par replenishment separately from cocktail and tap needs", () => {
  assert.equal(getLiquorCabinetOrderQuantity({
    parOrderQty: 22,
    onHand: 14,
    requiredBottles: 6,
  }), 22);
});

test("orders enough for cocktails when their shortage exceeds the cabinet par gap", () => {
  assert.equal(getLiquorCabinetOrderQuantity({
    parOrderQty: 2,
    onHand: 2,
    requiredBottles: 6,
  }), 4);
});
