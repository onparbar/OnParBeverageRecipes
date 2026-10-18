import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getTapPricingCoverage } from "../public/tap-pricing-coverage.mjs";

const now = new Date("2026-10-18T23:00:00Z");
const assignments = Array.from({ length: 102 }, (_, index) => ({
  tapNumber: index + 1, deviceId: index + 1000, lineNum: 1,
  plu: index + 2000, product: `Product ${index + 1}`,
}));
for (const tap of [38, 44, 77]) Object.assign(assignments[tap - 1], { plu: 11111, product: "Coming Soon!" });
const priceItems = assignments.filter(tap => tap.plu !== 11111).map(tap => ({
  ...tap, tapPosition: tap.tapNumber, name: tap.product, chargePerOz: 0.56,
  isCurrentTap: true, tapMatchSource: "pmb-tap-config",
}));
const input = () => ({ assignments: structuredClone(assignments), priceItems: structuredClone(priceItems),
  expectedTapNumbers: assignments.map(tap => tap.tapNumber), updatedAt: now.toISOString(), now });

test("empty Stella and the other Coming Soon taps do not need sell prices", () => {
  const coverage = getTapPricingCoverage(input());
  assert.equal(coverage.expectedCount, 99);
  assert.equal(coverage.capturedCount, 99);
  assert.deepEqual(coverage.placeholderTapNumbers, [38, 44, 77]);
  assert.deepEqual(coverage.missingAssignments, []);
});

test("Stella reconnected with its verified price counts as a priced tap", () => {
  const data = input();
  const stella = { ...data.assignments[37], plu: 59321, product: "Stella Artois 1" };
  data.assignments[37] = stella;
  data.priceItems.push({ ...stella, name: stella.product, tapPosition: 38, chargePerOz: 0.56,
    isCurrentTap: true, tapMatchSource: "pmb-tap-config" });
  const coverage = getTapPricingCoverage(data);
  assert.equal(coverage.expectedCount, 100);
  assert.equal(coverage.capturedCount, 100);
  assert.deepEqual(coverage.missingAssignments, []);
});

test("a reconnected Stella without a price still needs attention", () => {
  const data = input();
  data.assignments[37] = { ...data.assignments[37], plu: 59321, product: "Stella Artois 1" };
  const coverage = getTapPricingCoverage(data);
  assert.equal(coverage.expectedCount, 100);
  assert.equal(coverage.capturedCount, 99);
  assert.equal(coverage.missingAssignments[0].product, "Stella Artois 1");
});

test("old, incomplete, ambiguous or malformed assignment evidence cannot hide alerts", () => {
  const variants = [
    data => { data.updatedAt = "2026-10-15T15:01:49Z"; },
    data => { data.updatedAt = "2026-10-19T23:00:00Z"; },
    data => { data.updatedAt = ""; },
    data => { data.assignments.pop(); },
    data => { data.assignments[37].tapNumber = 37; },
    data => { data.assignments[37].deviceId = data.assignments[36].deviceId; },
    data => { data.assignments[37].plu = 0; },
    data => { data.assignments[37].product = ""; },
  ];
  for (const mutate of variants) { const data = input(); mutate(data); assert.equal(getTapPricingCoverage(data), null); }
});

test("wrong products, wrong physical slots, saved rows and zero prices do not count as verified", () => {
  for (const change of [ { plu: 90000 }, { name: "Another beer" }, { deviceId: 90000 },
    { lineNum: 2 }, { chargePerOz: 0 }, { isCurrentTap: false }, { tapMatchSource: "template-fallback" } ]) {
    const data = input();
    Object.assign(data.priceItems[0], change);
    const coverage = getTapPricingCoverage(data);
    assert.equal(coverage.capturedCount, 98);
    assert.equal(coverage.missingAssignments[0].tapNumber, 1);
  }
});

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const alertFunction = source.match(/function getMissingPriceAlerts\(\) \{[\s\S]*?\n\}/)[0];

function briefingAlerts(coverage, { stale = true } = {}) {
  return new Function("getCurrentTapPricingCoverage", "kegWallItems", "getKegLiveRow",
    "getKegCanonicalResolution", "getKegWallPricing", "getWeeklyPlanInventoryItems", "isPricingPlaceholder",
    "liveTapPricingUpdatedAt", "kegLiveLevelsStale", "clean", "formatNumber", "formatMissingCostMessage",
    `${alertFunction}; return getMissingPriceAlerts();`)(
    () => coverage, [{ wall: "Main", tapNumber: 38 }], () => ({ name: "Stella Artois 1" }),
    () => ({ operationallyVerified: true, product: { name: "Stella Artois 1" } }),
    () => ({ costPerOz: 0.10, chargeAvailable: false }), () => [], () => false,
    now.toISOString(), stale, value => String(value || "").trim(), String, items => items.join(", "),
  );
}

test("the real briefing does not call a disconnected Stella a missing sell price", () => {
  assert.deepEqual(briefingAlerts(getTapPricingCoverage(input())), []);
});

test("the real briefing still reports an active Stella without a verified price", () => {
  const data = input();
  data.assignments[37] = { ...data.assignments[37], plu: 59321, product: "Stella Artois 1" };
  const alerts = briefingAlerts(getTapPricingCoverage(data));
  assert.deepEqual(alerts.map(alert => alert.id), ["missing-tap-prices"]);
  assert.deepEqual(alerts[0].details, ["Stella Artois 1 · Main tap 38"]);
});

test("without current assignments an old keg snapshot is not evidence of a missing price", () => {
  assert.deepEqual(briefingAlerts(null), []);
  assert.equal(briefingAlerts(null, { stale: false })[0].id, "missing-tap-prices");
});

test("the pricing feed uses the fresh assignments even when keg readings still show 102 old products", () => {
  const feedFunction = source.match(/function getPmbPricingOverviewFeed\(\) \{[\s\S]*?\n\}/)[0];
  const feed = new Function("getCurrentTapPricingCoverage", "kegWallItems", "kegLiveLevels", "toNumber", "clean",
    "liveTapPriceItems", "tapPricingSyncLoading", "liveTapPricingUpdatedAt", "tapPricingSyncAttempted", "liveTapPricingMessage",
    `${feedFunction}; return getPmbPricingOverviewFeed();`)(
    () => getTapPricingCoverage(input()), assignments.map(tap => ({ tapNumber: tap.tapNumber, brand: `Old product ${tap.tapNumber}` })),
    new Map(), Number, String, priceItems, false, now.toISOString(), true, "",
  );
  assert.equal(feed.status, "online");
  assert.equal(feed.expectedCount, 99);
  assert.equal(feed.capturedCount, 99);
});
