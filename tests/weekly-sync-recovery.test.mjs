import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { mergeOperationalRecord } from "../public/operational-outbox.mjs";
import { reconcileKegLevelInputs } from "../public/keg-level-state.mjs";
import { buildMondayRunModel } from "../public/monday-run-view.mjs";
import { isRecommendationForOperatingWeek } from "../public/weekly-action-plan.mjs";
import { applyInventoryStateAction, createEmptyInventoryState, normalizeInventoryState } from "../lib/inventory-store.mjs";

test("independent saved changes merge without choosing a winner for a conflicting count", () => {
  const base = { lime: "1", syrup: "2" };
  assert.deepEqual(mergeOperationalRecord(base, { ...base, lime: "3" }, { ...base, syrup: "4" }).data, { lime: "3", syrup: "4" });
  assert.equal(mergeOperationalRecord(base, { ...base, lime: "3" }, { ...base, lime: "4" }).ok, false);
  assert.equal(mergeOperationalRecord(null, base, base).ok, false);
  assert.equal(mergeOperationalRecord(base, { syrup: "2" }, { ...base, lime: "4" }).ok, false);
  assert.deepEqual(mergeOperationalRecord(base, { syrup: "2" }, base).data, { syrup: "2" });
});

test("keg recovery keeps individual taps separate and treats an On Deck product as an atomic choice", () => {
  const base = { onHandOverrides: { tap21: 1, tap74: 2 }, onDeckOverrides: { tap70: { name: "Whiskey Smash", onHand: 1 } } };
  const ours = { ...base, onHandOverrides: { tap21: 3, tap74: 2 } };
  const theirs = { ...base, onHandOverrides: { tap21: 1, tap74: 4 } };
  const merged = reconcileKegLevelInputs(base, ours, theirs);
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.data.onHandOverrides, { tap21: "3", tap74: "4" });
  assert.equal(reconcileKegLevelInputs(base,
    { ...base, onDeckOverrides: { tap70: { name: "Whiskey Smash", onHand: 2 } } },
    { ...base, onDeckOverrides: { tap70: { name: "Apple Jack", onHand: 1 } } }).ok, false);
});

const readyPmb = { kegFeed: { status: "online" }, pricingFeed: { status: "online" }, weeklyUsageCaptured: true };

test("Step 1 distinguishes repair, stale readings, saving, and a report that is not captured", () => {
  const status = (extra) => buildMondayRunModel({ ...readyPmb, ...extra }).steps[0];
  assert.match(status({ kegFeed: { status: "stale" } }).status, /fresh reading/);
  assert.match(status({ kegFeed: { status: "partial", capturedCount: 58, expectedCount: 102 } }).status, /58 of 102/);
  assert.match(status({ weeklyUsageCaptured: false }).status, /Capture last week's usage/);
  assert.match(status({ weeklyUsageSavePending: true }).status, /Saving weekly usage/);
  assert.equal(status({ weeklyUsageSavePending: true }).complete, false);
  assert.match(status({ weeklyUsageSaveError: "conflict", pmbRefreshPending: true }).status, /save issue/);
  assert.match(status({ kegCountSaveError: "conflict" }).status, /save recovery/);
  assert.match(status({ tapRepairRefreshPending: true }).status, /Tap repair sent/);
  assert.equal(status({ planLocked: true, weeklyUsageSaveError: "conflict" }).complete, true);
});

test("inventory must have a count from this operating week, without making blank quantities mandatory", () => {
  const monday = new Date("2026-09-07T12:00:00Z");
  let state = applyInventoryStateAction(createEmptyInventoryState(), "initialize", {}, "owner", new Date("2026-09-01T12:00:00Z"));
  state = applyInventoryStateAction(state, "update-field", { id: "lime", field: "onHand", value: "4" }, "owner", new Date("2026-09-01T13:00:00Z"));
  const priorCountedAt = state.current.countedAt;
  state = applyInventoryStateAction(state, "update-field", { id: "lime", field: "par", value: "8" }, "owner", monday);
  assert.equal(state.current.countedAt, priorCountedAt);
  const model = () => buildMondayRunModel({ ...readyPmb, inventorySharedInitialized: true,
    inventoryCountedThisWeek: isRecommendationForOperatingWeek(state.current.countedAt, monday) });
  assert.equal(model().steps[1].status, "Count needed");
  state = applyInventoryStateAction(state, "update-field", { id: "lime", field: "onHand", value: "0" }, "owner", monday);
  assert.equal(model().steps[1].complete, true);
  assert.equal(normalizeInventoryState(state).current.countedAt, monday.toISOString());
  state = applyInventoryStateAction(state, "batch-update-fields", { source: "clear-on-hand", changes: [{ id: "lime", field: "onHand", value: "" }] }, "owner", monday);
  assert.equal(model().steps[1].complete, false);
  assert.equal(buildMondayRunModel({ planLocked: true }).steps[1].complete, false);
});

test("a count queued last week does not become this week's count merely because its retry succeeds today", () => {
  const today = new Date("2026-09-07T12:00:00Z");
  const priorWeek = "2026-09-06T17:00:00.000Z";
  const initial = applyInventoryStateAction(createEmptyInventoryState(), "initialize", {}, "owner", today);
  const saved = applyInventoryStateAction(initial, "update-field", { id: "lime", field: "onHand", value: "2", countedAt: priorWeek }, "owner", today);
  assert.equal(saved.current.countedAt, priorWeek);
  assert.equal(isRecommendationForOperatingWeek(saved.current.countedAt, today), false);
});

const dashboardSource = await readFile(new URL("../public/dashboard.js", import.meta.url), "utf8");
const queueSource = dashboardSource.slice(dashboardSource.indexOf("function queueSharedWeeklyUsageSave()"), dashboardSource.indexOf("function flushPendingSharedWeeklyUsageSave()"));

function usageQueueContext(conflict = false) {
  let writes = 0;
  const context = vm.createContext({
    weeklyUsageSharedOutbox: { id: "pending", baseRevision: 1, conflict, payload: { data: { activeItems: [] } } },
    weeklyUsageSharedPendingWrites: 0, weeklyUsageSharedSaving: false,
    weeklyUsageSharedSaveTimer: null, weeklyUsageSharedSaveError: "", weeklyUsageSharedMessage: "",
    weeklyUsageSharedWriteQueue: Promise.resolve(), weeklyUsageSharedRevision: 1,
    stageWeeklyUsageSharedOutbox() {}, normalizeOperationalOutboxEntry: (value) => value,
    tryRebaseWeeklyUsageOutbox: () => false,
    async requestSharedWeeklyUsage(body) { if (body) writes += 1; return { initialized: true, revision: 2, data: { activeItems: [] } }; },
    saveWeeklyUsageSharedOutbox() {}, applySharedWeeklyUsageState() {}, renderWeeklyUsage() {}, renderWeeklyPlan() {}, renderDashboardOverview() {},
    markOperationalOutboxFailure: (entry) => entry,
  });
  vm.runInContext(queueSource, context);
  return { context, writes: () => writes };
}

test("duplicate queued usage saves do not resubmit acknowledged data", async () => {
  const { context, writes } = usageQueueContext();
  await Promise.all([context.queueSharedWeeklyUsageSave(), context.queueSharedWeeklyUsageSave()]);
  assert.equal(writes(), 1);
  assert.equal(context.weeklyUsageSharedPendingWrites, 0);
  assert.equal(context.weeklyUsageSharedSaving, false);
});

test("an unresolved conflict releases the busy counter rather than remaining perpetually Saving", async () => {
  const { context, writes } = usageQueueContext(true);
  assert.equal(await context.queueSharedWeeklyUsageSave(), false);
  assert.equal(writes(), 0);
  assert.equal(context.weeklyUsageSharedPendingWrites, 0);
  assert.equal(context.weeklyUsageSharedSaving, false);
  assert.equal(context.weeklyUsageSharedOutbox.id, "pending");
});

const mondayRefreshSource = dashboardSource.slice(
  dashboardSource.indexOf("async function refreshSharedWeeklyUsageBeforeMondaySnapshot()"),
  dashboardSource.indexOf("let mondayWeeklyUsageSyncPromise = null;"),
);

function mondayRefreshContext({ flushResult = true, state = { initialized: true, revision: 7 }, afterFlushOutbox = null, readError = null } = {}) {
  const calls = [];
  const context = vm.createContext({
    weeklyUsageSharedOutbox: { id: "pending", baseRevision: 6 },
    weeklyUsageSharedSaveTimer: 17,
    weeklyUsageSharedSaving: true,
    weeklyUsageSharedSaveError: "Previous save interruption",
    weeklyUsageSharedMessage: "",
    weeklyUsageSharedRevision: 6,
    async flushPendingSharedWeeklyUsageSave() {
      calls.push("flush");
      if (flushResult) context.weeklyUsageSharedOutbox = afterFlushOutbox;
      return flushResult;
    },
    async requestSharedWeeklyUsage() {
      calls.push("read");
      if (readError) throw readError;
      return state;
    },
    clearTimeout(timer) { calls.push(["clear-timeout", timer]); },
    saveWeeklyUsageSharedOutbox() { calls.push("persist-outbox"); },
    applySharedWeeklyUsageState(value) {
      calls.push(["apply", value.revision]);
      context.weeklyUsageSharedRevision = value.revision;
    },
  });
  vm.runInContext(mondayRefreshSource, context);
  return { context, calls };
}

test("Monday snapshot refresh succeeds after the pending usage save is acknowledged", async () => {
  const { context, calls } = mondayRefreshContext();
  assert.equal(await context.refreshSharedWeeklyUsageBeforeMondaySnapshot(), true);
  assert.deepEqual(calls, ["flush", "read", ["clear-timeout", 17], "persist-outbox", ["apply", 7]]);
  assert.equal(context.weeklyUsageSharedRevision, 7);
  assert.equal(context.weeklyUsageSharedOutbox, null);
  assert.equal(context.weeklyUsageSharedSaveTimer, null);
  assert.equal(context.weeklyUsageSharedSaving, false);
  assert.equal(context.weeklyUsageSharedSaveError, "");
  assert.equal(context.weeklyUsageSharedMessage, "Shared Weekly Usage is current.");
});

test("Monday snapshot refresh stops when pending usage cannot be saved", async () => {
  const { context, calls } = mondayRefreshContext({ flushResult: false });
  assert.equal(await context.refreshSharedWeeklyUsageBeforeMondaySnapshot(), false);
  assert.deepEqual(calls, ["flush"]);
  assert.equal(context.weeklyUsageSharedOutbox.id, "pending");
  assert.equal(context.weeklyUsageSharedSaveError, "Previous save interruption");
});

test("Monday snapshot refresh preserves a new usage outbox queued during the refresh", async () => {
  const outbox = { id: "new-report", baseRevision: 6 };
  const { context, calls } = mondayRefreshContext({ afterFlushOutbox: outbox });
  assert.equal(await context.refreshSharedWeeklyUsageBeforeMondaySnapshot(), true);
  assert.deepEqual(calls, ["flush", "read"]);
  assert.equal(context.weeklyUsageSharedOutbox, outbox);
  assert.equal(context.weeklyUsageSharedRevision, 7);
  assert.equal(context.weeklyUsageSharedSaveTimer, 17);
});

test("Monday snapshot refresh reports missing setup and read failures without claiming success", async () => {
  for (const [options, message] of [
    [{ state: { initialized: false, revision: 0 } }, "Shared Weekly Usage setup is incomplete."],
    [{ readError: new Error("Storage unavailable") }, "Storage unavailable"],
  ]) {
    const { context, calls } = mondayRefreshContext(options);
    assert.equal(await context.refreshSharedWeeklyUsageBeforeMondaySnapshot(), false);
    assert.deepEqual(calls, ["flush", "read"]);
    assert.equal(context.weeklyUsageSharedSaveError, message);
    assert.equal(context.weeklyUsageSharedMessage, message);
  }
});
