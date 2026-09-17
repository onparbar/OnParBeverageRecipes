import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("future prep names identify Main and Karaoke without doubling suffixes", () => {
  const source = readFileSync(new URL("../lib/weekly-prep-additions.mjs", import.meta.url), "utf8");
  const start = source.indexOf("function buildPrepLookahead(");
  const end = source.indexOf("export async function addWeeklyPrepCocktail", start);
  const build = vm.runInNewContext(`${source.slice(start, end)}; buildPrepLookahead`, {
    clean: value => String(value || "").trim(),
  });
  const choices = [
    { id: "main", name: "House Cocktail", tap: { wall: "Main", currentStockKegs: 0, avgWeeklyKegs: 1 } },
    { id: "karaoke", name: "House Cocktail 2", tap: { wall: "Karaoke", currentStockKegs: 0, avgWeeklyKegs: 1 } },
  ];
  const forecast = build(choices, [], "");
  for (const week of forecast.weeks) {
    assert.deepEqual(Array.from(week.items, item => item.name), ["House Cocktail 1", "House Cocktail 2"]);
  }
});

test("order adjustments no longer offer cocktail prep while the separate adder remains", () => {
  const dashboard = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const start = dashboard.indexOf("function renderVendorOrderAdjustments()");
  const end = dashboard.indexOf("function renderAssistedOrderPanel", start);
  assert.doesNotMatch(dashboard.slice(start, end), /add-prep|data-prep-adjustment/);
  const prep = readFileSync(new URL("../public/weekly-prep-add.mjs", import.meta.url), "utf8");
  assert.match(prep, /data-prep-tap-open[^>]*>Add cocktail/);
});
