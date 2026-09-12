import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { waitForPmbTapReadiness } from "../public/pmb-repair-monitor.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function load(name, scope) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.indexOf("\n}\n", start) + 2;
  return vm.runInNewContext(`(${source.slice(start, end)})`, scope);
}

test("connection verification keeps retrying past ten minutes without another repair", async () => {
  const start = Date.parse("2026-09-12T04:00:00Z");
  let time = start;
  let calls = 0;
  const expectedTapNumbers = Array.from({ length: 102 }, (_, i) => i + 1);
  const result = await waitForPmbTapReadiness({
    expectedTapNumbers, sentAt: new Date(start).toISOString(), now: () => time,
    wait: async (ms) => { time += ms; },
    readLevels: async (timeout) => {
      assert.ok(timeout > 0 && timeout <= 90000);
      calls++;
      if (time - start < 12 * 60000) throw new Error("PMB still reconnecting");
      return { stale: false, partial: false, degraded: false, updatedAt: new Date(time).toISOString(), expectedCount: 102, capturedCount: 102,
        items: expectedTapNumbers.map((tapNumber) => ({ tapNumber, levelAvailable: true, fillLevelPercent: 50 })) };
    },
  });
  assert.equal(result.ready, true);
  assert.ok(time - start > 12 * 60000);
  assert.ok(calls > 2);
});

test("saved or partial readings cannot confirm a repaired connection", async () => {
  let time = Date.parse("2026-09-12T04:00:00Z");
  const sentAt = new Date(time).toISOString();
  const expectedTapNumbers = Array.from({ length: 102 }, (_, i) => i + 1);
  await assert.rejects(waitForPmbTapReadiness({
    expectedTapNumbers, sentAt, now: () => time, wait: async (ms) => { time += ms; }, maxWaitMs: 120000,
    readLevels: async () => ({ stale: true, partial: true, updatedAt: new Date(time).toISOString(), expectedCount: 102, capturedCount: 101, items: [] }),
  }), /connection-check window ended/);
});

test("all taps render in one numerically sorted list without wall headers or duplicate count", () => {
  const walls = { innerHTML: "", dataset: {}, querySelectorAll: () => [], querySelector: () => null };
  const calls = [];
  const kegWallItems = Array.from({ length: 102 }, (_, i) => ({ tapNumber: 102 - i, wall: i % 2 ? "Main" : "Patio" }));
  const render = load("renderKegLevels", {
    dashboardRenderCoordinator: { defer: () => false }, kegSummary: { innerHTML: "" }, kegWalls: walls,
    kegWallItems, getKegLiveRow: () => ({ levelAvailable: true, fillLevelPercent: 50 }),
    getWallCocktailRecipeCoverage: () => ({ missing: [] }), kegSyncLoading: false, kegConfigUpdateRunning: false,
    kegRepairStatus: null, kegSyncAttempted: true, kegLiveLevelsStale: false, kegLiveLevelsError: "", pmbMorningRepairMessage: "",
    formatNumber: String, escapeHtml: String, renderParAgentPanel: () => "", activeKegWallFilter: "all", toNumber: Number,
    renderKegWallBlock: (name, items, options) => { calls.push({ name, items, options }); return "tap-table"; },
    getVisibleComingSoonItems: () => [], comingSoonItems: [], renderComingSoonBlock: () => "",
    renderInventorySpeechAssistant: () => {}, bindKegLevelEvents: () => {},
  });
  render();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.hideHeader, true);
  assert.deepEqual(Array.from(calls[0].items, (item) => item.tapNumber), Array.from({ length: 102 }, (_, i) => i + 1));
  assert.match(walls.innerHTML, /102 Taps/);
  assert.doesNotMatch(walls.innerHTML, /All Tap|keg-wall-filter__count/);
});

test("ingredient editor fills known packages without replacing complete saved prices", () => {
  const overrides = { "vanilla-syrup": { bottleOz: "25", bottlePrice: "" } };
  const getValues = load("getIngredientPriceEditorValues", { priceOverrides: overrides, toNumber: Number });
  const cold = getValues({ id: "cold-brew-concentrate" });
  assert.equal(cold.bottleOz, "32");
  assert.equal(Number(cold.bottlePrice), 25.835 / 2);
  assert.equal(getValues({ id: "vanilla-syrup" }).bottlePrice, "13.12");
  overrides["vanilla-syrup"] = { bottleOz: "25", bottlePrice: "15.50", updatedAt: "saved" };
  assert.equal(getValues({ id: "vanilla-syrup" }), overrides["vanilla-syrup"]);
});
