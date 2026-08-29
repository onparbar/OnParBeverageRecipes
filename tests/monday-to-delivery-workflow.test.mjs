import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStaffPrepPlanUpdate,
  buildStaffPrepPlan,
} from "../lib/staff-prep-plan.mjs";
import {
  applyWeeklyOrderTrackingUpdate,
  buildWeeklyOrderTracking,
} from "../lib/weekly-order-tracking.mjs";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";

const generatedAt = "2026-08-24T13:00:00.000Z";
const mondayClock = () => new Date("2026-08-24T13:00:00.000Z");
const deliveryClock = () => new Date("2026-08-27T13:00:00.000Z");
const prepClock = () => new Date("2026-08-27T15:00:00.000Z");

function createMondayPlan() {
  const items = [
    {
      key: "main-31-garage-beer-lime",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Garage Beer Lime",
      vendor: "Bonbright",
      unitCost: 177.9,
      tapNumber: 31,
      wall: "Main",
    },
    {
      key: "karaoke-82-angry-orchard",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Angry Orchard",
      vendor: "Heidelberg",
      unitCost: 164,
      tapNumber: 82,
      wall: "Karaoke",
    },
    {
      key: "patio-13-titos",
      actionType: "order",
      isLiquorTap: true,
      orderQty: 2,
      orderProductName: "Tito's Vodka",
      vendor: "OHLQ",
      unitCost: 28.2,
      tapNumber: 13,
      wall: "Patio",
    },
    {
      key: "main-47-bacardi-sunset",
      actionType: "make",
      orderQty: 1,
      name: "Bacardi Sunset 1",
      tapNumber: 47,
      wall: "Main",
      priority: 1,
    },
  ];

  return {
    generatedAt,
    items,
    mondayInventorySnapshot: {
      savedAt: generatedAt,
      reason: "Monday count complete",
    },
    weeklyPlanSnapshot: createWeeklyPlanSnapshot({
      generatedAt,
      recommendations: items,
      publishedAt: generatedAt,
    }),
  };
}

test("Monday plan proceeds through ordering, delivery, and staff completion", () => {
  let sharedState = createMondayPlan();

  assert.equal(sharedState.weeklyPlanSnapshot.generatedAt, generatedAt);
  assert.equal(sharedState.mondayInventorySnapshot.savedAt, generatedAt);

  let orders = buildWeeklyOrderTracking(sharedState, mondayClock());
  assert.equal(orders.vendors.length, 3);
  assert.equal(orders.itemCount, 3);
  assert.equal(orders.receivedCount, 0);

  for (const vendor of orders.vendors) {
    sharedState = applyWeeklyOrderTrackingUpdate(sharedState, {
      action: "set-ordered",
      generatedAt,
      vendorId: vendor.id,
      ordered: true,
      orderedBy: "Sam",
    }, { role: "owner", now: mondayClock });
  }

  orders = buildWeeklyOrderTracking(sharedState, deliveryClock());
  assert.equal(orders.vendors.every((vendor) => vendor.ordered), true);

  for (const item of orders.vendors.flatMap((vendor) => vendor.items)) {
    sharedState = applyWeeklyOrderTrackingUpdate(sharedState, {
      action: "set-receipt",
      generatedAt,
      itemId: item.id,
      status: "received",
      receivedQuantity: item.quantity,
      handledBy: "Jordan",
    }, { role: "employee", now: deliveryClock });
  }

  orders = buildWeeklyOrderTracking(sharedState, deliveryClock());
  assert.equal(orders.receivedCount, 3);
  assert.equal(orders.notReceivedCount, 0);
  assert.equal(orders.notReceivedItems.length, 0);

  let prep = buildStaffPrepPlan(sharedState);
  assert.equal(prep.totalCount, 1);
  assert.equal(prep.liquorRefillTotalCount, 1);

  for (const item of [...prep.items, ...prep.liquorRefills]) {
    sharedState = applyStaffPrepPlanUpdate(sharedState, {
      generatedAt,
      itemId: item.id,
      completed: true,
      preparedBy: "Jordan",
      actualQuantity: item.quantity,
    }, { now: prepClock });
  }

  prep = buildStaffPrepPlan(sharedState);
  orders = buildWeeklyOrderTracking(sharedState, prepClock());

  assert.equal(prep.completedCount, prep.totalCount);
  assert.equal(prep.liquorRefillCompletedCount, prep.liquorRefillTotalCount);
  assert.equal(orders.receivedCount, orders.itemCount);
  assert.equal(orders.vendors.every((vendor) => vendor.ordered), true);
  assert.equal(prep.items[0].preparedBy, "Jordan");
  assert.equal(prep.liquorRefills[0].preparedBy, "Jordan");
});
