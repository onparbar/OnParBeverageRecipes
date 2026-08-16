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
  return applyInventoryStateAction(base, "initialize", { onHandOverrides: { vodka: "2" } }, "owner", monday);
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
  assert.equal(state.snapshots[0].captureMetadata.sourceRevisions.weeklyUsage, 8);
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

test("reliable capture has no fixed time but remains Monday Eastern only", () => {
  assert.throws(() => applyInventoryStateAction(initializedState(), "save-snapshot", {
    items,
    summary,
    kegPlanSnapshot,
    reliableCapture: true,
    captureMetadata,
  }, "owner", new Date("2026-08-18T15:00:00.000Z")), (error) => error.code === "MONDAY_SNAPSHOT_DAY_REQUIRED");
});
