import test from "node:test";
import assert from "node:assert/strict";
import { applyPrepKegCounts } from "../lib/prep-keg-counts.mjs";
import { buildStaffPrepPlan } from "../lib/staff-prep-plan.mjs";
import { createLiveParRefresh } from "../lib/live-par-runtime.mjs";
import { preserveKegInputEditHistory } from "../lib/keg-input-edit-state.mjs";
import { applyCoolerEstimateObservations } from "../lib/keg-cooler-estimates.mjs";

const start = "2026-09-14T12:00:00.000Z";
function fixture() {
  return { onHandOverrides: { main: "2" }, onDeckOverrides: {}, parOverrides: {}, settings: {},
    recommendations: { generatedAt: start, items: [{ key: "main", tapNumber: 61,
      name: "Test Cocktail 1", wall: "Main", plu: 100, isKegTap: true,
      isLiquorTap: false, actionType: "make", orderQty: 1, batchSizeOz: 640 }] } };
}

test("prep credits a full keg once and reversal restores the original count", () => {
  const state = fixture();
  const target = buildStaffPrepPlan(state.recommendations).items[0];
  assert.ok(target);
  const changes = [{ target, update: { completed: true } }];
  const next = applyPrepKegCounts(state, state.recommendations, changes);
  assert.equal(next.onHandOverrides.main, "3");
  const retried = applyPrepKegCounts(next, next.recommendations, changes);
  assert.equal(retried.onHandOverrides.main, "3");
  const reversed = applyPrepKegCounts(next, next.recommendations, [{ target, update: { completed: false } }]);
  assert.equal(reversed.onHandOverrides.main, "2");
  assert.equal(state.onHandOverrides.main, "2");
});

test("liquor refills do not create finished cocktail kegs", () => {
  const state = fixture();
  const next = applyPrepKegCounts(state, state.recommendations, [{ target: { kind: "liquor-refill" }, update: { completed: true } }]);
  assert.deepEqual(next.onHandOverrides, state.onHandOverrides);
});

test("a delivery clock does not hide an earlier newly observed keg replacement", () => {
  const item = { tapNumber: 61, deviceId: 1, lineNum: 1, plu: 100, name: "Test Cocktail 1", levelAvailable: true };
  const state = applyCoolerEstimateObservations(fixture(), [{ ...item, tappedOn: "09/13/2026 08:00:00" }], { observedAt: start, fallbackAt: start });
  const delivered = preserveKegInputEditHistory(state, { ...state, onHandOverrides: { main: "3" } }, {
    now: "2026-09-14T13:00:00.000Z", fallbackAt: start, role: "staff", revision: 2, physicalCount: false });
  const next = applyCoolerEstimateObservations(delivered, [{ ...item, tappedOn: "09/14/2026 08:30:00" }], {
    observedAt: "2026-09-14T13:05:00.000Z", fallbackAt: start });
  assert.equal(next.onHandOverrides.main, "2");
});

test("live previews refresh on input revisions, skip unchanged inputs, and refresh PMB periodically", async () => {
  let time = Date.parse(start), revision = "1", reads = 0, calculations = 0;
  const saved = [];
  const tick = createLiveParRefresh({ now: () => time, readInputs: async () => revision,
    refreshLevels: async () => { reads++; }, calculate: async () => ({ recommendations: { version: ++calculations } }),
    save: async (value) => { saved.push(value); } });
  await tick(); await tick();
  assert.equal(calculations, 1);
  revision = "2"; await tick();
  assert.equal(calculations, 2);
  time += 300000; await tick();
  assert.equal(reads, 2);
  assert.equal(saved.length, 3);
  assert.equal(saved[2].status, "ready");
});

test("live previews discard mixed revisions and withhold results on PMB failure", async () => {
  const saved = [];
  let revision = 0;
  const tick = createLiveParRefresh({ readInputs: async () => ++revision, refreshLevels: async () => {},
    calculate: async () => ({ recommendations: {} }), save: async (value) => { saved.push(value); } });
  await tick(); assert.equal(saved.length, 0);
  const failed = createLiveParRefresh({ refreshLevels: async () => { throw new Error("offline"); },
    save: async (value) => { saved.push(value); } });
  await failed(); assert.equal(saved[0].status, "pending");
});
