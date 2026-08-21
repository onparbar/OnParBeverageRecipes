import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyActionPlan,
  canReuseWeeklyUsageHistory,
  createWeeklyPlanSnapshot,
  evaluateWeeklyPlanReadiness,
  findWeeklyUsageIdentityMatch,
  getCocktailPrepDisplayName,
  getCocktailPrepLabelName,
  getCurrentWeeklyPlanSnapshot,
  groupWeeklyPlanOrdersByVendor,
  hasCompleteWeeklyUsageRows,
  hasWeeklyUsagePhysicalIdentityConflict,
  isRecommendationForOperatingWeek,
  isWeeklyUsageNameFallbackEligible,
  isRecommendationSourceRevisionCurrent,
  isWeeklyPlanLockedForOrderingWeek,
  isWeeklyPlanHandoffAllowed,
  normalizeWeeklyPlanProductName,
  refreshWeeklyPlanMetadata,
  shouldRefreshMondayPlanForUsage,
} from "../public/weekly-action-plan.mjs";

test("combines repeated beer orders but keeps cocktail label batches separate by wall", () => {
  const plan = buildWeeklyActionPlan({
    recommendations: [
      { actionType: "order", isKegTap: true, orderQty: 1, orderProductName: "Budweiser 1", tapNumber: 42, wall: "Main", currentStockKegs: 0.2, avgWeeklyKegs: 0.5 },
      { actionType: "order", isKegTap: true, orderQty: 2, orderProductName: "Budweiser 2", tapNumber: 73, wall: "Karaoke", currentStockKegs: 0.4, avgWeeklyKegs: 0.7 },
      { actionType: "make", orderQty: 1, orderProductName: "House Margarita 1", tapNumber: 50, wall: "Main", currentStockKegs: 0.1, avgWeeklyKegs: 0.2 },
      { actionType: "make", orderQty: 1, orderProductName: "House Margarita 2", tapNumber: 94, wall: "Karaoke", currentStockKegs: 0.2, avgWeeklyKegs: 0.1 },
    ],
  });

  assert.deepEqual(plan.orders.beerKegs.map((item) => ({ name: item.name, quantity: item.quantity, taps: item.tapNumbers })), [
    { name: "Budweiser", quantity: 3, taps: [42, 73] },
  ]);
  assert.deepEqual(plan.prep.cocktails.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    taps: item.tapNumbers,
    walls: item.walls,
    batchSizeOz: item.batchSizeOz,
  })), [
    { name: "House Margarita 1", quantity: 1, taps: [50], walls: ["Main"], batchSizeOz: 1456 },
    { name: "House Margarita 2", quantity: 1, taps: [94], walls: ["Karaoke"], batchSizeOz: 1456 },
  ]);
  assert.equal(plan.summary.beerKegTotal, 3);
  assert.equal(plan.summary.cocktailBatchTotal, 2);
});

test("keeps liquor, mixer, and supply orders together with case quantities", () => {
  const plan = buildWeeklyActionPlan({
    inventoryItems: [
      { id: "titos", name: "Tito's", group: "Liquor Cabinet", orderUnits: 4, onHand: 2, par: 6, estimatedCost: 80 },
      { id: "cranberry", name: "Cranberry Juice", group: "Mixer Cabinet", orderUnits: 12, casePackaged: true, packSize: 12, estimatedCost: 32 },
      { id: "cups", name: "Cups", group: "Other", orderUnits: 2, estimatedCost: 10 },
    ],
    recommendations: [
      { actionType: "order", isLiquorTap: true, orderQty: 2, orderProductName: "Hennessy (Cognac) 3", tapNumber: 1, wall: "Patio", currentStockOunces: 80, avgWeeklyOunces: 120, vendor: "OHLQ", unitCost: 35 },
    ],
  });

  assert.equal(plan.orders.liquor[0].name, "Tito's");
  assert.equal(plan.orders.mixers[0].caseCount, 1);
  assert.equal(plan.orders.supplies[0].name, "Cups");
  assert.equal(plan.orders.liquorTapBottles[0].name, "Hennessy");
  assert.equal(plan.orders.liquorTapBottles[0].quantity, 2);
  assert.equal(plan.summary.orderLineCount, 4);
  assert.equal(plan.summary.heldLineCount, 0);
  assert.equal(plan.summary.estimatedInventoryCost, 122);
  assert.equal(plan.summary.estimatedLiquorTapCost, 70);
});

test("combines two low Patron taps into a four-bottle active order", () => {
  const plan = buildWeeklyActionPlan({
    recommendations: [
      { actionType: "order", isLiquorTap: true, orderQty: 2, orderProductName: "Patron Silver (Tequila) 3", tapNumber: 12, wall: "Patio", vendor: "OHLQ", unitCost: 98.7 },
      { actionType: "order", isLiquorTap: true, orderQty: 2, orderProductName: "Patron (Tequila) 2", tapNumber: 90, wall: "Karaoke", vendor: "OHLQ", unitCost: 98.7 },
    ],
  });

  assert.deepEqual(
    plan.orders.liquorTapBottles.map((item) => ({ name: item.name, quantity: item.quantity, taps: item.tapNumbers })),
    [{ name: "Patron Silver", quantity: 4, taps: [12, 90] }],
  );
  assert.equal(plan.summary.orderLineCount, 1);
  assert.equal(plan.summary.liquorTapBottleTotal, 4);
  assert.equal(plan.summary.heldLineCount, 0);
  assert.deepEqual(plan.review.deferredLiquorRefills, []);
  assert.equal(plan.summary.estimatedKnownPurchaseCost, 394.8);
  assert.equal(plan.summary.estimatedPurchaseCostComplete, true);
});

test("removes only PMB wall-number suffixes from weekly plan product names", () => {
  assert.equal(normalizeWeeklyPlanProductName("Garage Beer 2"), "Garage Beer");
  assert.equal(normalizeWeeklyPlanProductName("1800 Reposado"), "1800 Reposado");
});

test("formats Blue Dot as the exact wall label without changing its recipe mapping", () => {
  assert.equal(getCocktailPrepLabelName("BLUE DOT (SVEDKA) 1", "Main"), "Blue Dot 1");
  assert.equal(getCocktailPrepLabelName("Blue Dot (Vodka)", "Karaoke"), "Blue Dot 2");
  assert.equal(
    getCocktailPrepLabelName("Jacked Up Strawberry Lemonade (Jack Daniel's)1", "Main"),
    "Jacked Up Strawberry Lemonade (Jack Daniel's) 1",
  );
  const plan = buildWeeklyActionPlan({
    recommendations: [{
      actionType: "make",
      orderQty: 1,
      orderProductName: "BLUE DOT (SVEDKA) 1",
      tapNumber: 47,
      wall: "Main",
    }],
  });

  assert.equal(plan.prep.cocktails[0].name, "Blue Dot 1");
  assert.equal(plan.prep.cocktails[0].batchSizeOz, 1508);
});

test("cocktail prep is shown in tap order without spirit parentheticals", () => {
  assert.equal(getCocktailPrepDisplayName("VODKA CRAN (TITO'S) 1", "Main"), "VODKA CRAN 1");
  assert.equal(getCocktailPrepDisplayName("On Par Tee (Crown Royal)", "Karaoke"), "On Par Tee 2");

  const plan = buildWeeklyActionPlan({
    recommendations: [
      { actionType: "make", orderQty: 1, orderProductName: "Blue Dot (Svedka) 2", tapNumber: 93, wall: "Karaoke", priority: 9 },
      { actionType: "make", orderQty: 1, orderProductName: "Vodka Cran (Tito's) 1", tapNumber: 46, wall: "Main", priority: 1 },
    ],
  });

  assert.deepEqual(plan.prep.cocktails.map((item) => item.tapNumbers[0]), [46, 93]);
  assert.deepEqual(plan.prep.cocktails.map((item) => getCocktailPrepDisplayName(item.name)), ["Vodka Cran 1", "Blue Dot 2"]);
});

test("keeps capped and incomplete-inventory recommendations visible for review", () => {
  const plan = buildWeeklyActionPlan({
    recommendations: [
      {
        actionType: "order",
        isKegTap: true,
        rawOrderQty: 2,
        orderQty: 1,
        orderCapApplied: true,
        orderProductName: "Modelo 1",
        tapNumber: 8,
        wall: "Patio",
        reason: "The per-tap order cap trimmed this order.",
      },
      {
        actionType: "order",
        isKegTap: true,
        rawOrderQty: 1,
        orderQty: 0,
        inventoryStateMissing: true,
        orderProductName: "Guinness 2",
        tapNumber: 48,
        wall: "Main",
        reason: "Backup counts are missing.",
      },
    ],
  });

  assert.equal(plan.orders.beerKegs[0].quantity, 1);
  assert.deepEqual(
    plan.review.heldRecommendations.map((item) => ({ name: item.name, quantity: item.quantity })),
    [
      { name: "Guinness", quantity: 1 },
      { name: "Modelo", quantity: 1 },
    ],
  );
  assert.equal(plan.summary.heldLineCount, 2);
  assert.equal(plan.summary.heldUnitTotal, 2);
});

test("shows the configured beer-cap remainder as held with its explanation", () => {
  const plan = buildWeeklyActionPlan({
    recommendations: [
      {
        actionType: "order",
        isKegTap: true,
        calculatedOrderQty: 5,
        rawOrderQty: 2,
        orderQty: 2,
        orderCap: 2,
        orderCapApplied: true,
        orderProductName: "Test Lager 1",
        tapNumber: 21,
        wall: "Patio",
        reason: "Calculated need is 5 kegs; the configured per-tap order cap reduced this to 2.",
      },
    ],
  });

  assert.equal(plan.orders.beerKegs[0].quantity, 2);
  assert.equal(plan.review.heldRecommendations[0].quantity, 3);
  assert.match(plan.review.heldRecommendations[0].reasons.join(" "), /order cap reduced this to 2/);
  assert.equal(plan.summary.heldUnitTotal, 3);
});

test("shows inventory ordering holds without adding them to active orders", () => {
  const plan = buildWeeklyActionPlan({
    inventoryItems: [
      {
        id: "paused-gin",
        name: "Paused Gin",
        group: "Liquor Cabinet",
        orderUnits: 3,
        onHand: 3,
        par: 6,
        orderHoldReason: "Source note: do not order for now",
      },
      {
        id: "titos",
        name: "Tito's",
        group: "Liquor Cabinet",
        orderUnits: 2,
        unitCost: 20,
        estimatedCost: 40,
      },
    ],
  });

  assert.deepEqual(plan.orders.liquor.map((item) => item.name), ["Tito's"]);
  assert.deepEqual(plan.review.excludedInventory.map((item) => item.name), ["Paused Gin"]);
  assert.equal(plan.review.excludedInventory[0].quantity, 3);
  assert.equal(plan.summary.excludedLineCount, 1);
});

test("refreshes locked vendor, price, and review metadata without changing order quantities", () => {
  const plan = buildWeeklyActionPlan({
    recommendations: [
      { actionType: "order", isKegTap: true, orderQty: 1, orderProductName: "Garage Beer", vendor: "", unitCost: 0 },
      { actionType: "order", isKegTap: true, orderQty: 1, orderProductName: "Guinness Draught", vendor: "", unitCost: 0 },
    ],
    inventoryItems: [
      { id: "bombay-sapphire", name: "Bombay Sapphire", group: "Liquor Cabinet", par: 6, orderUnits: 3, orderHoldReason: "Old note" },
      { id: "sour-mix", name: "Sour Mix", group: "Mixer Cabinet", par: 16, orderUnits: 0, orderHoldReason: "Old rule" },
    ],
  });
  const refreshed = refreshWeeklyPlanMetadata(plan, {
    resolveBeerOrder: (item) => ({
      vendor: "Bonbright",
      unitCost: item.name === "Guinness Draught" ? 185 : 135,
    }),
    excludeInventoryReview: () => true,
  });

  assert.deepEqual(refreshed.orders.beerKegs.map((item) => item.quantity), [1, 1]);
  assert.deepEqual(refreshed.orders.beerKegs.map((item) => item.vendor), ["Bonbright", "Bonbright"]);
  assert.deepEqual(refreshed.orders.beerKegs.map((item) => item.estimatedCost), [135, 185]);
  assert.equal(refreshed.summary.estimatedBeerCost, 320);
  assert.equal(refreshed.summary.missingPriceCount, 0);
  assert.equal(refreshed.summary.excludedLineCount, 0);
  assert.deepEqual(refreshed.review.excludedInventory, []);
});

test("reports missing active prices and labels the known purchase estimate as incomplete", () => {
  const plan = buildWeeklyActionPlan({
    inventoryItems: [
      { id: "priced", name: "Priced", group: "Other", orderUnits: 2, unitCost: 5, estimatedCost: 10 },
      { id: "unpriced", name: "Unpriced", group: "Other", orderUnits: 1, unitCost: 0, estimatedCost: 0 },
    ],
    recommendations: [
      { actionType: "order", isKegTap: true, orderQty: 1, orderProductName: "Beer", unitCost: 40 },
      { actionType: "review", isLiquorTap: true, orderQty: 0, deferredQty: 1, deferredReview: true, orderProductName: "Liquor tap" },
    ],
  });

  assert.equal(plan.summary.estimatedKnownPurchaseCost, 50);
  assert.equal(plan.summary.missingPriceCount, 1);
  assert.equal(plan.summary.estimatedPurchaseCostComplete, false);
});

test("readiness blocks incomplete inputs, keeps the current-week plan fixed, and exposes review warnings", () => {
  const base = {
    parInitialized: true,
    recommendationGeneratedAt: "2026-08-12T12:00:00.000Z",
    weeklyUsageInitialized: true,
    latestCompletedUsageSaved: true,
    weeklyUsageLastSyncAt: "2026-08-12T11:00:00.000Z",
    inventoryInitialized: true,
    now: "2026-08-12T13:00:00.000Z",
  };

  assert.equal(evaluateWeeklyPlanReadiness(base).status, "ready");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, missingInventoryCount: 2 }).status, "blocked");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, weeklyUsageSavePending: true }).status, "blocked");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, weeklyUsageSaveError: "Revision conflict" }).status, "blocked");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, inventorySavePending: true }).status, "blocked");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, inventorySaveError: "Network unavailable" }).status, "blocked");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, inventorySnapshotCurrent: false }).status, "ready");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, recommendationSourceCurrent: false }).status, "ready");
  assert.equal(evaluateWeeklyPlanReadiness({
    ...base,
    parInputsChangedAt: "2026-08-12T12:30:00.000Z",
  }).status, "ready");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, heldLineCount: 1 }).status, "review");
  assert.equal(evaluateWeeklyPlanReadiness({ ...base, missingPriceCount: 1 }).status, "review");
});

test("the published Monday snapshot does not change with later counts", () => {
  const inventoryItems = [{
    id: "cranberry",
    name: "Cranberry Juice",
    group: "Mixer Cabinet",
    orderUnits: 12,
    par: 24,
    onHand: 12,
    vendor: "Proof",
    unitCost: 3,
    estimatedCost: 36,
  }];
  const recommendations = [{
    key: "main-42-bud-light",
    actionType: "order",
    isKegTap: true,
    orderQty: 2,
    orderProductName: "Bud Light",
    vendor: "Heidelberg",
    unitCost: 120,
    tapNumber: 42,
  }];
  const snapshot = createWeeklyPlanSnapshot({
    generatedAt: "2026-08-10T14:00:00.000Z",
    inventoryItems,
    recommendations,
    publishedAt: "2026-08-10T14:05:00.000Z",
  });
  const state = { generatedAt: snapshot.generatedAt, weeklyPlanSnapshot: snapshot };

  inventoryItems[0].orderUnits = 0;
  recommendations[0].orderQty = 0;

  assert.equal(getCurrentWeeklyPlanSnapshot(state, "2026-08-14T12:00:00.000Z")?.plan.summary.orderLineCount, 2);
  assert.equal(getCurrentWeeklyPlanSnapshot(state, "2026-08-17T12:00:00.000Z"), null);
  assert.equal(isWeeklyPlanLockedForOrderingWeek(snapshot.generatedAt, "2026-08-14T12:00:00.000Z"), true);
  assert.equal(isWeeklyPlanLockedForOrderingWeek(snapshot.generatedAt, "2026-08-10T17:00:00.000Z"), true);
});

test("a locked Monday snapshot upgrades combined cocktail prep into wall label rows", () => {
  const generatedAt = "2026-08-10T14:00:00.000Z";
  const recommendations = {
    generatedAt,
    items: [
      { actionType: "make", orderQty: 1, orderProductName: "BLUE DOT (SVEDKA) 1", tapNumber: 47, wall: "Main" },
      { actionType: "make", orderQty: 1, orderProductName: "BLUE DOT (SVEDKA) 2", tapNumber: 93, wall: "Karaoke" },
    ],
    weeklyPlanSnapshot: {
      version: 2,
      generatedAt,
      publishedAt: "2026-08-10T14:05:00.000Z",
      plan: {
        orders: { beerKegs: [], liquorTapBottles: [], liquor: [], mixers: [], supplies: [] },
        prep: { cocktails: [{ name: "BLUE DOT (SVEDKA)", quantity: 2, tapNumbers: [47, 93], walls: ["Main", "Karaoke"] }] },
        review: { heldRecommendations: [], excludedInventory: [], deferredLiquorRefills: [] },
        summary: { cocktailBatchTotal: 2, cocktailLineCount: 1 },
      },
    },
  };

  const snapshot = getCurrentWeeklyPlanSnapshot(recommendations, "2026-08-14T12:00:00.000Z");

  assert.equal(snapshot.version, 3);
  assert.deepEqual(snapshot.plan.prep.cocktails.map((item) => ({
    name: item.name,
    quantity: item.quantity,
    walls: item.walls,
    batchSizeOz: item.batchSizeOz,
  })), [
    { name: "Blue Dot 1", quantity: 1, walls: ["Main"], batchSizeOz: 1508 },
    { name: "Blue Dot 2", quantity: 1, walls: ["Karaoke"], batchSizeOz: 1508 },
  ]);
  assert.equal(snapshot.plan.summary.cocktailBatchTotal, 2);
  assert.equal(snapshot.plan.summary.cocktailLineCount, 2);
});

test("a locked legacy plan upgrades deferred liquor taps into two-bottle active orders", () => {
  const generatedAt = "2026-08-10T14:00:00.000Z";
  const recommendations = {
    generatedAt,
    weeklyPlanSnapshot: {
      version: 1,
      generatedAt,
      publishedAt: "2026-08-10T14:05:00.000Z",
      plan: {
        orders: { beerKegs: [], liquor: [], mixers: [], supplies: [] },
        prep: { cocktails: [] },
        review: {
          heldRecommendations: [],
          excludedInventory: [],
          deferredLiquorRefills: [{
            name: "Patron Silver (Tequila)",
            quantity: 2,
            tapNumbers: [12, 90],
            walls: ["Patio", "Karaoke"],
          }],
        },
        summary: {
          orderLineCount: 0,
          heldLineCount: 1,
          heldUnitTotal: 2,
          missingPriceCount: 0,
          estimatedPurchaseCostComplete: true,
        },
      },
    },
  };

  const snapshot = getCurrentWeeklyPlanSnapshot(recommendations, "2026-08-14T12:00:00.000Z");

  assert.equal(snapshot.version, 3);
  assert.deepEqual(
    snapshot.plan.orders.liquorTapBottles.map((item) => ({ name: item.name, quantity: item.quantity })),
    [{ name: "Patron Silver", quantity: 4 }],
  );
  assert.deepEqual(snapshot.plan.review.deferredLiquorRefills, []);
  assert.equal(snapshot.plan.summary.orderLineCount, 1);
  assert.equal(snapshot.plan.summary.heldLineCount, 0);
});

test("zero-par inventory is omitted from orders and review warnings", () => {
  const plan = buildWeeklyActionPlan({
    inventoryItems: [{
      id: "new-item",
      name: "New Item",
      group: "Other",
      par: 0,
      orderUnits: 4,
      orderHoldReason: "New item needs a count.",
    }],
  });

  assert.equal(plan.summary.orderLineCount, 0);
  assert.equal(plan.summary.excludedLineCount, 0);
  assert.deepEqual(plan.review.excludedInventory, []);
});

test("vendor orders keep Bonbright and Heidelberg in separate groups", () => {
  const plan = buildWeeklyActionPlan({
    recommendations: [
      { actionType: "order", isKegTap: true, orderQty: 1, orderProductName: "Miller Lite", vendor: "Bonbright", unitCost: 100 },
      { actionType: "order", isKegTap: true, orderQty: 2, orderProductName: "Bud Light", vendor: "Heidelberg", unitCost: 120 },
    ],
  });
  const groups = groupWeeklyPlanOrdersByVendor(plan);

  assert.deepEqual(groups.map((group) => group.vendor), ["Bonbright", "Heidelberg"]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.name)), [["Miller Lite"], ["Bud Light"]]);
  assert.deepEqual(groups.map((group) => group.estimatedCost), [100, 240]);
});

test("a Monday plan remains current through Sunday despite later read-only usage checks", () => {
  const mondayPlan = {
    parInitialized: true,
    recommendationGeneratedAt: "2026-08-10T14:00:00.000Z",
    recommendationSourceCurrent: true,
    weeklyUsageInitialized: true,
    latestCompletedUsageSaved: true,
    weeklyUsageLastSyncAt: "2026-08-13T16:00:00.000Z",
    inventoryInitialized: true,
  };

  assert.equal(isRecommendationForOperatingWeek(
    mondayPlan.recommendationGeneratedAt,
    "2026-08-16T18:00:00.000Z",
  ), true);
  assert.equal(shouldRefreshMondayPlanForUsage(
    mondayPlan.recommendationGeneratedAt,
    mondayPlan.weeklyUsageLastSyncAt,
    "2026-08-13T18:00:00.000Z",
  ), false);
  assert.equal(evaluateWeeklyPlanReadiness({
    ...mondayPlan,
    now: "2026-08-13T18:00:00.000Z",
  }).status, "ready");
});

test("a published Monday plan ignores later live-source changes until the next operating week", () => {
  const locked = {
    parInitialized: false,
    recommendationGeneratedAt: "2026-08-10T14:00:00.000Z",
    recommendationError: "A later PMB refresh failed.",
    recommendationInventoryMissing: true,
    weeklyUsageInitialized: false,
    latestCompletedUsageSaved: false,
    weeklyUsageLastSyncAt: "2026-08-10T16:00:00.000Z",
    inventoryInitialized: false,
    inventorySaveError: "A later inventory save failed.",
    missingInventoryCount: 4,
    lockedForWeek: true,
  };

  assert.equal(evaluateWeeklyPlanReadiness({
    ...locked,
    now: "2026-08-16T18:00:00.000Z",
    staleAfterDays: 1,
  }).status, "ready");
  assert.equal(evaluateWeeklyPlanReadiness({
    ...locked,
    now: "2026-08-17T18:00:00.000Z",
    staleAfterDays: 1,
  }).status, "blocked");
});

test("new Monday inputs start a new Weekly Plan cycle", () => {
  const base = {
    parInitialized: true,
    recommendationGeneratedAt: "2026-08-10T14:00:00.000Z",
    recommendationSourceCurrent: true,
    weeklyUsageInitialized: true,
    latestCompletedUsageSaved: true,
    inventoryInitialized: true,
  };

  assert.equal(evaluateWeeklyPlanReadiness({
    ...base,
    weeklyUsageLastSyncAt: "2026-08-10T16:00:00.000Z",
    now: "2026-08-10T17:00:00.000Z",
  }).status, "stale");
  assert.equal(evaluateWeeklyPlanReadiness({
    ...base,
    weeklyUsageLastSyncAt: "2026-08-17T13:00:00.000Z",
    now: "2026-08-17T14:00:00.000Z",
  }).status, "stale");
});

test("weekly usage identity prefers a physical tap and uses PLU only when unique", () => {
  const reports = [
    { tapNumber: 21, plu: 500, volumeOz: 100 },
    { tapNumber: 73, plu: 500, volumeOz: 250 },
  ];

  assert.equal(findWeeklyUsageIdentityMatch({ tapNumber: 73, plu: 500 }, reports), reports[1]);
  assert.equal(findWeeklyUsageIdentityMatch({ tapNumber: 73, plu: 500 }, [reports[0]]), null);
  assert.equal(hasWeeklyUsagePhysicalIdentityConflict({ tapNumber: 73, plu: 500 }, [reports[0]]), true);
  assert.equal(findWeeklyUsageIdentityMatch({ plu: 500 }, reports), null);
  assert.equal(findWeeklyUsageIdentityMatch({ plu: 600 }, [{ plu: 600, volumeOz: 10 }])?.volumeOz, 10);
  assert.equal(isWeeklyUsageNameFallbackEligible({ tapNumber: 21, name: "Same name" }), false);
  assert.equal(isWeeklyUsageNameFallbackEligible({ name: "Aggregate only" }), true);
});

test("latest completed Weekly Usage coverage requires every active row", () => {
  const activeRows = [
    { tapNumber: 1, saved: true },
    { tapNumber: 2, saved: true },
    { tapNumber: 3, saved: false },
  ];

  assert.equal(hasCompleteWeeklyUsageRows(activeRows, (item) => item.saved), false);
  assert.equal(hasCompleteWeeklyUsageRows(activeRows.map((item) => ({ ...item, saved: true })), (item) => item.saved), true);
  assert.equal(hasCompleteWeeklyUsageRows([], () => true), false);
});

test("recommendations are current only for the immediately published source revision", () => {
  assert.equal(isRecommendationSourceRevisionCurrent(11, 10), true);
  assert.equal(isRecommendationSourceRevisionCurrent(12, 10), false);
  assert.equal(isRecommendationSourceRevisionCurrent(10, 10), false);
  assert.equal(isRecommendationSourceRevisionCurrent(1, undefined), false);
  assert.equal(isRecommendationSourceRevisionCurrent(1, null), false);
  assert.equal(isRecommendationSourceRevisionCurrent(12, 10, 12), true);
  assert.equal(isRecommendationSourceRevisionCurrent(13, 10, 12), false);
});

test("Weekly Plan handoff is locked for blocked and stale plans", () => {
  assert.equal(isWeeklyPlanHandoffAllowed("blocked"), false);
  assert.equal(isWeeklyPlanHandoffAllowed("stale"), false);
  assert.equal(isWeeklyPlanHandoffAllowed("review"), true);
  assert.equal(isWeeklyPlanHandoffAllowed("ready"), true);
});

test("weekly usage history never recombines identical names or duplicate PLUs across physical taps", () => {
  const tap21 = { tapNumber: 21, plu: 500, name: "Same Product" };
  const tap73 = { tapNumber: 73, plu: 500, name: "Same Product" };

  assert.equal(canReuseWeeklyUsageHistory(tap21, tap21, 2), true);
  assert.equal(canReuseWeeklyUsageHistory(tap21, tap73, 2), false);
  assert.equal(canReuseWeeklyUsageHistory({ plu: 500, name: "Aggregate" }, tap73, 2), false);
  assert.equal(canReuseWeeklyUsageHistory({ plu: 500, name: "Aggregate" }, tap73, 1), true);
});
