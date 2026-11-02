import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRawRecommendation } from "../lib/par-agent.mjs";
import { getEightWeekPeakUsage, getKegReservePolicy } from "../public/keg-demand-policy.mjs";
import { buildInventoryPosition, buildStockGapRecommendation } from "../public/operations-truth-model.mjs";
import { isPricingPlaceholder } from "../public/pricing-placeholders.mjs";
import { getTapOrderProductName } from "../public/tap-order-product.mjs";

const now = new Date("2026-11-02T18:00:00.000Z");
const peak = 1.2752066532258066;
class TestDate extends Date {
  constructor(value = now.toISOString()) { super(value); }
}
const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function load(name, scope) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const fn = source.slice(start, source.indexOf("\n}\n", start) + 2);
  return new Function(...Object.keys(scope), `${fn}\nreturn ${name};`)(...Object.values(scope));
}

function calculate({ name = "Michelob ULTRA 1", wall = "Main", tapNumber = 21, backups = 0,
  connected = 0.679, weeklyPeak = peak, onDeck = null, savedName = name, type = "Lager" } = {}) {
  const key = `${wall.toLowerCase()}-${tapNumber}-michelob-ultra-1`;
  const tap = { key, tapNumber, wall, name, brand: name, templateBrand: "MICHELOB ULTRA 1", type, plu: 6655 };
  const level = { name, fillLevelPercent: connected * 100, rawKegSize: 1984, rawKegSizeDp: 0 };
  const usage = { name: savedName, tapNumber, displayUnit: "kegs", history: weeklyPeak === null ? [] : [
    { source: "PMB", label: "10/26/2026 - 11/1/2026", value: weeklyPeak, volumeOz: weeklyPeak * 1984 },
  ] };
  const state = { onHandOverrides: { [key]: backups }, onDeckOverrides: onDeck ? { [key]: onDeck } : {} };
  const before = structuredClone({ tap, level, usage, state });
  const scope = {
    Date: TestDate,
    getKegLiveRow: () => level, getKegDisplayBrand: () => name, isPricingPlaceholder,
    getKegCurrentFraction: () => connected,
    getWeeklyUsageForKegItem: () => usage, getSixWeekUsage: () => ({}),
    isLiquorOunceTap: () => false, toNumber: Number,
    getKegOnDeckItem: () => onDeck, getKegOnHandDisplay: () => backups,
    clean: value => String(value || "").trim(), normalizeTitle: value => String(value || "").toLowerCase(),
    getTapOrderProductName, getKegSizeOverrideOz: () => 1984, STANDARD_BEER_KEG_OZ: 1984,
    getKegFullOunces: () => 1984, getEightWeekPeakUsage, buildInventoryPosition, buildStockGapRecommendation,
  };
  const browserCalculate = load("getKegNeedCalculation", scope);
  const browser = browserCalculate(tap);
  let server;
  if (weeklyPeak === null) {
    assert.throws(() => buildRawRecommendation(tap, level, [], state, {}, usage, { now }), /No recorded usage/);
  } else {
    server = buildRawRecommendation(tap, level, [], state, {}, usage, { now });
    assert.equal(browser.orderQuantity, server.orderQty, "Browser and server use the same reserve and stock");
    assert.equal(Math.round(browser.targetStock * 100) / 100, server.targetStockKegs);
  }
  assert.deepEqual({ tap, level, usage, state }, before, "Policy calculation never changes physical counts or product assignments");
  const render = load("renderKegNeedCell", {
    ...scope, getKegNeedCalculation: browserCalculate, formatNumber: String, escapeHtml: String,
    renderKegNeedValue: () => `Order ${browser?.orderQuantity}`,
  });
  return { server, browser, html: render(tap, browser?.orderQuantity) };
}

test("Main Ultra's actual saved stock needs two kegs to cover usage and one full backup", () => {
  const { server, browser, html } = calculate();
  assert.equal(server.orderQty, 2);
  assert.equal(server.currentStockKegs, 0.679);
  assert.equal(server.targetStockKegs, 2.28);
  assert.equal(browser.targetStock, peak + 1);
  assert.equal(server.reserveKegs, 1);
  assert.equal(server.variabilityCushionPct, 100);
  assert.match(server.reason, /plus 1 full unopened backup keg in Main/);
  assert.doesNotMatch(server.reason, /plus 0\.25/);
  assert.match(html, /Backup reserve/);
  assert.match(html, /1 full unopened backup keg in Main/);
});

test("counted backups reduce the order and a covered reserve does not add another keg each week", () => {
  assert.equal(calculate({ backups: 1 }).server.orderQty, 1);
  const stocked = calculate({ backups: 2 });
  assert.equal(stocked.server.orderQty, 0);
  assert.match(stocked.server.reason, /covers.*plus 1 full unopened backup keg in Main/);
  assert.equal(calculate({ backups: 2 }).server.orderQty, 0, "Repeating the calculation with the same physical counts stays at zero");
  assert.equal(calculate({ backups: 1, weeklyPeak: 0.4 }).server.orderQty, 0);
});

test("Karaoke Ultra and other Main beers keep the quarter-keg reserve", () => {
  for (const options of [{ wall: "Karaoke", tapNumber: 73 }, { name: "Busch Light 1" }]) {
    const { server, html } = calculate(options);
    assert.equal(server.orderQty, 1);
    assert.equal(server.reserveKegs, 0.25);
    assert.equal(server.variabilityCushionPct, 25);
    assert.match(server.reason, /plus 0\.25 keg/);
    assert.doesNotMatch(html, /full unopened backup/);
  }
  const karaoke = calculate({ wall: "Karaoke", tapNumber: 73, connected: 0.583, weeklyPeak: 0.26 });
  assert.equal(karaoke.server.orderQty, 0, "Current Karaoke coverage remains sufficient");
});

test("reserve follows the intended product in Main, including placeholders, rather than a historical tap key", () => {
  assert.equal(calculate({ tapNumber: 22 }).server.reserveKegs, 1);
  assert.equal(calculate({ name: "Coming Soon!", savedName: "Michelob Ultra 1" }).server.reserveKegs, 1);
  assert.equal(calculate({ name: "Coming Soon!", savedName: "Busch Light 1" }).server.reserveKegs, 0.25);
  assert.equal(calculate({ onDeck: { name: "Busch Light 1", kind: "beer", onHand: 0 } }).server.reserveKegs, 0.25);
  assert.equal(calculate({ name: "Busch Light 1", onDeck: { name: "Michelob Ultra 1", kind: "beer", onHand: 0 } }).server.reserveKegs, 1);
  assert.equal(calculate({ onDeck: { name: "Coming Soon!", kind: "beer", onHand: 0 } }).server.reserveKegs, 1);
  assert.equal(getKegReservePolicy({ kind: "cocktail", wall: "Main", productName: "Michelob Ultra" }).reserveKegs, 0.25);
});

test("the standing reserve does not fabricate usage or cap a larger shortage", () => {
  assert.equal(calculate({ weeklyPeak: null }).browser, null);
  const large = calculate({ weeklyPeak: 4, connected: 0 }).server;
  assert.equal(large.orderQty, 5);
  assert.equal(large.orderCapApplied, false);
  assert.match(large.reason, /exceeds the 2-keg review threshold/);
});
