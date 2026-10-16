import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildRollingCocktailIngredientOrders } from "../public/rolling-cocktail-ingredients.mjs";
import { buildVendorCartRequest } from "../public/vendor-cart-bridge.mjs";

const bottleOz = 59.1745;
const bacardi = { id: "bacardi", name: "Bacardi", group: "Liquor Cabinet", bottleOz, onHand: 4, hasCurrentCount: true };
const sunset = { title: "Bacardi Sunset", ingredients: [{ name: "Bacardi Superior", raw: "Bacardi Superior = 6 bottles (1.75L)", oz: 355.05 }] };
const tap = { tapNumber: 48, name: "Bacardi Sunset 1", currentStockKegs: 0.33, avgWeeklyKegs: 0.098, preThursdayUsageSharePct: 0 };

test("Bacardi Sunset reserves six bottles and orders the two missing from Monday's four", () => {
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [bacardi], recipes: [sunset], tapInputs: [tap] });
  assert.equal(result.cocktailPrepRequiredBottles, 6);
  assert.equal(result.orderUnits, 2);
  assert.equal(result.orderHoldReason, "");
});

test("Bacardi flavors remain distinct from Superior", () => {
  const flavored = { ...bacardi, id: "bacardi-limon", name: "Bacardi Limon" };
  const [result, other] = buildRollingCocktailIngredientOrders({ inventoryItems: [bacardi, flavored], recipes: [sunset], tapInputs: [tap] });
  assert.equal(result.orderUnits, 2);
  assert.equal(other.cocktailPrepRequiredBottles, 0);
});

test("rounded recipe ounces do not turn six plus ten Jack Daniel's bottles into seventeen", () => {
  const recipes = [
    { title: "Jacked Up Strawberry Lemonade", ingredients: [{ name: "Jack Daniels", raw: "Jack Daniels=6 bottles (1.75L)", oz: 355 }] },
    { title: "Whiskey Sour", ingredients: [{ name: "Jack Daniels", raw: "Jack Daniels=10 bottles (1.75L bts)", oz: 592 }] },
  ];
  const [result] = buildRollingCocktailIngredientOrders({
    inventoryItems: [{ ...bacardi, id: "jack-daniel-s", name: "Jack Daniel's", onHand: 10 }], recipes,
    tapInputs: recipes.map((r, index) => ({ ...tap, tapNumber: index ? 72 : 68, name: r.title, currentStockKegs: 0.1 })),
  });
  assert.equal(result.cocktailPrepRequiredBottles, 16);
  assert.equal(result.orderUnits, 6);
});

test("bottle quantities with a different purchased size still convert by volume", () => {
  const [result] = buildRollingCocktailIngredientOrders({ inventoryItems: [{ ...bacardi, bottleOz: 25.3605, onHand: 0 }], recipes: [sunset], tapInputs: [tap] });
  assert.equal(result.cocktailPrepRequiredBottles, 14);
});

function orderView(lines) {
  return { order: { id: "ohlq:2026-10-12", vendorKey: "ohlq", actionsEnabled: true, expectedTotal: 423, lineCount: lines.length, lines } };
}
const jackLines = [
  { internalItemId: "jack-daniel-s", name: "Jack Daniel's Old No. 7 1.75L", vendorSku: "0066D", packSize: "1", requestedUnits: 7, requestedCases: null },
  { internalItemId: "karaoke-89-jack-daniel-s-whiskey-2", name: "Jack Daniel's Old No. 7 1.75L", vendorSku: "0066D", packSize: "1", requestedUnits: 2, requestedCases: null },
];

test("OHLQ combines cocktail and tap demand without changing saved receiving lines", () => {
  const view = orderView(structuredClone(jackLines));
  const original = structuredClone(view);
  const request = buildVendorCartRequest(view);
  assert.equal(request.lines.length, 1);
  assert.equal(request.lineCount, 1);
  assert.equal(request.lines[0].requestedUnits, 9);
  assert.equal(request.expectedTotal, 423);
  assert.deepEqual(view, original);
});

test("OHLQ combines cases and bottles in purchased units, but never different SKUs", () => {
  const request = buildVendorCartRequest(orderView([
    { ...jackLines[0], vendorSku: "1499L", packSize: 12, requestedUnits: 12, requestedCases: 1 },
    { ...jackLines[1], vendorSku: "1499L", packSize: "12", requestedUnits: 3 },
    { ...jackLines[0], vendorSku: "4982D" },
  ]));
  assert.equal(request.lines.length, 2);
  assert.equal(request.lines[0].requestedUnits, 15);
  assert.equal(request.lines[0].requestedCases, null);
  assert.equal(request.lines[1].requestedUnits, 7);
});

test("inconsistent duplicate OHLQ packaging stops the handoff", () => {
  assert.throws(() => buildVendorCartRequest(orderView([jackLines[0], { ...jackLines[1], packSize: 6 }])), /pack size/i);
});

test("the real OHLQ catalog worker stages nine bottles once instead of overwriting seven with two", async () => {
  const request = buildVendorCartRequest(orderView(jackLines));
  const bridge = await readFile(new URL("../chrome-extension/bees-cart-builder/dashboard-bridge.js", import.meta.url), "utf8");
  const validation = { SUPPORTED_VENDORS: new Set(["ohlq"]) };
  runInNewContext(bridge.slice(bridge.indexOf("function clean("), bridge.indexOf("window.addEventListener(")), validation);
  const state = { ...validation.validateOrder(request), phase: "ohlq-filtered", status: "working", results: [] };
  const control = { value: 0 };
  const writes = [];
  let cartQuantity = 0;
  const context = {
    OHLQ_CATALOG_PATH: "/Previously-Purchased", location: { pathname: "/Previously-Purchased" },
    waitForOhlqCatalog: async () => true,
    exactOhlqRows: () => [{ row: { innerText: "Jack Daniel's Old No. 7 1.75L" }, quantity: control }],
    setQuantity: (input, quantity) => { input.value = quantity; writes.push(quantity); return true; },
    buttonWithExactLabel: () => ({ click: () => { cartQuantity = control.value; } }),
    cartLinkSnapshot: () => "empty", saveState: async () => {},
    waitForAddConfirmation: async () => true, finishOhlqStaged: async () => {},
  };
  const worker = await readFile(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8");
  runInNewContext(worker.slice(worker.indexOf("async function runOhlqCatalog("), worker.indexOf("async function addExactMatch(")), context);
  await context.runOhlqCatalog(state);
  assert.equal(cartQuantity, 9);
  assert.deepEqual(writes, [9]);
});
