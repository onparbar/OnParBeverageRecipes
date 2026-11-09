import assert from "node:assert/strict";
import test from "node:test";
import { buildRollingCocktailIngredientOrders, netRollingLiquorTapRecommendations } from "../public/rolling-cocktail-ingredients.mjs";
import { buildWeeklyActionPlan, groupWeeklyPlanOrdersByVendor } from "../public/weekly-action-plan.mjs";
import { buildStaffPrepPlan } from "../lib/staff-prep-plan.mjs";

const generatedAt = "2026-11-09T19:07:30.456Z";
const products = [
  { id: "buffalo-trace", name: "Buffalo Trace", tapName: "Buffalo Trace Bourbon 3", tapNumber: 15, onHand: 9, bottleOz: 33.814, bottles: 3, sku: "1499L" },
  { id: "tito-s", name: "Tito's", tapName: "Tito's Vodka 3", tapNumber: 13, onHand: 18, bottles: 2, sku: "9232D" },
  { id: "jose-cuervo-silver", name: "Jose Cuervo Silver", tapName: "Jose Cuervo Silver Tequila 3", tapNumber: 5, onHand: 18, bottles: 2, sku: "5247D" },
  { id: "patron-silver", name: "Patron Silver", tapName: "Patron Silver Tequila 3", tapNumber: 12, onHand: 2, bottles: 2, sku: "6910D" },
  { id: "crown-apple", name: "Crown Apple", tapName: "Crown Royal Apple Whiskey 3", tapNumber: 16, onHand: 8, bottles: 2, sku: "2383D" },
  { id: "jack-daniel-s", name: "Jack Daniel's", tapName: "Jack Daniel's Whiskey 3", tapNumber: 19, onHand: 2, bottles: 2, sku: "4800D" },
];
const inventory = products.map(p => ({ ...p, group: "Liquor Cabinet", hasCurrentCount: true,
  bottleOz: p.bottleOz || 59.1745, vendor: "OHLQ", vendorSku: p.sku, unitCost: 34.78,
  packSize: p.id === "buffalo-trace" ? 12 : 1, casePackaged: p.id === "buffalo-trace" }));
const refills = products.map(p => ({ key: `patio-${p.tapNumber}`, name: p.tapName, orderProductName: p.tapName,
  isLiquorTap: true, actionType: "order", tapNumber: p.tapNumber, wall: "Patio", orderQty: p.bottles,
  bottleOz: p.bottleOz || 59.1745, vendor: "OHLQ", vendorSku: p.sku, unitCost: 34.78 }));
const rolling = () => buildRollingCocktailIngredientOrders({ inventoryItems: inventory, cocktails: [] });

test("known spirit suffixes match the exact counted cabinet expressions after protecting reserves", () => {
  const before = structuredClone({ inventory, refills });
  const result = netRollingLiquorTapRecommendations(refills, rolling());
  assert.deepEqual(result.map(r => [r.cabinetInventoryId, r.cabinetUsedQty, r.orderQty]), products.map(p => [p.id, p.bottles, 0]));
  assert.deepEqual({ inventory, refills }, before);
});

test("nine Buffalo Trace bottles cover the three-bottle refill without creating a twelve-bottle case", () => {
  const [netted] = netRollingLiquorTapRecommendations([refills[0]], rolling());
  const plan = buildWeeklyActionPlan({ recommendations: [netted] });
  assert.deepEqual(groupWeeklyPlanOrdersByVendor(plan), []);
  assert.equal(plan.prep.liquorRefills[0].quantity, 3);
  assert.equal(plan.prep.liquorRefills[0].inventoryItemId, "buffalo-trace");
  const task = buildStaffPrepPlan({ generatedAt, items: [netted] }).liquorRefills[0];
  assert.equal(task.quantity, 3);
  assert.equal(task.inventoryItemId, "buffalo-trace");
  assert.equal(task.completed, false);
  assert.equal(inventory[0].onHand, 9);
});

test("cabinet availability is allocated once and only the remaining shortage rounds up to a case", () => {
  const cabinet = rolling().map(item => item.id === "buffalo-trace" ? { ...item, onHand: 3 } : item);
  const results = netRollingLiquorTapRecommendations([refills[0], { ...refills[0], key: "other-tap", tapNumber: 92 }], cabinet);
  assert.deepEqual(results.map(r => [r.cabinetUsedQty, r.orderQty]), [[3, 0], [0, 3]]);
  assert.equal(groupWeeklyPlanOrdersByVendor(buildWeeklyActionPlan({ recommendations: results }))[0].items[0].quantity, 12);
});

test("matching stays bounded to the named product and refuses ambiguous rows", () => {
  for (const name of ["Buffalo Trace Single Barrel Bourbon 3", "Jack Daniel's Fire Whiskey 3", "Jose Cuervo Gold Tequila 3", "Patron Reposado Tequila 3", "Crown Royal Black Whiskey 3", "Tito's Lemon Vodka 3"]) {
    const input = { ...refills[0], name, orderProductName: name };
    assert.deepEqual(netRollingLiquorTapRecommendations([input], rolling()), [input]);
  }
  const duplicate = [...rolling(), { ...rolling()[0], id: "other-buffalo", name: "Buffalo Trace Bourbon" }];
  assert.deepEqual(netRollingLiquorTapRecommendations([refills[0]], duplicate), [refills[0]]);
});
