import assert from "node:assert/strict";
import test from "node:test";

import {
  canSafelyRetryOperationalOutbox,
  createOperationalOutboxEntry,
  markOperationalOutboxFailure,
  normalizeOperationalOutboxList,
  normalizeOperationalOutboxMap,
  rebaseOperationalOutboxAfterOwnCommit,
} from "../public/operational-outbox.mjs";

test("operational outboxes retry only against their recorded base revision", () => {
  const entry = createOperationalOutboxEntry({
    baseRevision: 7,
    payload: { action: "replace", data: { rows: [1] } },
    id: "weekly-1",
    updatedAt: "2026-08-12T12:00:00.000Z",
  });

  assert.equal(canSafelyRetryOperationalOutbox(entry, 7), true);
  assert.equal(canSafelyRetryOperationalOutbox(entry, 8), false);
  assert.equal(canSafelyRetryOperationalOutbox(entry, -1), false);
});

test("conflicts retain the desired payload for explicit review", () => {
  const entry = createOperationalOutboxEntry({
    baseRevision: 3,
    payload: { action: "sync-state", onHandOverrides: { tap: "2" } },
    id: "keg-1",
  });
  const conflicted = markOperationalOutboxFailure(entry, {
    conflict: true,
    currentRevision: 5,
    message: "Another manager changed Keg Levels.",
  });

  assert.equal(conflicted.conflict, true);
  assert.equal(conflicted.currentRevision, 5);
  assert.deepEqual(conflicted.payload.onHandOverrides, { tap: "2" });
});

test("only a known successful local commit rebases later pending operations", () => {
  const entry = createOperationalOutboxEntry({
    baseRevision: 4,
    payload: { action: "update-field", id: "vodka", field: "onHand", value: "3" },
    id: "inventory-1",
  });

  assert.equal(rebaseOperationalOutboxAfterOwnCommit(entry, {
    committedBaseRevision: 2,
    nextRevision: 5,
  }).baseRevision, 4);
  assert.equal(rebaseOperationalOutboxAfterOwnCommit(entry, {
    committedBaseRevision: 4,
    nextRevision: 5,
  }).baseRevision, 5);
});

test("invalid persisted map entries are ignored without losing valid operations", () => {
  const valid = createOperationalOutboxEntry({
    baseRevision: 1,
    payload: { action: "update-field", id: "gin", field: "par", value: "4" },
    id: "inventory-2",
  });
  const normalized = normalizeOperationalOutboxMap({ valid, invalid: { baseRevision: -1 } });
  assert.deepEqual(Object.keys(normalized), ["valid"]);
});

test("inventory mutation operations retain their browser order across reload", () => {
  const later = createOperationalOutboxEntry({
    baseRevision: 9,
    payload: { action: "restore-snapshot", id: "inventory-2026-08-10" },
    id: "operation-2",
    clientOrder: 102,
  });
  const earlier = createOperationalOutboxEntry({
    baseRevision: 9,
    payload: { action: "upsert-custom", item: { id: "tonic", name: "Tonic" } },
    id: "operation-1",
    clientOrder: 101,
  });

  const restored = normalizeOperationalOutboxList([later, { baseRevision: -1 }, earlier]);

  assert.deepEqual(restored.map((entry) => entry.id), ["operation-1", "operation-2"]);
  assert.deepEqual(restored.map((entry) => entry.payload.action), ["upsert-custom", "restore-snapshot"]);
});
