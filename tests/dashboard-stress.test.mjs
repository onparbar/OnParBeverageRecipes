import assert from "node:assert/strict";
import { performance as clock } from "node:perf_hooks";
import test from "node:test";

import { createDashboardRenderCoordinator } from "../public/dashboard-render-coordinator.mjs";
import { searchDashboardData, searchDashboardItems } from "../public/global-dashboard-search.mjs";
import { calculateWeeklyIngredientPrepNeed } from "../public/weekly-plan-prep-needs.mjs";
import { buildWeeklyUsagePerformance } from "../public/weekly-usage-performance.mjs";
import { buildWeeklyUsageSellerRankings } from "../public/weekly-usage-seller-rankings.mjs";

function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function buildWeekLabels(count) {
  const firstMonday = new Date(2021, 0, 4);
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(firstMonday.getTime() + index * 7 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
    return `${formatShortDate(start)} - ${formatShortDate(end)}`;
  });
}

test("coalesces a quarter-million refresh invalidations into one render per view", { timeout: 15_000 }, async () => {
  const coordinator = createDashboardRenderCoordinator();
  const viewNames = ["overview", "pricing", "inventory", "keg-levels", "weekly-usage", "weekly-plan"];
  const counts = Object.fromEntries(viewNames.map((name) => [name, 0]));
  const renders = Object.fromEntries(viewNames.map((name) => [name, () => { counts[name] += 1; }]));
  const startedAt = clock.now();

  await coordinator.batch(async () => {
    for (let index = 0; index < 250_000; index += 1) {
      const name = viewNames[index % viewNames.length];
      coordinator.defer(name, renders[name]);
    }
  });

  assert.deepEqual(counts, Object.fromEntries(viewNames.map((name) => [name, 1])));
  assert.equal(coordinator.getStats().pending, 0);
  assert.ok(clock.now() - startedAt < 10_000, "render coordination exceeded the 10-second stress budget");
});

test("search and usage analytics handle oversized dashboard datasets deterministically", { timeout: 15_000 }, () => {
  const searchableItems = Array.from({ length: 25_000 }, (_, index) => {
    const category = ["beer", "cocktail", "liquor"][index % 3];
    const wall = ["Main", "Patio", "Karaoke"][Math.floor(index / 3) % 3];
    return {
      id: `search-${index}`,
      name: `Load Product ${index}`,
      title: `Load Product ${index}`,
      section: `${wall} ${category}`,
      subtitle: `Tap ${index + 1}`,
      searchText: [category, wall],
      tapNumber: index + 1,
      category,
      wall,
      periods: {
        "last-week": {
          label: "Last week",
          ounces: index,
          dollars: index * 0.5,
          profit: index * 0.2,
        },
        recent: {
          label: "Recent",
          ounces: index * 6,
          dollars: index * 3,
          profit: index * 1.2,
        },
      },
    };
  });
  const expectedTop = searchableItems
    .filter((item) => item.category === "beer" && item.wall === "Main")
    .at(-1);
  const labels = buildWeekLabels(260);
  const usageItems = Array.from({ length: 102 }, (_, index) => {
    const tapNumber = index + 1;
    const category = index < 20 ? "liquor" : index % 4 === 0 ? "cocktail" : "beer";
    const wall = index < 20 ? "Patio" : index < 57 ? "Main" : "Karaoke";
    return {
      id: `tap-${tapNumber}`,
      name: `Load Product ${tapNumber} ${wall === "Main" ? 1 : wall === "Karaoke" ? 2 : 3}`,
      tapNumber,
      wall,
      type: category === "cocktail" ? "Cocktail" : category === "liquor" ? "Shots" : "Beer",
      displayUnit: category === "liquor" ? "oz" : "kegs",
      history: labels.map((label, weekIndex) => ({
        label,
        source: "PMB",
        volumeOz: tapNumber * 10 + weekIndex,
      })),
    };
  });
  const startedAt = clock.now();

  for (let pass = 0; pass < 20; pass += 1) {
    const navigationResults = searchDashboardItems(searchableItems, "load product 24999", { limit: 5 });
    assert.equal(navigationResults[0].id, "search-24999");
  }
  const dataResult = searchDashboardData(
    searchableItems,
    "which beer on main wall had highest pour last week",
  );
  const usagePerformance = buildWeeklyUsagePerformance(usageItems, { limit: 25 });
  const rankings = buildWeeklyUsageSellerRankings(usageItems);

  assert.equal(dataResult.status, "ready");
  assert.equal(dataResult.results[0].id, expectedTop.id);
  assert.equal(usagePerformance.eligibleCount, 102);
  assert.equal(usagePerformance.capturedCount, 102);
  assert.equal(usagePerformance.currentComplete, true);
  assert.equal(rankings.allTime.weekCount, 260);
  assert.ok(rankings.allTime.top.length > 0);
  assert.ok(clock.now() - startedAt < 10_000, "dashboard analytics exceeded the 10-second stress budget");
});

test("weekly prep math handles thousands of planned cocktail batches", { timeout: 15_000 }, () => {
  const recipe = {
    yieldOz: 128,
    ingredients: [{ name: "Simple Syrup", oz: 12 }, { name: "Vodka", oz: 32 }],
  };
  const plannedItems = Array.from({ length: 10_000 }, (_, index) => ({
    name: `Cocktail ${index}`,
    batchSizeOz: 128,
    quantity: 2,
  }));
  const startedAt = clock.now();
  const result = calculateWeeklyIngredientPrepNeed({
    plannedItems,
    ingredientName: "simple syrup",
    resolveRecipe: () => recipe,
    getRecipeYieldOz: (source) => source.yieldOz,
  });

  assert.equal(result.totalOz, 240_000);
  assert.equal(result.gallons, 1_875);
  assert.equal(result.complete, true);
  assert.ok(clock.now() - startedAt < 10_000, "weekly prep calculation exceeded the 10-second stress budget");
});
