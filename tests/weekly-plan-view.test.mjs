import assert from "node:assert/strict";
import test from "node:test";

import {
  getWeeklyPlanTapContext,
  renderWeeklyPlanCocktailRows,
  renderWeeklyPlanGroup,
  renderWeeklyPlanInventoryRows,
  renderWeeklyPlanLiquorRefillRows,
  renderWeeklyPlanLiquorTapRows,
  renderWeeklyPlanTapRows,
} from "../public/weekly-plan-view.mjs";

test("formats full and compact tap context without changing inventory units", () => {
  const item = {
    tapNumbers: [21, 75],
    walls: ["Main", "Karaoke"],
    currentStockKegs: 1.25,
    avgWeeklyKegs: 0.75,
    currentStockOunces: 240,
    avgWeeklyOunces: 90,
  };
  assert.equal(getWeeklyPlanTapContext(item, "kegs"), "Taps 21, 75 · Main, Karaoke · 1.25 kegs in stock · 0.75 avg/week");
  assert.equal(getWeeklyPlanTapContext(item, "oz"), "Taps 21, 75 · Main, Karaoke · 240 oz current · 90 oz avg/week");
  assert.equal(getWeeklyPlanTapContext(item, "kegs", { compact: true }), "Taps 21, 75 · Main, Karaoke");
});

test("renders inventory rows with case math, vendor, stock, cost, and safe product text", () => {
  const html = renderWeeklyPlanInventoryRows([{
    name: "Lime <Juice>",
    vendor: "Proof",
    onHand: 4,
    par: 12,
    estimatedCost: 35.5,
    casePackaged: true,
    caseCount: 2,
    quantity: 12,
  }]);
  assert.match(html, /Lime &lt;Juice&gt;/);
  assert.match(html, /Proof · 4 on hand · \$35\.50 estimated/);
  assert.doesNotMatch(html, /12 par/);
  assert.match(html, /2 cases · 12 units/);
});

test("renders canonical beer and refill actions while preserving tap assignments", () => {
  const beer = renderWeeklyPlanTapRows([{
    name: "Miller Lite 1",
    displayName: "Miller Lite",
    quantity: 2,
    tapNumbers: [22],
    walls: ["Main"],
  }], { action: "Order" });
  assert.match(beer, /<strong>Miller Lite<\/strong>/);
  assert.match(beer, /Tap 22 · Main/);
  assert.match(beer, /Order 2 kegs/);

  const refill = renderWeeklyPlanTapRows([{
    name: "Tito's Vodka 3",
    displayName: "Tito's Vodka",
    quantity: 1,
    tapNumbers: [13],
    walls: ["Patio"],
  }], { action: "Add", unit: "refills" });
  assert.match(refill, /Add 1 refill/);
});

test("sorts cocktail labels by tap and applies wall-specific display naming", () => {
  const html = renderWeeklyPlanCocktailRows([
    { name: "Blue Dot (Svedka) 2", displayName: "Blue Dot (Svedka)", quantity: 1, tapNumbers: [88], walls: ["Karaoke"], batchSizeOz: 1456 },
    { name: "Apple Jack 1", displayName: "Apple Jack", quantity: 2, quantityLabel: "2 labels", tapNumbers: [55], walls: ["Main"], batchSizeOz: 1456 },
  ]);
  assert.ok(html.indexOf("Apple Jack") < html.indexOf("Blue Dot"));
  assert.match(html, /Tap 55.*1,456 oz/);
  assert.match(html, /2 labels/);
  assert.match(html, /data-prep-subtract="cocktail:apple%20jack%201"/);
  assert.match(html, /aria-describedby="prep-subtract-status-1"/);
  assert.match(html, /data-prep-subtract-status role="status" aria-live="polite"/);
});

test("completed cocktail prep explains how to change quantity without rendering an unusable remove control", () => {
  const html = renderWeeklyPlanCocktailRows([{
    name: "House Margarita 1",
    displayName: "House Margarita",
    quantity: 1,
    tapNumbers: [47],
    walls: ["Main"],
    batchSizeOz: 1456,
    completionItem: { id: "cocktail:house%20margarita%201", completed: true, actualQuantity: 1 },
  }]);
  assert.doesNotMatch(html, /data-prep-subtract=/);
  assert.match(html, /Reopen completed prep before removing it\./);
});

test("an unlocked cocktail preview omits controls that require a saved Weekly Plan", () => {
  const html = renderWeeklyPlanCocktailRows([{
    name: "House Margarita 1",
    displayName: "House Margarita",
    quantity: 1,
    tapNumbers: [47],
    walls: ["Main"],
    batchSizeOz: 1456,
  }], { editable: false });
  assert.match(html, /House Margarita/);
  assert.doesNotMatch(html, /data-prep-tap-adder|data-prep-subtract=/);
});

test("renders liquor orders and staff refill instructions as separate concepts", () => {
  const orders = renderWeeklyPlanLiquorTapRows([{
    name: "Patron Silver",
    quantity: 2,
    tapNumbers: [12],
    walls: ["Patio"],
    vendor: "OHLQ",
    hasKnownPrice: false,
  }]);
  assert.match(orders, /Order 2 bottles/);
  assert.match(orders, /OHLQ · Price needed/);

  const refills = renderWeeklyPlanLiquorRefillRows([{
    name: "Patron Silver 3",
    displayName: "Patron Silver",
    quantity: 3,
    tapNumbers: [12, 90],
  }]);
  assert.match(refills, /Taps 12, 90/);
  assert.match(refills, /3 bottles/);
});

test("renders a reusable accented Weekly Plan group shell", () => {
  const html = renderWeeklyPlanGroup("Proof <Order>", 3, "<p>Lines</p>", "warning");
  assert.match(html, /weekly-plan-group--warning/);
  assert.match(html, /Proof &lt;Order&gt;/);
  assert.match(html, /<strong>3<\/strong>/);
  assert.match(html, /<p>Lines<\/p>/);
});
