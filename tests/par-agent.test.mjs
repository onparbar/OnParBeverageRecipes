import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawRecommendation,
  getCocktailRecipeYieldOz,
  getKegFullOunces,
} from "../lib/par-agent.mjs";
import { COCKTAIL_RECIPE_YIELDS } from "../public/cocktail-recipe-yields.mjs";

function cocktailTap(name, tapNumber) {
  return {
    key: `main-${tapNumber}`,
    tapNumber,
    wall: "Main",
    name,
    brand: name,
    templateBrand: name,
    type: "Cocktail",
    plu: tapNumber,
  };
}

function recommendation(name, tapNumber, volumeOz, fillLevelPercent = 0) {
  return buildRawRecommendation(
    cocktailTap(name, tapNumber),
    {
      fillLevelPercent,
      rawKegSize: 1536,
      rawKegSizeDp: 0,
    },
    [{ volumeOz }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
  );
}

test("uses each named cocktail recipe yield instead of the generic 12-gallon PMB size", () => {
  const fixtures = [
    ["SPIKED STRAWBERRY LEMONADE (TITO'S) 1", 65, 535, 1379, 0.388, 0.64],
    ["SPIKED STRAWBERRY LEMONADE (TITO'S) 2 ", 96, 58, 1379, 0.042, 0.29],
    ["SPIKED CRANBERRY LEMONADE (TITO'S) 1", 63, 274, 1379, 0.199, 0.45],
    ["SPIKED CRANBERRY LEMONADE (TITO'S) 2", 99, 96, 1379, 0.07, 0.32],
    ["SPIKED ARNOLD PALMER (TITO'S) 1", 62, 223, 1507, 0.148, 0.4],
  ];

  fixtures.forEach(([name, tapNumber, volumeOz, expectedYield, expectedWeekly, expectedTarget]) => {
    const tap = cocktailTap(name, tapNumber);
    const result = recommendation(name, tapNumber, volumeOz);
    assert.equal(getCocktailRecipeYieldOz(tap), expectedYield);
    assert.equal(getKegFullOunces({ rawKegSize: 1536 }, tap), expectedYield);
    assert.deepEqual(result.weeklyKegs, [expectedWeekly]);
    assert.equal(result.avgWeeklyKegs, expectedWeekly);
    assert.equal(result.targetStockKegs, expectedTarget);
    assert.equal(result.suggestedPar, expectedTarget);
  });
});

test("recognizes the Pink Lemonade display alias as the Strawberry recipe", () => {
  const tap = cocktailTap("Spiked Pink Lemonade (Vodka) 2", 96);
  assert.equal(getCocktailRecipeYieldOz(tap), 1379);
});

test("par-agent sizing covers every canonical cocktail source and display alias", () => {
  COCKTAIL_RECIPE_YIELDS.forEach(({ sourceTitle, yieldOz, aliases }) => {
    [sourceTitle, ...aliases].forEach((name, index) => {
      const tap = cocktailTap(`${name} ${index % 2 ? 2 : 1}`, 200 + index);
      assert.equal(getCocktailRecipeYieldOz(tap), yieldOz, name);
      assert.equal(getKegFullOunces({ rawKegSize: 1536 }, tap), yieldOz, name);
    });
  });
});

test("keeps PMB and standard size fallbacks for other cocktails", () => {
  const tap = cocktailTap("Generic Cocktail (Vodka) 1", 59);
  assert.equal(getCocktailRecipeYieldOz(tap), 0);
  assert.equal(getKegFullOunces({ rawKegSize: 1400 }, tap), 1400);
  assert.equal(getKegFullOunces(null, tap), 1536);
});

test("corrected Strawberry threshold produces the required make recommendation", () => {
  const result = recommendation("SPIKED STRAWBERRY LEMONADE (TITO'S) 1", 65, 535, 60);
  assert.equal(result.currentStockKegs, 0.6);
  assert.equal(result.avgWeeklyKegs, 0.388);
  assert.equal(result.targetStockKegs, 0.64);
  assert.equal(result.actionType, "make");
  assert.equal(result.rawOrderQty, 1);
  assert.equal(result.orderQty, 1);
  assert.match(result.reason, /below 0\.64: 0\.388\/week/);
});

test("uses On Par Tee and Whiskey Smash as saved On Deck make choices", () => {
  ["On Par Tee", "Whiskey Smash"].forEach((onDeckName, index) => {
    const tap = cocktailTap("SPIKED STRAWBERRY LEMONADE (TITO'S) 1", 65 + index);
    const result = buildRawRecommendation(
      tap,
      { fillLevelPercent: 60, rawKegSize: 1536, rawKegSizeDp: 0 },
      [{ volumeOz: 535 }],
      {
        onHandOverrides: {},
        onDeckOverrides: {
          [tap.key]: {
            comingSoonId: `recipe:${onDeckName.toLowerCase().replaceAll(" ", "-")}`,
            name: onDeckName,
            kind: "recipe",
            plu: 0,
          },
        },
      },
      {},
    );

    assert.equal(result.actionType, "make");
    assert.equal(result.orderQty, 1);
    assert.equal(result.orderProductName, onDeckName);
    assert.equal(result.onDeckProduct?.name, onDeckName);
    assert.match(result.reason, new RegExp(`Make ${onDeckName} from On Deck`));
  });
});
