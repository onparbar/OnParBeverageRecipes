import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRawRecommendation,
  fetchPmbSnapshot,
  getCocktailRecipeYieldOz,
  getKegFullOunces,
  getOnHandCoverage,
  getTapStateKey,
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

function beerTap(name = "MICHELOB ULTRA 2", tapNumber = 73) {
  return {
    key: `karaoke-${tapNumber}`,
    tapNumber,
    wall: "Karaoke",
    name,
    brand: name,
    templateBrand: name,
    type: "Lager",
    plu: tapNumber,
  };
}

function liquorTap(wall, tapNumber, name) {
  return {
    key: `${wall.toLowerCase()}-${tapNumber}`,
    tapNumber,
    wall,
    name,
    brand: name,
    templateBrand: name,
    type: "Shots",
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

function wallTap(tapNumber, { type = "Lager", brand = `Test Beer ${tapNumber}`, wall = "Main" } = {}) {
  return {
    key: getTapStateKey({ wall, tapNumber, brand }),
    tapNumber,
    type,
    brand,
    wall,
  };
}

async function pmbSnapshotFixture({ wallItems, tapRows, levelsBySlot = {}, tapConfigError = null }) {
  const productlist = [...new Map(
    tapRows.map((row) => [row.plu, { plu: row.plu, name: row.product }]),
  ).values()];

  return fetchPmbSnapshot({
    config: { baseUrl: "http://pmb.test", clientId: 1 },
    getAuthtokenImpl: async () => "test-token",
    getKegWallItemsImpl: async () => wallItems,
    getTapConfigRowsImpl: async () => {
      if (tapConfigError) throw tapConfigError;
      return tapRows;
    },
    postJsonImpl: async (_baseUrl, requestPath, body) => {
      if (requestPath === "/api/productlist") {
        return { status: 200, json: { productlist } };
      }
      return levelsBySlot[`${body.device_id}:${body.line_num}`];
    },
  });
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

test("uses the 13.2-gallon Guinness size instead of PMB's generic beer-keg size", () => {
  const tap = beerTap("BUDWEISER 1", 42);
  const liveLevel = {
    name: "Guinness Draught 1",
    tapProduct: "Guinness Draught 1",
    fillLevelPercent: 50,
    rawKegSize: 1984,
    rawKegSizeDp: 0,
  };
  const result = buildRawRecommendation(
    tap,
    liveLevel,
    [{ volumeOz: 1689.6 }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
  );

  assert.equal(getKegFullOunces(liveLevel, tap), 1689.6);
  assert.deepEqual(result.weeklyKegs, [1]);
  assert.equal(result.avgWeeklyKegs, 1);
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

test("uses built-in cocktails as saved On Deck make choices", () => {
  ["Bacardi Sunset", "On Par Tee", "Whiskey Smash"].forEach((onDeckName, index) => {
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

test("counts a prepared On Deck cocktail keg before recommending another batch", () => {
  const tap = cocktailTap("SPIKED STRAWBERRY LEMONADE (TITO'S) 1", 65);
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 10, rawKegSize: 1536, rawKegSizeDp: 0 },
    [{ volumeOz: 535 }],
    {
      onHandOverrides: {},
      onDeckOverrides: {
        [tap.key]: {
          comingSoonId: "recipe:on-par-tee",
          name: "On Par Tee",
          kind: "recipe",
          onHand: "1",
          onHandUnit: "keg",
        },
      },
    },
    {},
  );

  assert.equal(result.currentStockKegs, 1.1);
  assert.equal(result.actionType, "make");
  assert.equal(result.orderQty, 0);
});

test("orders a beer keg only when total stock is below average weekly usage plus 0.5 keg", () => {
  const tap = beerTap();
  const baseArgs = [
    tap,
    { fillLevelPercent: 40, rawKegSize: 1984, rawKegSizeDp: 0 },
    [{ volumeOz: 992 }],
  ];

  const belowTarget = buildRawRecommendation(
    ...baseArgs,
    { onHandOverrides: { [tap.key]: 0.5 }, onDeckOverrides: {} },
    {},
  );
  assert.equal(belowTarget.currentStockKegs, 0.9);
  assert.equal(belowTarget.avgWeeklyKegs, 0.5);
  assert.equal(belowTarget.targetStockKegs, 1);
  assert.equal(belowTarget.orderQty, 1);
  assert.match(belowTarget.reason, /below 1: 0\.5\/week plus 0\.5 keg/);

  const atTarget = buildRawRecommendation(
    ...baseArgs,
    { onHandOverrides: { [tap.key]: 0.6 }, onDeckOverrides: {} },
    {},
  );
  assert.equal(atTarget.currentStockKegs, 1);
  assert.equal(atTarget.orderQty, 0);
  assert.match(atTarget.reason, /covers 0\.5\/week plus 0\.5 keg/);
});

test("Main beer keeps one extra keg and can recommend two for a high-usage tap", () => {
  const tap = {
    ...beerTap("MILLER LITE 1", 22),
    key: "main-22",
    wall: "Main",
  };
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 10, rawKegSize: 1984, rawKegSizeDp: 0 },
    [{ volumeOz: 1587.2 }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
  );

  assert.equal(result.currentStockKegs, 0.1);
  assert.equal(result.avgWeeklyKegs, 0.8);
  assert.equal(result.targetStockKegs, 2.1);
  assert.equal(result.orderQty, 2);
  assert.match(result.reason, /keep 2 unopened backup kegs/);
});

test("standard Main beer orders one keg when connected plus on hand is below weekly average plus one backup", () => {
  const tap = {
    ...beerTap("TRUTH 1", 36),
    key: "main-36",
    wall: "Main",
  };
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 10, rawKegSize: 1984, rawKegSizeDp: 0 },
    [{ volumeOz: 793.6 }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
  );

  assert.equal(result.currentStockKegs, 0.1);
  assert.equal(result.avgWeeklyKegs, 0.4);
  assert.equal(result.targetStockKegs, 1.4);
  assert.equal(result.gapKegs, 1.3);
  assert.equal(result.orderQty, 1);
});

test("named Main beers keep high coverage even below the usage threshold", () => {
  ["Astra Red Cream Soda 1", "Blake's Triple Jam 1", "Guinness Draught 1"].forEach((name, index) => {
    const tap = {
      ...beerTap(name, 45 + index),
      key: `main-${45 + index}`,
      wall: "Main",
    };
    const result = buildRawRecommendation(
      tap,
      { fillLevelPercent: 50, rawKegSize: 1984, rawKegSizeDp: 0 },
      [{ volumeOz: 793.6 }],
      { onHandOverrides: { [tap.key]: 1 }, onDeckOverrides: {} },
      {},
    );

    assert.equal(result.avgWeeklyKegs, name === "Guinness Draught 1" ? 0.47 : 0.4);
    assert.equal(result.targetStockKegs, 2.5);
    assert.equal(result.orderQty, 1);
    assert.match(result.reason, /keep 2 unopened backup kegs/);
  });
});

test("uses the same tap keys as the browser for apostrophes and ampersands", () => {
  assert.equal(getTapStateKey({
    wall: "Main",
    tapNumber: 66,
    brand: "VODKA CRAN (TITO'S) 1",
  }), "main-66-vodka-cran-tito-s-1");
  assert.equal(getTapStateKey({
    wall: "Main",
    tapNumber: 47,
    brand: "GIN & JUICE (BOMBAY) 1",
  }), "main-47-gin-juice-bombay-1");
});

test("counts saved on-hand kegs for Vodka Cran", () => {
  const tap = cocktailTap("VODKA CRAN (TITO'S) 1", 66);
  tap.key = getTapStateKey(tap);
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 14.8, rawKegSize: 1379, rawKegSizeDp: 0 },
    [{ volumeOz: 280 }],
    { onHandOverrides: { "main-66-vodka-cran-tito-s-1": "1" }, onDeckOverrides: {} },
    {},
  );

  assert.equal(result.backupKegs, 1);
  assert.equal(result.currentStockKegs, 1.148);
  assert.equal(result.orderQty, 0);
});

test("uses the saved Weekly Usage average instead of a separate recent PMB average", () => {
  const tap = cocktailTap("BLUE DOT (SVEDKA) 1", 57);
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 42.4, rawKegSize: 1507, rawKegSizeDp: 0 },
    [{ volumeOz: 247.148 }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
    {
      tapNumber: 57,
      displayUnit: "kegs",
      average: 0.21435897435897439,
      history: [{ value: 0.23 }, { value: 0.25 }, { value: 0.16 }],
    },
  );

  assert.equal(result.avgWeeklyKegs, 0.214);
  assert.equal(result.targetStockKegs, 0.46);
  assert.deepEqual(result.weeklyKegs, [0.23, 0.25, 0.16]);
});

test("uses the 0.25-keg threshold for karaoke cocktail kegs", () => {
  const tap = {
    ...cocktailTap("RASPBERRY MARGARITA (JOSE CUERVO) 2", 93),
    key: "karaoke-93",
    wall: "Karaoke",
  };
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 30, rawKegSize: 1536, rawKegSizeDp: 0 },
    [{ volumeOz: 153.6 }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
  );

  assert.equal(result.currentStockKegs, 0.3);
  assert.equal(result.avgWeeklyKegs, 0.1);
  assert.equal(result.targetStockKegs, 0.35);
  assert.equal(result.orderQty, 1);
});

test("orders two bottles per low patio or karaoke liquor tap", () => {
  const fixtures = [
    [liquorTap("Patio", 1, "Hennessy (Cognac) 3"), 50, 0],
    [liquorTap("Karaoke", 83, "Grey Goose (Vodka) 2"), 49.8, 2],
  ];

  fixtures.forEach(([tap, fillLevelPercent, expectedBottleQty]) => {
    const result = buildRawRecommendation(
      tap,
      { fillLevelPercent, rawKegSize: 500, rawKegSizeDp: 0 },
      [{ volumeOz: 120 }, { volumeOz: 180 }],
      { onHandOverrides: { [tap.key]: 8 }, onDeckOverrides: {} },
      {},
    );

    assert.equal(result.isLiquorTap, true);
    assert.equal(result.avgWeeklyOunces, 150);
    assert.equal(result.targetStockOunces, 250);
    assert.equal(result.orderQty, expectedBottleQty);
    assert.equal(result.suggestedBottleOrderQty, expectedBottleQty);
    assert.equal(result.suggestedRefillQty, 0);
    assert.equal(result.deferredQty, 0);
    assert.equal(result.deferredReview, false);
    assert.equal(result.actionType, expectedBottleQty ? "order" : "none");
    assert.equal(result.currentStockOunces, expectedBottleQty ? 249 : 250);
  });
});

test("uses saved Weekly Usage ounces for liquor taps too", () => {
  const tap = liquorTap("Patio", 1, "Hennessy (Cognac) 3");
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 50, rawKegSize: 500, rawKegSizeDp: 0 },
    [{ volumeOz: 10 }],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
    {
      tapNumber: 1,
      displayUnit: "oz",
      average: 160,
      history: [{ value: 120 }, { value: 200 }],
    },
  );

  assert.equal(result.avgWeeklyOunces, 160);
  assert.equal(result.targetStockOunces, 260);
  assert.equal(result.orderQty, 2);
  assert.equal(result.suggestedBottleOrderQty, 2);
  assert.equal(result.deferredQty, 0);
  assert.deepEqual(result.weeklyOunces, [120, 200]);
});

test("uses a 500-ounce fallback when a liquor tap has no PMB keg-size metadata", () => {
  const tap = liquorTap("Patio", 1, "Hennessy (Cognac) 3");
  const liveLevel = {
    fillLevelPercent: 50,
    rawPercent: 5000,
    rawKegSize: null,
    rawKegSizeDp: null,
  };
  const result = buildRawRecommendation(
    tap,
    liveLevel,
    [],
    { onHandOverrides: {}, onDeckOverrides: {} },
    {},
    { tapNumber: 1, displayUnit: "oz", average: 160, history: [{ value: 160 }] },
  );

  assert.equal(getKegFullOunces(liveLevel, tap), 500);
  assert.equal(result.currentStockOunces, 250);
  assert.equal(result.targetStockOunces, 260);
  assert.equal(result.orderQty, 2);
  assert.equal(result.suggestedBottleOrderQty, 2);
  assert.equal(result.deferredQty, 0);
  assert.match(result.reason, /order 2 bottles/i);
});

test("fails closed when the live PMB tap configuration cannot be read", async () => {
  await assert.rejects(
    () => pmbSnapshotFixture({
      wallItems: [wallTap(21)],
      tapRows: [{ plu: 4101, deviceId: 9001, lineNum: 1, tapNumber: 21, product: "Test Beer", unused: false }],
      tapConfigError: new Error("management page timed out"),
    }),
    (error) => (
      error.code === "PMB_TAP_CONFIG_UNAVAILABLE"
      && error.status === 503
      && /Existing recommendations were kept/.test(error.message)
    ),
  );
});

test("fails closed when the live PMB tap configuration is only partial", async () => {
  await assert.rejects(
    () => pmbSnapshotFixture({
      wallItems: [wallTap(21), wallTap(22)],
      tapRows: [{ plu: 4101, deviceId: 9001, lineNum: 1, tapNumber: 21, product: "Test Beer 21", unused: false }],
    }),
    (error) => (
      error.code === "PMB_TAP_CONFIG_PARTIAL"
      && error.status === 503
      && error.details.liveTapCount === 1
      && error.details.expectedTapCount === 2
      && error.details.missingTapNumbers[0] === 22
    ),
  );
});

test("fails closed on failed and malformed PMB keg-level responses", async () => {
  const wallItems = [wallTap(21)];
  const tapRows = [{
    plu: 4101,
    deviceId: 9001,
    lineNum: 1,
    tapNumber: 21,
    product: "Test Beer 21",
    unused: false,
  }];

  await assert.rejects(
    () => pmbSnapshotFixture({
      wallItems,
      tapRows,
      levelsBySlot: {
        "9001:1": { status: 500, json: { fill_level_perc: 5000 } },
      },
    }),
    (error) => error.code === "PMB_KEG_LEVEL_READ_FAILED" && error.details.upstreamStatus === 500,
  );

  await assert.rejects(
    () => pmbSnapshotFixture({
      wallItems,
      tapRows,
      levelsBySlot: {
        "9001:1": { status: 200, json: { fill_level_perc: "not-a-level" } },
      },
    }),
    (error) => error.code === "PMB_KEG_LEVEL_READ_FAILED" && error.details.upstreamStatus === 200,
  );
});

test("keeps separate live levels when one PLU is assigned to multiple physical taps", async () => {
  const snapshot = await pmbSnapshotFixture({
    wallItems: [wallTap(21), wallTap(22)],
    tapRows: [
      { plu: 4101, deviceId: 9001, lineNum: 1, tapNumber: 21, product: "Test Beer", unused: false },
      { plu: 4101, deviceId: 9002, lineNum: 4, tapNumber: 22, product: "Test Beer", unused: false },
    ],
    levelsBySlot: {
      "9001:1": { status: 200, json: { fill_level_perc: 2500 } },
      "9002:4": { status: 200, json: { fill_level_perc: 7500 } },
    },
  });

  assert.equal(snapshot.currentTaps.length, 2);
  assert.equal(snapshot.levelsByTap.size, 2);
  assert.equal(snapshot.levelsByTap.get("tap:21").fillLevelPercent, 25);
  assert.equal(snapshot.levelsByTap.get("tap:22").fillLevelPercent, 75);
  assert.equal(snapshot.levelsByTap.get("tap:21").plu, 4101);
  assert.equal(snapshot.levelsByTap.get("tap:22").plu, 4101);
});

test("treats missing and blank on-hand counts as zero", () => {
  const firstKeg = beerTap("Test Lager 1", 21);
  const secondKeg = cocktailTap("BLUE DOT (SVEDKA) 1", 57);
  const coverage = getOnHandCoverage(
    [firstKeg, secondKeg, liquorTap("Patio", 1, "Hennessy (Cognac) 3")],
    {
      [firstKeg.key]: "0",
      unrelated1: "1",
      unrelated2: "1",
      unrelated3: "1",
      unrelated4: "1",
      unrelated5: "1",
    },
  );

  assert.equal(coverage.requiredCount, 2);
  assert.equal(coverage.coveredCount, 2);
  assert.deepEqual(coverage.missingTaps, []);
});

test("still rejects invalid nonblank on-hand counts", () => {
  const firstKeg = beerTap("Test Lager 1", 21);
  const secondKeg = cocktailTap("BLUE DOT (SVEDKA) 1", 57);
  const coverage = getOnHandCoverage([firstKeg, secondKeg], {
    [firstKeg.key]: "not a number",
    [secondKeg.key]: "-1",
  });

  assert.equal(coverage.requiredCount, 2);
  assert.equal(coverage.coveredCount, 0);
  assert.deepEqual(coverage.missingTaps.map((tap) => tap.tapNumber), [21, 57]);
});

test("makes enough cocktail kegs to cover the complete calculated gap", () => {
  const tap = cocktailTap("BLUE DOT (SVEDKA) 1", 57);
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 10, rawKegSize: 1507, rawKegSizeDp: 0 },
    [],
    { onHandOverrides: { [tap.key]: 0 }, onDeckOverrides: {} },
    {},
    {
      tapNumber: 57,
      displayUnit: "kegs",
      average: 2.4,
      history: [{ value: 2.4 }],
    },
  );

  assert.equal(result.currentStockKegs, 0.1);
  assert.equal(result.targetStockKegs, 2.65);
  assert.equal(result.gapKegs, 2.55);
  assert.equal(result.orderQty, 3);
});

test("surfaces the configured beer order cap whenever it reduces calculated need", () => {
  const tap = beerTap("Test Lager 1", 21);
  const result = buildRawRecommendation(
    tap,
    { fillLevelPercent: 0, rawKegSize: 1984, rawKegSizeDp: 0 },
    [],
    { onHandOverrides: { [tap.key]: 0 }, onDeckOverrides: {} },
    { maxOrderPerTap: 2 },
    {
      tapNumber: 21,
      displayUnit: "kegs",
      average: 4,
      history: [{ value: 4 }],
    },
  );

  assert.equal(result.calculatedOrderQty, 5);
  assert.equal(result.orderQty, 2);
  assert.equal(result.orderCap, 2);
  assert.equal(result.orderCapApplied, true);
  assert.match(result.reason, /configured per-tap order cap reduced this to 2/);
});
