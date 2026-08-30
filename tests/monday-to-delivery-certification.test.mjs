import assert from "node:assert/strict";
import test from "node:test";

import { applyStaffPrepPlanUpdate, buildStaffPrepPlan } from "../lib/staff-prep-plan.mjs";
import {
  applyWeeklyOrderTrackingUpdate,
  buildWeeklyOrderTracking,
} from "../lib/weekly-order-tracking.mjs";
import { runPmbRefreshTransaction } from "../public/pmb-refresh.mjs";
import { parseSmartReceivingTranscript } from "../public/smart-receiving.mjs";
import { parseInventoryTranscript } from "../public/speech-inventory.mjs";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";

test("certifies refresh, voice count, lock, order, receive, prep, and completion", async () => {
  const generatedAt = "2026-08-31T13:00:00.000Z";
  const now = () => new Date(generatedAt);
  const refresh = await runPmbRefreshTransaction({
    sources: [
      { key: "levels", run: async () => ({ count: 102 }) },
      { key: "usage", run: async () => ({ count: 102 }) },
      { key: "pricing", run: async () => ({ count: 72 }) },
    ],
    now,
  });
  assert.equal(refresh.status, "ok");

  const count = parseInventoryTranscript("main wall one voodoo ranger ipa", [{
    id: "voodoo",
    name: "Voodoo Ranger IPA 1",
    aliases: ["Voodoo Ranger IPA"],
    target: "keg",
    wall: "Main",
    group: "Main cooler",
    unit: "kegs",
    currentValue: "0",
  }]);
  assert.deepEqual(count.proposals.map(({ matchedId, quantity }) => [matchedId, quantity]), [["voodoo", 1]]);

  const items = [
    {
      key: "main-42-voodoo",
      actionType: "order",
      isKegTap: true,
      orderQty: 1,
      orderProductName: "Voodoo Ranger IPA",
      vendor: "Bonbright",
      unitCost: 180,
      tapNumber: 42,
      wall: "Main",
    },
    {
      key: "main-47-bacardi",
      actionType: "make",
      orderQty: 1,
      name: "Bacardi Sunset 1",
      tapNumber: 47,
      wall: "Main",
      priority: 1,
    },
  ];
  let shared = {
    generatedAt,
    items,
    mondayInventorySnapshot: { savedAt: generatedAt, reason: "Certified count" },
    weeklyPlanSnapshot: createWeeklyPlanSnapshot({
      generatedAt,
      recommendations: items,
      publishedAt: generatedAt,
    }),
  };
  let tracking = buildWeeklyOrderTracking(shared, now());
  const vendor = tracking.vendors[0];
  shared = applyWeeklyOrderTrackingUpdate(shared, {
    action: "set-ordered",
    generatedAt,
    vendorId: vendor.id,
    ordered: true,
    orderedBy: "Sam",
  }, { role: "owner", now });
  tracking = buildWeeklyOrderTracking(shared, now());
  const proposal = parseSmartReceivingTranscript(
    "everything from Bonbright was delivered",
    { available: true, ...tracking },
  ).proposal;
  shared = applyWeeklyOrderTrackingUpdate(shared, {
    action: "set-receipts",
    generatedAt,
    vendorId: vendor.id,
    confirmed: true,
    handledBy: "Jordan",
    receipts: proposal.lines.map((line) => ({
      itemId: line.itemId,
      status: line.status,
      receivedQuantity: line.receivedQuantity,
      reason: line.reason,
    })),
  }, { role: "employee", now });
  tracking = buildWeeklyOrderTracking(shared, now());
  assert.equal(tracking.receivedCount, tracking.itemCount);

  let prep = buildStaffPrepPlan(shared);
  shared = applyStaffPrepPlanUpdate(shared, {
    generatedAt,
    itemId: prep.items[0].id,
    completed: true,
    preparedBy: "Jordan",
    actualQuantity: prep.items[0].quantity,
  }, { now });
  prep = buildStaffPrepPlan(shared);
  assert.equal(prep.completedCount, prep.totalCount);
});
