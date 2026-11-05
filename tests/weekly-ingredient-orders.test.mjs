import assert from "node:assert/strict";
import test from "node:test";
import { refreshWeeklyIngredientOrders } from "../public/weekly-ingredient-orders.mjs";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";
import { buildUnifiedVendorOrderModel } from "../public/vendor-order-drafts.mjs";
import { applyWeeklyOrderTrackingUpdate, buildWeeklyOrderTracking } from "../lib/weekly-order-tracking.mjs";
import { legacyWeeklyOrderItemId } from "../public/weekly-order-item-identity.mjs";

const generatedAt = "2026-11-02T16:57:00.000Z";
const now = () => new Date("2026-11-04T15:00:00.000Z");
const citron = { id: "absolut-citron", name: "Absolut Citron", group: "Liquor Cabinet", vendor: "OHLQ",
  vendorSku: "citron", vendorProductName: "Absolut Citron 1.75L", bottleOz: 59.1745,
  onHand: 0, hasCurrentCount: true, unitCost: 25, hasKnownPrice: true, packSize: 1, orderUnits: 0 };
const recipe = { title: "Lemon Drop", ingredients: [{ name: "Absolut Citron", raw: "Absolut Citron = 14 bottles (1.75L)", oz: 828.443 }] };
const tap = { key: "main-48", name: "Lemon Drop", wall: "Main", tapNumber: 48,
  currentStockKegs: 0.7, avgWeeklyKegs: 0.3, preThursdayUsageSharePct: 0 };

function fixture({ item = citron, quantity = 0, items = [], policy = {} } = {}) {
  const inventoryItem = { ...item, orderUnits: quantity, par: quantity, estimatedCost: quantity * item.unitCost };
  return { generatedAt, items,
    weeklyPlanSnapshot: createWeeklyPlanSnapshot({ generatedAt, publishedAt: generatedAt,
      inventoryItems: [inventoryItem], recommendations: items, orderPolicy: policy }),
  };
}
function refresh(recommendations, options = {}) {
  return refreshWeeklyIngredientOrders({ recommendations, inventoryItems: [citron], tapInputs: [tap], recipes: [recipe], ...options });
}

test("legacy plan refresh adds next Thursday's Citron and keeps prep and noningredient purchases intact", () => {
  const state = fixture();
  state.weeklyPlanSnapshot.plan.orders.supplies.push({ id: "cups", name: "Cups", vendor: "Shop", quantity: 2, estimatedCost: 4, unitCost: 2 });
  state.weeklyPlanSnapshot.plan.prep.liquorRefills = [{ name: "Patron", quantity: 2 }];
  const original = structuredClone(state);
  const next = refresh(state);
  const snapshot = next.weeklyPlanSnapshot;
  assert.equal(snapshot.ingredientPlanningVersion, 2);
  assert.equal(snapshot.plan.orders.liquor[0].quantity, 14);
  assert.equal(snapshot.plan.summary.estimatedInventoryCost, 354);
  assert.deepEqual(snapshot.plan.prep, original.weeklyPlanSnapshot.plan.prep);
  assert.deepEqual(snapshot.plan.orders.supplies, original.weeklyPlanSnapshot.plan.orders.supplies);
  assert.deepEqual(snapshot.ingredientOrderReview, []);
  assert.deepEqual(state, original);
  assert.deepEqual(refresh(next), next);
});

test("adding a planned batch refreshes purchasing once and removing it removes stale policy minimums", () => {
  const state = fixture();
  state.items = [{ ...tap, actionType: "make", orderQty: 1, prepAdditionId: "added-lemon" }];
  const next = refresh(state);
  assert.equal(next.weeklyPlanSnapshot.plan.orders.liquor[0].quantity, 14);
  assert.equal(next.weeklyPlanSnapshot.orderPolicy.cocktailIngredientMinimumOrders[0].quantity, 14);
  const removed = refresh({ ...next, items: [] }, { tapInputs: [{ ...tap, currentStockKegs: 3 }] });
  assert.deepEqual(removed.weeklyPlanSnapshot.plan.orders.liquor, []);
  assert.deepEqual(removed.weeklyPlanSnapshot.orderPolicy.cocktailIngredientMinimumOrders, []);
});

test("placed supplier lines, receipts and draft history stay exact while the remaining bottles need an additional order", () => {
  let state = fixture({ quantity: 6 });
  const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-ordered", generatedAt,
    vendorId: vendor.id, ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-receipt", generatedAt,
    itemId: vendor.items[0].id, status: "partial", receivedQuantity: 4, handledBy: "Alex" }, { role: "owner", now });
  const before = buildWeeklyOrderTracking(state, now());
  const next = refresh(state);
  const after = buildWeeklyOrderTracking(next, now());
  assert.deepEqual(after.vendors, before.vendors);
  assert.deepEqual(next.weeklyOrderTracking, state.weeklyOrderTracking);
  assert.deepEqual(next.weeklyPlanSnapshot.plan.orders.liquor, state.weeklyPlanSnapshot.plan.orders.liquor);
  assert.deepEqual(next.weeklyPlanSnapshot.ingredientOrderReview.map(({ name, quantity, unit, kind }) => ({ name, quantity, unit, kind })), [
    { name: "Absolut Citron", quantity: 8, unit: "bottles", kind: "additional-order" },
  ]);
  assert.deepEqual(refresh(next), next);
});

test("new ingredient for an already placed supplier never becomes an ordered receiving line", () => {
  const other = { ...citron, id: "other-vodka", name: "Other vodka", vendorSku: "other", vendorProductName: "Other vodka" };
  let state = fixture({ item: other, quantity: 2 });
  const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-ordered", generatedAt, vendorId: vendor.id,
    ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  const next = refresh(state);
  const tracked = buildWeeklyOrderTracking(next, now()).vendors[0];
  assert.equal(tracked.ordered, true);
  assert.deepEqual(tracked.items.map(item => item.name), ["Other vodka"]);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 14);
});

test("saved positive and zero manager adjustments are respected and expose any ingredient shortage", () => {
  for (const quantity of [0, 5]) {
    let state = fixture({ quantity: 14 });
    const item = buildWeeklyOrderTracking(state, now()).adjustmentCatalog.find(item => item.internalId === citron.id);
    state = applyWeeklyOrderTrackingUpdate(state, { action: "set-order-adjustment", generatedAt,
      vendor: "OHLQ", catalogId: item.catalogId, quantity, reason: "Manager reviewed", adjustedBy: "Sam" }, { role: "owner", now });
    const next = refresh(state);
    assert.deepEqual(next.weeklyOrderTracking, state.weeklyOrderTracking);
    assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 14 - quantity);
    assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].kind, "adjustment-shortage");
    const actual = buildWeeklyOrderTracking(next, now()).vendors.find(item => item.vendor === "OHLQ");
    assert.equal(actual?.items[0]?.quantity || 0, quantity);
  }
});

test("future Proof ingredient need remains on the order when this Thursday needs none", () => {
  const grenadine = { ...citron, id: "grenadine", name: "Grenadine", vendor: "Proof", vendorSku: "grenadine",
    vendorProductName: "Grenadine", group: "Mixer Cabinet", bottleOz: 1, packSize: 6, casePackaged: true, unitCost: 3 };
  const state = fixture({ item: grenadine, policy: { proofMinimum: 0, proofPrepRequirement: "not-required" } });
  const next = refresh(state, { inventoryItems: [grenadine], recipes: [{ title: "Lemon Drop", ingredients: [{ name: "Grenadine", oz: 8 }] }] });
  assert.equal(next.weeklyPlanSnapshot.orderPolicy.proofPrepRequirement, "required");
  assert.equal(next.weeklyPlanSnapshot.plan.orders.mixers[0].quantity, 12);
  const model = buildUnifiedVendorOrderModel(next.weeklyPlanSnapshot.plan, { snapshot: next.weeklyPlanSnapshot });
  assert.equal(model.drafts[0].vendor, "Proof");
  assert.equal(model.drafts[0].lines[0].requestedUnits, 12);
  assert.deepEqual(model.deferredOrders, []);
});

test("a placed tap purchase of the same SKU remains reserved for its tap when prep is added", () => {
  const items = [{ key: "tap-citron", name: "Absolut Citron", orderProductName: "Absolut Citron",
    isLiquorTap: true, actionType: "order", orderQty: 2, vendor: "OHLQ", vendorSku: "citron", unitCost: 25 }];
  let state = fixture({ items });
  const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-ordered", generatedAt,
    vendorId: vendor.id, ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  const next = refresh(state);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 14);
  assert.deepEqual(next.weeklyPlanSnapshot.plan.orders.liquorTapBottles, state.weeklyPlanSnapshot.plan.orders.liquorTapBottles);
});

test("additional purchases subtract the manager-adjusted quantity actually placed", () => {
  let state = fixture({ quantity: 6 });
  const catalog = buildWeeklyOrderTracking(state, now()).adjustmentCatalog.find(item => item.internalId === citron.id);
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-order-adjustment", generatedAt,
    vendor: "OHLQ", catalogId: catalog.catalogId, quantity: 10, reason: "Extra bottles", adjustedBy: "Sam" }, { role: "owner", now });
  const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-ordered", generatedAt,
    vendorId: vendor.id, ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  const next = refresh(state);
  assert.equal(buildWeeklyOrderTracking(next, now()).vendors[0].items[0].quantity, 10);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 4);
});

test("placed Proof minimum top-ups stay frozen and case deltas exclude those committed units", () => {
  const grenadine = { ...citron, id: "grenadine", name: "Grenadine", vendor: "Proof", vendorSku: "grenadine",
    vendorProductName: "Grenadine", group: "Mixer Cabinet", bottleOz: 1, packSize: 6, casePackaged: true, unitCost: 3 };
  let state = fixture({ item: grenadine, quantity: 6, policy: {
    proofMinimum: 36, proofPrepRequirement: "required", proofMinimumCandidates: [{ ...grenadine,
      shelfStable: true, projectedPrepUseUnits: 12, onHandUnits: 0 }],
  } });
  const before = buildWeeklyOrderTracking(state, now());
  assert.equal(before.vendors[0].items[0].quantity, 2);
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-ordered", generatedAt,
    vendorId: before.vendors[0].id, ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  const placed = buildWeeklyOrderTracking(state, now());
  const next = refresh(state, { inventoryItems: [grenadine], recipes: [{ title: "Lemon Drop", ingredients: [{ name: "Grenadine", oz: 18 }] }] });
  assert.deepEqual(buildWeeklyOrderTracking(next, now()).vendors, placed.vendors);
  assert.deepEqual(next.weeklyPlanSnapshot.ingredientOrderReview.map(({ quantity, unit, requestedUnits }) => ({ quantity, unit, requestedUnits })), [
    { quantity: 1, unit: "cases", requestedUnits: 6 },
  ]);
});

test("missing ingredient evidence is prominently reviewable rather than silently treating purchases as covered", () => {
  const state = fixture();
  const next = refresh(state, { tapInputs: [{ ...tap, currentStockKegs: null }] });
  assert.deepEqual(next.weeklyPlanSnapshot.plan.orders.liquor, []);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview.length, 1);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].kind, "ingredient-data");
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 0);
  assert.match(next.weeklyPlanSnapshot.ingredientOrderReview[0].reason, /stock or weekly usage is missing/);
});

test("legacy receipts without a placed flag retain their original receiving quantities and statuses", () => {
  for (const legacy of [false, true]) {
    let state = fixture({ quantity: 6 });
    const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
    const item = vendor.items[0];
    state = applyWeeklyOrderTrackingUpdate(state, { action: "set-receipt", generatedAt,
      itemId: item.id, status: "received", receivedQuantity: 6, handledBy: "Alex" }, { role: "owner", now });
    if (legacy) {
      const receipt = state.weeklyOrderTracking.receipts[item.id];
      delete state.weeklyOrderTracking.receipts[item.id];
      state.weeklyOrderTracking.receipts[legacyWeeklyOrderItemId(vendor.vendor, item)] = receipt;
    }
    const before = buildWeeklyOrderTracking(state, now());
    assert.equal(before.vendors[0].ordered, false);
    const next = refresh(state);
    assert.deepEqual(buildWeeklyOrderTracking(next, now()).vendors, before.vendors);
    assert.deepEqual(next.weeklyOrderTracking, state.weeklyOrderTracking);
    assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 8);
    assert.match(next.weeklyPlanSnapshot.ingredientOrderReview[0].reason, /previously recorded supplier delivery/);
  }
});

test("new prep buys the cabinet bottles already committed to a physical tap refill", () => {
  const jack = { ...citron, id: "jack-daniel-s", name: "Jack Daniels", vendorSku: "0066D",
    vendorProductName: "Jack Daniel's Old No. 7 1.75L", onHand: 10 };
  const refill = { key: "jack-tap", name: "Jack Daniels", orderProductName: "Jack Daniels", isLiquorTap: true,
    actionType: "none", orderQty: 0, refillBottleQty: 2, cabinetUsedQty: 2, cabinetInventoryId: jack.id,
    vendor: "OHLQ", vendorSku: jack.vendorSku, unitCost: 25, bottleOz: jack.bottleOz, wall: "Main", tapNumber: 20 };
  const state = fixture({ item: jack, items: [refill] });
  const savedRefills = structuredClone(state.weeklyPlanSnapshot.plan.prep.liquorRefills);
  state.items.push({ name: "Whiskey Sour", key: "extra-sour", actionType: "make", orderQty: 1 });
  const options = { inventoryItems: [jack], tapInputs: [], recipes: [{ title: "Whiskey Sour", ingredients: [
    { name: "Jack Daniels", raw: "Jack Daniels = 10 bottles (1.75L)", oz: 591.745 },
  ] }] };
  const next = refresh(state, options);
  assert.equal(next.weeklyPlanSnapshot.plan.orders.liquor[0].quantity, 2);
  assert.equal(next.weeklyPlanSnapshot.plan.orders.liquor[0].onHand, 10);
  assert.match(next.weeklyPlanSnapshot.plan.orders.liquor[0].reasons.join(" "), /reserving 2 bottles for scheduled tap refills/);
  assert.deepEqual(next.weeklyPlanSnapshot.plan.orders.liquorTapBottles, []);
  assert.deepEqual(next.weeklyPlanSnapshot.plan.prep.liquorRefills, savedRefills);
  assert.deepEqual(refresh(next, options), next);

  // Exact inventory identity on the prep task is enough for an older snapshot
  // even when its original raw liquor recommendation is no longer available.
  const withoutRaw = refresh({ ...state, items: state.items.filter(item => !item.isLiquorTap) }, options);
  assert.equal(withoutRaw.weeklyPlanSnapshot.plan.orders.liquor[0].quantity, 2);
});

test("refill reservations exclude bottles already purchased and never count a raw allocation twice", () => {
  for (const cabinetUsedQty of [0, 2]) {
    const item = { ...citron, onHand: 14 };
    const refill = { key: "citron-refill", name: item.name, orderProductName: item.name, isLiquorTap: true,
      actionType: "order", orderQty: 2, refillBottleQty: 2 + cabinetUsedQty, cabinetUsedQty,
      cabinetInventoryId: item.id, vendor: item.vendor, vendorSku: item.vendorSku, unitCost: item.unitCost };
    const state = fixture({ item, items: [refill] });
    state.items.push({ name: "Lemon Drop", key: "added-lemon", actionType: "make", orderQty: 1 });
    const next = refresh(state, { inventoryItems: [item], tapInputs: [] });
    assert.equal(next.weeklyPlanSnapshot.plan.orders.liquor[0]?.quantity || 0, cabinetUsedQty);
    assert.deepEqual(next.weeklyPlanSnapshot.plan.orders.liquorTapBottles, state.weeklyPlanSnapshot.plan.orders.liquorTapBottles);
    assert.deepEqual(next.weeklyPlanSnapshot.plan.prep.liquorRefills, state.weeklyPlanSnapshot.plan.prep.liquorRefills);
  }
});

test("new prep against a placed supplier reports the refill reservation as an additional purchase", () => {
  const item = { ...citron, onHand: 14 };
  const refill = { key: "citron-refill", name: item.name, orderProductName: item.name, isLiquorTap: true,
    actionType: "order", orderQty: 2, refillBottleQty: 4, cabinetUsedQty: 2,
    cabinetInventoryId: item.id, vendor: item.vendor, vendorSku: item.vendorSku, unitCost: item.unitCost };
  let state = fixture({ item, items: [refill] });
  const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
  state = applyWeeklyOrderTrackingUpdate(state, { action: "set-ordered", generatedAt,
    vendorId: vendor.id, ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  state.items.push({ name: "Lemon Drop", key: "added-lemon", actionType: "make", orderQty: 1 });
  const next = refresh(state, { inventoryItems: [item], tapInputs: [] });
  assert.deepEqual(next.weeklyPlanSnapshot.plan.orders, state.weeklyPlanSnapshot.plan.orders);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].quantity, 2);
  assert.equal(next.weeklyPlanSnapshot.ingredientOrderReview[0].kind, "additional-order");
});
