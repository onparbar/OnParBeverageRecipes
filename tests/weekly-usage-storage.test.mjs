import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createOperationalOutboxEntry, normalizeOperationalOutboxEntry, markOperationalOutboxFailure, rebaseOperationalOutboxAfterOwnCommit } from "../public/operational-outbox.mjs";
import { reconcileWeeklyUsageData } from "../public/weekly-usage-reconciliation.mjs";
import { buildThirtySecondBriefing } from "../public/thirty-second-briefing.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function fn(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  return `${source.slice(start - (source.slice(start - 6, start) === "async " ? 6 : 0), source.indexOf("\n}\n", start) + 2)}\n`;
}
function setup({ storageFails = false, networkFails = false, conflict = false } = {}) {
  const base = { activeItems: [], archivedItems: [], currentOverrides: { tap1: "1", tap2: "2" }, historyOverrides: {}, lastSyncAt: "" };
  const local = structuredClone(base); local.currentOverrides.tap1 = "3";
  let remote = { initialized: true, revision: conflict ? 2 : 1, data: structuredClone(base) };
  if (conflict) remote.data.currentOverrides.tap2 = "4";
  const saved = new Map();
  let writes = 0;
  const ctx = vm.createContext({
    console: { warn() {} }, structuredClone, Date, Promise,
    weeklyUsageSharedOutbox: createOperationalOutboxEntry({ id: "a", baseRevision: 1, payload: { data: local, baseData: base } }),
    weeklyUsagePersistedOutboxId: "a", weeklyUsageSharedOutboxDurable: true,
    weeklyUsageRecoveryEntries: [], weeklyUsageSharedPendingWrites: 0, weeklyUsageSharedSaving: false,
    weeklyUsageSharedSaveTimer: null, weeklyUsageSharedSaveError: "", weeklyUsageSharedMessage: "",
    weeklyUsageSharedWriteQueue: Promise.resolve(), weeklyUsageSharedRevision: 1, weeklyUsageSharedBaseline: base,
    weeklyUsageConflictDetails: [], loadWeeklyUsageSharedOutbox: () => null,
    weeklyUsageJournal: {
      async put(entry, previous) { if (storageFails) throw new Error("QuotaExceededError"); saved.set(entry.id, structuredClone(entry)); if (previous !== entry.id) saved.delete(previous); },
      async remove(id) { saved.delete(id); },
    },
    async requestSharedWeeklyUsage(body) {
      if (!body) return structuredClone(remote);
      writes++;
      if (networkFails) throw new Error("offline");
      if (body.expectedRevision !== remote.revision) throw Object.assign(new Error("conflict"), { code: "WEEKLY_USAGE_STATE_REVISION_CONFLICT" });
      remote = { initialized: true, revision: remote.revision + 1, data: structuredClone(body.data) };
      return remote;
    },
    stageWeeklyUsageSharedOutbox() {}, normalizeOperationalOutboxEntry, markOperationalOutboxFailure,
    rebaseOperationalOutboxAfterOwnCommit, reconcileWeeklyUsageData,
    areDashboardStateValuesEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    cloneWeeklyUsageValue: structuredClone, restoreWeeklyUsageFromOutbox() {},
    applySharedWeeklyUsageState(state) { ctx.weeklyUsageSharedRevision = state.revision; },
    renderWeeklyUsage() {}, renderWeeklyPlan() {}, renderDashboardOverview() {},
  });
  vm.runInContext(["saveWeeklyUsageSharedOutbox", "advanceWeeklyUsageRecovery", "tryRebaseWeeklyUsageOutbox", "queueSharedWeeklyUsageSave"].map(fn).join("\n"), ctx);
  return { ctx, saved, writes: () => writes, remote: () => remote, online: () => { networkFails = false; } };
}

test("unavailable offline storage does not prevent a confirmed server save from clearing the warning", async () => {
  const { ctx, remote } = setup({ storageFails: true });
  assert.equal(await ctx.queueSharedWeeklyUsageSave(), true);
  assert.equal(ctx.weeklyUsageSharedOutbox, null);
  assert.equal(ctx.weeklyUsageSharedSaveError, "");
  assert.equal(ctx.weeklyUsageSharedOutboxDurable, true);
  assert.equal(remote().data.currentOverrides.tap1, "3");
});
test("quota failure during conflict rebase still allows independent changes to save safely", async () => {
  const { ctx, remote } = setup({ storageFails: true, conflict: true });
  assert.equal(await ctx.queueSharedWeeklyUsageSave(), true);
  assert.deepEqual(remote().data.currentOverrides, { tap1: "3", tap2: "4" });
  assert.equal(ctx.weeklyUsageSharedOutbox, null);
});
test("offline edits remain recoverable and retry clears the pending record only after server acknowledgement", async () => {
  const { ctx, saved, online, remote } = setup({ networkFails: true });
  assert.equal(await ctx.queueSharedWeeklyUsageSave(), false);
  assert.equal(saved.get("a").payload.data.currentOverrides.tap1, "3");
  assert.equal(remote().data.currentOverrides.tap1, "1");
  online();
  assert.equal(await ctx.queueSharedWeeklyUsageSave(), true);
  assert.equal(saved.size, 0);
  assert.equal(ctx.weeklyUsageSharedPendingWrites, 0);
});
test("a lost response to an accepted save is acknowledged by readback without losing the edit", async () => {
  const { ctx, remote } = setup();
  const request = ctx.requestSharedWeeklyUsage;
  let dropped = false;
  ctx.requestSharedWeeklyUsage = async body => {
    const state = await request(body);
    if (body && !dropped) { dropped = true; throw new Error("response interrupted"); }
    return state;
  };
  assert.equal(await ctx.queueSharedWeeklyUsageSave(), false);
  assert.equal(remote().revision, 2);
  assert.equal(await ctx.queueSharedWeeklyUsageSave(), true);
  assert.equal(remote().revision, 2);
  assert.equal(ctx.weeklyUsageSharedOutbox, null);
});
test("a newer edit created during a server save remains pending", async () => {
  const { ctx, saved } = setup();
  const request = ctx.requestSharedWeeklyUsage;
  ctx.requestSharedWeeklyUsage = async body => {
    const state = await request(body);
    if (body) {
      ctx.weeklyUsageSharedOutbox = createOperationalOutboxEntry({ id: "b", baseRevision: 1,
        payload: { data: { ...body.data, currentOverrides: { tap1: "5", tap2: "2" } }, baseData: body.data } });
    }
    return state;
  };
  await ctx.queueSharedWeeklyUsageSave();
  assert.equal(ctx.weeklyUsageSharedOutbox.id, "b");
  assert.equal(saved.get("b").payload.data.currentOverrides.tap1, "5");
  assert.equal(saved.has("a"), false);
});
test("full legacy cache cannot turn an acknowledged shared report into a failed save", () => {
  const ctx = vm.createContext({ weeklyUsageSharedInitialized: true, localStorage: { setItem() { throw new Error("quota"); } },
    scheduleSharedWeeklyUsageSave() {}, weeklyUsageCurrentOverrides: {}, weeklyUsageHistoryOverrides: {}, weeklyUsageArchivedItems: [], weeklyUsageLastSyncAt: "" });
  for (const name of ["CurrentOverrides", "HistoryOverrides", "ArchivedItems", "LastSyncAt"]) {
    vm.runInContext(fn(`saveWeeklyUsage${name}`), ctx);
    assert.doesNotThrow(() => ctx[`saveWeeklyUsage${name}`]());
  }
});
test("briefing lists each weekly-save failure once, omitting its duplicated combined summary", () => {
  const reasons = ["Weekly Usage changes are still saving.", "The latest Weekly Usage save failed: Storage unavailable."];
  const briefing = buildThirtySecondBriefing({ overview: { alerts: [{ id: "weekly-plan-blocked", severity: "critical", message: reasons.join(" "), details: reasons }] }, readiness: { status: "blocked", blockers: reasons } });
  const usage = briefing.lines.find(line => /weekly usage needs attention/i.test(line.text));
  assert.deepEqual(usage.bullets, reasons);
});

test("an edit arriving during recovery-record cleanup is not overwritten by the earlier response", async () => {
  const { ctx } = setup();
  let release;
  ctx.weeklyUsageJournal.remove = () => new Promise(resolve => { release = resolve; });
  let applied = 0;
  ctx.applySharedWeeklyUsageState = () => { applied++; };
  const pending = ctx.queueSharedWeeklyUsageSave();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const before = applied;
  const newer = createOperationalOutboxEntry({id:'new-edit',baseRevision:2,payload:{data:{currentOverrides:{tap1:'7'}}}});
  ctx.weeklyUsageSharedOutbox = newer;
  release();
  await pending;
  assert.equal(applied, before, 'earlier server response must be applied before yielding to cleanup');
  assert.equal(ctx.weeklyUsageSharedOutbox, newer);
});

test("recovery continues through separate tab records without acknowledging unsaved records", async () => {
  const { ctx, remote } = setup();
  const secondBase = structuredClone(ctx.weeklyUsageSharedBaseline);
  const secondData = structuredClone(secondBase); secondData.currentOverrides.tap2 = '9';
  ctx.weeklyUsageRecoveryEntries = [createOperationalOutboxEntry({id:'other-tab',baseRevision:1,payload:{data:secondData,baseData:secondBase}})];
  await ctx.queueSharedWeeklyUsageSave();
  assert.equal(ctx.weeklyUsageSharedOutbox.id,'other-tab');
  await ctx.queueSharedWeeklyUsageSave();
  assert.equal(ctx.weeklyUsageSharedOutbox,null);
  assert.deepEqual(remote().data.currentOverrides,{tap1:'3',tap2:'9'});
});

function serverRefreshSetup(overrides = {}) {
  const ctx = vm.createContext({
    weeklyUsageSharedRevision: 4, weeklyUsageSharedOutbox: null, weeklyUsageSharedPendingWrites: 0, weeklyUsageSharedSaveTimer: null,
    weeklyUsageSyncLoading: false, weeklyUsageSyncMessage: '', weeklyUsageSyncError: '',
    flushPendingSharedWeeklyUsageSave: async () => true,
    requestOperationalSharedJson: async path => {
      assert.equal(path,'/api/weekly-usage-refresh');
      return {response:{ok:true},result:{initialized:true,revision:5,data:{activeItems:['saved report']}}};
    },
    applySharedWeeklyUsageState(state) { ctx.applied = state; },
    renderWeeklyUsage() {}, renderWeeklyPlan() {}, renderDashboardOverview() {}, ...overrides,
  });
  vm.runInContext(fn('refreshWeeklyUsageOnServer'),ctx);
  return ctx;
}
test('automatic refresh uses server-saved state without staging a browser report', async () => {
  const ctx=serverRefreshSetup();
  assert.equal((await ctx.refreshWeeklyUsageOnServer()).ok,true);
  assert.equal(ctx.applied.revision,5);
  assert.equal(ctx.weeklyUsageSharedOutbox,null);
});
test('an automatic server refresh cannot overwrite an edit made while waiting', async () => {
  const ctx=serverRefreshSetup();
  const request=ctx.requestOperationalSharedJson;
  ctx.requestOperationalSharedJson=async path=>{ctx.weeklyUsageSharedOutbox={id:'new-edit'};return request(path);};
  await ctx.refreshWeeklyUsageOnServer();
  assert.equal(ctx.applied,undefined);
  assert.equal(ctx.weeklyUsageSharedOutbox.id,'new-edit');
});
test('an unavailable or unverified report is not presented as a successful refresh', async () => {
  const ctx=serverRefreshSetup({requestOperationalSharedJson:async()=>({response:{ok:true},result:{initialized:true,revision:5,recovery:{status:'pending',message:'Owner review required'}}})});
  assert.equal((await ctx.refreshWeeklyUsageOnServer()).ok,false);
  assert.equal(ctx.weeklyUsageSyncError,'Owner review required');
});
test('legacy pending reports migrate before they can be recovered or removed', async () => {
  const {ctx}=setup();
  const original=ctx.weeklyUsageSharedOutbox;
  ctx.weeklyUsageJournalLoaded=false;
  ctx.weeklyUsageJournal.list=async()=>[];
  let copied;
  ctx.weeklyUsageJournal.put=async entry=>{copied=structuredClone(entry);};
  vm.runInContext(fn('loadWeeklyUsageJournal'),ctx);
  await ctx.loadWeeklyUsageJournal();
  assert.equal(copied.id,original.id);
  assert.equal(ctx.weeklyUsageSharedOutbox.id,original.id);
  assert.deepEqual(ctx.weeklyUsageSharedOutbox.payload.data,original.payload.data);
});

test('conflicting edits remain blocked and preserved even when the local disk is full', async () => {
  const {ctx,remote}=setup({storageFails:true,conflict:true});
  remote().data.currentOverrides.tap1='9';
  assert.equal(await ctx.queueSharedWeeklyUsageSave(),false);
  assert.equal(remote().data.currentOverrides.tap1,'9');
  assert.equal(ctx.weeklyUsageSharedOutbox.payload.data.currentOverrides.tap1,'3');
  assert.equal(ctx.weeklyUsageSharedOutbox.conflict,true);
});
