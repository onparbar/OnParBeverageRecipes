import assert from "node:assert/strict";
import test from "node:test";
import { parseDashboardDataQuery, searchDashboardData, searchDashboardItems } from "../public/global-dashboard-search.mjs";
import { buildPricingAdvisor, getPmbPriceUpdateEligibility } from "../public/pricing-advisor.mjs";

const products = Array.from({ length: 8 }, (_, index) => ({
  id: `product-${index}`, name: `Cocktail ${index}`, tapNumber: 31 + index,
  wall: "main", category: "cocktail",
  periods: { recent: { label: "6-week average", ounces: 10 + index / 10, dollars: 30 + index, profit: 20 + index, margin: 80 + index } },
}));

test("decimal thresholds preserve fractional ounces and do not become product words", () => {
  assert.equal(parseDashboardDataQuery("under 10.5 oz").intent.comparison.threshold, 10.5);
  assert.equal(searchDashboardData(products, "under 10.5 oz").results.length, 5);
  assert.equal(parseDashboardDataQuery("over $10.50").intent.comparison.threshold, 10.5);
});

test("top counts, exact taps and default recent history work together", () => {
  const top = searchDashboardData(products, "top 5 cocktails");
  assert.equal(top.results.length, 5);
  assert.equal(top.intent.period, "recent");
  assert.equal(top.results[0].name, "Cocktail 7");
  assert.deepEqual(searchDashboardData(products, "tap 31").results.map(item => item.tapNumber), [31]);
  assert.deepEqual(searchDashboardData(products, "31").results.map(item => item.tapNumber), [31]);
});

test("profit and margin use distinct metrics and missing data is not zero", () => {
  assert.equal(searchDashboardData(products, "lowest profit margin").results[0].value, 80);
  assert.equal(searchDashboardData(products, "highest profit").results[0].value, 27);
  const unknown = [{ ...products[0], periods: { recent: { ounces: 10, dollars: null, profit: null } } }];
  assert.equal(searchDashboardData(unknown, "no sales").results.length, 0);
  assert.equal(searchDashboardData(unknown, "lowest profit").results.length, 0);
});

test("navigation tolerates a transposed name but keeps numeric tap matches exact", () => {
  const items = [
    { id: "a", title: "Fireball", subtitle: "Tap 31", section: "Keg Levels" },
    { id: "b", title: "Fireball", subtitle: "Tap 131", section: "Keg Levels" },
  ];
  assert.equal(searchDashboardItems(items, "firebal").length, 2);
  assert.equal(searchDashboardItems(items, "fierball").length, 2);
  assert.deepEqual(searchDashboardItems(items, "tap 31").map(item => item.id), ["a"]);
});

const now = new Date("2026-09-10T12:00:00Z");
const liquor = {
  id: "liquor-1", kind: "Liquor", name: "Test liquor", tapPosition: 1,
  mappingVerified: true, costPerOz: 1, livePriceUpdatedAt: now.toISOString(),
  portions: [{ name: "Single", price: 10, servingOz: 1.5 }, { name: "Double", price: 13.5, servingOz: 3 }],
};

test("one liquor tap counts once and reviews both single and double margins", () => {
  const advisor = buildPricingAdvisor([liquor], { now });
  assert.equal(advisor.summary.total, 1);
  assert.equal(advisor.summary.priceChangeCount, 1);
  assert.equal(advisor.rows[0].portions[0].action, "hold");
  assert.equal(advisor.rows[0].portions[0].recommendedPricePerOz, 10);
  assert.equal(advisor.rows[0].portions[1].recommendedPricePerOz, 16.67);
  assert.equal(advisor.rows[0].publishEligible, false);
  assert.equal(getPmbPriceUpdateEligibility(liquor, { now }).eligible, false);
});

test("cost dates alone no longer trigger warnings but missing costs remain blocked", () => {
  for (const costUpdatedAt of ["", "2000-01-01"]) {
    const row = buildPricingAdvisor([{ ...liquor, costUpdatedAt, costPerOz: 0.2 }], { now }).rows[0];
    assert.equal(row.needsReview, false);
    assert.equal(row.action, "hold");
  }
  assert.equal(buildPricingAdvisor([{ ...liquor, costPerOz: 0 }], { now }).rows[0].hasBlocker, true);
});
