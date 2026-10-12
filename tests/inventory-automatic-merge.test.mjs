import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { applyInventoryStateAction, createEmptyInventoryState, normalizeInventoryState } from "../lib/inventory-store.mjs";
import { markOperationalOutboxFailure, canSafelyRetryOperationalOutbox, createOperationalOutboxEntry } from "../public/operational-outbox.mjs";

const morning = "2026-10-12T12:00:00.000Z";
const afternoon = "2026-10-12T16:00:00.000Z";
const later = new Date("2026-10-12T17:00:00.000Z");
const apply = (state, action, payload, at = later) => applyInventoryStateAction(state, action, payload, "owner", at);
const initial = () => apply(createEmptyInventoryState(), "initialize", { onHandOverrides: { jack: "20", gin: "4" } }, new Date(morning));

test("an old browser count cannot overwrite a newer count while unrelated edits still merge", () => {
  let state = apply(initial(), "update-field", { id: "jack", field: "onHand", value: "10", countedAt: afternoon });
  state = apply(normalizeInventoryState(state), "batch-update-fields", { countedAt: morning, changes: [
    { id: "jack", field: "onHand", value: "20" }, { id: "gin", field: "onHand", value: "6" },
  ] });
  assert.equal(state.current.onHandOverrides.jack, "10");
  assert.equal(state.current.countedItemsAt.jack, afternoon);
  assert.equal(state.current.onHandOverrides.gin, "6");
});

test("batch conversion preserves each item's original count time", () => {
  let state = apply(initial(), "update-field", { id: "jack", field: "onHand", value: "10", countedAt: afternoon });
  state = apply(state, "batch-update-fields", { countedAt: later.toISOString(), changes: [
    { id: "jack", field: "onHand", value: "20", countedAt: morning },
    { id: "gin", field: "onHand", value: "7", countedAt: later.toISOString() },
  ] });
  assert.equal(state.current.onHandOverrides.jack, "10");
  assert.equal(state.current.onHandOverrides.gin, "7");
});

test("cleared fields and pars retain a timestamp so stale retries cannot resurrect them", () => {
  let state = apply(initial(), "batch-update-fields", { countedAt: afternoon, changes: [
    { id: "jack", field: "onHand", value: "" }, { id: "jack", field: "par", value: "12" },
  ] });
  state = apply(normalizeInventoryState(state), "update-field", { countedAt: morning, id: "jack", field: "onHand", value: "20" });
  state = apply(state, "update-field", { countedAt: morning, id: "jack", field: "par", value: "8" });
  assert.equal(state.current.onHandOverrides.jack, undefined);
  assert.equal(state.current.parOverrides.jack, "12");
  assert.equal(state.current.countedItemsAt.jack, undefined);
});

test("a delayed count cannot refund ingredients already used by a newer prep completion", () => {
  let state = apply(initial(), "apply-contributions", { sources: [{ sourceId: "whiskey-sour", effectiveAt: afternoon, contributions: [{ id: "jack", quantity: -10, baseline: 20 }] }] }, new Date(afternoon));
  state = apply(state, "update-field", { id: "jack", field: "onHand", value: "20", countedAt: morning });
  assert.equal(state.current.onHandOverrides.jack, "10");
  assert.equal(state.current.inventoryContributions["whiskey-sour::jack"].quantity, -10);
});

test("submit confirmation cannot overwrite an edit arriving after its shared read", () => {
  let state = apply(initial(), "update-field", { id: "jack", field: "onHand", value: "10", countedAt: afternoon });
  state = apply(state, "batch-update-fields", { source: "section-count", countedAt: later.toISOString(), changes: [
    { id: "jack", field: "onHand", value: "20", expectedValue: "20" },
    { id: "gin", field: "onHand", value: "4", expectedValue: "4" },
  ] });
  assert.equal(state.current.onHandOverrides.jack, "10");
  assert.equal(state.current.countedItemsAt.jack, afternoon);
  assert.equal(state.current.countedItemsAt.gin, later.toISOString());
});

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
}
function entry(action, id) {
  return markOperationalOutboxFailure(createOperationalOutboxEntry({ id, baseRevision: 2, updatedAt: morning, payload: { action, id: "jack", field: "onHand", value: "10", countedAt: morning } }), { conflict: true, currentRevision: 8, message: "stale" });
}

test("legacy routine conflict flags automatically clear without a confirmation or rebasing snapshot inputs", () => {
  const scope = {
    inventorySharedRevision: 8,
    inventoryFieldOutbox: { jack: entry("update-field", "field") },
    inventoryActionOutbox: [entry("reorder-items", "order"), entry("batch-update-fields", "batch"), entry("restore-snapshot", "restore")],
    clean: value => String(value || "").trim(), markOperationalOutboxFailure, canSafelyRetryOperationalOutbox,
    saveInventoryFieldOutbox: () => true, saveInventoryActionOutbox: () => true,
  };
  vm.runInContext(`${functionSource("canAutoRecoverInventoryOperation")}\n${functionSource("recoverRoutineInventoryConflicts")}`, vm.createContext(scope));
  assert.equal(scope.recoverRoutineInventoryConflicts(), true);
  assert.equal(scope.inventoryFieldOutbox.jack.conflict, false);
  assert.equal(scope.inventoryFieldOutbox.jack.payload.countedAt, morning);
  assert.equal(scope.inventoryActionOutbox[0].conflict, false);
  assert.equal(scope.inventoryActionOutbox[1].conflict, false);
  assert.equal(scope.inventoryActionOutbox[2].conflict, true);
});


test("a baseline count with no saved override can be confirmed, but not over a concurrent new override", () => {
  const state = initial();
  const payload = { source: "section-count", changes: [{ id: "tonic", field: "onHand", value: "5", expectedValue: "" }] };
  const counted = apply(state, "batch-update-fields", payload);
  assert.equal(counted.current.onHandOverrides.tonic, "5");
  const concurrent = apply(state, "update-field", { id: "tonic", field: "onHand", value: "9" });
  assert.equal(apply(concurrent, "batch-update-fields", payload).current.onHandOverrides.tonic, "9");
});

function recoveryHarness({ put = async () => {}, persist = () => true } = {}) {
  const rejected = entry("save-snapshot", "rejected");
  const unknown = createOperationalOutboxEntry({ id: "unknown", baseRevision: 8, updatedAt: afternoon, payload: { action: "save-snapshot", captureId: "unknown" } });
  const scope = {
    inventoryActionOutbox: [rejected, unknown], inventorySharedSaveError: "old conflict",
    inventorySnapshotRecoveryJournal: { put }, saveInventoryActionOutbox: persist,
    getPendingInventoryOperations: () => scope.inventoryActionOutbox,
  };
  vm.runInContext(functionSource("retireRejectedInventorySnapshots"), vm.createContext(scope));
  return scope;
}

test("snapshot recovery archives rejected captures while preserving unknown outcomes and new edits", async () => {
  const archived = [];
  let release;
  const h = recoveryHarness({ put: async record => { archived.push(record); await new Promise(resolve => { release = resolve; }); } });
  const recovery = h.retireRejectedInventorySnapshots();
  h.inventoryActionOutbox.push(entry("batch-update-fields", "new-count"));
  release();
  assert.equal(await recovery, true);
  assert.deepEqual(archived.map(record => record.id), ["rejected"]);
  assert.deepEqual(Array.from(h.inventoryActionOutbox, record => record.id), ["unknown", "new-count"]);
});

test("snapshot archive or outbox write failure retains the full pending capture", async () => {
  for (const options of [{ put: async () => { throw new Error("storage unavailable"); } }, { persist: () => false }]) {
    const h = recoveryHarness(options);
    assert.equal(await h.retireRejectedInventorySnapshots(), false);
    assert.deepEqual(Array.from(h.inventoryActionOutbox, record => record.id), ["rejected", "unknown"]);
  }
});
