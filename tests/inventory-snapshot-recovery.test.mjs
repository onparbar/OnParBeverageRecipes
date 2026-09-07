import test from "node:test";
import assert from "node:assert/strict";
import { inventorySnapshotInputsMatch } from "../public/inventory-snapshot-recovery.mjs";

const counts = {
  onHandOverrides: { "lime-juice": "12", kahlua: "6" },
  parOverrides: { "lime-juice": "40" },
  customItems: [{ id: "custom", name: "Custom", packSize: 1 }],
  itemOrder: ["lime-juice", "kahlua"],
};

test("voice-learning metadata and revision timestamps do not conflict with identical inventory inputs", () => {
  assert.equal(inventorySnapshotInputsMatch(counts, {
    ...counts,
    onHandOverrides: { kahlua: "6", "lime-juice": "12" },
    updatedAt: "2026-09-07T18:46:17.025Z",
    speechAliases: [{ alias: "coffee", product: "Cold Brew" }],
  }), true);
});

test("changed counts, pars, custom items and order prevent snapshot recovery", () => {
  for (const changed of [
    { onHandOverrides: { ...counts.onHandOverrides, "lime-juice": "13" } },
    { parOverrides: { "lime-juice": "41" } },
    { customItems: [{ id: "custom", name: "Custom", packSize: 6 }] },
    { itemOrder: ["kahlua", "lime-juice"] },
  ]) {
    assert.equal(inventorySnapshotInputsMatch(counts, { ...counts, ...changed }), false);
  }
});

test("an explicit zero count is not treated as an uncounted item", () => {
  assert.equal(inventorySnapshotInputsMatch({ onHandOverrides: { lime: "0" } }, {}), false);
});

test("comparison does not mutate local or shared inputs", () => {
  const local = structuredClone(counts);
  const shared = structuredClone(counts);
  inventorySnapshotInputsMatch(local, shared);
  assert.deepEqual(local, counts);
  assert.deepEqual(shared, counts);
});
