import assert from "node:assert/strict";
import test from "node:test";

import {
  applyInventoryStateAction,
  createEmptyInventoryState,
} from "../lib/inventory-store.mjs";

const monday = new Date("2026-08-17T15:00:00.000Z");
const items = [{ id: "vodka", name: "Vodka", onHandDisplay: "2", parDisplay: "4" }];
const summary = { tapCount: 2, liveTapCount: 2, pmbUpdatedAt: "2026-08-17T14:30:00.000Z" };
const kegPlanSnapshot = { generatedAt: "2026-08-17T14:45:00.000Z", items: [], tapInputs: [], summary: {} };
const captureMetadata = {
  captureId: "snapshot-attempt-2026-08-17",
  sourceFreshness: {
    inventory: "current",
    weeklyUsage: "current",
    pmb: "verified",
    pricing: "current",
    recommendations: "current",
  },
  sourceRevisions: { inventory: 4, weeklyUsage: 8, pmb: 2, pricing: 3, recommendations: 9 },
  sourceTimestamps: { inventory: monday.toISOString(), weeklyUsage: monday.toISOString(), pmb: monday.toISOString(), pricing: monday.toISOString(), recommendations: monday.toISOString() },
};

function initializedState() {
  const base = createEmptyInventoryState();
  const initialized = applyInventoryStateAction(base, "initialize", { onHandOverrides: { vodka: "2" } }, "owner", monday);
  return applyInventoryStateAction(initialized, "update-field", { id: "vodka", field: "onHand", value: "2" }, "owner", monday);
}

test("captures one immutable Monday snapshot with actor and source provenance", () => {
  const state = applyInventoryStateAction(initializedState(), "save-snapshot", {
    items,
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata,
  }, "owner", monday);
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.snapshots[0].weekOf, "2026-08-17");
  assert.equal(state.snapshots[0].captureMetadata.actorRole, "owner");
  assert.equal(state.snapshots[0].captureMetadata.captureId, captureMetadata.captureId);
  assert.equal(state.snapshots[0].captureMetadata.sourceRevisions.weeklyUsage, 8);
});

test("Monday capture archives NA beer for ordering then clears only its running count", () => {
  const initial = applyInventoryStateAction(createEmptyInventoryState(), "initialize", {
    onHandOverrides: { vodka: "2", "non-alcoholic-beer": "47" },
  }, "owner", monday);
  const counted = applyInventoryStateAction(initial, "batch-update-fields", {
    changes: [
      { id: "vodka", field: "onHand", value: "2" },
      { id: "non-alcoholic-beer", field: "onHand", value: "47" },
    ],
  }, "owner", monday);
  const captured = applyInventoryStateAction(counted, "save-snapshot", {
    items: [...items, { id: "non-alcoholic-beer", name: "Non Alcoholic Beer", group: "Other", onHandDisplay: "47", parDisplay: "48", orderDisplay: "24" }],
    summary, kegPlanSnapshot, reliableCapture: true, captureMetadata,
  }, "owner", monday);
  assert.equal(captured.snapshots[0].items.find((item) => item.id === "non-alcoholic-beer").onHandDisplay, "47");
  assert.equal(captured.snapshots[0].items.find((item) => item.id === "non-alcoholic-beer").orderDisplay, "24");
  assert.equal(captured.current.onHandOverrides.vodka, "2");
  assert.equal(captured.current.countedItemsAt.vodka, monday.toISOString());
  assert.equal(captured.current.onHandOverrides["non-alcoholic-beer"], undefined);
  assert.equal(captured.current.countedItemsAt["non-alcoholic-beer"], undefined);
});

test("a duplicate reliable capture preserves the first valid snapshot", () => {
  const first = applyInventoryStateAction(initializedState(), "save-snapshot", {
    items,
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata,
  }, "owner", monday);
  const duplicate = applyInventoryStateAction(first, "save-snapshot", {
    items: [{ ...items[0], onHandDisplay: "99" }],
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata,
  }, "owner", new Date("2026-08-17T20:00:00.000Z"));
  assert.equal(duplicate.snapshots.length, 1);
  assert.equal(duplicate.snapshots[0].items[0].onHandDisplay, "2");
  assert.equal(duplicate.snapshots[0].savedAt, first.snapshots[0].savedAt);
});

test("partial source data blocks capture without changing the prior state", () => {
  const base = initializedState();
  assert.throws(() => applyInventoryStateAction(base, "save-snapshot", {
    items,
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata: {
      ...captureMetadata,
      sourceFreshness: { ...captureMetadata.sourceFreshness, pricing: "missing" },
    },
  }, "owner", monday), (error) => error.code === "MONDAY_SNAPSHOT_SOURCE_INCOMPLETE");
  assert.equal(base.snapshots.length, 0);
});

test("an outside-Monday capture requires a reason", () => {
  assert.throws(() => applyInventoryStateAction(initializedState(), "save-snapshot", {
    items,
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata,
  }, "owner", new Date("2026-08-18T15:00:00.000Z")), (error) => error.code === "MONDAY_SNAPSHOT_REASON_REQUIRED");
});

test("an explained outside-Monday capture is saved for the Monday operating week", () => {
  const state = applyInventoryStateAction(initializedState(), "save-snapshot", {
    items,
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata: {
      ...captureMetadata,
      outsideMondayReason: "Inventory issues were corrected after Monday's count.",
    },
  }, "owner", new Date("2026-08-18T15:00:00.000Z"));
  assert.equal(state.snapshots[0].weekOf, "2026-08-17");
  assert.equal(state.snapshots[0].captureMetadata.capturedOutsideMonday, true);
  assert.equal(state.snapshots[0].captureMetadata.outsideMondayReason, "Inventory issues were corrected after Monday's count.");
});
