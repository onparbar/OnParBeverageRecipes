import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyUsageSellerRankings,
  WEEKLY_USAGE_SELLER_RANKING_DATA_BOUNDARY,
} from "../public/weekly-usage-seller-rankings.mjs";

const labels = [
  "8/3/26 - 8/9/26",
  "7/27/26 - 8/2/26",
  "7/20/26 - 7/26/26",
  "7/13/26 - 7/19/26",
  "7/6/26 - 7/12/26",
  "6/29/26 - 7/5/26",
  "6/22/26 - 6/28/26",
];

function pmb(label, volumeOz) {
  return { label, source: "PMB", volumeOz, value: volumeOz, hasValue: true };
}

function item({
  id,
  name = id,
  tapNumber,
  wall = "Main",
  type = "Beer",
  displayUnit = "kegs",
  history = [],
}) {
  return { id, name, tapNumber, wall, type, displayUnit, history };
}

test("builds top five and bottom three for the latest six recorded weeks and all history", () => {
  const items = Array.from({ length: 8 }, (_, index) => item({
    id: `drink-${index + 1}`,
    tapNumber: index + 1,
    history: labels.map((label) => pmb(label, (index + 1) * 10)),
  }));

  const rankings = buildWeeklyUsageSellerRankings(items);

  assert.equal(rankings.recordedWeekCount, 7);
  assert.equal(rankings.dataBoundary.allTimeLabel, "All saved PMB weeks");
  assert.equal(rankings.dataBoundary.legacySalesIncluded, false);
  assert.equal(rankings.dataBoundary.crossWallAggregation, false);
  assert.equal(rankings.dataBoundary.requiresVerifiedWallAndCategory, true);
  assert.equal(WEEKLY_USAGE_SELLER_RANKING_DATA_BOUNDARY.metric, "poured ounces");
  assert.equal(rankings.recent.weekCount, 6);
  assert.deepEqual(rankings.recent.weekLabels, labels.slice(0, 6));
  assert.equal(rankings.allTime.weekCount, 7);
  assert.deepEqual(rankings.recent.top.map((row) => row.name), [
    "drink-8", "drink-7", "drink-6", "drink-5", "drink-4",
  ]);
  assert.deepEqual(rankings.recent.bottom.map((row) => row.name), [
    "drink-1", "drink-2", "drink-3",
  ]);
  assert.equal(rankings.recent.top[0].sampleWeekCount, 6);
  assert.equal(rankings.allTime.top[0].sampleWeekCount, 7);
});

test("averages only recorded PMB weeks, includes recorded zeros, and excludes no-positive products", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "partial", history: [pmb(labels[0], 120), pmb(labels[2], 0)] }),
    item({ id: "zero-only", history: [pmb(labels[0], 0), pmb(labels[1], 0)] }),
    item({ id: "legacy", history: [{ label: labels[0], value: 9_999 }] }),
    item({ id: "invalid", history: [pmb("not a week", 500), pmb(labels[0], -4)] }),
    item({ id: "", name: "", history: [pmb(labels[0], 800)] }),
  ]);

  assert.equal(rankings.recent.weekCount, 3);
  assert.equal(rankings.recent.eligibleCount, 1);
  assert.equal(rankings.recent.top[0].id, "beer:main:partial");
  assert.equal(rankings.recent.top[0].averageWeeklyOz, 60);
  assert.equal(rankings.recent.top[0].sampleWeekCount, 2);
  assert.equal(rankings.recent.top[0].positiveWeekCount, 1);
  assert.equal(rankings.quality.ignoredItemCount, 1);
  assert.ok(rankings.quality.ignoredEntryCount >= 3);
});

test("uses exact poured ounces and converts PMB displayed values only with a known full size", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({
      id: "exact",
      history: [{ label: labels[0], source: "PMB", volumeOz: 625, value: 0.32 }],
    }),
    item({
      id: "converted",
      history: [{ label: labels[0], source: "PMB", value: 0.5 }],
    }),
    item({
      id: "unknown-size",
      history: [{ label: labels[0], source: "PMB", value: 1 }],
    }),
  ], {
    getFullOunces: (source) => source.id === "converted" ? 1_984 : 0,
  });

  assert.equal(rankings.recent.eligibleCount, 2);
  assert.equal(rankings.recent.top[0].id, "beer:main:converted");
  assert.equal(rankings.recent.top[0].averageWeeklyOz, 992);
  assert.equal(rankings.recent.top[1].averageWeeklyOz, 625);
});

test("keeps the same drink separate across walls while deduplicating repeated tap-week history", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "ultra-main", name: "MICHELOB ULTRA 1", tapNumber: 21, wall: "Main", history: [pmb(labels[0], 500)] }),
    item({ id: "ultra-karaoke", name: "MICHELOB ULTRA 2", tapNumber: 73, wall: "Karaoke", history: [pmb(labels[0], 250)] }),
    item({ id: "ultra-main-archive", name: "MICHELOB ULTRA 1", tapNumber: 21, wall: "Main", history: [pmb(labels[0], 500), pmb(labels[1], 400)] }),
  ]);

  const [mainUltra, karaokeUltra] = rankings.allTime.top;
  assert.equal(mainUltra.id, "beer:main:michelob ultra");
  assert.equal(mainUltra.averageWeeklyOz, 450);
  assert.equal(mainUltra.totalOz, 900);
  assert.equal(mainUltra.sampleWeekCount, 2);
  assert.deepEqual(mainUltra.tapNumbers, [21]);
  assert.deepEqual(mainUltra.walls, ["Main"]);
  assert.equal(karaokeUltra.id, "beer:karaoke:michelob ultra");
  assert.equal(karaokeUltra.averageWeeklyOz, 250);
  assert.deepEqual(karaokeUltra.tapNumbers, [73]);
  assert.deepEqual(karaokeUltra.walls, ["Karaoke"]);
});

test("rejects conflicting duplicate tap-week samples instead of choosing a value", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "first", name: "Same Drink 1", tapNumber: 1, history: [pmb(labels[0], 100), pmb(labels[1], 80)] }),
    item({ id: "duplicate", name: "Same Drink 1", tapNumber: 1, history: [pmb(labels[0], 120)] }),
  ]);

  assert.equal(rankings.allTime.top[0].averageWeeklyOz, 80);
  assert.equal(rankings.allTime.top[0].sampleWeekCount, 1);
  assert.equal(rankings.allTime.weekCount, 2);
  assert.equal(rankings.quality.conflictingSampleCount, 1);
});

test("breaks average ties by stronger sample count, then name and stable id", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "zulu", history: [pmb(labels[0], 100)] }),
    item({ id: "bravo", history: [pmb(labels[0], 100), pmb(labels[1], 100)] }),
    item({ id: "Alpha", name: "Alpha", history: [pmb(labels[0], 100), pmb(labels[1], 100)] }),
  ]);

  assert.deepEqual(rankings.recent.top.map((row) => row.name), ["Alpha", "bravo", "zulu"]);
  assert.deepEqual(rankings.recent.bottom.map((row) => row.name), ["Alpha", "bravo", "zulu"]);
});

test("supports category-specific rankings without changing the shared period window", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "beer", history: [pmb(labels[0], 400)] }),
    item({ id: "cocktail", type: "Cocktail", history: [pmb(labels[1], 300)] }),
    item({ id: "liquor", type: "Shots", displayUnit: "oz", history: [pmb(labels[2], 30)] }),
  ], { category: "cocktail" });

  assert.equal(rankings.category, "cocktail");
  assert.equal(rankings.recent.weekCount, 3);
  assert.deepEqual(rankings.recent.top.map((row) => row.id), ["cocktail:main:cocktail"]);
  assert.equal(rankings.recent.top[0].sampleWeekCount, 1);
});

test("exposes chronological volume points while preserving missing weeks as null gaps and recorded zeros", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({
      id: "trend",
      history: [pmb(labels[0], 120), pmb(labels[2], 0)],
    }),
    item({ id: "period-anchor", history: [pmb(labels[1], 10)] }),
  ]);

  const row = rankings.recent.top.find((candidate) => candidate.id === "beer:main:trend");
  assert.equal(row.wall, "main");
  assert.equal(row.weeklyTrend.seriesId, row.id);
  assert.equal(row.weeklyTrend.metric, "volume");
  assert.equal(row.weeklyTrend.unit, "oz");
  assert.equal(row.weeklyTrend.order, "oldest-to-newest");
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.weekLabel), [
    labels[2], labels[1], labels[0],
  ]);
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.value), [0, null, 120]);
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.status), [
    "recorded", "missing", "recorded",
  ]);
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.volumeOz), [0, null, 120]);
  assert.equal(row.weeklyTrend.status, "gapped");
  assert.equal(row.weeklyTrend.recordedWeekCount, 2);
  assert.equal(row.weeklyTrend.missingWeekCount, 1);
  assert.equal(row.weeklyTrend.unavailableWeekCount, 0);
  assert.equal(row.weeklyTrend.canRenderSparkline, true);
});

test("marks unverified profit weeks unavailable without connecting them as zero", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({
      id: "profit-trend",
      history: [pmb(labels[0], 100), pmb(labels[1], 80), pmb(labels[2], 60)],
    }),
  ], {
    metric: "profit",
    getGrossProfitPerOz: (_source, context) => context.weekLabel === labels[1]
      ? { grossProfitPerOz: null, reason: "Price was not verified for this week." }
      : 2,
  });

  const row = rankings.allTime.top[0];
  assert.equal(row.weeklyTrend.metric, "profit");
  assert.equal(row.weeklyTrend.unit, "USD");
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.value), [120, null, 200]);
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.grossProfit), [120, null, 200]);
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.status), [
    "recorded", "unavailable", "recorded",
  ]);
  assert.deepEqual(row.weeklyTrend.points.map((point) => point.pouredOz), [60, null, 100]);
  assert.equal(row.weeklyTrend.unavailableWeekCount, 1);
  assert.equal(row.weeklyTrend.missingWeekCount, 0);
  assert.equal(row.weeklyTrend.gapWeekCount, 1);
  assert.equal(row.weeklyTrend.canRenderSparkline, true);
});

test("keeps matching product trend series isolated by physical wall", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({
      id: "shared-main",
      name: "Shared Lager 1",
      tapNumber: 21,
      history: [pmb(labels[0], 100), pmb(labels[1], 80)],
    }),
    item({
      id: "shared-karaoke",
      name: "Shared Lager 2",
      tapNumber: 73,
      history: [pmb(labels[0], 50), pmb(labels[2], 40)],
    }),
  ]);

  const main = rankings.allTime.top.find((row) => row.wall === "main");
  const karaoke = rankings.allTime.top.find((row) => row.wall === "karaoke");
  assert.deepEqual(main.weeklyTrend.points.map((point) => point.value), [null, 80, 100]);
  assert.deepEqual(karaoke.weeklyTrend.points.map((point) => point.value), [40, null, 50]);
  assert.equal(main.weeklyTrend.wallLabel, "Main");
  assert.equal(karaoke.weeklyTrend.wallLabel, "Karaoke");
  assert.deepEqual(main.weeklyTrend.tapNumbers, [21]);
  assert.deepEqual(karaoke.weeklyTrend.tapNumbers, [73]);
  assert.notEqual(main.weeklyTrend.seriesId, karaoke.weeklyTrend.seriesId);
});

test("filters Main, Karaoke, and Patio independently without combining matching products in All walls", () => {
  const items = [
    item({ id: "shared-main", name: "Shared Lager 1", tapNumber: 21, wall: "Main", history: [pmb(labels[0], 400)] }),
    item({ id: "shared-karaoke", name: "Shared Lager 2", tapNumber: 73, wall: "Karaoke", history: [pmb(labels[0], 250)] }),
    item({ id: "patio-liquor", name: "Patio Vodka 3", tapNumber: 3, wall: "Patio", type: "Shots", displayUnit: "oz", history: [pmb(labels[0], 50)] }),
  ];

  const allWalls = buildWeeklyUsageSellerRankings(items);
  const main = buildWeeklyUsageSellerRankings(items, { wall: "main" });
  const karaoke = buildWeeklyUsageSellerRankings(items, { wall: "karaoke" });
  const patio = buildWeeklyUsageSellerRankings(items, { wall: "patio" });

  assert.deepEqual(allWalls.recent.top.map((row) => row.averageWeeklyOz), [400, 250, 50]);
  assert.deepEqual(allWalls.recent.top.map((row) => row.walls), [["Main"], ["Karaoke"], ["Patio"]]);
  assert.equal(main.wall, "main");
  assert.deepEqual(main.recent.top.map((row) => row.tapNumbers), [[21]]);
  assert.deepEqual(karaoke.recent.top.map((row) => row.tapNumbers), [[73]]);
  assert.deepEqual(patio.recent.top.map((row) => row.tapNumbers), [[3]]);
  assert.equal(main.recent.weekCount, 1);
  assert.equal(karaoke.recent.weekCount, 1);
});

test("infers canonical wall and category from tap identity and excludes unidentifiable legacy rows", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "known-tap", name: "Known Archived Spirit", tapNumber: 84, wall: "", type: "", history: [pmb(labels[0], 30)] }),
    item({ id: "known-suffix", name: "Suffix Spirit 2", tapNumber: undefined, wall: "", type: "Shots", displayUnit: "oz", history: [pmb(labels[0], 20)] }),
    item({ id: "unknown", name: "Ambiguous Legacy Product", tapNumber: undefined, wall: "", type: "", history: [pmb(labels[0], 999)] }),
  ]);

  assert.deepEqual(rankings.recent.top.map((row) => row.id), [
    "liquor:karaoke:known archived spirit",
    "liquor:karaoke:suffix spirit",
  ]);
  assert.equal(rankings.quality.sourceItemCount, 3);
  assert.equal(rankings.quality.identifiedSourceItemCount, 2);
  assert.equal(rankings.quality.unverifiedIdentityItemCount, 1);
});

test("physical tap identity wins over stale wall and category metadata", () => {
  const source = item({
    id: "stale-row",
    name: "Current Karaoke Shot 2",
    tapNumber: 84,
    wall: "Main",
    type: "Cocktail",
    displayUnit: "kegs",
    history: [pmb(labels[0], 30)],
  });
  const rankings = buildWeeklyUsageSellerRankings([source]);

  assert.equal(rankings.recent.top[0].id, "liquor:karaoke:current karaoke shot");
  assert.deepEqual(rankings.recent.top[0].walls, ["Karaoke"]);
  assert.equal(buildWeeklyUsageSellerRankings([source], { wall: "main" }).recent.eligibleCount, 0);
});

test("ranks estimated profit per wall after applying each tap's verified per-ounce rate", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "shared-main", name: "Shared Drink 1", tapNumber: 21, history: [pmb(labels[0], 100)] }),
    item({ id: "shared-patio", name: "Shared Drink 2", tapNumber: 73, history: [pmb(labels[0], 50)] }),
    item({ id: "other", name: "Other", tapNumber: 22, history: [pmb(labels[0], 200)] }),
  ], {
    metric: "profit",
    getGrossProfitPerOz: (source) => ({
      grossProfitPerOz: source.tapNumber === 21 ? 2 : source.tapNumber === 73 ? 4 : 1,
    }),
  });

  assert.equal(rankings.metric, "profit");
  assert.equal(rankings.metricMetadata.averageField, "averageWeeklyGrossProfit");
  assert.equal(rankings.metricMetadata.requiresVerifiedPriceAndCost, true);
  assert.deepEqual(rankings.recent.top.map((row) => row.id), [
    "beer:main:other",
    "beer:karaoke:shared drink",
    "beer:main:shared drink",
  ]);
  assert.deepEqual(rankings.recent.top.map((row) => row.averageWeeklyGrossProfit), [200, 200, 200]);
  const mainShared = rankings.recent.top.find((row) => row.id === "beer:main:shared drink");
  assert.equal(mainShared.totalGrossProfit, 200);
  assert.equal(mainShared.averageWeeklyPouredOz, 100);
});

test("withholds only the wall that lacks verified profit inputs", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({
      id: "shared-main",
      name: "Shared Drink 1",
      tapNumber: 21,
      history: [pmb(labels[0], 100), pmb(labels[1], 80)],
    }),
    item({
      id: "shared-patio",
      name: "Shared Drink 2",
      tapNumber: 73,
      history: [pmb(labels[0], 50)],
    }),
  ], {
    metric: "profit",
    getGrossProfitPerOz: (source) => source.tapNumber === 21
      ? 2
      : { grossProfitPerOz: null, reason: "Cocktail cost is not verified." },
  });

  const sharedMain = rankings.allTime.top[0];
  assert.equal(sharedMain.id, "beer:main:shared drink");
  assert.equal(sharedMain.sampleWeekCount, 2);
  assert.equal(sharedMain.averageWeeklyGrossProfit, 180);
  assert.equal(rankings.recordedWeekCount, 2);
  assert.equal(rankings.metricMetadata.unavailableItemCount, 1);
  assert.equal(rankings.metricMetadata.unavailableSampleCount, 1);
  assert.equal(rankings.allTime.top.some((row) => row.id === "beer:karaoke:shared drink"), false);
  assert.deepEqual(rankings.metricMetadata.unavailableReasons, [
    { reason: "Cocktail cost is not verified.", count: 1 },
  ]);
  assert.match(rankings.metricMetadata.unavailableReason, /verified selling price and cost/i);
});

test("lets the caller resolve a verified profit rate for each recorded week", () => {
  const seenWeeks = [];
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "seasonal", history: [pmb(labels[0], 100), pmb(labels[1], 100)] }),
  ], {
    metric: "profit",
    getGrossProfitPerOz: (_source, context) => {
      seenWeeks.push(context.weekLabel);
      return context.weekLabel === labels[0] ? 2 : 1;
    },
  });

  assert.deepEqual(seenWeeks, [labels[0], labels[1]]);
  assert.equal(rankings.allTime.top[0].averageWeeklyGrossProfit, 150);
  assert.equal(rankings.allTime.top[0].totalGrossProfit, 300);
  assert.match(rankings.metricMetadata.calculation, /resolved per tap and week/i);
  assert.equal(rankings.metricMetadata.historicalRatesInferred, false);
});

test("profit requires exact PMB ounces even when displayed PMB usage can be converted", () => {
  const source = item({
    id: "converted",
    history: [{ label: labels[0], source: "PMB", value: 0.5 }],
  });
  const volume = buildWeeklyUsageSellerRankings([source], {
    metric: "volume",
    getFullOunces: () => 1_984,
  });
  const profit = buildWeeklyUsageSellerRankings([source], {
    metric: "profit",
    getFullOunces: () => 1_984,
    getGrossProfitPerOz: () => 2,
  });

  assert.equal(volume.recent.top[0].averageWeeklyOz, 992);
  assert.equal(profit.recordedWeekCount, 1);
  assert.equal(profit.recent.eligibleCount, 0);
  assert.equal(profit.metricMetadata.unavailableExactVolumeSampleCount, 1);
  assert.match(profit.metricMetadata.unavailableReason, /exact poured ounces/i);
});

test("keeps zero and negative gross-profit drinks eligible when their PMB volume is positive", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "loss", history: [pmb(labels[0], 100)] }),
    item({ id: "break-even", history: [pmb(labels[0], 100)] }),
  ], {
    metric: "profit",
    getGrossProfitPerOz: (source) => source.id === "loss" ? -0.5 : 0,
  });

  assert.equal(rankings.recent.eligibleCount, 2);
  assert.deepEqual(
    rankings.recent.bottom.map((row) => row.averageWeeklyGrossProfit),
    [-50, 0],
  );
});

test("profit availability metadata follows the selected drink category", () => {
  const rankings = buildWeeklyUsageSellerRankings([
    item({ id: "beer", type: "Beer", history: [pmb(labels[0], 100)] }),
    item({ id: "cocktail", type: "Cocktail", history: [pmb(labels[1], 50)] }),
  ], {
    category: "cocktail",
    metric: "profit",
    getGrossProfitPerOz: (source) => source.type === "Cocktail" ? 3 : null,
  });

  assert.equal(rankings.recordedWeekCount, 2);
  assert.equal(rankings.quality.selectedSourceItemCount, 1);
  assert.equal(rankings.metricMetadata.unavailableItemCount, 0);
  assert.deepEqual(rankings.recent.top.map((row) => row.id), ["cocktail:main:cocktail"]);
});
