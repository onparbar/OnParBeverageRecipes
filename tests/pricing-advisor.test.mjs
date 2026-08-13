import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPricingAdvisor,
  calculateGrossMarginPercent,
  calculateTargetPricePerOz,
  evaluatePricingRecommendation,
  getPmbPriceEditorDefault,
  getPmbPriceUpdateEligibility,
  getVerifiedPmbPriceIdentity,
  isPricingAdvisorEligibleKind,
  parsePricingTimestamp,
  validatePmbPriceIncrease,
} from "../public/pricing-advisor.mjs";

test("calculates an 82% gross-margin price and rounds upward to the configured increment", () => {
  assert.equal(calculateTargetPricePerOz({ costPerOz: 0.18 }), 1);
  assert.equal(calculateTargetPricePerOz({ costPerOz: 0.181 }), 1.01);
  assert.equal(calculateTargetPricePerOz({ costPerOz: 0.18, priceIncrement: 0.05 }), 1);
  assert.equal(calculateGrossMarginPercent(0.18, 1), 82);
});

test("can account for sellable yield without pretending it is configured by default", () => {
  assert.equal(calculateTargetPricePerOz({ costPerOz: 0.18, sellableYieldPercent: 90 }), 1.12);
  assert.equal(calculateTargetPricePerOz({ costPerOz: 0.18, sellableYieldPercent: 0 }), 0);
});

test("treats 82% as a floor and never recommends lowering a higher price", () => {
  const common = {
    id: "lager",
    name: "Lager",
    costPerOz: 0.18,
    mappingVerified: true,
    costUpdatedAt: "2026-08-10T12:00:00.000Z",
    livePriceUpdatedAt: "2026-08-12T08:00:00.000Z",
  };
  const options = { now: new Date("2026-08-12T09:00:00.000Z") };

  assert.equal(evaluatePricingRecommendation({ ...common, currentPricePerOz: 1 }, options).action, "hold");
  assert.equal(evaluatePricingRecommendation({ ...common, currentPricePerOz: 0.9 }, options).action, "increase");
  const aboveFloor = evaluatePricingRecommendation({ ...common, currentPricePerOz: 1.1 }, options);
  assert.equal(aboveFloor.action, "hold");
  assert.equal(aboveFloor.recommendedPricePerOz, 1.1);
  assert.equal(aboveFloor.priceChange, 0);
});

test("limits the advisor to beer and cocktails", () => {
  assert.equal(isPricingAdvisorEligibleKind("Beer"), true);
  assert.equal(isPricingAdvisorEligibleKind("cocktail"), true);
  assert.equal(isPricingAdvisorEligibleKind("Liquor"), false);
  assert.equal(isPricingAdvisorEligibleKind("Shots"), false);
});

test("shows a calculation but requires review when price inputs are stale or undated", () => {
  const result = evaluatePricingRecommendation({
    id: "lager",
    name: "Lager",
    costPerOz: 0.18,
    currentPricePerOz: 0.9,
    mappingVerified: true,
    costUpdatedAt: "Default Heidelberg Provi pricing",
    livePriceUpdatedAt: "2026-08-10T08:00:00.000Z",
  }, { now: new Date("2026-08-12T09:00:00.000Z") });

  assert.equal(result.recommendedPricePerOz, 1);
  assert.equal(result.action, "increase");
  assert.equal(result.needsReview, true);
  assert.deepEqual(result.issues.map((entry) => entry.code), ["undated-cost", "stale-live-price", "large-change"]);
  assert.equal(result.publishEligible, false);
});

test("blocks an unmapped or incomplete row and never marks any row publishable", () => {
  const result = buildPricingAdvisor([
    { id: "unknown", name: "Unknown", currentPricePerOz: 1, mappingVerified: false },
    {
      id: "ready",
      name: "Ready",
      costPerOz: 0.18,
      currentPricePerOz: 1,
      mappingVerified: true,
      costUpdatedAt: "2026-08-12T07:00:00.000Z",
      livePriceUpdatedAt: "2026-08-12T08:00:00.000Z",
    },
  ], { now: new Date("2026-08-12T09:00:00.000Z") });

  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.blockedCount, 1);
  assert.equal(result.summary.onTargetCount, 1);
  assert.equal(result.summary.priceChangeCount, 0);
  assert.ok(result.rows.every((row) => row.mode === "dry-run" && row.publishEligible === false));
});

test("counts only verified below-floor increases as price suggestions", () => {
  const result = buildPricingAdvisor([
    {
      id: "missing-live",
      name: "Missing Live",
      costPerOz: 0.18,
      currentPricePerOz: 0,
      mappingVerified: true,
      costUpdatedAt: "2026-08-12T07:00:00.000Z",
    },
    {
      id: "below-floor",
      name: "Below Floor",
      costPerOz: 0.18,
      currentPricePerOz: 0.9,
      mappingVerified: true,
      costUpdatedAt: "2026-08-12T07:00:00.000Z",
      livePriceUpdatedAt: "2026-08-12T08:00:00.000Z",
    },
  ], { now: new Date("2026-08-12T09:00:00.000Z") });

  assert.equal(result.summary.priceChangeCount, 1);
});

test("extracts dates from human-readable price provenance", () => {
  assert.equal(
    parsePricingTimestamp("Bonbright manual pricing 2026-07-24"),
    new Date("2026-07-24").getTime(),
  );
  assert.equal(parsePricingTimestamp("Default pricing"), 0);
});

test("permits a deliberate live increase only with fresh mapped PMB identity", () => {
  const input = {
    plu: 4101,
    kind: "Beer",
    name: "Test IPA",
    mappingVerified: true,
    costPerOz: 0.18,
    costUpdatedAt: "2026-08-11T08:00:00.000Z",
    currentPricePerOz: 0.9,
    livePriceUpdatedAt: "2026-08-12T08:00:00.000Z",
    tapNumber: 21,
    deviceId: 9001,
    lineNum: 2,
    isCurrentTap: true,
    tapMatchSource: "pmb-tap-config",
    assignments: [
      { tapNumber: 21, deviceId: 9001, lineNum: 2, name: "Test IPA" },
      { tapNumber: 62, deviceId: 9002, lineNum: 4, name: "Test IPA" },
    ],
  };
  const result = getPmbPriceUpdateEligibility(input, {
    now: new Date("2026-08-12T09:00:00.000Z"),
  });

  assert.equal(result.eligible, true);
  assert.deepEqual(result.identity, {
    tapNumber: 21,
    deviceId: 9001,
    lineNum: 2,
    name: "Test IPA",
  });
});

test("live price editing fails closed for liquor, stale live data, and incomplete assignments", () => {
  const common = {
    plu: 4101,
    kind: "Beer",
    name: "Test IPA",
    mappingVerified: true,
    costPerOz: 0.18,
    costUpdatedAt: "2026-08-11T08:00:00.000Z",
    currentPricePerOz: 0.9,
    livePriceUpdatedAt: "2026-08-12T08:00:00.000Z",
    tapNumber: 21,
    deviceId: 9001,
    lineNum: 2,
    isCurrentTap: true,
    tapMatchSource: "pmb-tap-config",
  };
  const now = new Date("2026-08-12T09:00:00.000Z");

  assert.equal(getPmbPriceUpdateEligibility({ ...common, kind: "Liquor" }, { now }).eligible, false);
  assert.equal(getPmbPriceUpdateEligibility({
    ...common,
    livePriceUpdatedAt: "2026-08-10T08:00:00.000Z",
  }, { now }).eligible, false);
  assert.equal(getPmbPriceUpdateEligibility({
    ...common,
    assignments: [{ tapNumber: 21, deviceId: 0, lineNum: 2 }],
  }, { now }).eligible, false);
  assert.equal(getPmbPriceUpdateEligibility({
    ...common,
    tapMatchSource: "template-fallback",
  }, { now }).eligible, false);
});

test("a fresh verified live price remains manually editable when cost guidance is unavailable", () => {
  const result = getPmbPriceUpdateEligibility({
    plu: 4101,
    kind: "Beer",
    name: "Test IPA",
    mappingVerified: false,
    costPerOz: 0,
    costUpdatedAt: "",
    currentPricePerOz: 1,
    livePriceUpdatedAt: "2026-08-12T08:00:00.000Z",
    tapNumber: 21,
    deviceId: 9001,
    lineNum: 2,
    isCurrentTap: true,
    tapMatchSource: "pmb-tap-config",
  }, { now: new Date("2026-08-12T09:00:00.000Z") });

  assert.equal(result.eligible, true);
});

test("price editor prefills only a current-cost 82% increase suggestion", () => {
  const recommendation = {
    action: "increase",
    currentPricePerOz: 0.9,
    recommendedPricePerOz: 1,
    issues: [{ code: "large-change" }],
  };
  assert.equal(getPmbPriceEditorDefault(recommendation), 1);
  assert.equal(getPmbPriceEditorDefault({
    ...recommendation,
    issues: [{ code: "stale-cost" }],
  }), 0.9);
  assert.equal(getPmbPriceEditorDefault({
    ...recommendation,
    action: "hold",
    currentPricePerOz: 1.1,
    recommendedPricePerOz: 1.1,
    issues: [],
  }), 1.1);
});

test("live price validation rejects decreases and no-op submissions", () => {
  assert.equal(validatePmbPriceIncrease({ currentPricePerOz: 1, newPricePerOz: 0.99 }).valid, false);
  assert.equal(validatePmbPriceIncrease({ currentPricePerOz: 1, newPricePerOz: 1 }).valid, false);
  assert.equal(validatePmbPriceIncrease({ currentPricePerOz: 1, newPricePerOz: 1.01 }).valid, true);
  assert.equal(getVerifiedPmbPriceIdentity({ plu: 1, name: "Beer" }), null);
});
