import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  deleteInventorySnapshotState,
  getMondayDate,
  hydrateInventoryState,
  readInventoryState,
  reorderInventoryItems,
  restoreInventorySnapshotState,
  saveInventorySnapshot,
  updateInventoryField,
  upsertCustomInventoryItem,
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

test("persists custom item edits and shared cabinet order", async () => {
  await useTemporaryState();
  await hydrateInventoryState({});
  await upsertCustomInventoryItem({
    id: "bacardi-1l",
    name: "Bacardi 1L",
    group: "Liquor Cabinet",
    onHandDisplay: "3",
    parDisplay: "",
    packSize: 1,
    unitCost: 0,
  });
  await upsertCustomInventoryItem({
    id: "bacardi-1l",
    name: "Bacardi Superior 1L",
    group: "Liquor Cabinet",
    onHandDisplay: "3",
    parDisplay: "6",
    packSize: 1,
    unitCost: 18.5,
    vendorProduct: {
      vendor: "OHLQ",
      syncVendor: "OHLQ",
      productName: "Bacardi Superior White Rum 1L",
      bottleOz: 33.814,
    },
    matchedSku: "BACARDI-1L",
  });
  const state = await reorderInventoryItems(["tito-s", "bacardi-1l"]);
  const customItem = state.current.customItems[0];
  assert.equal(customItem.name, "Bacardi Superior 1L");
  assert.equal(customItem.unitCost, 18.5);
  assert.equal(customItem.vendorProduct.bottleOz, 33.814);
  assert.equal(state.current.onHandOverrides["bacardi-1l"], "3");
  assert.equal(state.current.parOverrides["bacardi-1l"], "6");
  assert.deepEqual(state.current.itemOrder, ["tito-s", "bacardi-1l"]);
});

test("uses Monday as the snapshot week and replaces that week's prior save", async () => {
  await useTemporaryState();
  await hydrateInventoryState({});
  const items = [{ name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" }];
  const summary = {
    bottleInventoryValue: 100,
    connectedLineValue: 200,
    backupKegValue: 300,
    currentLineValue: 500,
    totalBeverageInventoryValue: 600,
    pmbUpdatedAt: "2026-07-24T12:00:00.000Z",
    liveTapCount: 102,
    tapCount: 102,
  };
  await saveInventorySnapshot(items, "owner", new Date(2026, 6, 24, 12), summary);
  await saveInventorySnapshot([{ ...items[0], onHandDisplay: "3" }], "owner", new Date(2026, 6, 26, 12), summary);
  const state = await readInventoryState();
  assert.equal(getMondayDate(new Date(2026, 6, 24, 12)), "2026-07-20");
  assert.equal(state.snapshots.length, 1);
  assert.equal(state.snapshots[0].items[0].onHandDisplay, "3");
  assert.deepEqual(state.snapshots[0].summary, summary);
  assert.deepEqual(state.current.onHandOverrides, {});
});

test("saving Monday inventory preserves the snapshot and clears current counts only", async () => {
  await useTemporaryState();
  await hydrateInventoryState({
    onHandOverrides: { vodka: "3", gin: "2" },
    parOverrides: { vodka: "5", gin: "4" },
  });
  const state = await saveInventorySnapshot([
    { id: "vodka", name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "3", parDisplay: "5" },
    { id: "gin", name: "Gin", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" },
  ], "owner", new Date(2026, 7, 10, 12), {
    bottleInventoryValue: 50,
    connectedLineValue: 30,
    backupKegValue: 10,
    liveTapCount: 2,
    tapCount: 2,
  });

  assert.deepEqual(state.snapshots[0].items.map(({ id, onHandDisplay }) => ({ id, onHandDisplay })), [
    { id: "vodka", onHandDisplay: "3" },
    { id: "gin", onHandDisplay: "2" },
  ]);
  assert.deepEqual(state.current.onHandOverrides, {});
  assert.deepEqual(state.current.parOverrides, { vodka: "5", gin: "4" });
});

test("Monday inventory embeds frozen keg inputs, cocktail prep, and active orders", async () => {
  await useTemporaryState();
  await hydrateInventoryState({});
  const generatedAt = "2026-08-10T14:00:00.000Z";
  const state = await saveInventorySnapshot([
    { id: "vodka", name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" },
  ], "owner", new Date(2026, 7, 10, 12), {
    bottleInventoryValue: 50,
    connectedLineValue: 30,
    backupKegValue: 10,
    liveTapCount: 2,
    tapCount: 2,
  }, {
    generatedAt,
    summary: { tapCount: 2, cocktailMakeCount: 1, kegOrderCount: 0 },
    tapInputs: [
      { key: "main-47-cocktail", tapNumber: 47, wall: "Main", name: "Blue Dot 1", liveFraction: 0.2, backupKegs: 1, avgWeeklyKegs: 1.4 },
      { key: "main-21-beer", tapNumber: 21, wall: "Main", name: "Beer", liveFraction: 0.8, backupKegs: 0, avgWeeklyKegs: 0.5 },
    ],
    items: [
      { key: "main-47-cocktail", tapNumber: 47, wall: "Main", name: "Blue Dot 1", isKegTap: true, actionType: "make", orderQty: 1, rawOrderQty: 1, orderProductName: "Blue Dot 1", currentStockKegs: 1.2, avgWeeklyKegs: 1.4 },
      { key: "main-21-beer", tapNumber: 21, wall: "Main", name: "Beer", isKegTap: true, actionType: "order", orderQty: 0, rawOrderQty: 0 },
    ],
  });

  assert.equal(state.snapshots[0].kegPlanSnapshot.generatedAt, generatedAt);
  assert.equal(state.snapshots[0].kegPlanSnapshot.tapInputs.length, 2);
  assert.equal(state.snapshots[0].kegPlanSnapshot.tapInputs[0].backupKegs, 1);
  assert.deepEqual(
    state.snapshots[0].kegPlanSnapshot.items.map(({ actionType, orderProductName, orderQty }) => ({ actionType, orderProductName, orderQty })),
    [{ actionType: "make", orderProductName: "Blue Dot 1", orderQty: 1 }],
  );
  assert.equal(state.snapshots[0].kegPlanSnapshot.summary.cocktailMakeCount, 1);
});

test("restores and deletes a snapshot", async () => {
  await useTemporaryState();
  await hydrateInventoryState({ onHandOverrides: { vodka: "9" } });
  const state = await saveInventorySnapshot([
    { name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" },
  ], "owner", new Date(2026, 6, 24, 12), {
    bottleInventoryValue: 20,
    connectedLineValue: 30,
    backupKegValue: 10,
    currentLineValue: 999,
    totalBeverageInventoryValue: 999,
    liveTapCount: 1,
    tapCount: 1,
  });
  await updateInventoryField({ id: "vodka", field: "onHand", value: "7" });
  const restored = await restoreInventorySnapshotState(state.snapshots[0].id);
  assert.equal(restored.current.onHandOverrides.vodka, "2");
  assert.equal(restored.current.parOverrides.vodka, "4");
  const deleted = await deleteInventorySnapshotState(state.snapshots[0].id);
  assert.equal(deleted.snapshots.length, 0);
});

test("rejects incomplete PMB coverage and recomputes derived beverage totals", async () => {
  await useTemporaryState();
  await hydrateInventoryState({});
  const items = [{ name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" }];
  await assert.rejects(
    saveInventorySnapshot(items, "owner", new Date(2026, 6, 24, 12), {
      bottleInventoryValue: 20,
      connectedLineValue: 30,
      backupKegValue: 10,
      liveTapCount: 100,
      tapCount: 102,
    }),
    /Complete PMB tap coverage/,
  );
  const state = await saveInventorySnapshot(items, "owner", new Date(2026, 6, 24, 12), {
    bottleInventoryValue: 20,
    connectedLineValue: 30,
    backupKegValue: 10,
    currentLineValue: 999,
    totalBeverageInventoryValue: 999,
    liveTapCount: 102,
    tapCount: 102,
  });
  assert.equal(state.snapshots[0].summary.currentLineValue, 40);
  assert.equal(state.snapshots[0].summary.totalBeverageInventoryValue, 60);
});

test("recovers the latest Monday snapshot from the atomic backup", async () => {
  const statePath = await useTemporaryState();
  await hydrateInventoryState({});
  await saveInventorySnapshot([
    { id: "vodka", name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2", parDisplay: "4" },
  ], "owner", new Date(2026, 7, 10, 12), {
    bottleInventoryValue: 20,
    connectedLineValue: 30,
    backupKegValue: 10,
    liveTapCount: 1,
    tapCount: 1,
  });
  await writeFile(statePath, "not json", "utf8");

  const recovered = await readInventoryState();
  assert.equal(recovered.snapshots[0].weekOf, "2026-08-10");
  assert.equal(recovered.snapshots[0].items[0].onHandDisplay, "2");
});
