import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createWeeklyPlanSnapshot, getCurrentWeeklyPlanSnapshot,
  normalizeWeeklyPlanKegOrderMetadata, refreshWeeklyPlanMetadata,
} from "../public/weekly-action-plan.mjs";
import { fillMissingKegOrderMetadata, getKegOrderDefaults } from "../public/keg-order-defaults.mjs";
import { buildUnifiedVendorOrderModel } from "../public/vendor-order-drafts.mjs";
import { buildWeeklyOrderTracking, applyWeeklyOrderTrackingUpdate, WeeklyOrderTrackingError } from "../lib/weekly-order-tracking.mjs";
import { normalizeSnapshotOrder } from "../public/weekly-snapshot-orders.mjs";

const generatedAt = "2026-11-02T16:57:27.987Z";
const now = () => new Date("2026-11-02T18:00:00.000Z");
class TestDate extends Date {
  constructor(value = now().toISOString()) { super(value); }
}

function fixture() {
  const items = [
    { key: "main-corona", orderProductName: "Corona", vendor: "Bonbright", unitCost: 143, tapNumber: 38 },
    { key: "main-37-dortmunder-gold-lager-1", orderProductName: "Dortmunder Gold Lager 1", vendor: "", unitCost: 0, tapNumber: 37, name: "Coming Soon!" },
    { key: "main-garage-lime", orderProductName: "Garage Beer Lime", vendor: "Bonbright", unitCost: 135, tapNumber: 39 },
  ].map(item => ({ actionType: "order", isKegTap: true, orderQty: 1, wall: "Main", ...item }));
  const snapshot = createWeeklyPlanSnapshot({ generatedAt, publishedAt: generatedAt, recommendations: items });
  // A previously published plan captured an inactive tap's order without its catalog metadata.
  const missing = snapshot.plan.orders.beerKegs.find(item => item.tapNumbers.includes(37));
  Object.assign(missing, { vendor: "", vendors: [], vendorSku: "", unitCost: 0, estimatedCost: 0, hasKnownPrice: false });
  return { generatedAt, items, weeklyPlanSnapshot: snapshot };
}

const dashboardSource = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function executeDashboardFunction(name, dependencies) {
  const source = dashboardSource.match(new RegExp(`function ${name}\\([^]*?\\n}\\n`))?.[0];
  assert.ok(source, `${name} exists`);
  return new Function(...Object.keys(dependencies), `${source}\nreturn ${name}();`)(...Object.values(dependencies));
}

function browserPlan(recommendations) {
  return executeDashboardFunction("getWeeklyPlanModel", {
    Date: TestDate, parAgentState: { recommendations }, getCurrentWeeklyPlanSnapshot,
    hydrateWeeklyPlanLiquorTapPricing: plan => plan, refreshWeeklyPlanMetadata,
    isFoodDepartmentOrderedInventoryItem: () => false, inventoryItems: [],
    getKegPricingKey: () => { throw new Error("Locked beer metadata must not be replaced by live catalog metadata"); },
  });
}

function browserDraft(recommendations) {
  const snapshot = getCurrentWeeklyPlanSnapshot(recommendations, now());
  const tracking = buildWeeklyOrderTracking(recommendations, now());
  return buildUnifiedVendorOrderModel(browserPlan(recommendations), {
    snapshot, manualAdjustments: tracking.adjustments, manualCatalog: tracking.adjustmentCatalog, now: now(),
  }).drafts.find(draft => draft.vendor === "Bonbright");
}

function update(state, payload) {
  return applyWeeklyOrderTrackingUpdate(state, { generatedAt, ...payload }, { role: "owner", now });
}

async function archive(state, vendorId) {
  const source = readFileSync(new URL("../lib/weekly-order-snapshot.mjs", import.meta.url), "utf8")
    .replace(/^import [^]*?;\n/gm, "").replace("export async function", "async function");
  const writes = [];
  const dependencies = {
    Date: TestDate, WeeklyOrderTrackingError, normalizeSnapshotOrder,
    getCurrentWeeklyPlanSnapshot: state => getCurrentWeeklyPlanSnapshot(state, now()),
    buildWeeklyOrderTracking: state => buildWeeklyOrderTracking(state, now()),
    buildUnifiedVendorOrderModel: (plan, options) => buildUnifiedVendorOrderModel(plan, { ...options, now: now() }),
    mutateSharedInventoryState: async (...args) => writes.push(args),
  };
  const save = new Function(...Object.keys(dependencies), `${source}\nreturn archiveWeeklyOrderPlacement;`)(...Object.values(dependencies));
  const order = await save(state, vendorId, "owner");
  assert.deepEqual(writes, [["save-order-snapshot", { order }, "owner"]]);
  return order;
}

test("inactive Dortmunder uses the same three-line order for display, approval, handoff, placement and archive", async () => {
  let state = fixture();
  const original = structuredClone(state);
  const draft = browserDraft(state);
  assert.deepEqual(draft.lines.map(line => [line.name, line.requestedUnits]), [
    ["Corona", 1], ["Dortmunder Gold Lager", 1], ["Garage Beer Lime", 1],
  ]);
  assert.equal(draft.estimatedTotal, 453);
  assert.deepEqual(state, original, "Reading metadata never mutates the saved plan");
  const tracking = buildWeeklyOrderTracking(state, now());
  assert.equal(tracking.vendors.length, 1);
  assert.equal(tracking.adjustmentCatalog.find(item => item.name === "Dortmunder Gold Lager").vendor, "Bonbright");
  state = update(state, { action: "review-and-approve", vendor: "Bonbright", expectedDraftId: draft.id, approvedBy: "Sam", confirmed: true });
  state = update(state, { action: "record-handoff", vendor: "Bonbright", draftId: draft.id, event: "copied" });
  const vendor = buildWeeklyOrderTracking(state, now()).vendors[0];
  state = update(state, { action: "set-ordered", vendorId: vendor.id, expectedDraftId: draft.id, ordered: true, orderedBy: "Sam" });
  assert.equal(browserDraft(state).id, draft.id);
  const placed = buildWeeklyOrderTracking(state, now());
  assert.equal(placed.vendors[0].items.length, 3);
  assert.equal(placed.drafts[0].status, "manually_completed");
  assert.ok(placed.drafts[0].copiedAt);
  const archived = await archive(state, vendor.id);
  assert.equal(archived.draftId, draft.id);
  assert.equal(archived.estimatedTotal, 453);
  assert.equal(archived.lines.length, 3);
  assert.deepEqual(archived.lines.map(line => line.requestedUnits), [1, 1, 1]);
  assert.deepEqual(state.weeklyPlanSnapshot.plan.orders.beerKegs.map(line => [line.id, line.quantity, line.kegDestinations]),
    original.weeklyPlanSnapshot.plan.orders.beerKegs.map(line => [line.id, line.quantity, line.kegDestinations]));
});

test("a genuine quantity change still rejects the displayed draft fingerprint", () => {
  const state = fixture();
  const draft = browserDraft(state);
  state.weeklyPlanSnapshot.plan.orders.beerKegs[0].quantity = 2;
  assert.throws(() => update(state, { action: "review-and-approve", vendor: "Bonbright", expectedDraftId: draft.id, approvedBy: "Sam", confirmed: true }),
    error => error.code === "ORDER_DRAFT_CHANGED" && error.status === 409);
});

test("previously placed orders do not silently acquire newly resolved keg lines in either client or server", async () => {
  const state = fixture();
  state.weeklyOrderTracking = { vendors: { "vendor:bonbright": { vendor: "Bonbright", orderedBy: "Sam", orderedAt: generatedAt } } };
  const draft = browserDraft(state);
  assert.equal(draft.lines.length, 2);
  assert.equal(draft.estimatedTotal, 278);
  const tracking = buildWeeklyOrderTracking(state, now());
  assert.equal(tracking.vendors.find(vendor => vendor.vendor === "Bonbright").items.length, 2);
  assert.equal(tracking.vendors.find(vendor => vendor.vendor === "Needs vendor").ordered, false);
  const archived = await archive(state, "vendor:bonbright");
  assert.equal(archived.lines.length, 2);
  assert.equal(archived.draftId, draft.id);
});

test("shared fallback keeps explicit prices, identities and vendor assignments and leaves unknown products unresolved", () => {
  const line = { id: "saved-id", name: "Dortmunder Gold Lager", quantity: 2, vendor: "Bonbright", vendorSku: "SAVED-SKU", vendorProductName: "Saved description", unitCost: 190, estimatedCost: 380, hasKnownPrice: true };
  const resolved = fillMissingKegOrderMetadata(line);
  for (const key of Object.keys(line)) assert.deepEqual(resolved[key], line[key]);
  assert.deepEqual(fillMissingKegOrderMetadata({ ...line, vendor: "Other distributor", unitCost: 0 }), { ...line, vendor: "Other distributor", unitCost: 0 });
  assert.deepEqual(fillMissingKegOrderMetadata({ name: "Unmapped New Beer", unitCost: 0 }), { name: "Unmapped New Beer", unitCost: 0 });
  assert.equal(fillMissingKegOrderMetadata({ name: "Dortmunder Gold Lager", vendor: "Bonbright", unitCost: 0, hasKnownPrice: true }).unitCost, 0);
  assert.equal(getKegOrderDefaults("GL DORTMUNDER 1/2 BBL").unitCost, 175);
  assert.equal(getKegOrderDefaults("Dortmunder Gold Lager 1").vendor, "Bonbright");
  const plan = normalizeWeeklyPlanKegOrderMetadata({ orders: { beerKegs: [line] }, summary: {}, review: {} });
  assert.equal(plan.orders.beerKegs[0].unitCost, 190);
});

test("legacy receipts retain their line identity and status before a vendor order is marked placed", () => {
  for (const receiptKey of [
    "needs vendor|product|main-37-dortmunder-gold-lager-1",
    "needs vendor|beer keg|dortmunder gold lager",
  ]) {
    const state = fixture();
    const receipt = { status: "received", receivedQuantity: 1, handledBy: "Sam", updatedAt: generatedAt };
    state.weeklyOrderTracking = { receipts: { [`order:${encodeURIComponent(receiptKey)}`]: receipt } };
    assert.equal(browserDraft(state).lines.length, 2);
    const tracking = buildWeeklyOrderTracking(state, now());
    const line = tracking.vendors.find(vendor => vendor.vendor === "Needs vendor").items[0];
    assert.equal(line.status, "received");
    assert.equal(line.receivedQuantity, 1);
    const saved = update(state, { action: "set-receipt", itemId: line.id, status: "received", receivedQuantity: 1, handledBy: "Sam" });
    assert.equal(browserDraft(saved).lines.length, 2);
    const savedLine = buildWeeklyOrderTracking(saved, now()).vendors.find(vendor => vendor.vendor === "Needs vendor").items[0];
    assert.equal(savedLine.id, line.id);
    assert.equal(savedLine.status, "received");
    assert.equal(savedLine.receivedQuantity, 1);
    assert.deepEqual(state.weeklyOrderTracking.receipts[`order:${encodeURIComponent(receiptKey)}`], receipt);
    assert.equal(saved.weeklyOrderTracking.receipts[`order:${encodeURIComponent(receiptKey)}`].receivedQuantity, 1);
  }
});

test("new snapshots and publishing resolve inactive order products without requiring an active tap pricing row", () => {
  const source = fixture().items;
  const snapshot = createWeeklyPlanSnapshot({ generatedAt, recommendations: source });
  const line = snapshot.plan.orders.beerKegs.find(item => item.tapNumbers.includes(37));
  assert.equal(line.vendor, "Bonbright");
  assert.equal(line.unitCost, 175);
  const recommendations = executeDashboardFunction("getWeeklyPlanRecommendations", {
    getCurrentMondayKegPlanSnapshot: () => ({ items: source }),
    netRollingLiquorTapRecommendations: items => items,
    getWeeklyPlanInventoryItems: () => [],
    getTapOrderProductName: item => item.orderProductName,
    getSavedTapOrderProduct: () => "", weeklyUsageItems: [], weeklyUsageArchivedItems: [],
    getKegPricingItem: () => null, getKegVendorCatalogProduct: () => null,
    getOrderingSku: () => "", getKegOrderDefaults,
  });
  const published = recommendations.find(item => item.tapNumber === 37);
  assert.equal(published.vendor, "Bonbright");
  assert.equal(published.unitCost, 175);
  assert.equal(published.orderQty, 1);
  assert.equal(published.internalId, "main-37-dortmunder-gold-lager-1");
});
