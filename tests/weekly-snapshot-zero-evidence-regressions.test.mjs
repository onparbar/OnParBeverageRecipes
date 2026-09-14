import test from "node:test";
import assert from "node:assert/strict";
import { findWeeklySnapshotAssignment } from "../lib/weekly-snapshot-assignment-evidence.mjs";
import { verifyWeeklyReportZeros } from "../lib/pmb-weekly-zero-verification.mjs";
import { createWeeklyUsageRecovery } from "../lib/weekly-usage-recovery.mjs";

const tap = { tapNumber: 83, plu: 196542, name: "Grey Goose Vodka 2", deviceId: 111, lineNum: 1 };
const week = { startDate: "2026-09-07", endDate: "2026-09-13", label: "9/7/26 - 9/13/26" };
const through = "2026-09-14T12:00:00Z";
function snapshot(at = "2026-09-03T04:07:02Z", product = tap) {
  return {
    id: "inventory-2026-08-31", savedAt: new Date(Date.parse(at) + 2000).toISOString(),
    summary: { tapCount: 1, liveTapCount: 1, pmbUpdatedAt: at },
    captureMetadata: { sourceFreshness: { pmb: "verified" }, sourceTimestamps: { pmb: at } },
    kegPlanSnapshot: { generatedAt: new Date(Date.parse(at) + 1000).toISOString(),
      tapInputs: [{ tapNumber: product.tapNumber, name: product.name }], items: [] },
  };
}
function evidence() {
  return { snapshots: [snapshot()], events: [{ slot_key: "83:111:1", occurred_at: "2026-09-12T04:48:00Z", product: tap }] };
}
function report() {
  return { ...week, transactionCount: 2067, updatedAt: through, items: [{ ...tap,
    volumeOz: 0, transactionCount: 0, isCurrentTap: true, hasValue: false,
    usageUnknownReason: "No transactions establish this product's historical tap assignment." }] };
}
function options(history = evidence()) {
  return { currentTaps: [tap], startTime: Date.parse("2026-09-07T04:00:00Z"),
    endTime: Date.parse("2026-09-14T04:00:00Z"), reportDigest: "complete-report-digest",
    assignments: [{ ...tap, firstSeenAt: "2026-09-12T04:48:00Z", lastSeenAt: through, historicalEvidence: history }] };
}

test("verified snapshots establish a full week before the newer assignment log started", () => {
  const result = findWeeklySnapshotAssignment(tap, week, evidence(), through);
  assert.equal(result.method, "whole-week-historical-assignment");
  assert.ok(result.sources.some(source => source.reference === "inventory-2026-08-31"));
  assert.ok(result.sources.some(source => source.source === "tap-product-history"));
  const verified = verifyWeeklyReportZeros(report(), options()).items[0];
  assert.equal(verified.hasValue, true);
  assert.equal(verified.volumeOz, 0);
  assert.equal(verified.zeroUsageVerified, true);
  assert.equal(verified.usageUnknownReason, "");
  assert.equal(verified.zeroUsageEvidence.source, "verified-snapshot-and-assignment-history");
  assert.equal(verified.zeroUsageEvidence.reportDigest, "complete-report-digest");
  assert.ok(verified.zeroUsageEvidence.assignmentResolution.sources.length > 0);
});

test("an observation after the week started cannot be backdated to Monday", () => {
  const history = evidence();
  history.snapshots = [snapshot("2026-09-07T19:59:18Z")];
  assert.equal(findWeeklySnapshotAssignment(tap, week, history, through), null);
  assert.equal(verifyWeeklyReportZeros(report(), options(history)).items[0].hasValue, false);
});

test("product swaps inside the week prevent a false whole-week zero", () => {
  const history = evidence();
  history.events.unshift({ slot_key: "83:111:1", occurred_at: "2026-09-09T12:00:00Z",
    product: { ...tap, plu: 999, name: "Different product 2" } });
  assert.equal(findWeeklySnapshotAssignment(tap, week, history, through), null);
  assert.equal(verifyWeeklyReportZeros(report(), options(history)).items[0].hasValue, false);
});

test("a same-name different PLU during the week remains unverified", () => {
  const history = evidence();
  history.events.unshift({ slot_key: "83:111:1", occurred_at: "2026-09-08T12:00:00Z", product: { ...tap, plu: 999 } });
  assert.equal(findWeeklySnapshotAssignment(tap, week, history, through), null);
});

test("stale snapshots, stale end observations, and incorrect live devices fail closed", () => {
  const history = evidence();
  history.snapshots[0].captureMetadata.sourceFreshness.pmb = "stale";
  assert.equal(findWeeklySnapshotAssignment(tap, week, history, through), null);
  assert.equal(findWeeklySnapshotAssignment(tap, week, evidence(), "2026-09-13T20:00:00Z"), null);
  const mismatch = options();
  mismatch.currentTaps = [{ ...tap, deviceId: 222 }];
  assert.equal(verifyWeeklyReportZeros(report(), mismatch).items[0].hasValue, false);
});

test("missing historical evidence cannot convert unknown zero usage", () => {
  assert.equal(verifyWeeklyReportZeros(report(), options(null)).items[0].hasValue, false);
  assert.equal(findWeeklySnapshotAssignment(tap, { ...week, endDate: "2026-09-12" }, evidence(), through), null);
});

test("saved unknown entries are retried and repaired in active history and overrides", async () => {
  const unknown = { ...report().items[0], label: week.label, value: 0, source: "PMB" };
  const item = { ...tap, id: "83-goose", displayUnit: "oz", history: [unknown] };
  let state = { initialized: true, revision: 4, data: { activeItems: [item], archivedItems: [],
    currentOverrides: { "83-goose": 2 }, historyOverrides: { "83-goose": [structuredClone(unknown)] }, lastSyncAt: through } };
  let reads = 0;
  const recovery = createWeeklyUsageRecovery({ now: () => new Date(through), readSnapshot: async () => null,
    readState: async () => structuredClone(state), replaceState: async ({ expectedRevision, data }) => {
      assert.equal(expectedRevision, 4); state = { ...state, revision: 5, data }; return state;
    } });
  const result = await recovery(structuredClone(state), async () => { reads += 1; return verifyWeeklyReportZeros(report(), options()); });
  assert.equal(reads, 1);
  for (const rows of [result.data.activeItems[0].history, result.data.historyOverrides["83-goose"]]) {
    assert.equal(rows[0].zeroUsageVerified, true);
    assert.equal(rows[0].hasValue, true);
    assert.ok(rows[0].zeroUsageEvidence.assignmentResolution.sources.length);
  }
  assert.deepEqual(result.data.currentOverrides, { "83-goose": 2 });
  await recovery(result, async () => { reads += 1; throw new Error("Unexpected second fetch"); });
  assert.equal(reads, 1);
});

test("an unresolved saved entry retries later instead of hammering PMB", async () => {
  let now = new Date(through);
  let reads = 0;
  const state = { initialized: true, revision: 1, data: { activeItems: [{ ...tap, id: "83", displayUnit: "oz", history: [] }],
    archivedItems: [], historyOverrides: {}, currentOverrides: {}, lastSyncAt: "" } };
  const recovery = createWeeklyUsageRecovery({ now: () => now, readState: async () => structuredClone(state) });
  const load = async () => { reads += 1; throw new Error("PMB offline"); };
  await recovery(state, load);
  await recovery(state, load);
  assert.equal(reads, 1);
  now = new Date(now.getTime() + 300001);
  await recovery(state, load);
  assert.equal(reads, 2);
});
