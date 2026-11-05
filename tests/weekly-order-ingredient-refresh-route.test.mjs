import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";
import { applyWeeklyOrderTrackingUpdate, buildWeeklyOrderTracking } from "../lib/weekly-order-tracking.mjs";

const generatedAt = "2026-11-02T16:57:00.000Z";
const now = () => new Date("2026-11-04T20:00:00.000Z");
const source = readFileSync(new URL("../app/api/weekly-order-tracking/route.js", import.meta.url), "utf8")
  .replace(/^import\s[\s\S]*?;\n/gm, "").replaceAll("export ", "");

function fixture({ legacy = true, placed = false, role = "owner" } = {}) {
  const items = [{ key: "main-42-lager", name: "Lager", actionType: "order", isKegTap: true,
    orderQty: 1, orderProductName: "Lager", vendor: "Heidelberg", vendorSku: "HD-1", unitCost: 120, tapNumber: 42, wall: "Main" }];
  let recommendations = { generatedAt, items, weeklyPlanSnapshot: createWeeklyPlanSnapshot({ generatedAt, publishedAt: generatedAt, recommendations: items, inventoryItems: [{
    id: "absolut-citron", name: "Absolut Citron", group: "Liquor Cabinet", vendor: "OHLQ", vendorSku: "0028D",
    vendorProductName: "Absolut Citron Vodka 1.75L", onHand: 0, orderUnits: 14, unitCost: 32.9, estimatedCost: 460.6, hasKnownPrice: true,
  }] }) };
  recommendations = applyWeeklyOrderTrackingUpdate(recommendations,
    { action: "review-and-approve", generatedAt, vendor: "OHLQ", approvedBy: "Sam", confirmed: true }, { role: "owner", now });
  const initialTracking = buildWeeklyOrderTracking(recommendations, now());
  const vendor = initialTracking.vendors.find(item => item.vendor === "OHLQ");
  const draft = initialTracking.drafts.find(item => item.vendor === "OHLQ");
  if (placed) recommendations = applyWeeklyOrderTrackingUpdate(recommendations,
    { action: "set-ordered", generatedAt, vendorId: vendor.id, ordered: true, orderedBy: "Sam" }, { role: "owner", now });
  if (legacy) delete recommendations.weeklyPlanSnapshot.ingredientPlanningVersion;
  const state = { initialized: true, revision: 7, recommendations };
  const events = [];
  const writes = [];
  const context = {
    console,
    NextResponse: { json: (body, options) => ({ body, ...options }) },
    requireDashboardRequestIdentity: async () => ({ role, name: "Sam" }),
    readParAgentState: async () => state,
    buildWeeklyOrderTracking: value => buildWeeklyOrderTracking(value, now()),
    applyWeeklyOrderTrackingUpdate: (value, body, options) => {
      events.push("apply");
      return applyWeeklyOrderTrackingUpdate(value, body, { ...options, now });
    },
    writeParAgentState: async (value, options) => { writes.push({ value, options }); return { ...value, revision: 8 }; },
    archiveWeeklyOrderPlacement: async () => { events.push("archive"); return {}; },
    recordDashboardActivity: async () => { events.push("activity"); },
    refreshSavedIngredientPurchases: async value => { events.push("refresh-adjustment"); return value; },
    planReceiptInventoryContributions: async () => { events.push("receipt-plan"); return { sources: [], unmatched: [] }; },
    assertInventoryContributionPlan: () => {},
    buildWeeklySnapshotCompletion: () => ({}), buildStaffPrepPlan: () => ({}),
    applyBeerReceiptCounts: (prior, updated) => ({ ...prior, recommendations: updated }),
    recoverPendingInventoryUpdates: async () => ({}),
    executeInventoryBackedOperation: async ({ persist }) => ({ saved: await persist(), inventoryUpdate: {} }),
  };
  vm.runInNewContext(source, context);
  return { state, vendor, draft, events, writes,
    post: body => context.POST({ json: async () => ({ generatedAt, vendor: "OHLQ", vendorId: vendor.id, draftId: draft.id, ...body }) }),
  };
}

for (const body of [
  { action: "review-and-approve", confirmed: true },
  { action: "approve-draft", confirmed: true },
  { action: "record-handoff", event: "opened_vendor" },
  { action: "set-ordered", ordered: true },
]) {
  test(`legacy unplaced supplier rejects ${body.action} before mutating or archiving`, async () => {
    const f = fixture();
    const before = structuredClone(f.state);
    const result = await f.post(body);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, "INGREDIENT_ORDERS_REFRESH_REQUIRED");
    assert.deepEqual(f.events, []);
    assert.deepEqual(f.writes, []);
    assert.deepEqual(f.state, before);
  });

  test(`refreshed supplier permits ${body.action} through its normal validation`, async () => {
    const f = fixture({ legacy: false });
    const result = await f.post(body);
    assert.equal(result.status, 200, result.body.error);
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].options.expectedRevision, 7);
  });
}

test("a legacy placed order permits an idempotent placement retry", async () => {
  const f = fixture({ placed: true });
  const result = await f.post({ action: "set-ordered", ordered: true });
  assert.equal(result.status, 200, result.body.error);
  assert.equal(f.writes.length, 1);
  assert.equal(result.body.vendors.find(vendor => vendor.vendor === "OHLQ").ordered, true);
});

test("legacy placed delivery receipts keep their existing inventory workflow", async () => {
  const f = fixture({ placed: true, role: "employee" });
  const result = await f.post({ action: "set-receipt", itemId: f.vendor.items[0].id, status: "received", receivedQuantity: 14 });
  assert.equal(result.status, 200, result.body.error);
  assert.ok(f.events.includes("receipt-plan"));
  assert.equal(f.writes.length, 1);
  assert.equal(result.body.vendors.find(vendor => vendor.vendor === "OHLQ").items[0].status, "received");
});

test("staff order approval retains its owner-only error", async () => {
  const f = fixture({ role: "employee" });
  const result = await f.post({ action: "review-and-approve", confirmed: true });
  assert.equal(result.status, 403);
  assert.equal(result.body.code, "OWNER_ORDER_DRAFT_REQUIRED");
  assert.equal(f.writes.length, 0);
});

test("a current manual order adjustment still refreshes ingredient reviews", async () => {
  const f = fixture({ legacy: false });
  const catalog = buildWeeklyOrderTracking(f.state.recommendations, now()).adjustmentCatalog.find(item => item.internalId === "absolut-citron");
  const result = await f.post({ action: "set-order-adjustment", catalogId: catalog.catalogId, quantity: 12, reason: "Partial supplier availability." });
  assert.equal(result.status, 200, result.body.error);
  assert.ok(f.events.includes("refresh-adjustment"));
  assert.equal(f.writes.length, 1);
});
