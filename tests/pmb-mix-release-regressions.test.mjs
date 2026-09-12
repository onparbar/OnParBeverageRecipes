import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildLastWeekProjectedSalesMix } from "../public/dashboard-beverage-pulse.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const rows = [
  { id: "beer", name: "Beer", tapNumber: 21, type: "Beer", history: [{ label: "8/31/26 - 9/6/26", source: "PMB", volumeOz: 100, hasValue: true }] },
  { id: "cocktail", name: "Cocktail", tapNumber: 47, type: "Cocktail", history: [{ label: "8/31/26 - 9/6/26", source: "PMB", volumeOz: 50, hasValue: true }] },
  { id: "liquor", name: "Liquor", tapNumber: 1, type: "Shots", history: [{ label: "8/31/26 - 9/6/26", source: "PMB", volumeOz: 50, hasValue: true }] },
];

test("volume mix requires no pricing and wall mix ignores the selected wall", () => {
  const main = buildLastWeekProjectedSalesMix(rows, { wall: "main", metric: "volume" });
  const patio = buildLastWeekProjectedSalesMix(rows, { wall: "patio", metric: "volume" });
  assert.equal(main.available, true);
  assert.equal(main.unpricedTapCount, 0);
  assert.equal(main.categories.find((row) => row.category === "beer").sharePercent, 67);
  assert.deepEqual(main.walls, patio.walls);
  assert.deepEqual(main.walls.map((row) => row.sharePercent), [75, 0, 25]);
});

test("profit mix accepts and counts estimated rates", () => {
  const mix = buildLastWeekProjectedSalesMix(rows, {
    wall: "main", metric: "profit",
    getGrossProfitPerOz: (row) => ({ grossProfitPerOz: row.id === "beer" ? 1 : 4, estimated: true }),
  });
  assert.equal(mix.available, true);
  assert.equal(mix.projectedProfit, 300);
  assert.equal(mix.estimatedTapCount, 2);
  assert.equal(mix.categories.find((row) => row.category === "cocktail").sharePercent, 67);
});

test("scheduled repair is background-only without dashboard polling or notices", () => {
  assert.doesNotMatch(source, /refreshPmbMorningRepairStatus|pmb-morning-repair-status/);
  const runtime = readFileSync(new URL("../lib/pmb-morning-repair-runtime.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(runtime, /recordDashboardActivity/);
  assert.match(runtime, /startPmbMorningRepairScheduler/);
});

test("stale and failed PMB pricing checks disable portion writes", () => {
  assert.match(source, /const stalePricing = result\.stale === true \|\| result\.degraded === true/);
  assert.match(source, /code: "PMB_PRICING_STALE"/);
  assert.match(source, /code: "PMB_PRICING_REFRESH_FAILED"/);
  assert.match(source, /succeeded = !stalePricing/);
});
