import assert from "node:assert/strict";
import test from "node:test";

import { netLiquorTapRecommendations } from "../public/liquor-cabinet-netting.mjs";

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
