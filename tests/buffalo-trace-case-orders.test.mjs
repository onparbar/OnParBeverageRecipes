import assert from "node:assert/strict";
import test from "node:test";
import { applyPurchasePackPolicy } from "../public/purchase-pack-policy.mjs";
import { buildWeeklyActionPlan, groupWeeklyPlanOrdersByVendor, refreshWeeklyPlanMetadata } from "../public/weekly-action-plan.mjs";
import { buildVendorOrderDrafts } from "../public/vendor-order-drafts.mjs";
import { renderWeeklyPlanLiquorRefillRows } from "../public/weekly-plan-view.mjs";

const product = { id: "buffalo-trace", name: "Buffalo Trace", vendor: "OHLQ", vendorSku: "1499L", vendorProductName: "Buffalo Trace Bourbon 1L", unitCost: 34.78, hasKnownPrice: true };
const options = { sourceDate: "2026-10-12T18:00:00.000Z", generatedAt: "2026-10-12T18:00:00.000Z", now: new Date("2026-10-12T18:00:00.000Z") };
const recommendation = { ...product, internalId: product.id, actionType: "order", isLiquorTap: true, tapNumber: 15, wall: "Main", orderQty: 3 };

test("Buffalo Trace purchases round upward in cases of 12 without inventing a zero-demand order", () => {
  for (const [needed, expected] of [[0,0],[1,12],[3,12],[12,12],[13,24],[25,36]]) {
    const result = applyPurchasePackPolicy({ ...product, quantity: needed });
    assert.equal(result.quantity, expected);
    assert.equal(result.caseCount, expected / 12);
    assert.equal(result.packSize, 12);
    assert.equal(result.estimatedCost, Math.round(expected * 34.78 * 100) / 100);
  }
  const other = { name: "Bulleit Bourbon", quantity: 3 };
  assert.equal(applyPurchasePackPolicy(other), other);
});

test("a three-bottle refill creates a twelve-bottle supplier order while prep stays three", () => {
  const plan = buildWeeklyActionPlan({ recommendations: [recommendation] });
  assert.equal(plan.orders.liquorTapBottles[0].quantity, 3);
  assert.match(renderWeeklyPlanLiquorRefillRows(plan.orders.liquorTapBottles), /3 bottles to add/);
  const line = groupWeeklyPlanOrdersByVendor(plan)[0].items[0];
  assert.equal(line.quantity, 12);
  assert.equal(line.caseCount, 1);
  assert.equal(plan.summary.liquorTapBottleTotal, 12);
  assert.equal(plan.summary.estimatedKnownPurchaseCost, 417.36);
  const draft = buildVendorOrderDrafts(plan, options).drafts[0];
  assert.equal(draft.lines[0].requestedUnits, 12);
  assert.equal(draft.lines[0].requestedCases, 1);
  assert.equal(draft.lines[0].extendedCost, 417.36);
  assert.deepEqual(draft.lines[0].blockers, []);
});

test("combine tap refill needs before rounding and respect zero demand", () => {
  const plan = buildWeeklyActionPlan({ recommendations: [recommendation, { ...recommendation, tapNumber: 88, wall: "Patio", orderQty: 3 }] });
  assert.equal(groupWeeklyPlanOrdersByVendor(plan)[0].items[0].quantity, 12);
  assert.equal(plan.orders.liquorTapBottles[0].quantity, 6);
  assert.deepEqual(buildVendorOrderDrafts(buildWeeklyActionPlan({ recommendations: [{ ...recommendation, orderQty: 0 }] }), options).drafts, []);
});

test("cabinet shortages and old saved tap plans use the same supplier pack and corrected price", () => {
  const inventoryPlan = buildWeeklyActionPlan({ inventoryItems: [{ ...product, group: "Liquor Cabinet", onHand: 0, par: 3, orderUnits: 3, estimatedCost: 104.34 }] });
  assert.equal(inventoryPlan.orders.liquor[0].quantity, 12);
  assert.equal(inventoryPlan.summary.estimatedKnownPurchaseCost, 417.36);
  const legacy = { orders: { beerKegs: [], liquorTapBottles: [{ ...product, quantity: 3, estimatedCost: 104.34 }], liquor: [], mixers: [], supplies: [] }, prep: { cocktails: [] }, review: { excludedInventory: [] }, summary: { estimatedKnownPurchaseCost: 104.34, liquorTapBottleTotal: 3 } };
  const refreshed = refreshWeeklyPlanMetadata(legacy);
  assert.equal(refreshed.summary.estimatedKnownPurchaseCost, 417.36);
  assert.equal(refreshed.summary.liquorTapBottleTotal, 12);
  assert.equal(buildVendorOrderDrafts(legacy, options).drafts[0].lines[0].requestedUnits, 12);
  assert.equal(legacy.orders.liquorTapBottles[0].quantity, 3);
});

test("old bottle-based manual adjustments cannot bypass the case rule but removal still works", () => {
  const plan = buildWeeklyActionPlan({ recommendations: [recommendation] });
  const manualCatalog = [{ ...product, catalogId: "buffalo", lineType: "Liquor tap bottle", casePackaged: false, packSize: 1 }];
  const adjusted = buildVendorOrderDrafts(plan, { ...options, manualCatalog, manualAdjustments: [{ catalogId: "buffalo", quantity: 5, reason: "Extra bottles" }] });
  assert.equal(adjusted.drafts[0].lines[0].requestedUnits, 12);
  assert.equal(adjusted.drafts[0].lines[0].extendedCost, 417.36);
  assert.deepEqual(buildVendorOrderDrafts(plan, { ...options, manualCatalog, manualAdjustments: [{ catalogId: "buffalo", quantity: 0, reason: "Already received" }] }).drafts, []);
});
