import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createPmbMorningRepairRunner, getPmbRepairClock, isPmbMorningRepairEnabled,
  isPmbRepairWindow, readPmbMorningRepairStatus, summarizePmbRepairRefresh,
} from "../lib/pmb-morning-repair.mjs";
import { sendFullPmbConfigUpdate } from "../lib/pmb-full-config-update.mjs";

const enabledEnv = {
  NODE_ENV: "production", ONPAR_DEPLOYMENT_TARGET: "on-site", ONPAR_PMB_REPAIR_SCHEDULER: "1",
};
const summerMorning = "2026-09-07T14:00:05.000Z";

function refreshed(at, { missing = false, stale = false } = {}) {
  return {
    levels: {
      updatedAt: at, stale, degraded: missing, partial: missing,
      expectedCount: 2, capturedCount: missing ? 1 : 2,
      unreachableTaps: missing ? [{ tapNumber: 73 }] : [],
      sharedSnapshotSaved: !missing,
      items: [
        { tapNumber: 21, fillLevelPercent: 0, levelAvailable: true },
        { tapNumber: 73, fillLevelPercent: missing ? null : 50, levelAvailable: !missing },
      ],
    },
    pricing: { updatedAt: at, items: [{ tapPosition: 21, chargePerOz: 1 }], pmbBackupSaved: true },
  };
}

async function harness(t, overrides = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "onpar-morning-repair-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = { value: new Date(summerMorning) };
  const calls = { repairs: 0, reads: 0, waits: [], audit: [] };
  const options = {
    env: { ...enabledEnv }, stateDirectory: directory, now: () => clock.value,
    repair: async ({ beforeWrite }) => { await beforeWrite(); calls.repairs += 1; },
    refresh: async () => { calls.reads += 1; return refreshed(clock.value.toISOString()); },
    wait: async (ms) => { calls.waits.push(ms); clock.value = new Date(clock.value.getTime() + ms); },
    recordActivity: async (entry) => { calls.audit.push(entry); },
    ...overrides,
  };
  return { directory, clock, calls, options, run: createPmbMorningRepairRunner(options) };
}

test("uses Eastern daylight saving time and admits only the 10:00 minute every day", () => {
  for (const instant of [summerMorning, "2026-01-11T15:00:00Z", "2026-03-08T14:00:59Z", "2026-11-01T15:00:00Z"]) {
    assert.equal(isPmbRepairWindow(new Date(instant)), true);
  }
  for (const instant of ["2026-09-07T13:59:59Z", "2026-09-07T14:01:00Z", "2026-09-07T15:00:00Z", "2026-01-11T14:00:00Z"]) {
    assert.equal(isPmbRepairWindow(new Date(instant)), false);
  }
  assert.equal(getPmbRepairClock(new Date("2026-09-08T02:00:00Z")).date, "2026-09-07");
});

test("builds, previews, development, unarmed services, and pause settings cannot run", async (t) => {
  for (const change of [
    { NODE_ENV: "development" }, { NODE_ENV: "test" }, { ONPAR_DEPLOYMENT_TARGET: "vercel" },
    { ONPAR_DEPLOYMENT_TARGET: "" }, { NEXT_PHASE: "phase-production-build" }, { VERCEL: "1" },
    { ONPAR_PMB_REPAIR_SCHEDULER: "" }, { PMB_MORNING_REPAIR_ENABLED: "false" }, { PMB_MORNING_REPAIR_ENABLED: " False " },
  ]) {
    const h = await harness(t, { env: { ...enabledEnv, ...change } });
    assert.equal(isPmbMorningRepairEnabled(h.options.env), false);
    assert.equal((await h.run()).skipped, true);
    assert.equal(h.calls.repairs, 0);
  }
});

test("never catches up at 10:01 or after opening", async (t) => {
  const h = await harness(t);
  for (const instant of ["2026-09-07T14:01:00Z", "2026-09-07T15:00:00Z", "2026-09-07T22:00:00Z"]) {
    h.clock.value = new Date(instant);
    assert.equal((await h.run()).skipped, true);
  }
  assert.equal(h.calls.repairs, 0);
  assert.equal(h.calls.reads, 0);
});

test("sends one repair, waits three minutes, verifies fresh readings, and persists the outcome", async (t) => {
  const h = await harness(t);
  const result = await h.run();
  assert.equal(result.status, "verified");
  assert.equal(result.verification.capturedCount, 2);
  assert.equal(h.calls.repairs, 1);
  assert.equal(h.calls.reads, 1);
  assert.deepEqual(h.calls.waits, [180_000]);
  assert.equal(h.calls.audit.length, 2);
  const status = await readPmbMorningRepairStatus({ ...h.options, now: h.clock.value });
  assert.equal(status.lastRun.status, "verified");
  assert.equal(status.missedToday, true);
  assert.deepEqual(status.missedSlots, ["07:00"]);
});

test("independent runners and a restarted process cannot send twice on the same date", async (t) => {
  const h = await harness(t);
  const second = createPmbMorningRepairRunner(h.options);
  await Promise.all([h.run(), second()]);
  h.clock.value = new Date(summerMorning);
  assert.equal((await createPmbMorningRepairRunner(h.options)()).alreadyClaimed, true);
  assert.equal(h.calls.repairs, 1);
});

test("the next Eastern date receives its own claim", async (t) => {
  const h = await harness(t);
  await h.run();
  h.clock.value = new Date("2026-09-08T14:00:05Z");
  assert.equal((await h.run()).status, "verified");
  assert.equal(h.calls.repairs, 2);
});

test("a partial or corrupt claim from a crash permanently blocks another same-day write", async (t) => {
  const h = await harness(t);
  await writeFile(path.join(h.directory, "2026-09-07.json"), "{");
  assert.equal((await h.run()).alreadyClaimed, true);
  assert.equal(h.calls.repairs, 0);
  assert.match((await readPmbMorningRepairStatus({ ...h.options, now: h.clock.value })).statusError, /could not be read/);
});

test("failure to persist a claim prevents all PMB actions", async (t) => {
  const h = await harness(t);
  const file = path.join(h.directory, "not-a-directory");
  await writeFile(file, "keep");
  const result = await createPmbMorningRepairRunner({ ...h.options, stateDirectory: file })();
  assert.equal(result.status, "failed");
  assert.equal(h.calls.repairs, 0);
  assert.equal(h.calls.reads, 0);
});

test("checks the actual clock after slow authentication before dispatching the real adapter's config call", async (t) => {
  const h = await harness(t);
  const urls = [];
  const env = { ...enabledEnv, PMB_API_BASE_URL: "https://pmb.invalid", PMB_API_USERNAME: "fake", PMB_API_PASSWORD: "fake" };
  const result = await createPmbMorningRepairRunner({
    ...h.options,
    repair: ({ beforeWrite }) => sendFullPmbConfigUpdate({ env, beforeWrite, fetchImpl: async (url) => {
      urls.push(url);
      h.clock.value = new Date("2026-09-07T14:01:00Z");
      return { status: 200, text: async () => JSON.stringify({ authtoken: "test-only" }) };
    } }),
  })();
  assert.equal(result.status, "missed-window");
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith("/api/authtoken"));
  assert.equal(h.calls.reads, 0);
});

test("a timed-out configuration request is never retried that day", async (t) => {
  const h = await harness(t);
  const run = createPmbMorningRepairRunner({ ...h.options, repair: async ({ beforeWrite }) => {
    await beforeWrite(); h.calls.repairs += 1; throw new Error("simulated uncertain write");
  } });
  assert.equal((await run()).status, "uncertain");
  assert.equal((await run()).alreadyClaimed, true);
  assert.equal(h.calls.repairs, 1);
  assert.equal(h.calls.reads, 0);
});

test("missing taps cause read-only retries, never another repair", async (t) => {
  const h = await harness(t);
  const run = createPmbMorningRepairRunner({ ...h.options, refresh: async () => {
    h.calls.reads += 1;
    return refreshed(h.clock.value.toISOString(), { missing: true });
  } });
  const result = await run();
  assert.equal(result.status, "unverified");
  assert.deepEqual(result.verification.missingTaps, [73]);
  assert.equal(h.calls.repairs, 1);
  assert.equal(h.calls.reads, 47);
  assert.deepEqual(h.calls.waits, [180_000, ...Array(47).fill(60_000)]);
});

test("verification timeouts stop additional reads because existing readers may still be running", async (t) => {
  const h = await harness(t);
  const result = await createPmbMorningRepairRunner({ ...h.options, refresh: async () => {
    h.calls.reads += 1;
    return { levels: { timedOut: true, error: "Timed out" } };
  } })();
  assert.equal(result.status, "needs-attention");
  assert.equal(h.calls.reads, 1);
  assert.match(result.message, /unresolved/);
});

test("a delayed or sleeping worker does not start verification after its pre-opening window", async (t) => {
  const h = await harness(t);
  const result = await createPmbMorningRepairRunner({ ...h.options, wait: async () => {
    h.clock.value = new Date("2026-09-07T15:02:00Z");
  } })();
  assert.equal(result.status, "unverified");
  assert.equal(h.calls.repairs, 1);
  assert.equal(h.calls.reads, 0);
});

test("old backup responses, duplicate taps, and incomplete pricing do not count as restored", () => {
  const sentAt = summerMorning;
  const now = new Date("2026-09-07T14:33:05Z");
  const valid = () => refreshed(now.toISOString());
  assert.equal(summarizePmbRepairRefresh(valid(), { sentAt, now }).verified, true);
  const stale = valid(); stale.levels.stale = true;
  assert.equal(summarizePmbRepairRefresh(stale, { sentAt, now }).verified, false);
  const old = valid(); old.levels.updatedAt = "2026-09-06T14:00:05Z";
  assert.equal(summarizePmbRepairRefresh(old, { sentAt, now }).verified, false);
  const duplicate = valid(); duplicate.levels.items[1].tapNumber = 21;
  assert.equal(summarizePmbRepairRefresh(duplicate, { sentAt, now }).verified, false);
  const pricing = valid(); pricing.pricing.stale = true;
  assert.equal(summarizePmbRepairRefresh(pricing, { sentAt, now }).verified, false);
});

test("activity storage failure does not repeat the repair or erase durable success", async (t) => {
  const h = await harness(t, { recordActivity: async () => { throw new Error("fake storage failure"); } });
  assert.equal((await h.run()).status, "verified");
  assert.equal(JSON.parse(await readFile(path.join(h.directory, "2026-09-07.json"))).status, "verified");
  assert.equal(h.calls.repairs, 1);
});

test("status explains an interrupted attempt after opening while retaining its daily claim", async (t) => {
  const h = await harness(t);
  await writeFile(path.join(h.directory, "2026-09-07.json"), JSON.stringify({ date: "2026-09-07", status: "repair-sent", message: "Waiting three minutes" }));
  h.clock.value = new Date("2026-09-07T15:00:00Z");
  const status = await readPmbMorningRepairStatus({ ...h.options, now: h.clock.value });
  assert.equal(status.lastRun.status, "unverified");
  assert.match(status.lastRun.message, /claim is retained/);
  h.clock.value = new Date(summerMorning);
  assert.equal((await h.run()).alreadyClaimed, true);
  assert.equal(h.calls.repairs, 0);
});


test("Monday 7am is additional, timezone-aware, and unavailable on other days", () => {
  for (const at of ["2026-09-07T11:00:00Z", "2026-01-12T12:00:59Z", "2026-03-09T11:00:00Z", "2026-11-02T12:00:00Z"]) {
    assert.equal(isPmbRepairWindow(new Date(at)), true);
  }
  for (const at of ["2026-09-08T11:00:00Z", "2026-09-07T10:59:59Z", "2026-09-07T11:01:00Z"]) {
    assert.equal(isPmbRepairWindow(new Date(at)), false);
  }
});

test("Monday early and daily slots each run once, including across process restarts", async (t) => {
  const h = await harness(t);
  h.clock.value = new Date("2026-09-07T11:00:05Z");
  const early = await h.run();
  assert.equal(early.status, "verified");
  assert.equal(early.slotId, "monday-reset");
  h.clock.value = new Date("2026-09-07T11:00:30Z");
  assert.equal((await createPmbMorningRepairRunner(h.options)()).alreadyClaimed, true);
  h.clock.value = new Date("2026-09-07T14:00:05Z");
  assert.equal((await createPmbMorningRepairRunner(h.options)()).status, "verified");
  assert.equal(h.calls.repairs, 2);
  const status = await readPmbMorningRepairStatus({ ...h.options, now: h.clock.value });
  assert.equal(status.todayRuns.length, 2);
  assert.equal(status.missedToday, false);
  assert.equal(status.lastRun.slotId, "daily");
});

test("a sleeping Monday repair cannot dispatch in the separate 10am slot", async (t) => {
  const h = await harness(t);
  h.clock.value = new Date("2026-09-07T11:00:05Z");
  const run = createPmbMorningRepairRunner({ ...h.options, repair: async ({ beforeWrite }) => {
    h.clock.value = new Date("2026-09-07T14:00:05Z");
    await beforeWrite();
    h.calls.repairs += 1;
  } });
  assert.equal((await run()).status, "missed-window");
  assert.equal(h.calls.repairs, 0);
  assert.equal((await h.run()).status, "verified");
});

test("Monday incomplete readings stop at 7:50 without consuming the daily repair", async (t) => {
  const h = await harness(t);
  h.clock.value = new Date("2026-09-07T11:00:05Z");
  const result = await createPmbMorningRepairRunner({ ...h.options, refresh: async () => {
    h.calls.reads += 1;
    return refreshed(h.clock.value.toISOString(), { missing: true });
  } })();
  assert.equal(result.status, "unverified");
  assert.equal(h.calls.reads, 47);
  h.clock.value = new Date("2026-09-07T14:00:05Z");
  assert.equal((await h.run()).status, "verified");
  assert.equal(h.calls.repairs, 2);
});
