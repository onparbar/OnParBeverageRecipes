import test from "node:test";
import assert from "node:assert/strict";
import {
  createWeeklyUsageRecoveryJob,
  isWeeklyUsageRecoveryRuntimeEnabled,
  loadPmbWeeklyUsageReport,
} from "../lib/weekly-usage-recovery-runtime.mjs";

const enabledEnv = {
  NEXT_RUNTIME: "nodejs",
  NODE_ENV: "production",
  ONPAR_DEPLOYMENT_TARGET: "on-site",
  ONPAR_PMB_REPAIR_SCHEDULER: "1",
};
const authenticatedEnv = {
  ...enabledEnv,
  DASHBOARD_PASSWORD: "owner-password",
  DASHBOARD_SESSION_SECRET: "a-session-secret-that-is-definitely-long-enough",
};

test("weekly usage recovery runtime is limited to the on-site production service", () => {
  assert.equal(isWeeklyUsageRecoveryRuntimeEnabled(enabledEnv), true);
  assert.equal(isWeeklyUsageRecoveryRuntimeEnabled({ ...enabledEnv, NODE_ENV: "development" }), false);
  assert.equal(isWeeklyUsageRecoveryRuntimeEnabled({ ...enabledEnv, VERCEL: "1" }), false);
  assert.equal(isWeeklyUsageRecoveryRuntimeEnabled({ ...enabledEnv, ONPAR_WEEKLY_USAGE_RECOVERY_ENABLED: "false" }), false);
});

test("background recovery reads shared state and delegates to the fail-closed recovery merge", async () => {
  const state = { initialized: true, revision: 7, data: { activeItems: [] } };
  const calls = [];
  const loadReport = async () => ({ reports: [] });
  const run = createWeeklyUsageRecoveryJob({
    readState: async () => state,
    loadReport,
    recover: async (receivedState, receivedLoader) => {
      calls.push({ receivedState, receivedLoader });
      return { ...receivedState, recovered: true };
    },
  });

  const result = await run();
  assert.equal(result.recovered, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].receivedState, state);
  assert.equal(calls[0].receivedLoader, loadReport);
});

test("background recovery skips uninitialized shared weekly usage", async () => {
  let recoveries = 0;
  const state = { initialized: false, revision: 0, data: null };
  const run = createWeeklyUsageRecoveryJob({
    readState: async () => state,
    recover: async () => { recoveries += 1; },
  });

  assert.equal(await run(), state);
  assert.equal(recoveries, 0);
});

test("overlapping scheduler ticks share one recovery attempt", async () => {
  let finish;
  let reads = 0;
  const pending = new Promise((resolve) => { finish = resolve; });
  const state = { initialized: true, data: { activeItems: [] } };
  const run = createWeeklyUsageRecoveryJob({
    readState: async () => { reads += 1; return state; },
    recover: async () => pending,
  });

  const first = run();
  const second = run();
  finish(state);
  assert.equal(await first, state);
  assert.equal(await second, state);
  assert.equal(reads, 1);
});

test("idle background recovery uses revision metadata instead of rereading weekly history", async () => {
  let reads = 0;
  let metadataReads = 0;
  const state = { initialized: true, revision: 19, data: { activeItems: [] } };
  const run = createWeeklyUsageRecoveryJob({
    readState: async () => { reads += 1; return state; },
    readMetadata: async () => { metadataReads += 1; return { initialized: true, revision: 19 }; },
    recover: async (value) => value,
    now: () => Date.parse("2026-09-28T12:00:00.000Z"),
  });

  await run();
  const skipped = await run();
  assert.equal(reads, 1);
  assert.equal(metadataReads, 1);
  assert.equal(skipped.skipped, true);
});

test("a new completed reporting week forces a full recovery audit even when the revision is unchanged", async () => {
  let time = Date.parse("2026-09-28T12:00:00.000Z");
  let reads = 0;
  const state = { initialized: true, revision: 19, data: { activeItems: [] } };
  const run = createWeeklyUsageRecoveryJob({
    readState: async () => { reads += 1; return state; },
    readMetadata: async () => ({ initialized: true, revision: 19 }),
    recover: async (value) => value,
    now: () => time,
  });

  await run();
  time += 7 * 24 * 60 * 60_000;
  await run();
  assert.equal(reads, 2);
});

test("service recovery requests only the intended completed week with a short-lived owner session", async () => {
  let capturedRequest;
  const payload = { reports: [{ startDate: "2026-09-14" }] };
  const result = await loadPmbWeeklyUsageReport({ startDate: "2026-09-14" }, {
    env: authenticatedEnv,
    loadRoute: async () => ({
      GET: async (request) => {
        capturedRequest = request;
        return Response.json(payload);
      },
    }),
  });

  assert.deepEqual(result, payload);
  assert.equal(new URL(capturedRequest.url).searchParams.get("weeks"), "2026-09-14");
  assert.match(capturedRequest.cookies.get("onpar_dashboard_session").value, /^v2\./);
});

test("service recovery preserves PMB review failures instead of treating them as a report", async () => {
  await assert.rejects(
    loadPmbWeeklyUsageReport({ startDate: "2026-09-14" }, {
      env: authenticatedEnv,
      loadRoute: async () => ({
        GET: async () => Response.json({
          error: "Owner review is required.",
          code: "PMB_WEEKLY_USAGE_REVIEW_REQUIRED",
        }, { status: 409 }),
      }),
    }),
    (error) => error.status === 409 && error.code === "PMB_WEEKLY_USAGE_REVIEW_REQUIRED",
  );
});
