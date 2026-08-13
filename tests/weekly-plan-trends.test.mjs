import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklyPlanTrends,
  getWeeklyPlanTrendCategory,
} from "../public/weekly-plan-trends.mjs";

const latest = "8/3/26 - 8/9/26";
const previous = "7/27/26 - 8/2/26";
const older = "7/20/26 - 7/26/26";
const staleWeek = "7/13/26 - 7/19/26";
const now = new Date(2026, 7, 12, 12, 0, 0);

function pmb(label, volumeOz) {
  return { label, source: "PMB", volumeOz, value: volumeOz };
}

function item({
  id,
  name = id,
  tapNumber,
  plu,
  wall = "Main",
  type = "Beer",
  displayUnit = "kegs",
  history = [],
}) {
  return { id, name, tapNumber, plu, wall, type, displayUnit, history };
}

function build(items, options = {}) {
  return buildWeeklyPlanTrends(items, { now, ...options });
}

test("uses only exact PMB poured ounces and treats an explicit zero as captured coverage", () => {
  const result = build([
    item({
      id: "exact",
      tapNumber: 21,
      plu: 101,
      history: [
        pmb(latest, 125),
        pmb(previous, 100),
        { label: latest, source: "GoTab", volumeOz: 9_999 },
      ],
    }),
    item({
      id: "zero",
      tapNumber: 22,
      plu: 102,
      history: [pmb(latest, 0), pmb(previous, 50)],
    }),
  ]);

  assert.equal(result.status, "ready");
  assert.equal(result.coverage.latestCapturedTapCount, 2);
  assert.equal(result.coverage.latestComplete, true);
  assert.equal(result.sections.movers.risers[0].currentOz, 125);
  assert.equal(result.sections.emergingLow.items[0].status, "zero");
  assert.equal(result.sections.emergingLow.items[0].currentOz, 0);

  const valueOnly = build([
    item({
      id: "value-only",
      tapNumber: 23,
      history: [{ label: latest, source: "PMB", value: 4 }],
    }),
  ]);
  assert.equal(valueOnly.status, "incomplete");
  assert.equal(valueOnly.coverage.latestCapturedTapCount, 0);

  const otherSourceOnly = build([
    item({
      id: "other-source",
      tapNumber: 24,
      history: [{ label: latest, source: "GoTab", volumeOz: 500 }],
    }),
  ]);
  assert.equal(otherSourceOnly.status, "unavailable");
  assert.equal(otherSourceOnly.period.latestLabel, "");
});

test("aggregates an explicit product identity across walls without merging a distinct PLU", () => {
  const result = build([
    item({
      id: "ultra-main",
      name: "MICHELOB ULTRA 1",
      tapNumber: 21,
      plu: 500,
      wall: "Main",
      history: [pmb(latest, 300), pmb(previous, 200)],
    }),
    item({
      id: "ultra-karaoke",
      name: "MICHELOB ULTRA 2",
      tapNumber: 73,
      plu: 500,
      wall: "Karaoke",
      history: [pmb(latest, 200), pmb(previous, 150)],
    }),
    item({
      id: "same-name-different-product",
      name: "MICHELOB ULTRA 1",
      tapNumber: 22,
      plu: 501,
      wall: "Patio",
      history: [pmb(latest, 250), pmb(previous, 300)],
    }),
  ]);

  assert.equal(result.coverage.productCount, 2);
  assert.deepEqual(
    result.sections.movers.risers.map((row) => ({
      plu: row.plu,
      name: row.name,
      currentOz: row.currentOz,
      previousOz: row.previousOz,
      taps: row.tapNumbers,
    })),
    [{ plu: 500, name: "MICHELOB ULTRA", currentOz: 500, previousOz: 350, taps: [21, 73] }],
  );
  assert.deepEqual(result.sections.movers.fallers.map((row) => row.plu), [501]);

  const identityMissing = build([
    item({ id: "same-a", name: "Same Name 1", tapNumber: 31, history: [pmb(latest, 100), pmb(previous, 90)] }),
    item({ id: "same-b", name: "Same Name 2", tapNumber: 74, history: [pmb(latest, 80), pmb(previous, 70)] }),
  ]);
  assert.equal(identityMissing.coverage.productCount, 2);
});

test("ranks movers by poured-ounce change while suppressing unstable percentages from small bases", () => {
  const result = build([
    item({ id: "tiny-base", tapNumber: 1, plu: 1, history: [pmb(latest, 108), pmb(previous, 8)] }),
    item({ id: "steady-base", tapNumber: 2, plu: 2, history: [pmb(latest, 180), pmb(previous, 100)] }),
    item({ id: "from-zero", tapNumber: 3, plu: 3, history: [pmb(latest, 50), pmb(previous, 0)] }),
    item({ id: "faller", tapNumber: 4, plu: 4, history: [pmb(latest, 100), pmb(previous, 300)] }),
  ]);

  assert.deepEqual(result.sections.movers.risers.map((row) => row.name), [
    "tiny-base",
    "steady-base",
    "from-zero",
  ]);
  assert.deepEqual(
    result.sections.movers.risers.map((row) => [row.changeOz, row.changePercent, row.percentGuard]),
    [
      [100, null, "small-base"],
      [80, 80, "none"],
      [50, null, "from-zero"],
    ],
  );
  assert.deepEqual(
    result.sections.movers.fallers.map((row) => [row.changeOz, row.changePercent]),
    [[-200, -66.7]],
  );
  assert.equal(result.sections.movers.percentBaseOz, 32);
});

test("identifies sustained high poured volume across three complete consecutive weeks", () => {
  const result = build([
    item({
      id: "steady",
      tapNumber: 21,
      plu: 10,
      history: [pmb(latest, 300), pmb(previous, 280), pmb(older, 320)],
    }),
    item({
      id: "one-week-spike",
      tapNumber: 22,
      plu: 11,
      history: [pmb(latest, 1_000), pmb(previous, 10), pmb(older, 10)],
    }),
  ]);

  assert.equal(result.sections.sustained.available, true);
  assert.deepEqual(result.sections.sustained.weekLabels, [latest, previous, older]);
  assert.equal(result.sections.sustained.includedTapCount, 2);
  assert.equal(result.sections.sustained.excludedTapCount, 0);
  assert.equal(result.sections.sustained.partial, false);
  assert.match(result.sections.sustained.statusCopy, /uses all 2 active taps/i);
  assert.deepEqual(
    result.sections.sustained.items.map((row) => ({
      name: row.name,
      averageOz: row.averageOz,
      lowestWeekOz: row.lowestWeekOz,
      highestWeekOz: row.highestWeekOz,
    })),
    [{ name: "steady", averageOz: 300, lowestWeekOz: 280, highestWeekOz: 320 }],
  );
});

test("calculates sustained volume from complete three-week tap histories and reports exclusions", () => {
  const result = build([
    item({
      id: "shared-main",
      name: "Shared Lager 1",
      tapNumber: 21,
      plu: 10,
      wall: "Main",
      history: [pmb(latest, 300), pmb(previous, 280), pmb(older, 320)],
    }),
    item({
      id: "shared-karaoke",
      name: "Shared Lager 2",
      tapNumber: 73,
      plu: 10,
      wall: "Karaoke",
      history: [pmb(latest, 120), pmb(previous, 110)],
    }),
    item({
      id: "invalid-middle",
      tapNumber: 74,
      plu: 11,
      wall: "Karaoke",
      history: [
        pmb(latest, 90),
        { label: previous, source: "PMB", volumeOz: "invalid" },
        pmb(older, 80),
      ],
    }),
  ]);

  assert.equal(result.sections.sustained.available, true);
  assert.equal(result.sections.sustained.includedTapCount, 1);
  assert.equal(result.sections.sustained.excludedTapCount, 2);
  assert.equal(result.sections.sustained.partial, true);
  assert.deepEqual(
    result.sections.sustained.items.map((row) => ({
      name: row.name,
      taps: row.tapNumbers,
      averageOz: row.averageOz,
    })),
    [{ name: "Shared Lager", taps: [21], averageOz: 300 }],
  );

  const [newKaraokeTap, invalidMiddle] = result.sections.sustained.excludedTaps;
  assert.equal(newKaraokeTap.tapNumber, 73);
  assert.equal(newKaraokeTap.wall, "Karaoke");
  assert.equal(newKaraokeTap.code, "likely-new-tap");
  assert.equal(newKaraokeTap.likelyNew, true);
  assert.deepEqual(
    newKaraokeTap.missingWeeks.map((week) => [week.weekNumber, week.label, week.code]),
    [[3, older, "missing-sustained-week-3"]],
  );
  assert.match(newKaraokeTap.reason, /likely a new or newly assigned tap/i);

  assert.equal(invalidMiddle.tapNumber, 74);
  assert.equal(invalidMiddle.code, "invalid-sustained-week-2");
  assert.equal(invalidMiddle.likelyNew, false);
  assert.deepEqual(invalidMiddle.missingWeeks.map((week) => week.label), [previous]);
  assert.match(invalidMiddle.reason, /does not contain valid poured ounces/i);
  assert.match(result.sections.sustained.statusCopy, /uses 1 of 3 active taps/i);
  assert.match(result.sections.sustained.statusCopy, /Tap 73 \(Shared Lager\)/i);
  assert.match(result.sections.sustained.statusCopy, /not treated as zero pours/i);
  assert.match(result.statusCopy, /Sustained high volume uses 1 of 3 active taps/i);
});

test("does not call an established tap new when its three-week history has a gap", () => {
  const result = build([
    item({
      id: "complete",
      tapNumber: 20,
      history: [pmb(latest, 200), pmb(previous, 190), pmb(older, 180)],
    }),
    item({
      id: "established-gap",
      tapNumber: 21,
      history: [pmb(latest, 100), pmb(previous, 95), pmb(staleWeek, 90)],
    }),
  ]);

  const gap = result.sections.sustained.excludedTaps[0];
  assert.equal(gap.tapNumber, 21);
  assert.equal(gap.code, "missing-sustained-week-3");
  assert.equal(gap.likelyNew, false);
  assert.deepEqual(gap.missingWeeks.map((week) => week.label), [older]);
  assert.match(gap.reason, /No PMB poured-ounce data is saved/i);
});

test("surfaces new low and zero poured-usage patterns against a recent baseline", () => {
  const result = build([
    item({
      id: "new-zero",
      tapNumber: 21,
      plu: 20,
      history: [pmb(latest, 0), pmb(previous, 100), pmb(older, 100)],
    }),
    item({
      id: "new-low",
      tapNumber: 22,
      plu: 21,
      history: [pmb(latest, 30), pmb(previous, 100), pmb(older, 140)],
    }),
    item({
      id: "ordinary-variation",
      tapNumber: 23,
      plu: 22,
      history: [pmb(latest, 80), pmb(previous, 100), pmb(older, 100)],
    }),
  ]);

  assert.equal(result.sections.emergingLow.baselineWeekCount, 2);
  assert.deepEqual(
    result.sections.emergingLow.items.map((row) => ({
      name: row.name,
      status: row.status,
      currentOz: row.currentOz,
      baselineOz: row.baselineOz,
      changeOz: row.changeOz,
      changePercent: row.changePercent,
    })),
    [
      { name: "new-zero", status: "zero", currentOz: 0, baselineOz: 100, changeOz: -100, changePercent: -100 },
      { name: "new-low", status: "low", currentOz: 30, baselineOz: 120, changeOz: -90, changePercent: -75 },
    ],
  );
});

test("calculates meaningful category share movement only when multiple categories are supported", () => {
  const result = build([
    item({
      id: "beer",
      tapNumber: 21,
      plu: 30,
      type: "Beer",
      history: [pmb(latest, 800), pmb(previous, 800)],
    }),
    item({
      id: "cocktail",
      tapNumber: 50,
      plu: 31,
      type: "Cocktail",
      history: [pmb(latest, 400), pmb(previous, 200)],
    }),
  ]);

  assert.equal(getWeeklyPlanTrendCategory({ type: "Cocktail" }), "cocktail");
  assert.equal(getWeeklyPlanTrendCategory({ displayUnit: "oz", type: "Cocktail" }), "liquor");
  assert.equal(result.sections.categoryMix.available, true);
  assert.equal(result.sections.categoryMix.currentTotalOz, 1_200);
  assert.equal(result.sections.categoryMix.previousTotalOz, 1_000);
  assert.deepEqual(
    result.sections.categoryMix.items.map((row) => [row.category, row.sharePointChange]),
    [["beer", -13.3], ["cocktail", 13.3]],
  );

  const oneCategory = build([
    item({ id: "beer-only", tapNumber: 21, history: [pmb(latest, 100), pmb(previous, 90)] }),
  ]);
  assert.equal(oneCategory.sections.categoryMix.available, false);
  assert.match(oneCategory.sections.categoryMix.reason, /two beverage categories/i);
});

test("calculates like-for-like movement from complete tap pairs and reports excluded taps", () => {
  const latestIncomplete = build([
    item({ id: "complete", tapNumber: 21, plu: 40, history: [pmb(latest, 100), pmb(previous, 80)] }),
    item({ id: "missing-latest", tapNumber: 22, plu: 41, history: [pmb(previous, 50)] }),
  ]);

  assert.equal(latestIncomplete.status, "limited");
  assert.equal(latestIncomplete.coverage.latestCapturedTapCount, 1);
  assert.equal(latestIncomplete.coverage.latestMissingTapCount, 1);
  assert.equal(latestIncomplete.coverage.comparisonIncludedTapCount, 1);
  assert.equal(latestIncomplete.coverage.comparisonExcludedTapCount, 1);
  assert.equal(latestIncomplete.sections.movers.available, true);
  assert.deepEqual(
    latestIncomplete.sections.movers.risers.map((row) => [row.name, row.previousOz, row.currentOz]),
    [["complete", 80, 100]],
  );
  assert.deepEqual(latestIncomplete.sections.movers.excludedTaps, [{
    id: "beer:plu:41",
    name: "missing-latest",
    category: "beer",
    tapNumber: 22,
    wall: "Main",
    code: "missing-current-week",
    likelyNew: false,
    missingWeeks: ["current"],
    reason: "No PMB poured-ounce data is saved for the current week.",
  }]);
  assert.equal(latestIncomplete.sections.sustained.available, false);
  assert.equal(latestIncomplete.sections.emergingLow.available, true);
  assert.equal(latestIncomplete.sections.categoryMix.available, false);
  assert.match(latestIncomplete.statusCopy, /Tap 22 \(missing-latest\)/i);
  assert.match(latestIncomplete.statusCopy, /not treated as zero pours/i);

  const previousIncomplete = build([
    item({ id: "complete", tapNumber: 21, plu: 40, history: [pmb(latest, 100), pmb(previous, 80)] }),
    item({ id: "missing-previous", tapNumber: 22, plu: 41, history: [pmb(latest, 50)] }),
  ]);
  assert.equal(previousIncomplete.status, "limited");
  assert.equal(previousIncomplete.coverage.latestComplete, true);
  assert.equal(previousIncomplete.coverage.previousComplete, false);
  assert.equal(previousIncomplete.sections.movers.available, true);
  assert.equal(previousIncomplete.sections.movers.excludedTaps[0].code, "likely-new-tap");
  assert.equal(previousIncomplete.sections.movers.excludedTaps[0].likelyNew, true);
  assert.match(previousIncomplete.sections.movers.excludedTaps[0].reason, /likely a new tap/i);
  assert.match(previousIncomplete.statusCopy, /Tap 22 \(missing-previous\).*likely a new tap/i);
});

test("excludes only the incomplete tap when one product is offered on multiple walls", () => {
  const result = build([
    item({
      id: "shared-main",
      name: "Shared Lager 1",
      tapNumber: 21,
      plu: 500,
      wall: "Main",
      history: [pmb(latest, 140), pmb(previous, 100)],
    }),
    item({
      id: "shared-karaoke",
      name: "Shared Lager 2",
      tapNumber: 73,
      plu: 500,
      wall: "Karaoke",
      history: [pmb(latest, 60)],
    }),
  ]);

  assert.equal(result.sections.movers.available, true);
  assert.deepEqual(
    result.sections.movers.risers.map((row) => ({
      name: row.name,
      taps: row.tapNumbers,
      previousOz: row.previousOz,
      currentOz: row.currentOz,
      changeOz: row.changeOz,
    })),
    [{ name: "Shared Lager", taps: [21], previousOz: 100, currentOz: 140, changeOz: 40 }],
  );
  assert.equal(result.sections.movers.excludedTaps[0].tapNumber, 73);
  assert.equal(result.sections.movers.excludedTaps[0].wall, "Karaoke");
  assert.equal(result.sections.movers.excludedTaps[0].code, "likely-new-tap");
});

test("distinguishes a prior-week gap from a likely new tap and flags invalid PMB ounces", () => {
  const result = build([
    item({ id: "complete", tapNumber: 20, history: [pmb(latest, 100), pmb(previous, 80)] }),
    item({
      id: "prior-gap",
      tapNumber: 21,
      history: [pmb(latest, 50), pmb(older, 40)],
    }),
    item({
      id: "invalid-current",
      tapNumber: 22,
      history: [{ label: latest, source: "PMB", volumeOz: "bad" }, pmb(previous, 25)],
    }),
  ]);

  const [priorGap, invalidCurrent] = result.sections.movers.excludedTaps;
  assert.equal(priorGap.tapNumber, 21);
  assert.equal(priorGap.code, "missing-prior-week");
  assert.equal(priorGap.likelyNew, false);
  assert.match(priorGap.reason, /No PMB poured-ounce data is saved for the prior week/i);
  assert.equal(invalidCurrent.tapNumber, 22);
  assert.equal(invalidCurrent.code, "invalid-current-week");
  assert.match(invalidCurrent.reason, /does not contain valid poured ounces/i);
});

test("fails closed for stale PMB history and will not compare across a missing week", () => {
  const stale = build([
    item({
      id: "stale",
      tapNumber: 21,
      history: [pmb(previous, 100), pmb(older, 90), pmb(staleWeek, 80)],
    }),
  ]);
  assert.equal(stale.status, "stale");
  assert.equal(stale.period.stale, true);
  assert.equal(stale.period.expectedLatestStartDate, "2026-08-03");
  assert.equal(stale.sections.movers.available, false);
  assert.match(stale.statusCopy, /latest completed Monday-Sunday report/i);

  const missingConsecutiveWeek = build([
    item({
      id: "gap",
      tapNumber: 21,
      history: [pmb(latest, 100), pmb(older, 90)],
    }),
  ]);
  assert.equal(missingConsecutiveWeek.status, "limited");
  assert.equal(missingConsecutiveWeek.period.previousLabel, "");
  assert.equal(missingConsecutiveWeek.period.previousStartTime, 0);
  assert.equal(missingConsecutiveWeek.sections.movers.available, false);
  assert.match(missingConsecutiveWeek.sections.movers.reason, /prior consecutive week/i);
});

test("returns compact deterministic output and uses poured-usage language", () => {
  const fixtures = [
    item({ id: "z", name: "Zulu 2", tapNumber: 73, plu: 60, history: [pmb(latest, 120), pmb(previous, 100)] }),
    item({ id: "a", name: "Alpha 1", tapNumber: 21, plu: 61, history: [pmb(latest, 90), pmb(previous, 120)] }),
    item({ id: undefined, name: "Anonymous", wall: "Patio", history: [pmb(latest, 60), pmb(previous, 40)] }),
  ];
  const forward = build(fixtures);
  const reverse = build([...fixtures].reverse());

  assert.deepEqual(forward, reverse);
  assert.doesNotMatch(JSON.stringify(forward), /\b(?:sales|sold|revenue)\b/i);
  assert.deepEqual(Object.keys(forward), [
    "status",
    "statusLabel",
    "statusCopy",
    "period",
    "coverage",
    "sections",
  ]);
});
