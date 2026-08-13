import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyUsagePerformance,
  getWeeklyUsageEntryPouredOz,
  getWeeklyUsagePerformanceCategory,
} from "../public/weekly-usage-performance.mjs";

function item({
  id,
  name = id,
  tapNumber,
  displayUnit = "kegs",
  type = "Beer",
  history = [],
}) {
  return { id, name, tapNumber, displayUnit, type, history };
}

function pmb(label, volumeOz, value = volumeOz) {
  return { label, source: "PMB", volumeOz, value, hasValue: true };
}

const latest = "8/3/26 - 8/9/26";
const previous = "7/27/26 - 8/2/26";

test("uses exact PMB poured ounces instead of displayed keg equivalents", () => {
  const beer = item({ id: "beer", history: [pmb(latest, 625, 0.32)] });
  assert.equal(getWeeklyUsageEntryPouredOz(beer, beer.history[0], () => 1984), 625);

  const legacyShapedPmbEntry = { label: latest, source: "PMB", value: 0.5 };
  assert.equal(getWeeklyUsageEntryPouredOz(beer, legacyShapedPmbEntry, () => 1984), 992);
});

test("ignores legacy non-PMB history so sales-derived rows cannot enter PMB rankings", () => {
  const performance = buildWeeklyUsagePerformance([
    item({
      id: "pmb",
      history: [pmb(latest, 300), { label: previous, value: 99 }],
    }),
    item({
      id: "legacy",
      history: [
        { label: latest, source: "GoTab", volumeOz: 9_999, value: 4 },
        { label: previous, value: 5 },
      ],
    }),
  ]);

  assert.equal(performance.latestLabel, latest);
  assert.equal(performance.capturedCount, 1);
  assert.equal(performance.eligibleCount, 2);
  assert.equal(performance.top[0].id, "pmb");
  assert.equal(performance.bottomSuppressed, true);
  assert.deepEqual(performance.bottom, []);
});

test("ranks complete PMB weeks by poured ounces and includes explicit zero pours", () => {
  const performance = buildWeeklyUsagePerformance([
    item({ id: "middle", tapNumber: 2, history: [pmb(latest, 150), pmb(previous, 100)] }),
    item({ id: "top", tapNumber: 1, history: [pmb(latest, 500), pmb(previous, 450)] }),
    item({ id: "zero", tapNumber: 3, history: [pmb(latest, 0), pmb(previous, 25)] }),
  ]);

  assert.equal(performance.currentComplete, true);
  assert.equal(performance.trendComplete, true);
  assert.deepEqual(performance.top.map((row) => row.id), ["top", "middle", "zero"]);
  assert.deepEqual(performance.bottom.map((row) => row.id), ["zero", "middle", "top"]);
  assert.equal(performance.totalCurrentOz, 650);
  assert.equal(performance.totalTrendOz, 75);
});

test("uses only comparable taps for movement and explains prior-week exclusions", () => {
  const performance = buildWeeklyUsagePerformance([
    item({ id: "one", name: "Established", tapNumber: 21, history: [pmb(latest, 200), pmb(previous, 100)] }),
    item({ id: "two", name: "New Tap", tapNumber: 22, history: [pmb(latest, 300)] }),
  ]);

  assert.equal(performance.currentComplete, true);
  assert.equal(performance.previousComplete, false);
  assert.equal(performance.comparableCount, 1);
  assert.equal(performance.totalTrendOz, 100);
  assert.equal(performance.totalTrendPercent, 100);
  assert.deepEqual(performance.excludedComparisonTaps, [{
    tapNumber: 22,
    name: "New Tap",
    wall: "",
    missingCurrent: false,
    missingPrevious: true,
    likelyNewTap: true,
    reason: "No prior week or older PMB usage is saved; this may be a new or newly assigned tap.",
  }]);
});

test("excludes taps missing the current week and reports the distinct reason", () => {
  const performance = buildWeeklyUsagePerformance([
    item({ id: "complete", name: "Complete", tapNumber: 21, history: [pmb(latest, 120), pmb(previous, 100)] }),
    item({ id: "missing-current", name: "Missing Current", tapNumber: 22, history: [pmb(previous, 80)] }),
  ]);

  assert.equal(performance.totalTrendOz, 20);
  assert.equal(performance.comparableCount, 1);
  assert.equal(performance.excludedComparisonTaps[0].missingCurrent, true);
  assert.equal(performance.excludedComparisonTaps[0].likelyNewTap, false);
  assert.match(performance.excludedComparisonTaps[0].reason, /current week/i);
});

test("distinguishes a prior-week reporting gap from a likely new tap", () => {
  const older = "7/20/26 - 7/26/26";
  const performance = buildWeeklyUsagePerformance([
    item({
      id: "gap",
      name: "Established Gap",
      tapNumber: 21,
      history: [pmb(latest, 120), pmb(older, 90)],
    }),
    item({
      id: "anchor",
      name: "Anchor",
      tapNumber: 22,
      history: [pmb(latest, 100), pmb(previous, 80)],
    }),
  ]);

  const gap = performance.excludedComparisonTaps.find((row) => row.tapNumber === 21);
  assert.equal(gap.likelyNewTap, false);
  assert.match(gap.reason, /older PMB history exists/i);
});

test("does not compare across a globally missing prior consecutive week", () => {
  const older = "7/20/26 - 7/26/26";
  const performance = buildWeeklyUsagePerformance([
    item({
      id: "gap",
      tapNumber: 21,
      history: [pmb(latest, 120), pmb(older, 90)],
    }),
  ]);

  assert.equal(performance.previousLabel, "");
  assert.equal(performance.comparableCount, 0);
  assert.equal(performance.totalTrendOz, null);
  assert.equal(performance.totalTrendPercent, null);
});

test("supports category-specific rankings without changing the shared PMB week", () => {
  const items = [
    item({ id: "beer", type: "Lager", history: [pmb(latest, 400), pmb(previous, 300)] }),
    item({ id: "cocktail", type: "Cocktail", history: [pmb(latest, 250), pmb(previous, 200)] }),
    item({ id: "liquor", type: "Shots", displayUnit: "oz", history: [pmb(latest, 40), pmb(previous, 50)] }),
  ];
  const cocktailPerformance = buildWeeklyUsagePerformance(items, { category: "cocktail" });

  assert.equal(getWeeklyUsagePerformanceCategory(items[0]), "beer");
  assert.equal(getWeeklyUsagePerformanceCategory(items[1]), "cocktail");
  assert.equal(getWeeklyUsagePerformanceCategory(items[2]), "liquor");
  assert.equal(cocktailPerformance.latestLabel, latest);
  assert.deepEqual(cocktailPerformance.top.map((row) => row.id), ["cocktail"]);
});

test("combines the same drink poured from multiple walls into one ranking", () => {
  const performance = buildWeeklyUsagePerformance([
    item({ id: "ultra-main", name: "MICHELOB ULTRA 1", tapNumber: 21, history: [pmb(latest, 500), pmb(previous, 400)] }),
    item({ id: "ultra-karaoke", name: "MICHELOB ULTRA 2", tapNumber: 73, history: [pmb(latest, 250), pmb(previous, 200)] }),
    item({ id: "other", name: "OTHER BEER 1", tapNumber: 22, history: [pmb(latest, 600), pmb(previous, 590)] }),
  ]);

  assert.equal(performance.productCount, 2);
  assert.equal(performance.top[0].name, "MICHELOB ULTRA");
  assert.equal(performance.top[0].currentOz, 750);
  assert.deepEqual(performance.top[0].tapNumbers, [21, 73]);
  assert.equal(performance.top[0].trendOz, 150);
});

test("returns an unavailable state when no PMB-sourced history exists", () => {
  const performance = buildWeeklyUsagePerformance([
    item({ id: "legacy", history: [{ label: latest, value: 0.5 }] }),
  ]);

  assert.equal(performance.latestLabel, "");
  assert.equal(performance.capturedCount, 0);
  assert.equal(performance.currentComplete, false);
  assert.deepEqual(performance.top, []);
  assert.deepEqual(performance.bottom, []);
});
