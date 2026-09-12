import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { getEightWeekPeakUsage } from "../public/keg-demand-policy.mjs";
import { isUsableWeeklyUsageEntry } from "../public/weekly-usage-evidence.mjs";
import { getWeeklyUsageEntryPouredOz, getWeeklyUsagePerformanceCategory } from "../public/weekly-usage-performance.mjs";
import { buildWeeklyUsageSellerRankings } from "../public/weekly-usage-seller-rankings.mjs";
import { buildLastWeekProjectedSalesMix } from "../public/dashboard-beverage-pulse.mjs";
import { buildRawRecommendation } from "../lib/par-agent.mjs";
import { getActiveComingSoonItems } from "../public/coming-soon-items.mjs";
import { kegDestination } from "../public/keg-destination.mjs";

const now = new Date("2026-09-12T12:00:00Z");
const label = "8/31/26 - 9/6/26";
const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function functions(names, scope = {}) {
  const declarations = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    return source.slice(start, source.indexOf("\n}\n", start) + 2);
  }).join("\n");
  return vm.runInNewContext(`${declarations}\n({${names.join(",")}})`, {
    clean: (value) => String(value ?? "").trim(),
    toNumber: (value) => Number(value) || 0,
    sum: (values) => values.reduce((total, value) => total + value, 0),
    getWeeklyUsagePerformanceCategory,
    ...scope,
  });
}

test("uncertain zeros stay stored but do not become usage or affect averages", () => {
  const uncertain = { label, source: "PMB", hasValue: true, volumeOz: 0, value: 0 };
  const before = JSON.stringify(uncertain);
  assert.equal(isUsableWeeklyUsageEntry(uncertain), false);
  assert.equal(getWeeklyUsageEntryPouredOz({}, uncertain), null);
  assert.equal(isUsableWeeklyUsageEntry({ ...uncertain, zeroUsageVerified: true }), true);
  assert.equal(isUsableWeeklyUsageEntry({ ...uncertain, reportComplete: true, historicalAssignmentVerified: true }), true);
  assert.equal(isUsableWeeklyUsageEntry({ ...uncertain, reportComplete: true }), false);
  assert.equal(isUsableWeeklyUsageEntry({ ...uncertain, historicalAssignmentVerified: true }), false);
  assert.equal(isUsableWeeklyUsageEntry({ ...uncertain, zeroUsageVerified: true, hasValue: false }), false);
  assert.equal(isUsableWeeklyUsageEntry({ ...uncertain, value: 0, volumeOz: 0.01 }), true);
  const rankings = buildWeeklyUsageSellerRankings([{ name: "Beer 1", tapNumber: 21, history: [
    uncertain, { label: "8/24/26 - 8/30/26", volumeOz: 100 },
  ] }]);
  assert.equal(rankings.recent.top[0].averageWeeklyOz, 100);
  assert.equal(rankings.recent.top[0].sampleWeekCount, 1);
  assert.equal(JSON.stringify(uncertain), before);
});

test("eight-week demand uses the peak plus 25%, excludes missing and out-of-window readings", () => {
  const item = { displayUnit: "kegs", history: [
    { label, value: 0.5, volumeOz: 992 },
    { label: "7/13/26", value: 1.2 },
    { label: "7/6/26", value: 20 },
    { label: "9/7/26", value: 30 },
    { label: "8/17/26", value: 40, hasValue: false },
    { label: "8/10/26", value: 0 },
    { label: "8/3/26", value: null },
  ] };
  const result = getEightWeekPeakUsage(item, now, 1984);
  assert.equal(result.sampleWeeks, 2);
  assert.equal(result.peak, 1.2);
  assert.equal(result.targetStock, 1.5);
  assert.equal(getEightWeekPeakUsage({ history: [] }, now, 1984).targetStock, null);
  const ounceUsage = getEightWeekPeakUsage({ displayUnit: "oz", history: [{ label, value: 2400 }] }, now, 2000);
  assert.equal(ounceUsage.targetStock, 1.5);
});

test("beer and cocktail planners use the same target as the dashboard without double-counting forecasts", () => {
  for (const [tapNumber, type] of [[21, "Lager"], [50, "Cocktail"]]) {
    const tap = { tapNumber, type, wall: "Main", key: "tap", plu: 100, name: "Test product 1" };
    const usage = { displayUnit: "kegs", history: [{ label, value: 1.2 }, { label: "8/24/26", value: 0.5 }] };
    const result = buildRawRecommendation(tap, { fillLevelPercent: 30, rawKegSize: 1984 }, [],
      { onHandOverrides: { tap: 1 }, onDeckOverrides: {} }, {}, usage, { now });
    assert.equal(result.targetStockKegs, 1.5);
    assert.equal(result.currentStockKegs, 1.3);
    assert.equal(result.orderQty, 1);
    assert.equal(result.variabilityCushionPct, 25);
    assert.equal(result.usageExpectedWeeks, 8);
    assert.equal(result.preThursdayForecastKegs, 0);
    assert.throws(() => buildRawRecommendation(tap, { fillLevelPercent: 30 }, [], {}, {},
      { displayUnit: "kegs", history: [{ label: "9/1/25", value: 10 }] }, { now }), /No recorded usage/);
  }
});

test("PMB pricing categories recognize Shots and Lager without assigning unknown rows to beer", () => {
  assert.equal(getWeeklyUsagePerformanceCategory({ type: "Shots" }), "liquor");
  assert.equal(getWeeklyUsagePerformanceCategory({ type: "Lager" }), "beer");
  assert.equal(getWeeklyUsagePerformanceCategory({ tapPosition: 95 }), "cocktail");
  assert.equal(getWeeklyUsagePerformanceCategory({ name: "Unclassified" }), "unknown");
});

test("PBR uses same-product pricing rather than its replacement or liquor-contaminated averages", () => {
  const current = (name, plu, tapPosition, chargePerOz, type) => ({ name, plu, tapPosition, chargePerOz, type,
    isCurrentTap: true, tapMatchSource: "pmb-tap-config", assignments: [{ tapNumber: tapPosition }] });
  const scope = {
    liveTapPriceItems: [current("Pabst Blue Ribbon 1", 3883, 24, 0.3, "Lager"),
      current("Garage Beer Lime 2", 999, 78, 0.8, "Lager"), current("Vodka 3", 123, 3, 8, "Shots")],
    getAverageLiquorSellingPricePerOz: (item) => item.chargePerOz,
  };
  const api = functions(["getWeeklyUsageLivePrice", "normalizeWeeklyUsageSellingRate", "getWeeklyUsageLiveSellingRate",
    "getWeeklyUsagePluSellingRate", "getWeeklyUsageCategoryAverageSellingRate", "getWeeklyUsageSellingProductKey",
    "getWeeklyUsageSameProductSellingRate", "getWeeklyUsageSavedSellingRate", "getWeeklyUsageItemSellingRate"], scope);
  const archived = { name: "Pabst Blue Ribbon 2", plu: 145631, tapNumber: 78, history: [] };
  const result = api.getWeeklyUsageItemSellingRate(archived, { entry: {
    sellingPricePerOz: 8, sellingPriceEstimated: true, sellingPriceSource: "category-average",
  } });
  assert.equal(result.sellingPricePerOz, 0.3);
  assert.equal(result.source, "same-product-current-price");
  assert.equal(api.getWeeklyUsageCategoryAverageSellingRate("beer"), 0.55);
  assert.equal(api.getWeeklyUsageSavedSellingRate(archived, { sellingPricePerOz: 0.8, pricePlu: 999 }), null);
});

test("current cocktail margins use Pricing's exact recipe calculation, not historical or category costs", () => {
  const recipe = { id: "cranberry", defaultChargePerOz: 2.09 };
  const live = { name: "Spiked Cranberry Lemonade 1", chargePerOz: 2.09 };
  const overrides = {};
  const api = functions(["calculateRecipePricing", "getPerformanceCurrentMarginRate"], {
    getWeeklyUsageLivePrice: () => live, getRecipeForLiveTapPrice: () => recipe, chargeOverrides: overrides,
    getRecipeTotals: () => ({ oz: 1379, cost: 238, costPerOz: 238 / 1379 }),
    getPourOzForAlcoholTarget: () => 5,
  });
  const rate = api.getPerformanceCurrentMarginRate({}, { entry: { sellingPricePerOz: 9 } });
  const pricing = api.calculateRecipePricing(recipe, 2.09);
  assert.equal(rate.grossProfitPerOz / rate.sellingPricePerOz * 100, pricing.margin);
  overrides.cranberry = "2.25";
  assert.equal(api.getPerformanceCurrentMarginRate({}).sellingPricePerOz, 2.25);
});

test("liquor estimated selling rates honor the two-ounce double even with older PMB quantities", () => {
  const api = functions(["getPortionServingOz", "getAverageLiquorSellingPricePerOz"], {
    getLiveTapPortions: () => [{ name: "Single", quantityOz: 1.5, price: 9 }, { name: "Double", quantityOz: 3, price: 12 }],
  });
  assert.equal(api.getAverageLiquorSellingPricePerOz({}), 6);
});

test("Coming Soon stays out of analytics without hiding a different wall's installed product", () => {
  const main = { id: "main", name: "Triple Jam Cider 1", tapNumber: 46, plu: 1 };
  const queued = { id: "queued", name: "Triple Jam Cider 2", tapNumber: 78, plu: 2 };
  const old = { id: "old", name: "Pabst Blue Ribbon 2", tapNumber: 78, plu: 3 };
  const levels = new Map();
  const api = functions(["getDashboardPulseWall", "getAnalyticsUsageItems"], {
    weeklyUsageItems: [main, queued], weeklyUsageArchivedItems: [old],
    comingSoonItems: [{ id: "beer:triple-jam-2", name: queued.name, kind: "beer", pmbActiveAt: "2026-09-01" }],
    getActiveComingSoonItems, kegLiveLevelsStale: false, kegLiveLevels: levels,
  });
  assert.deepEqual(Array.from(api.getAnalyticsUsageItems(), (item) => item.id), ["main", "old"]);
  levels.set("78", queued);
  assert.deepEqual(Array.from(api.getAnalyticsUsageItems(), (item) => item.id), ["main", "queued", "old"]);
});

test("wall comparison uses estimated profit rather than volume and includes all walls", () => {
  const items = [
    { name: "Main beer", tapNumber: 21, wall: "Main", type: "Beer", history: [{ label, volumeOz: 100 }] },
    { name: "Karaoke beer", tapNumber: 73, wall: "Karaoke", type: "Beer", history: [{ label, volumeOz: 50 }] },
  ];
  const result = buildLastWeekProjectedSalesMix(items, { wall: "karaoke", metric: "profit",
    getGrossProfitPerOz: (item) => item.tapNumber === 21 ? 1 : 4 });
  assert.deepEqual(result.walls.map((row) => row.sharePercent), [33, 67, 0]);
  assert.match(source, /renderDashboardProjectedWallMix\(profitMix\.walls\)/);
});

test("the 26-drink option reaches the ranking engine and destinations respect keg quantity", () => {
  const items = Array.from({ length: 26 }, (_, index) => ({ name: `Beer ${index} Lager`, tapNumber: 21 + index,
    type: "Beer", history: [{ label, volumeOz: index + 1 }] }));
  const result = buildWeeklyUsageSellerRankings(items, { topLimit: 26, bottomLimit: 26 });
  assert.equal(result.recent.top.length, 26);
  assert.equal(result.recent.bottom.length, 26);
  assert.equal(kegDestination({ unit: "kegs", quantity: 1, tapNumbers: [21, 73] }), "Tap assignment needed");
  assert.equal(kegDestination({ unit: "kegs", quantity: 2, tapNumbers: [21, 73] }), "Taps 21, 73");
});
