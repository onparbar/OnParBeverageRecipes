import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { buildInventoryPosition, buildOperationalRecommendation, buildStockGapRecommendation } from "../public/operations-truth-model.mjs";
import { attachTapProductHistory, tapProductIdentity } from "../lib/pmb-tap-product-history.mjs";
import { normalizePmbLevelSnapshot } from "../lib/pmb-level-snapshot-store.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function load(name, scope = {}) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.indexOf("\n}\n", start) + 2;
  return vm.runInNewContext(`(${source.slice(start, end)})`, scope);
}
const item = { tapNumber: 21, deviceId: 123, lineNum: 1, plu: 6655, tapProduct: "Test beer 1", brand: "Test beer 1", fillLevelPercent: 75 };
const escapeHtml = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const base = {
  getKegItemKey: () => "21", getKegOnDeckItem: () => null,
  tapReplacementOverrides: {}, getTapReplacementProductOptions: () => "",
  kegConfigUpdateRunning: false, activeKegAdjustKey: "", escapeHtml,
  formatUpdatedAt: (date) => date,
};
const renderProduct = load("renderTapChangeControls", base);
const monthsAgo = (months) => { const date = new Date(); date.setMonth(date.getMonth() - months); return date.toISOString(); };

test("product hover contains only recent introduction and previous product", () => {
  const introducedAt = monthsAgo(1);
  const html = renderProduct(item, { tappedOn: "old keg timestamp", productHistory: { introducedAt, introductionSource: "confirmed", introductionPreviousName: "Previous <beer>" } });
  assert.match(html, /Product swap history/);
  assert.ok(html.includes(introducedAt));
  assert.match(html, /Previous &lt;beer>/);
  assert.doesNotMatch(html, /weekly|Last tapped|old keg timestamp/);
});

test("old returning products, unknown baselines, and invalid dates have no new-product hover", () => {
  for (const history of [
    { introducedAt: monthsAgo(4), changedAt: new Date().toISOString(), introductionSource: "confirmed" },
    { introducedAt: monthsAgo(1), introductionSource: "baseline" },
    { introducedAt: "invalid", introductionSource: "confirmed" },
    { introducedAt: monthsAgo(-1), introductionSource: "confirmed" },
    null,
  ]) assert.doesNotMatch(renderProduct(item, { productHistory: history }), /Product swap history/);
});

test("observed rather than confirmed introductions are labeled first detected", () => {
  assert.match(renderProduct(item, { productHistory: { introducedAt: monthsAgo(1), introductionSource: "detected" } }), /First detected/);
});

test("order hover uses the same stock target as the recommendation", () => {
  const scope = {
    getKegLiveRow: () => ({}), getKegCurrentFraction: () => 0.75,
    getKegItemKey: () => "21", isLiquorOunceTap: () => false,
    getKegParDisplay: () => "2.25", getKegOnDeckItem: () => ({ kind: "beer", onHand: 1 }),
    getKegOnHandDisplay: () => "0", normalizeTitle: String, toNumber: Number,
    getWeeklyUsageForKegItem: () => ({}), getSixWeekUsage: () => ({ sampleWeeks: 6, average: 1.8 }),
    MINIMUM_KEG_CUSHION: 0.25,
    getKegDisplayBrand: () => "Test beer",
    getKegFullOunces: () => 1984,
    getEightWeekPeakUsage: () => ({ sampleWeeks: 8, peak: 1.8, targetStock: 2.25 }),
    parAgentState: { recommendations: { items: [{ key: "21", preThursdayForecastKegs: 0.25 }] } },
    buildInventoryPosition, buildOperationalRecommendation, buildStockGapRecommendation,
  };
  const calculate = load("getKegNeedCalculation", scope);
  assert.equal(calculate(item).targetStock, 2.25);
  assert.equal(calculate(item).orderQuantity, 1);
  assert.equal(load("getKegNeed", { getKegNeedCalculation: calculate })(item), 1);
  const render = load("renderKegNeedCell", {
    ...scope, getKegNeedCalculation: calculate, getKegDisplayBrand: () => "Test beer",
    getWeeklyUsageForKegItem: () => ({}), getSixWeekUsage: () => ({ sampleWeeks: 6, average: 1.8 }),
    formatNumber: String, escapeHtml, renderKegNeedValue: () => "Order 1",
  });
  const html = render(item, 1);
  assert.match(html, /Order 1/);
  assert.match(html, /1.8 kegs \/ week/);
  assert.match(html, /Need at least/);
  assert.match(html, /2.25 kegs/);
  assert.doesNotMatch(html, /Last tapped|Replaced/);
});

test("liquor targets and missing readings keep existing order behavior", () => {
  const scope = {
    getKegLiveRow: () => ({}), getKegCurrentFraction: () => 0.5, getKegItemKey: () => "21",
    toNumber: Number, isLiquorOunceTap: () => true, getKegCurrentLevelOz: () => 110,
    getKegDisplayBrand: () => "Test liquor", getWeeklyUsageForKegItem: () => ({ displayUnit: "oz" }),
    getSixWeekUsage: () => ({ sampleWeeks: 6, average: 150 }),
    normalizeIngredientAlias: String, normalizeLiquorTapProductName: String, slugify: String,
    inventoryItems: [], priceOverrides: {}, getVendorMapping: () => ({ bottleOz: 50 }),
    parAgentState: { recommendations: { items: [{ key: "21", avgWeeklyOunces: 150, bottleOz: 50 }] } },
    buildInventoryPosition, buildOperationalRecommendation, buildStockGapRecommendation,
  };
  const result = load("getKegNeedCalculation", scope)(item);
  assert.equal(result.targetStock, 250);
  assert.equal(result.orderQuantity, 3);
  assert.equal(load("getKegNeedCalculation", { ...scope, getKegCurrentFraction: () => null })(item), null);
});

test("original introduction survives response attachment and snapshot storage", () => {
  const introducedAt = monthsAgo(4);
  const data = { ...tapProductIdentity(item), source: "confirmed", firstSeenAt: new Date().toISOString(), introducedAt, introductionSource: "confirmed", introductionPreviousProduct: { name: "Original previous beer" } };
  const [attached] = attachTapProductHistory([item], [{ slot_key: data.slotKey, data }]);
  const result = normalizePmbLevelSnapshot({ updatedAt: new Date().toISOString(), items: [attached] }).items[0];
  assert.equal(result.productHistory.introducedAt, introducedAt);
  assert.equal(result.productHistory.introductionPreviousName, "Original previous beer");
  assert.equal(result.productHistory.introductionSource, "confirmed");
});
