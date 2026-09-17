import test from "node:test";
import assert from "node:assert/strict";
import { applyCoolerEstimateObservations } from "../lib/keg-cooler-estimates.mjs";

const key = "main-39-breakfast-stout-1";
const start = "2026-09-17T14:00:00Z";
const later = "2026-09-17T16:00:00Z";
const item = { tapNumber: 39, deviceId: 123, lineNum: 2, plu: 187456,
  name: "Guinness Draught 1", levelAvailable: true, tappedOn: "09/17/2026 11:50:20" };
const reference = { key, wall: "Main", name: item.name, plu: item.plu, isKegTap: true, isLiquorTap: false };
function initial() {
  return applyCoolerEstimateObservations({ onHandOverrides: { [key]: "1" }, recommendations: { items: [] } },
    [{ ...item, tappedOn: "09/16/2026 12:00:00" }], { observedAt: start, fallbackAt: start });
}
const observe = (state, mapped = true) => applyCoolerEstimateObservations(state,
  [{ ...item, ...(mapped ? { inventoryReference: reference } : {}) }], { observedAt: later, fallbackAt: start });

test("a tap absent from the weekly plan consumes one backup using its permanent key", () => {
  const next = observe(initial());
  assert.equal(next.onHandOverrides[key], "0");
  assert.equal(observe(next).onHandOverrides[key], "0");
  assert.deepEqual(next.recommendations.items, []);
});

test("a previously unmatched reset is recovered once without duplicating the event", () => {
  const missed = observe(initial(), false);
  assert.equal(missed.coolerEstimateState.events[0].outcome, "unmatched-product");
  const fixed = observe(missed);
  assert.equal(fixed.onHandOverrides[key], "0");
  assert.equal(fixed.coolerEstimateState.events.length, 1);
  assert.equal(fixed.coolerEstimateState.events[0].previousOutcome, "unmatched-product");
  assert.deepEqual(observe(fixed), fixed);
});

test("a newer physical count prevents replay from consuming a keg again", () => {
  const missed = observe(initial(), false);
  missed.inputEditState = { clocks: { [JSON.stringify(["onHandOverrides", key])]: { countedAt: "2026-09-17T15:55:00Z" } } };
  const next = observe(missed);
  assert.equal(next.onHandOverrides[key], "1");
  assert.equal(next.coolerEstimateState.events[0].deduction, 0);
});
