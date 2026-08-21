import assert from "node:assert/strict";
import test from "node:test";

import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";
import {
  WeeklyOrderTrackingError,
  applyWeeklyOrderTrackingUpdate,
  buildWeeklyOrderTracking,
} from "../lib/weekly-order-tracking.mjs";

const generatedAt = "2026-08-10T14:00:00.000Z";
const clock = () => new Date("2026-08-13T16:30:00.000Z");

function recommendations(overrides = {}) {
  const items = [
    {
      key: "main-42-bud-light",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Bud Light",
      vendor: "Heidelberg",
      unitCost: 120,
      tapNumber: 42,
      wall: "Main",
    },
    {
      key: "patio-12-patron",
      actionType: "order",
      isLiquorTap: true,
      orderQty: 2,
      orderProductName: "Patron Silver (Tequila) 3",
      vendor: "OHLQ",
      unitCost: 98.7,
      tapNumber: 12,
      wall: "Patio",
    },
  ];
  return {
    generatedAt,
    items,
    weeklyPlanSnapshot: createWeeklyPlanSnapshot({ generatedAt, recommendations: items }),
    ...overrides,
  };
}

test("builds a sanitized receipt checklist from the locked vendor orders", () => {
  const plan = buildWeeklyOrderTracking(recommendations(), clock());

  assert.deepEqual(plan.vendors.map((vendor) => vendor.vendor), ["Heidelberg", "OHLQ"]);
  assert.equal(plan.itemCount, 2);
  assert.equal(plan.receivedCount, 0);
  assert.equal(plan.notReceivedCount, 0);
  assert.deepEqual(
    plan.vendors.flatMap((vendor) => vendor.items).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
    })),
    [
      { name: "Bud Light", quantity: 1, unit: "keg" },
      { name: "Patron Silver", quantity: 2, unit: "bottles" },
    ],
  );
});

test("only an owner can record who placed a vendor order", () => {
  const base = recommendations();
  const vendor = buildWeeklyOrderTracking(base, clock()).vendors[0];

  assert.throws(
    () => applyWeeklyOrderTrackingUpdate(base, {
      action: "set-ordered",
      generatedAt,
      vendorId: vendor.id,
      ordered: true,
      orderedBy: "Sam",
    }, { role: "employee", now: clock }),
    (error) => error instanceof WeeklyOrderTrackingError
      && error.code === "OWNER_ORDER_TRACKING_REQUIRED",
  );

  const updated = applyWeeklyOrderTrackingUpdate(base, {
    action: "set-ordered",
    generatedAt,
    vendorId: vendor.id,
    ordered: true,
    orderedBy: "  Sam   W. ",
  }, { role: "owner", now: clock });
  const plan = buildWeeklyOrderTracking(updated, clock());

  assert.equal(plan.vendors[0].ordered, true);
  assert.equal(plan.vendors[0].orderedBy, "Sam W.");
  assert.equal(plan.vendors[0].orderedAt, "2026-08-13T16:30:00.000Z");
});

test("an employee can mark an item not received and expose it for a dashboard alert", () => {
  const base = recommendations();
  const item = buildWeeklyOrderTracking(base, clock()).vendors[1].items[0];
  const updated = applyWeeklyOrderTrackingUpdate(base, {
    action: "set-receipt",
    generatedAt,
    itemId: item.id,
    status: "not-received",
    handledBy: "  Jordan  ",
  }, { role: "employee", now: clock });
  const plan = buildWeeklyOrderTracking(updated, clock());

  assert.equal(plan.notReceivedCount, 1);
  assert.deepEqual(plan.notReceivedItems.map((entry) => ({
    vendor: entry.vendor,
    name: entry.name,
    handledBy: entry.handledBy,
  })), [{ vendor: "OHLQ", name: "Patron Silver", handledBy: "Jordan" }]);
});

test("an employee can record a partial bottle delivery", () => {
  const bottleItems = [{
    key: "crown-apple-order",
    actionType: "order",
    isLiquorTap: true,
    orderQty: 18,
    orderProductName: "Crown Apple",
    vendor: "OHLQ",
    unitCost: 35,
    lineType: "Liquor tap bottle",
  }];
  const base = {
    generatedAt,
    items: bottleItems,
    weeklyPlanSnapshot: createWeeklyPlanSnapshot({ generatedAt, recommendations: bottleItems }),
  };
  const item = buildWeeklyOrderTracking(base, clock()).vendors[0].items[0];
  const updated = applyWeeklyOrderTrackingUpdate(base, {
    action: "set-receipt",
    generatedAt,
    itemId: item.id,
    status: "partial",
    receivedQuantity: 14,
    handledBy: "Jordan",
  }, { role: "employee", now: clock });
  const plan = buildWeeklyOrderTracking(updated, clock());
  const saved = plan.vendors[0].items[0];

  assert.equal(saved.status, "partial");
  assert.equal(saved.quantity, 18);
  assert.equal(saved.receivedQuantity, 14);
  assert.equal(saved.missingQuantity, 4);
  assert.equal(plan.receivedCount, 0);
  assert.equal(plan.notReceivedCount, 1);
  assert.equal(plan.notReceivedItems[0].name, "Crown Apple");
});

test("receipt quantities cannot exceed the amount ordered", () => {
  const base = recommendations();
  const item = buildWeeklyOrderTracking(base, clock()).vendors[1].items[0];

  assert.throws(
    () => applyWeeklyOrderTrackingUpdate(base, {
      action: "set-receipt",
      generatedAt,
      itemId: item.id,
      status: "partial",
      receivedQuantity: 3,
      handledBy: "Jordan",
    }, { role: "employee", now: clock }),
    (error) => error.code === "RECEIVED_QUANTITY_INVALID",
  );
});

test("receipt tracking requires the current plan and the employee name", () => {
  const base = recommendations();
  const item = buildWeeklyOrderTracking(base, clock()).vendors[0].items[0];

  assert.throws(
    () => applyWeeklyOrderTrackingUpdate(base, {
      action: "set-receipt",
      generatedAt: "2026-08-03T14:00:00.000Z",
      itemId: item.id,
      status: "received",
      handledBy: "Jordan",
    }, { role: "employee", now: clock }),
    (error) => error.code === "WEEKLY_ORDER_PLAN_CHANGED",
  );
  assert.throws(
    () => applyWeeklyOrderTrackingUpdate(base, {
      action: "set-receipt",
      generatedAt,
      itemId: item.id,
      status: "received",
      handledBy: "",
    }, { role: "employee", now: clock }),
    (error) => error.code === "RECEIVED_BY_REQUIRED",
  );
});

test("persists an idempotent reviewed, opened, and manually completed handoff", () => {
  const mondayClock = () => new Date("2026-08-10T15:00:00.000Z");
  let state = recommendations({
    items: [{
      key: "main-42-bud-light",
      id: "bud-light",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Bud Light",
      vendor: "Heidelberg",
      vendorSku: "HD-BUD-1",
      vendorProductName: "Bud Light Half Barrel",
      unitCost: 120,
      tapNumber: 42,
      wall: "Main",
    }],
  });
  state.weeklyPlanSnapshot = createWeeklyPlanSnapshot({
    generatedAt,
    recommendations: state.items,
    publishedAt: generatedAt,
  });
  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "create-draft",
    generatedAt,
    vendor: "Heidelberg",
    createdBy: "Samantha",
  }, { role: "owner", now: mondayClock });
  let draft = buildWeeklyOrderTracking(state, mondayClock()).drafts[0];
  assert.equal(draft.status, "ready_for_review");
  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "approve-draft",
    generatedAt,
    vendor: "Heidelberg",
    approvedBy: "Samantha",
    confirmed: true,
  }, { role: "owner", now: mondayClock });
  draft = buildWeeklyOrderTracking(state, mondayClock()).drafts[0];
  assert.equal(draft.status, "reviewed");
  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "record-handoff",
    generatedAt,
    vendor: "Heidelberg",
    draftId: draft.id,
    event: "opened_vendor",
  }, { role: "owner", now: mondayClock });
  draft = buildWeeklyOrderTracking(state, mondayClock()).drafts[0];
  assert.equal(draft.status, "opened_vendor");
  const vendor = buildWeeklyOrderTracking(state, mondayClock()).vendors[0];
  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "set-ordered",
    generatedAt,
    vendorId: vendor.id,
    ordered: true,
    orderedBy: "Samantha",
  }, { role: "owner", now: mondayClock });
  const completed = buildWeeklyOrderTracking(state, mondayClock()).drafts[0];
  const repeated = applyWeeklyOrderTrackingUpdate(state, {
    action: "set-ordered",
    generatedAt,
    vendorId: vendor.id,
    ordered: true,
    orderedBy: "Samantha",
  }, { role: "owner", now: mondayClock });
  assert.equal(completed.status, "manually_completed");
  assert.equal(buildWeeklyOrderTracking(repeated, mondayClock()).drafts[0].completedAt, completed.completedAt);
});

test("stores a manager order adjustment, updates receiving, and invalidates approval", () => {
  const mondayClock = () => new Date("2026-08-10T15:00:00.000Z");
  let state = recommendations({
    items: [{
      key: "guinness",
      id: "guinness",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Guinness",
      vendor: "Bonbright",
      vendorSku: "BB-GUINNESS",
      vendorProductName: "Guinness",
      unitCost: 185,
      tapNumber: 1,
      wall: "Main",
    }],
  });
  state.weeklyPlanSnapshot = createWeeklyPlanSnapshot({
    generatedAt,
    recommendations: state.items,
    publishedAt: generatedAt,
  });
  const catalogItem = buildWeeklyOrderTracking(state, mondayClock()).adjustmentCatalog.find((item) => item.name === "Guinness");
  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "set-order-adjustment",
    generatedAt,
    catalogId: catalogItem.catalogId,
    vendor: "Bonbright",
    quantity: 3,
    reason: "St. Patrick's Day",
    adjustedBy: "Samantha",
  }, { role: "owner", now: mondayClock });
  const tracking = buildWeeklyOrderTracking(state, mondayClock());

  assert.equal(tracking.adjustments[0].quantity, 3);
  assert.equal(tracking.vendors[0].items[0].quantity, 3);
  assert.equal(tracking.drafts.length, 0);
});

test("stores and restores a current-week order exclusion", () => {
  const mondayClock = () => new Date("2026-08-10T15:00:00.000Z");
  let state = recommendations({
    items: [{
      key: "guinness",
      id: "guinness",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Guinness",
      vendor: "Bonbright",
      vendorSku: "BB-GUINNESS",
      vendorProductName: "Guinness",
      unitCost: 185,
      tapNumber: 1,
      wall: "Main",
    }],
  });
  state.weeklyPlanSnapshot = createWeeklyPlanSnapshot({
    generatedAt,
    recommendations: state.items,
    publishedAt: generatedAt,
  });
  const catalogItem = buildWeeklyOrderTracking(state, mondayClock()).adjustmentCatalog.find((item) => item.name === "Guinness");
  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "set-order-adjustment",
    generatedAt,
    catalogId: catalogItem.catalogId,
    vendor: "Bonbright",
    quantity: 0,
    reason: "Already covered",
    adjustedBy: "Samantha",
  }, { role: "owner", now: mondayClock });
  let tracking = buildWeeklyOrderTracking(state, mondayClock());

  assert.equal(tracking.adjustments[0].quantity, 0);
  assert.equal(tracking.vendors.length, 0);

  state = applyWeeklyOrderTrackingUpdate(state, {
    action: "remove-order-adjustment",
    generatedAt,
    catalogId: catalogItem.catalogId,
    vendor: "Bonbright",
    adjustedBy: "Samantha",
  }, { role: "owner", now: mondayClock });
  tracking = buildWeeklyOrderTracking(state, mondayClock());

  assert.equal(tracking.adjustments.length, 0);
  assert.equal(tracking.vendors[0].items[0].quantity, 1);
});
