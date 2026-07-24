import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteInventorySnapshotState,
  getMondayDate,
  hydrateInventoryState,
  readInventoryState,
  restoreInventorySnapshotState,
  saveInventorySnapshot,
  updateInventoryField,
} from "../lib/inventory-store.mjs";

async function useTemporaryState() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onpar-inventory-"));
  process.env.INVENTORY_STATE_PATH = path.join(directory, "inventory-state.json");
  return process.env.INVENTORY_STATE_PATH;
}

test("hydrates shared state only once", async () => {
  await useTemporaryState();
  await hydrateInventoryState({
    onHandOverrides: { vodka: "3" },
    parOverrides: { vodka: "5" },
  });
  await hydrateInventoryState({ onHandOverrides: { vodka: "99" } });
  const state = await readInventoryState();
  assert.equal(state.initialized, true);
  assert.equal(state.current.onHandOverrides.vodka, "3");
  assert.equal(state.current.parOverrides.vodka, "5");
});

test("serializes concurrent field updates without losing either item", async () => {
  const statePath = await useTemporaryState();
  await hydrateInventoryState({});
  await Promise.all([
    updateInventoryField({ id: "vodka", field: "onHand", value: "2" }),
    updateInventoryField({ id: "gin", field: "onHand", value: "4" }),
  ]);
  const state = await readInventoryState();
  assert.deepEqual(state.current.onHandOverrides, { vodka: "2", gin: "4" });
  const storedJson = await readFile(statePath, "utf8");
  assert.doesNotThrow(() => JSON.parse(storedJson));
});

test("uses Monday as the snapshot week and replaces that week's prior save", async () => {
  await useTemporaryState();
  await hydrateInventoryState({});
  const items = [{ name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" }];
  await saveInventorySnapshot(items, "owner", new Date(2026, 6, 24, 12));
  await saveInventorySnapshot([{ ...items[0], onHandDisplay: "3" }], "owner", new Date(2026, 6, 26, 12));
  const state = await readInventoryState();
  assert.equal(getMondayDate(new Date(2026, 6, 24, 12)), "2026-07-20");
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.snapshots[0].items[0].onHandDisplay, "3");
});

test("restores and deletes a snapshot", async () => {
  await useTemporaryState();
  await hydrateInventoryState({ onHandOverrides: { vodka: "9" } });
  const state = await saveInventorySnapshot([
    { name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" },
  ], "owner", new Date(2026, 6, 24, 12));
  await updateInventoryField({ id: "vodka", field: "onHand", value: "7" });
  const restored = await restoreInventorySnapshotState(state.snapshots[0].id);
  assert.equal(restored.current.onHandOverrides.vodka, "2");
  assert.equal(restored.current.parOverrides.vodka, "4");
  const deleted = await deleteInventorySnapshotState(state.snapshots[0].id);
  assert.equal(deleted.snapshots.length, 0);
});
