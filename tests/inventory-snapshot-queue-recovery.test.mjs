import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { applyInventoryStateAction, createEmptyInventoryState } from "../lib/inventory-store.mjs";
import {
  canSafelyRetryOperationalOutbox, createOperationalOutboxEntry,
  markOperationalOutboxFailure, normalizeOperationalOutboxEntry,
  rebaseOperationalOutboxAfterOwnCommit,
} from "../public/operational-outbox.mjs";
import { isRejectedInventorySnapshot } from "../public/inventory-snapshot-recovery.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const stamp = "2026-11-02T16:00:00.000Z";
const cabinet = { "don-julio-blanco": "2", "crown-royal-peach": "2", "woodford-reserve": "2" };
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `Missing ${name}`);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
}
function snapshot(id, capturedRevision = 9) {
  return createOperationalOutboxEntry({ id, baseRevision: 9, clientOrder: 1, updatedAt: stamp,
    payload: { action: "save-snapshot", reliableCapture: true, captureId: id,
      snapshotBaseState: { revision: capturedRevision } } });
}
function harness({ failSnapshot = false, failArchive = false } = {}) {
  const archived = [];
  const requests = [];
  let shared = applyInventoryStateAction(createEmptyInventoryState(), "initialize", {
    onHandOverrides: { ...cabinet, "simple-syrup": "0", gin: "4" },
  }, "owner", new Date(stamp));
  shared.revision = 9;
  const scope = {
    inventorySharedInitialized: true, inventorySharedProvisioned: true,
    inventorySharedRevision: 9, inventorySharedUpdatedAt: stamp,
    inventorySharedSaving: false, inventorySharedSaveError: "Snapshot inputs do not match the expected inventory revision.",
    inventorySharedMessage: "", inventoryFieldOutboxDurable: true, inventoryActionOutboxDurable: true,
    inventoryFieldOutbox: {}, inventoryActionOutbox: [], inventoryOutboxClientOrder: 10,
    inventoryQueuedFieldKeys: new Set(), inventoryQueuedActionIds: new Set(),
    inventoryFieldSyncPendingCount: 0, inventoryFieldSyncQueue: Promise.resolve(),
    inventoryFieldSyncTimers: new Map(), inventoryFieldSyncFailures: new Map(),
    inventoryCountedItemsAt: {}, inventoryContributions: {}, inventoryContributionShortfalls: {},
    inventoryOnHandOverrides: { ...shared.current.onHandOverrides },
    createOperationalOutboxEntry, normalizeOperationalOutboxEntry,
    markOperationalOutboxFailure, rebaseOperationalOutboxAfterOwnCommit,
    canSafelyRetryOperationalOutbox, isRejectedInventorySnapshot,
    clean: value => String(value ?? "").trim(), clearTimeout,
    saveInventoryActionOutbox: () => true, saveInventoryFieldOutbox: () => true,
    renderInventoryPanels: () => {}, renderWeeklyPlan: () => {}, renderInventory: () => {},
    overlayInventoryOutboxes: () => {
      Object.values(scope.inventoryFieldOutbox).forEach(({ payload }) => {
        if (payload.field === "onHand") scope.inventoryOnHandOverrides[payload.id] = payload.value;
      });
    },
    inventorySnapshotRecoveryJournal: { put: async record => {
      if (failArchive) throw new Error("Recovery storage unavailable");
      archived.push(structuredClone(record));
    } },
    requestSharedInventory: async body => {
      requests.push(body ? structuredClone(body) : { action: "read" });
      if (body?.action === "save-snapshot") {
        if (failSnapshot) throw Object.assign(new Error("Snapshot inputs do not match the expected inventory revision."), {
          code: "INVALID_INVENTORY_STATE_REVISION", status: 400,
        });
        // Simulate the server acknowledging an already committed captureId.
        assert.equal(body.captureId, "unknown");
        assert.equal(body.expectedRevision, body.snapshotBaseState.revision);
      } else if (body) {
        const revision = shared.revision;
        shared = applyInventoryStateAction(shared, body.action, body, "owner", new Date(stamp));
        shared.revision = revision + 1;
      }
      return structuredClone(shared);
    },
    applySharedInventoryState: state => {
      scope.inventorySharedRevision = state.revision;
      scope.inventoryOnHandOverrides = { ...state.current.onHandOverrides };
    },
  };
  const names = [
    "getPendingInventoryOperations", "hasEarlierFailedInventoryOperation", "canAutoRecoverInventoryOperation",
    "recoverRoutineInventoryConflicts", "stageInventoryFieldBatchOutbox", "nextInventoryOutboxClientOrder",
    "stageInventoryActionOutbox", "queueInventoryActionSync", "queueInventoryFieldSync",
    "retireRejectedInventorySnapshots", "flushPendingInventorySyncs", "refreshInventoryForSubmit",
    "loadSharedInventoryState",
  ];
  vm.runInContext(names.map(functionSource).join("\n"), vm.createContext(scope));
  return { scope, archived, requests, state: () => shared };
}

test("the count-save refresh retires only the malformed capture and saves pending counts", async () => {
  const h = harness();
  const malformed = snapshot("malformed", 8);
  const unknown = snapshot("unknown");
  unknown.clientOrder = 2;
  h.scope.inventoryActionOutbox = [malformed, unknown, createOperationalOutboxEntry({
    id: "pending-action", baseRevision: 9, clientOrder: 3, updatedAt: stamp,
    payload: { action: "batch-update-fields", countedAt: stamp, changes: [{ id: "simple-syrup", field: "onHand", value: "0" }] },
  })];
  h.scope.inventoryFieldOutbox = { "gin:onHand": createOperationalOutboxEntry({
    id: "pending-field", baseRevision: 9, clientOrder: 4, updatedAt: stamp,
    payload: { action: "update-field", id: "gin", field: "onHand", value: "5", countedAt: stamp },
  }) };
  await h.scope.refreshInventoryForSubmit();
  assert.deepEqual(h.archived.map(record => record.id), ["malformed"]);
  assert.deepEqual(h.archived[0].payload, malformed.payload);
  assert.deepEqual(h.requests.map(request => request.action), ["save-snapshot", "batch-update-fields", "update-field", "read"]);
  assert.equal(h.requests[0].captureId, "unknown", "a valid uncertain capture is retried, never discarded");
  assert.equal(h.state().current.onHandOverrides.gin, "5");
  assert.equal(h.state().current.onHandOverrides["simple-syrup"], "0");
  for (const [id, count] of Object.entries(cabinet)) assert.equal(h.state().current.onHandOverrides[id], count);
  assert.equal(h.scope.getPendingInventoryOperations().length, 0);

  h.scope.stageInventoryActionOutbox({ action: "batch-update-fields", source: "section-count",
    changes: [{ id: "simple-syrup", field: "onHand", value: "0", expectedValue: "0" }] });
  assert.equal(await h.scope.flushPendingInventorySyncs(), true, "a fresh weekly count can save after recovery");
  for (const [id, count] of Object.entries(cabinet)) assert.equal(h.state().current.onHandOverrides[id], count);
});

test("reloading retires a malformed capture before the retry logic clears its failure", async () => {
  const h = harness();
  h.scope.inventoryActionOutbox = [snapshot("malformed", 8)];
  await h.scope.loadSharedInventoryState();
  assert.deepEqual(h.archived.map(record => record.id), ["malformed"]);
  assert.deepEqual(h.requests.map(request => request.action), ["read"]);
  assert.equal(h.scope.getPendingInventoryOperations().length, 0);
  assert.equal(h.scope.inventorySharedSaveError, "");
  for (const [id, count] of Object.entries(cabinet)) assert.equal(h.scope.inventoryOnHandOverrides[id], count);
});

test("an explicit snapshot revision 400 is retained as rejected across serialization", async () => {
  const h = harness({ failSnapshot: true });
  h.scope.inventoryActionOutbox = [snapshot("rejected-400")];
  await h.scope.queueInventoryActionSync("rejected-400");
  const restored = normalizeOperationalOutboxEntry(JSON.parse(JSON.stringify(h.scope.inventoryActionOutbox[0])));
  assert.equal(restored.conflict, true);
  h.scope.inventoryActionOutbox = [restored];
  assert.equal(await h.scope.retireRejectedInventorySnapshots(), true);
  assert.deepEqual(h.archived.map(record => record.id), ["rejected-400"]);
  for (const [id, count] of Object.entries(cabinet)) assert.equal(h.state().current.onHandOverrides[id], count);
});

test("an archive failure prevents count writes and retains malformed and uncertain captures", async () => {
  const h = harness({ failArchive: true });
  h.scope.inventoryActionOutbox = [snapshot("malformed", 8), snapshot("unknown")];
  await assert.rejects(h.scope.refreshInventoryForSubmit(), /entered counts have not finished saving/);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(h.scope.inventoryActionOutbox.map(record => record.id), ["malformed", "unknown"]);
  for (const [id, count] of Object.entries(cabinet)) assert.equal(h.state().current.onHandOverrides[id], count);
});

test("reload preserves displayed pending counts when snapshot archival fails", async () => {
  const h = harness({ failArchive: true });
  h.scope.inventoryActionOutbox = [snapshot("malformed", 8)];
  h.scope.inventoryFieldOutbox = { "gin:onHand": createOperationalOutboxEntry({
    id: "pending-field", baseRevision: 9, clientOrder: 4, updatedAt: stamp,
    payload: { action: "update-field", id: "gin", field: "onHand", value: "7", countedAt: stamp },
  }) };
  await h.scope.loadSharedInventoryState();
  assert.equal(h.scope.inventoryOnHandOverrides.gin, "7");
  assert.equal(h.state().current.onHandOverrides.gin, "4");
  assert.equal(h.scope.getPendingInventoryOperations().length, 2);
  assert.deepEqual(h.requests.map(request => request.action), ["read"]);
  assert.match(h.scope.inventorySharedSaveError, /Recovery storage unavailable/);
});
