import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLastWeekPourLeaders,
  buildLastWeekProjectedSalesMix,
} from "../public/dashboard-beverage-pulse.mjs";

const latestLabel = "8/3/26 - 8/9/26";
const priorLabel = "7/27/26 - 8/2/26";

function pmb(label, volumeOz) {
  return { label, source: "PMB", volumeOz, value: volumeOz, hasValue: true };
}

function item({
  id,
  name = id,
  tapNumber,
  type = "Beer",
  displayUnit = "kegs",
  history = [],
}) {
  return { id, name, tapNumber, type, displayUnit, history };
}

test("projects last-week category sales from exact pours and verified per-ounce prices", () => {
  const items = [
    item({ id: "beer", tapNumber: 73, history: [pmb(latestLabel, 100), pmb(priorLabel, 900)] }),
    item({ id: "cocktail", tapNumber: 93, type: "Cocktail", history: [pmb(latestLabel, 50), pmb(priorLabel, 800)] }),
    item({ id: "liquor", tapNumber: 83, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 10), pmb(priorLabel, 700)] }),
  ];
  const rates = { beer: 2, cocktail: 4, liquor: 10 };

  const mix = buildLastWeekProjectedSalesMix(items, {
    wall: "karaoke",
    getSellingPricePerOz: (source) => rates[source.id],
  });

  assert.equal(mix.available, true);
  assert.equal(mix.weekLabel, latestLabel);
  assert.equal(mix.projectedSales, 500);
  assert.equal(mix.capturedTapCount, 3);
  assert.equal(mix.pricedTapCount, 3);
  assert.deepEqual(
    mix.categories.map((row) => [row.category, row.projectedSales, row.sharePercent]),
    [
      ["cocktail", 200, 40],
      ["beer", 200, 40],
      ["liquor", 100, 20],
    ],
  );
});

test("keeps beer and cocktails on the selected wall while including venue liquor", () => {
  const items = [
    item({ id: "main-beer", tapNumber: 21, history: [pmb(latestLabel, 100)] }),
    item({ id: "main-cocktail", tapNumber: 47, type: "Cocktail", history: [pmb(latestLabel, 50)] }),
    item({ id: "karaoke-liquor", tapNumber: 83, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 90)] }),
  ];

  const mix = buildLastWeekProjectedSalesMix(items, {
    wall: "main",
    getSellingPricePerOz: (source) => source.id === "main-beer" ? 2 : null,
  });

  assert.equal(mix.projectedSales, 200);
  assert.equal(mix.capturedTapCount, 3);
  assert.equal(mix.pricedTapCount, 1);
  assert.equal(mix.unpricedTapCount, 2);
  assert.deepEqual(
    mix.categories.map((row) => [row.category, row.sharePercent]),
    [["cocktail", 0], ["beer", 100], ["liquor", 0]],
  );
});

test("includes Patio and Karaoke liquor in a Main projected sales mix", () => {
  const mix = buildLastWeekProjectedSalesMix([
    item({ id: "main-beer", tapNumber: 21, history: [pmb(latestLabel, 100)] }),
    item({ id: "patio-liquor", tapNumber: 1, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 20)] }),
    item({ id: "karaoke-liquor", tapNumber: 83, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 30)] }),
  ], {
    wall: "main",
    getSellingPricePerOz: (source) => source.id === "main-beer" ? 2 : 5,
  });

  assert.deepEqual(
    mix.categories.map((row) => [row.category, row.projectedSales, row.sharePercent]),
    [
      ["cocktail", 0, 0],
      ["beer", 200, 44],
      ["liquor", 250, 56],
    ],
  );
});

test("returns an honest unavailable state when last-week pours have no current prices", () => {
  const mix = buildLastWeekProjectedSalesMix([
    item({ id: "beer", tapNumber: 21, history: [pmb(latestLabel, 100)] }),
  ], {
    wall: "main",
    getSellingPricePerOz: () => ({ sellingPricePerOz: null }),
  });

  assert.equal(mix.available, false);
  assert.equal(mix.weekLabel, latestLabel);
  assert.equal(mix.projectedSales, 0);
  assert.equal(mix.unpricedTapCount, 1);
  assert.equal(mix.categories.reduce((total, row) => total + row.sharePercent, 0), 0);
});

test("uses authoritative tap ranges when PMB type labels are not category names", () => {
  const mix = buildLastWeekProjectedSalesMix([
    item({ id: "seasonal-beer", tapNumber: 21, type: "Seasonal", history: [pmb(latestLabel, 100)] }),
    item({ id: "house-cocktail", tapNumber: 47, type: "House Batch", history: [pmb(latestLabel, 50)] }),
  ], {
    wall: "main",
    getSellingPricePerOz: () => 2,
  });

  assert.equal(mix.available, true);
  assert.equal(mix.projectedSales, 300);
  assert.deepEqual(
    mix.categories.map((row) => [row.category, row.projectedSales]),
    [["cocktail", 100], ["beer", 200], ["liquor", 0]],
  );
});

test("keeps beer and cocktail leaders on the selected wall while combining Patio and Karaoke liquor", () => {
  const leaders = buildLastWeekPourLeaders([
    item({ id: "main-beer", name: "Main Beer", tapNumber: 21, history: [pmb(latestLabel, 120)] }),
    item({ id: "karaoke-beer", name: "Karaoke Beer", tapNumber: 73, history: [pmb(latestLabel, 900)] }),
    item({ id: "main-cocktail", name: "Main Cocktail 1", tapNumber: 47, type: "Cocktail", history: [pmb(latestLabel, 80)] }),
    item({ id: "patio-patron", name: "Patron 3", tapNumber: 1, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 40)] }),
    item({ id: "karaoke-patron", name: "Patron 2", tapNumber: 83, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 60)] }),
  ], { wall: "main", metric: "oz" });

  assert.deepEqual(leaders.sections.beer.rows.map((row) => row.name), ["Main Beer"]);
  assert.deepEqual(leaders.sections.cocktail.rows.map((row) => row.name), ["Main Cocktail"]);
  assert.deepEqual(
    leaders.sections.liquor.rows.map((row) => [row.name, row.value, row.tapCount, row.walls]),
    [["Patron", 100, 2, ["patio", "karaoke"]]],
  );
});

test("switches leader order from poured ounces to projected sales", () => {
  const items = [
    item({ id: "volume", name: "Volume Beer", tapNumber: 21, history: [pmb(latestLabel, 100)] }),
    item({ id: "value", name: "Value Beer", tapNumber: 22, history: [pmb(latestLabel, 60)] }),
  ];
  const rates = { volume: 1, value: 3 };

  const volumeLeaders = buildLastWeekPourLeaders(items, { wall: "main", metric: "oz" });
  const salesLeaders = buildLastWeekPourLeaders(items, {
    wall: "main",
    metric: "sales",
    getSellingPricePerOz: (source) => rates[source.id],
  });

  assert.deepEqual(volumeLeaders.sections.beer.rows.map((row) => row.name), ["Volume Beer", "Value Beer"]);
  assert.deepEqual(
    salesLeaders.sections.beer.rows.map((row) => [row.name, row.value]),
    [["Value Beer", 180], ["Volume Beer", 100]],
  );
});

test("sales leaders exclude only taps without a current verified price", () => {
  const leaders = buildLastWeekPourLeaders([
    item({ id: "priced", name: "Priced Liquor", tapNumber: 1, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 20)] }),
    item({ id: "unpriced", name: "Unpriced Liquor", tapNumber: 83, type: "Shots", displayUnit: "oz", history: [pmb(latestLabel, 100)] }),
  ], {
    wall: "main",
    metric: "sales",
    getSellingPricePerOz: (source) => source.id === "priced" ? 5 : null,
  });

  assert.deepEqual(leaders.sections.liquor.rows.map((row) => [row.name, row.value]), [["Priced Liquor", 100]]);
  assert.equal(leaders.sections.liquor.capturedTapCount, 2);
  assert.equal(leaders.sections.liquor.pricedTapCount, 1);
  assert.equal(leaders.sections.liquor.unpricedTapCount, 1);
});
