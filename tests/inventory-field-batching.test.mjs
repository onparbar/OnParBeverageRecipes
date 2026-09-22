import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import {
  createOperationalOutboxEntry,
  normalizeOperationalOutboxEntry,
} from "../public/operational-outbox.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");

function functionSource(name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\(`, "m");
  const start = source.search(pattern);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return source.slice(start, end + 2);
}

function makeEntry(id, field, value, clientOrder) {
  return createOperationalOutboxEntry({
    baseRevision: 7,
    payload: { action: "update-field", id, field, value, countedAt: "2026-09-22T12:00:00.000Z" },
    id: `entry-${id}-${field}`,
    updatedAt: "2026-09-22T12:00:00.000Z",
    clientOrder,
  });
}

function makeHarness(overrides = {}) {
  const writes = [];
  const scope = {
    inventoryFieldOutbox: {
      "vodka:onHand": makeEntry("vodka", "onHand", "4", 10),
      "gin:onHand": makeEntry("gin", "onHand", "5", 11),
      "vodka:par": makeEntry("vodka", "par", "8", 12),
    },
    inventoryActionOutbox: [],
    inventoryQueuedFieldKeys: new Set(),
    inventoryQueuedActionIds: new Set(),
    inventoryFieldSyncPendingCount: 0,
    inventorySharedRevision: 7,
    normalizeOperationalOutboxEntry,
    createOperationalOutboxEntry,
    clean: value => String(value ?? "").trim(),
    saveInventoryActionOutbox() { writes.push(["actions", structuredClone(scope.inventoryActionOutbox)]); return true; },
    saveInventoryFieldOutbox() { writes.push(["fields", structuredClone(scope.inventoryFieldOutbox)]); return true; },
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : ["2026-09-22T12:00:01.000Z"])); }
    },
    ...overrides,
  };
  const context = vm.createContext(scope);
  vm.runInContext(functionSource("stageInventoryFieldBatchOutbox"), context);
  return { scope, writes };
}

test("pending inventory fields collapse into one durable atomic save", () => {
  const { scope, writes } = makeHarness();
  const batch = scope.stageInventoryFieldBatchOutbox();
  assert.equal(batch.payload.action, "batch-update-fields");
  assert.equal(batch.payload.source, "field-auto-save");
  assert.deepEqual(batch.payload.changes.map(change => ({ ...change })), [
    { id: "vodka", field: "onHand", value: "4" },
    { id: "gin", field: "onHand", value: "5" },
    { id: "vodka", field: "par", value: "8" },
  ]);
  assert.equal(scope.inventoryActionOutbox.length, 1);
  assert.equal(Object.keys(scope.inventoryFieldOutbox).length, 0);
  assert.equal(writes[0][0], "actions", "the combined recovery entry is durable before individual entries are removed");
  assert.equal(writes[1][0], "fields");
});

test("field batching waits for active or conflicting saves", () => {
  for (const overrides of [
    { inventoryFieldSyncPendingCount: 1 },
    { inventoryQueuedFieldKeys: new Set(["vodka:onHand"]) },
    { inventoryActionOutbox: [makeEntry("earlier", "onHand", "1", 1)] },
  ]) {
    const { scope, writes } = makeHarness(overrides);
    assert.equal(scope.stageInventoryFieldBatchOutbox(), null);
    assert.equal(writes.length, 0);
    assert.equal(Object.keys(scope.inventoryFieldOutbox).length, 3);
  }
  const conflict = makeHarness();
  conflict.scope.inventoryFieldOutbox["vodka:onHand"].conflict = true;
  assert.equal(conflict.scope.stageInventoryFieldBatchOutbox(), null);
});

test("batch persistence failure leaves every individual recovery entry intact", () => {
  const { scope } = makeHarness({ saveInventoryActionOutbox: () => false });
  assert.equal(scope.stageInventoryFieldBatchOutbox(), null);
  assert.equal(scope.inventoryActionOutbox.length, 0);
  assert.equal(Object.keys(scope.inventoryFieldOutbox).length, 3);
});

test("inventory autosave timer flushes the combined queue", () => {
  const schedule = functionSource("scheduleInventoryFieldSync");
  assert.match(schedule, /flushPendingInventorySyncs\(\)/);
  assert.doesNotMatch(schedule, /queueInventoryFieldSync\(key, payload\)/);
});
