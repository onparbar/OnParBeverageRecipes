import test from "node:test";
import assert from "node:assert/strict";
import {
  createWeeklyUsageRecovery,
  getRecoverableUsageWeek,
  mergeRecoveredWeeklyReport,
} from "../lib/weekly-usage-recovery.mjs";
import { prepareBriefingInputs } from "../public/briefing-readiness.mjs";

const week = { startDate: "2026-09-07", endDate: "2026-09-13", label: "9/7/26 - 9/13/26" };
const item = { id: "tap-21", tapNumber: 21, plu: 6655, name: "Michelob ULTRA 1", displayUnit: "kegs", history: [] };
const base = () => ({ initialized: true, revision: 1, data: {
  activeItems: [structuredClone(item)], archivedItems: [], currentOverrides: {}, historyOverrides: {}, lastSyncAt: "",
} });
const snapshot = { items: [{ ...item, rawKegSize: 1984, rawKegSizeDp: 0 }] };
const report = () => ({ ...week, updatedAt: "2026-09-14T16:00:00.000Z", items: [{ ...item, volumeOz: 992, hasValue: true }] });
const monday = () => new Date("2026-09-14T16:00:00Z");

test("weekly recovery follows Monday 7am Eastern, including DST", () => {
  assert.equal(getRecoverableUsageWeek(new Date("2026-09-14T10:59:59Z")).startDate, "2026-08-31");
  assert.deepEqual(getRecoverableUsageWeek(new Date("2026-09-14T11:00:00Z")), week);
  assert.equal(getRecoverableUsageWeek(new Date("2026-11-02T11:59:59Z")).startDate, "2026-10-19");
  assert.equal(getRecoverableUsageWeek(new Date("2026-11-02T12:00:00Z")).startDate, "2026-10-26");
});

test("recovery preserves exact ounces and converts keg units without changing counts", () => {
  const input = base().data;
  input.currentOverrides = { "tap-21": 7 };
  const merged = mergeRecoveredWeeklyReport(input, report(), snapshot);
  assert.equal(merged.activeItems[0].history[0].volumeOz, 992);
  assert.equal(merged.activeItems[0].history[0].value, 0.5);
  assert.equal(merged.activeItems[0].average, 0.5);
  assert.deepEqual(merged.currentOverrides, input.currentOverrides);
  assert.equal(input.activeItems[0].history.length, 0);
});

test("recovery preserves reviewed zeros and mirrored history overrides", () => {
  const data = base().data;
  const zero = { label: week.label, source: "PMB", volumeOz: 0, value: 0, hasValue: true, zeroUsageVerified: true,
    zeroUsageEvidence: { source: "owner-confirmed-assignment" } };
  data.historyOverrides[item.id] = [zero];
  const result = mergeRecoveredWeeklyReport(data, report(), snapshot);
  assert.deepEqual(result.activeItems[0].history[0], zero);
  assert.deepEqual(result.historyOverrides[item.id][0], zero);
});

test("recovery never treats an unknown zero or missing keg size as usable", () => {
  const unknown = report();
  unknown.items[0] = { ...unknown.items[0], volumeOz: 0, hasValue: false, usageUnknownReason: "Assignment unknown" };
  const entry = mergeRecoveredWeeklyReport(base().data, unknown, snapshot).activeItems[0].history[0];
  assert.equal(entry.hasValue, false);
  assert.equal(entry.usageUnknownReason, "Assignment unknown");
  const missingSize = mergeRecoveredWeeklyReport(base().data, report()).activeItems[0].history[0];
  assert.equal(missingSize.volumeOz, 992);
  assert.equal(missingSize.value, null);
  assert.equal(missingSize.hasValue, false);
});

test("a replaced product's usage stays archived rather than entering its replacement's average", () => {
  const changed = report();
  changed.items[0] = { ...changed.items[0], name: "Previous beer", plu: 999 };
  const result = mergeRecoveredWeeklyReport(base().data, changed, snapshot);
  assert.equal(result.activeItems[0].history.length, 0);
  assert.equal(result.archivedItems[0].name, "Previous beer");
  assert.equal(result.archivedItems[0].history[0].volumeOz, 992);
});

test("duplicate report identities fail closed", () => {
  const duplicate = report();
  duplicate.items.push(structuredClone(duplicate.items[0]));
  assert.throws(() => mergeRecoveredWeeklyReport(base().data, duplicate, snapshot), /duplicate product rows/);
});

test("simultaneous recovery requests share one report fetch and preserve state on PMB failure", async () => {
  let rejectReport;
  let calls = 0;
  const pending = new Promise((resolve, reject) => { rejectReport = reject; });
  const recover = createWeeklyUsageRecovery({ readState: async () => base(), now: monday });
  const load = () => { calls += 1; return pending; };
  const first = recover(base(), load);
  const second = recover(base(), load);
  rejectReport(new Error("PMB unavailable"));
  const results = await Promise.all([first, second]);
  assert.equal(calls, 1);
  for (const result of results) {
    assert.equal(result.revision, 1);
    assert.equal(result.recovery.status, "pending");
    assert.equal(result.recovery.message, "PMB unavailable");
  }
});

test("recovery retries CAS conflicts against fresh state and leaves concurrent edits intact", async () => {
  let state = base();
  let writes = 0;
  const recover = createWeeklyUsageRecovery({
    readState: async () => structuredClone(state), readSnapshot: async () => snapshot, now: monday,
    replaceState: async ({ expectedRevision, data }) => {
      writes += 1;
      if (writes === 1) {
        state.revision = 2;
        state.data.currentOverrides[item.id] = 9;
        throw Object.assign(new Error("Concurrent edit"), { status: 409 });
      }
      assert.equal(expectedRevision, 2);
      state = { ...state, revision: 3, data };
      return state;
    },
  });
  const result = await recover(base(), async () => report());
  assert.equal(writes, 2);
  assert.equal(result.data.currentOverrides[item.id], 9);
  assert.equal(result.data.activeItems[0].history[0].value, 0.5);
});

test("completed weeks are not refetched and a wrong-week response cannot be saved", async () => {
  let writes = 0;
  const recover = createWeeklyUsageRecovery({ readState: async () => base(), now: monday,
    replaceState: async () => { writes += 1; throw new Error("Unexpected write"); } });
  const complete = base();
  complete.data.activeItems[0].history = [{ label: week.label }];
  await recover(complete, async () => { throw new Error("Unexpected fetch"); });
  const result = await recover(base(), async () => ({ ...report(), startDate: "2026-08-31" }));
  assert.equal(result.recovery.status, "pending");
  assert.equal(writes, 0);
});

test("briefing separates physical count tasks from storage failures without changing readiness", () => {
  const readiness = { status: "blocked", blockers: ["36 inventory items are using an old baseline instead of a current saved count.", "Shared state could not be saved."], staleReasons: [], reviewReasons: [] };
  const alerts = [{ id: "inventory-counts-missing", severity: "critical", title: "36 inventory counts are not current" },
    { id: "weekly-plan-readiness", title: "Weekly plan needs attention" }];
  const result = prepareBriefingInputs(alerts, readiness);
  assert.equal(result.alerts.filter((alert) => alert.id === "inventory-count-task").length, 1);
  assert.equal(result.alerts.find((alert) => alert.id === "inventory-count-task").severity, "info");
  assert.deepEqual(result.readiness.blockers, ["Shared state could not be saved."]);
  assert.equal(readiness.blockers.length, 2);
  assert.equal(readiness.status, "blocked");
});

test("briefing shortens whole-week gaps but preserves the missing-data warning", () => {
  const result = prepareBriefingInputs([], { staleReasons: ["0/102 active taps have saved usage. Missing: Tap 1, Tap 2, Tap 3"] });
  assert.match(result.readiness.staleReasons[0], /0\/102 active taps/);
  assert.doesNotMatch(result.readiness.staleReasons[0], /Tap 1/);
});
