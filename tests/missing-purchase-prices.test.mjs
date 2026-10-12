import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildRawRecommendation } from "../lib/par-agent.mjs";
import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";
import { getSavedTapOrderProduct, getTapOrderProductName } from "../public/tap-order-product.mjs";
import { isPricingPlaceholder } from "../public/pricing-placeholders.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function load(name, scope) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return vm.runInNewContext(`(${source.slice(start, source.indexOf("\n}\n", start) + 2)})`, scope);
}
const tap = { key: "main-28", tapNumber: 28, wall: "Main", name: "Coming Soon!", templateBrand: "SUMMER ALE 1", type: "Seasonal" };
const now = new Date("2026-10-12T15:00:00Z");
function recommend(onDeckOverrides = {}, savedProduct = null) {
  return buildRawRecommendation(tap, { fillLevelPercent: 11.5, rawKegSize: 1984, rawKegSizeDp: 0 },
    [{ label: "10/5/2026 - 10/11/2026", source: "PMB", volumeOz: 960 }],
    { onHandOverrides: {}, onDeckOverrides }, {}, savedProduct, { now });
}
test("seasonal placeholder waits for a real beer instead of purchasing Coming Soon", () => {
  const result = recommend();
  assert.equal(result.orderQty, 0);
  assert.equal(result.orderProductName, "");
  assert.equal(result.actionType, "none");
  assert.match(result.reason, /select.*on deck/i);
});
test("seasonal placeholder can purchase an explicitly selected On Deck beer", () => {
  const result = recommend({ [tap.key]: { name: "Winter White Ale", kind: "beer", onHand: "0", onHandUnit: "keg" } });
  assert.ok(result.orderQty > 0);
  assert.equal(result.orderProductName, "Winter White Ale");
});
test("cached placeholder purchases cannot enter the weekly purchase plan", () => {
  const result = buildWeeklyActionPlan({ recommendations: [
    { ...tap, isKegTap: true, actionType: "order", orderQty: 1, orderProductName: "Coming Soon!", unitCost: 0 },
    { ...tap, key: "other", isKegTap: true, actionType: "order", orderQty: 1, orderProductName: "Winter White Ale", unitCost: 182 },
  ] });
  assert.equal(result.orders.beerKegs.length, 1);
  assert.equal(result.orders.beerKegs[0].name, "Winter White Ale");
  assert.equal(result.summary.missingPriceCount, 0);
});
function pricingScope() {
  const scope = { toNumber: value => Number(value) || 0, priceOverrides: {}, inventoryItems: [],
    ingredients: [{ id: "1800-reposado", name: "1800 Reposado" }],
    normalizeIngredientAlias: () => "1800 Reposado", normalizeLiquorTapProductName: value => value,
    slugify: () => "1800-reposado", getVendorMapping: () => ({ unitPrice: 42.3, preferredSku: "2411D", vendor: "OHLQ" }),
    getIngredientBottleCost: () => 44.18,
    getCurrentMondayKegPlanSnapshot: () => null,
    liveParRecommendations: { items: [{ name: "1800 Reposado Tequila 3", isLiquorTap: true, orderQty: 2, actionType: "order" }] },
    getWeeklyPlanInventoryItems: () => [], netRollingLiquorTapRecommendations: items => items,
  };
  scope.getWeeklyPlanLiquorBottleCost = (...args) => load("getWeeklyPlanLiquorBottleCost", scope)(...args);
  return scope;
}
test("1800 weekly orders use the current catalog bottle price without a cabinet item", () => {
  const result = load("getWeeklyPlanRecommendations", pricingScope())({ live: true });
  assert.equal(result[0].unitCost, 44.18);
  assert.equal(buildWeeklyActionPlan({ recommendations: result }).summary.missingPriceCount, 0);
});
test("bottle pricing preserves saved and inventory prices, then falls back to a mapped cost", () => {
  const scope = pricingScope();
  const cost = () => scope.getWeeklyPlanLiquorBottleCost("1800-reposado", "1800 Reposado");
  scope.priceOverrides["1800-reposado"] = { bottlePrice: 45 };
  assert.equal(cost(), 45);
  scope.priceOverrides = {};
  scope.inventoryItems = [{ name: "1800 Reposado", unitCost: 43 }];
  assert.equal(cost(), 43);
  scope.inventoryItems = [];
  scope.ingredients = [];
  assert.equal(cost(), 42.3);
  scope.getVendorMapping = () => null;
  assert.equal(cost(), 0);
});
test("previously unpriced saved liquor lines receive the same current bottle cost", () => {
  const plan = buildWeeklyActionPlan({ recommendations: [{ name: "1800 Reposado", isLiquorTap: true, actionType: "order", orderQty: 2, unitCost: 0 }] });
  const result = load("hydrateWeeklyPlanLiquorTapPricing", pricingScope())(plan);
  assert.equal(result.orders.liquorTapBottles[0].estimatedCost, 88.36);
  assert.equal(result.summary.missingPriceCount, 0);
});
test("keg screen does not calculate an order for an unassigned seasonal placeholder", () => {
  const result = load("getKegNeedCalculation", {
    getKegLiveRow: () => ({}), getKegCurrentFraction: () => 0.115,
    getKegDisplayBrand: () => "Coming Soon!", getWeeklyUsageForKegItem: () => ({}),
    getSixWeekUsage: () => ({}), isLiquorOunceTap: () => false, toNumber: Number,
    getKegOnDeckItem: () => null, clean: value => String(value || "").trim(),
    getTapOrderProductName, isPricingPlaceholder, normalizeTitle: value => String(value || "").toLowerCase(),
  })(tap);
  assert.equal(result, null);
});


test("Tap 28 retains Octoberfest while PMB shows Coming Soon, until a real replacement is selected", () => {
  const saved = { tapNumber: 28, name: "Octoberfest", history: [{ label: "10/5/2026 - 10/11/2026", source: "PMB", volumeOz: 960 }] };
  const result = recommend({}, saved);
  assert.equal(result.orderProductName, "Octoberfest");
  assert.ok(result.orderQty > 0);
  assert.equal(getTapOrderProductName({ ...tap, name: "Winter White Ale" }, saved), "Winter White Ale");
  assert.equal(getTapOrderProductName(tap, saved, { name: "Winter White Ale" }), "Winter White Ale");
  assert.equal(getTapOrderProductName(tap, { ...saved, tapNumber: 29 }), "");
});
test("cached Tap 28 placeholder resolves to the saved Octoberfest keg price without changing its quantity", () => {
  const scope = pricingScope();
  scope.liveParRecommendations.items = [{ ...tap, isKegTap: true, orderQty: 1, actionType: "order", orderProductName: "Coming Soon!" }];
  scope.weeklyUsageItems = [{ tapNumber: 28, name: "Octoberfest" }];
  scope.getTapOrderProductName = getTapOrderProductName;
  scope.getSavedTapOrderProduct = getSavedTapOrderProduct;
  scope.weeklyUsageArchivedItems = [];
  scope.getKegPricingItem = name => name === "Octoberfest" ? { id: "octoberfest", name, vendor: "Heidelberg" } : null;
  scope.getKegVendorCatalogProduct = () => null;
  scope.getKegPrice = () => 182;
  scope.getOrderingSku = () => "";
  const result = load("getWeeklyPlanRecommendations", scope)({ live: true });
  assert.equal(result[0].orderProductName, "Octoberfest");
  assert.equal(result[0].orderQty, 1);
  assert.equal(result[0].unitCost, 182);
  assert.equal(buildWeeklyActionPlan({ recommendations: result }).summary.missingPriceCount, 0);
});

const archivedOctoberfest = {
  tapNumber: 28, name: "Octoberfest", replacedAt: "2026-10-12T15:08:14.581Z", replacedBy: "Coming Soon!",
  history: [{ label: "9/28/2026 - 10/4/2026", source: "PMB", hasValue: true, volumeOz: 960.56 }],
};
test("a weekly refresh preserves the archived Octoberfest identity and usage for ordering", () => {
  const active = [{ ...tap, history: [{ label: "10/5/2026 - 10/11/2026", hasValue: false, volumeOz: 0 }] }];
  const archived = [
    { ...archivedOctoberfest, name: "Summer Ale 1", replacedAt: "2026-09-28T21:32:03.534Z", replacedBy: "Octoberfest" },
    archivedOctoberfest,
  ];
  const saved = getSavedTapOrderProduct(tap, active, archived);
  assert.equal(saved, archivedOctoberfest);
  const result = recommend({}, saved);
  assert.equal(result.orderProductName, "Octoberfest");
  assert.equal(result.orderQty, 1);
  assert.ok(result.avgWeeklyKegs > 0);
  const scope = { isPricingPlaceholder, getSavedTapOrderProduct, weeklyUsageItems: active, weeklyUsageArchivedItems: archived };
  assert.equal(load("getWeeklyUsageForKegItem", scope)(tap, tap.name), archivedOctoberfest);
});
test("retention cannot revive an older beer after a real replacement or cross physical taps", () => {
  const active = [{ ...tap }];
  assert.equal(getSavedTapOrderProduct(tap, active, [{ ...archivedOctoberfest, tapNumber: 29 }]), active[0]);
  assert.equal(getSavedTapOrderProduct(tap, active, [{ ...archivedOctoberfest, replacedBy: "Winter White Ale" }]), active[0]);
  const replacement = { ...tap, name: "Winter White Ale" };
  assert.equal(getSavedTapOrderProduct(replacement, [replacement], [archivedOctoberfest]), replacement);
  assert.equal(getTapOrderProductName(replacement, archivedOctoberfest), "Winter White Ale");
  assert.equal(getTapOrderProductName(tap, archivedOctoberfest, { name: "Winter White Ale" }), "Winter White Ale");
});

test("a newly needed Buffalo Trace Bourbon tap matches the saved Buffalo Trace bottle price", () => {
  const scope = pricingScope();
  scope.normalizeIngredientAlias = load("normalizeIngredientAlias", {
    clean: value => String(value || "").trim(), getPreparedIngredientCanonicalName: () => "",
    titleCaseIngredientName: value => value,
  });
  scope.normalizeLiquorTapProductName = value => value.replace(/\s+[123]$/, "");
  scope.slugify = value => value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  scope.ingredients = [];
  scope.getVendorMapping = id => id === "buffalo-trace" ? { unitPrice: 34.78, vendor: "OHLQ", preferredSku: "1499L" } : null;
  scope.liveParRecommendations.items = [{ name: "Buffalo Trace Bourbon 3", isLiquorTap: true, orderQty: 3, actionType: "order" }];
  const result = load("getWeeklyPlanRecommendations", scope)({ live: true });
  assert.equal(result[0].orderProductName, "Buffalo Trace");
  assert.equal(result[0].unitCost, 34.78);
  assert.equal(buildWeeklyActionPlan({ recommendations: result }).summary.missingPriceCount, 0);
});
