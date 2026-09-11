import assert from "node:assert/strict";
import test from "node:test";
import { applyInventoryStateAction, normalizeInventoryState } from "../lib/inventory-store.mjs";

function inventory() {
  return applyInventoryStateAction({}, "initialize", {
    onHandOverrides: { bitters: 7, vodka: 3 },
    parOverrides: { bitters: 2 },
    itemOrder: ["bitters", "vodka"],
  });
}

test("a cabinet move persists with item order and preserves counts and reserves", () => {
  const original = inventory();
  const moved = applyInventoryStateAction(original, "reorder-items", {
    itemOrder: ["vodka", "bitters"],
    movedItem: { id: "bitters", group: "Liquor Cabinet" },
  });
  const restored = normalizeInventoryState(JSON.parse(JSON.stringify(moved)));
  assert.deepEqual(restored.current.itemOrder, ["vodka", "bitters"]);
  assert.equal(restored.current.groupOverrides.bitters, "Liquor Cabinet");
  assert.deepEqual(restored.current.onHandOverrides, original.current.onHandOverrides);
  assert.deepEqual(restored.current.parOverrides, original.current.parOverrides);
  assert.deepEqual(original.current.groupOverrides, {});
});

test("moving back or into Other retains the same inventory identity and count", () => {
  let state = inventory();
  for (const group of ["Liquor Cabinet", "Other", "Mixer Cabinet"]) {
    state = applyInventoryStateAction(state, "reorder-items", {
      itemOrder: ["bitters", "vodka"], movedItem: { id: "bitters", group },
    });
    assert.equal(state.current.groupOverrides.bitters, group);
    assert.equal(state.current.onHandOverrides.bitters, "7");
  }
});

test("reordering within a cabinet preserves its assignment", () => {
  const state = applyInventoryStateAction(inventory(), "reorder-items", {
    itemOrder: ["bitters", "vodka"], movedItem: { id: "bitters", group: "Other" },
  });
  const reordered = applyInventoryStateAction(state, "reorder-items", { itemOrder: ["vodka", "bitters"] });
  assert.equal(reordered.current.groupOverrides.bitters, "Other");
});

test("invalid cabinets and moves missing the item are rejected without changing counts", () => {
  const state = inventory();
  for (const movedItem of [{ id: "bitters", group: "Unknown" }, { id: "missing", group: "Other" }]) {
    assert.throws(() => applyInventoryStateAction(state, "reorder-items", {
      itemOrder: ["bitters", "vodka"], movedItem,
    }), /valid item and cabinet/);
  }
  assert.equal(state.current.onHandOverrides.bitters, "7");
  assert.deepEqual(state.current.groupOverrides, {});
});
