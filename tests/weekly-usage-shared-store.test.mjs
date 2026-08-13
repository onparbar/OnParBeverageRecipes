import assert from "node:assert/strict";
import test from "node:test";
import {
  WeeklyUsageStateError,
  createEmptyWeeklyUsageData,
  createSharedWeeklyUsageStore,
} from "../lib/weekly-usage-shared-store.mjs";

function makeRow(overrides = {}) {
  return {
    id: "weekly-usage",
    revision: 0,
    initialized: false,
    data: {},
    initialized_at: null,
    updated_at: "2026-07-31T12:00:00.000Z",
    updated_by_role: "",
    ...overrides,
  };
}

function makeEnvironment(overrides = {}) {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test-only",
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createSupabaseFetch(initialRow, { missingTable = false } = {}) {
  let row = structuredClone(initialRow);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    if (missingTable) return jsonResponse({ code: "PGRST205" }, 404);
    if (method === "GET") return jsonResponse(row ? [structuredClone(row)] : []);
    const revision = Number(String(url.searchParams.get("revision") || "").replace(/^eq\./, ""));
    const initialized = String(url.searchParams.get("initialized") || "").replace(/^eq\./, "") === "true";
    if (!row || row.revision !== revision || row.initialized !== initialized) return jsonResponse([]);
    row = { ...row, ...JSON.parse(init.body) };
    return jsonResponse([structuredClone(row)]);
  };
  fetchImpl.calls = calls;
  fetchImpl.getRow = () => structuredClone(row);
  return fetchImpl;
}

function assertStoreError(error, code, status) {
  assert.ok(error instanceof WeeklyUsageStateError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
}

test("reads an uninitialized Weekly Usage row without importing browser reports", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedWeeklyUsageStore({ env: makeEnvironment(), fetchImpl });
  const state = await store.read();
  assert.equal(state.initialized, false);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.data, createEmptyWeeklyUsageData());
  assert.deepEqual(fetchImpl.calls.map((call) => call.method), ["GET"]);
});

test("Weekly Usage Supabase requests abort after the configured timeout", async () => {
  let observedSignal = null;
  const shared = createSharedWeeklyUsageStore({
    env: makeEnvironment({ SUPABASE_REQUEST_TIMEOUT_MS: "25" }),
    fetchImpl: async (_input, init) => {
      observedSignal = init.signal;
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
  });

  await assert.rejects(
    shared.read(),
    (error) => assertStoreError(error, "WEEKLY_USAGE_STATE_UNAVAILABLE", 503),
  );
  assert.equal(observedSignal?.aborted, true);
});

test("requires explicit revision-zero Weekly Usage initialization", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedWeeklyUsageStore({
    env: makeEnvironment(),
    fetchImpl,
    now: () => new Date("2026-07-31T16:00:00.000Z"),
  });
  await assert.rejects(
    store.initialize({ expectedRevision: 2, data: createEmptyWeeklyUsageData() }),
    (error) => assertStoreError(error, "INVALID_WEEKLY_USAGE_REVISION", 400),
  );

  const data = createEmptyWeeklyUsageData();
  data.activeItems = [{ id: "tap-1", history: [{ label: "7/20/26 - 7/26/26", value: 1 }] }];
  data.lastSyncAt = "2026-07-31T15:30:00.000Z";
  const state = await store.initialize({ expectedRevision: 0, data });
  assert.equal(state.initialized, true);
  assert.equal(state.revision, 1);
  assert.deepEqual(state.data, data);
  const patch = fetchImpl.calls.find((call) => call.method === "PATCH");
  assert.equal(patch.url.searchParams.get("revision"), "eq.0");
  assert.equal(patch.url.searchParams.get("initialized"), "eq.false");
});

test("rejects updates before initialization and stale whole-report saves", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedWeeklyUsageStore({ env: makeEnvironment(), fetchImpl });
  await assert.rejects(
    store.replace({ expectedRevision: 0, data: createEmptyWeeklyUsageData() }),
    (error) => assertStoreError(error, "WEEKLY_USAGE_STATE_NOT_INITIALIZED", 409),
  );

  await store.initialize({ expectedRevision: 0, data: createEmptyWeeklyUsageData() });
  await store.replace({ expectedRevision: 1, data: createEmptyWeeklyUsageData() });
  await assert.rejects(
    store.replace({ expectedRevision: 1, data: createEmptyWeeklyUsageData() }),
    (error) => assertStoreError(error, "WEEKLY_USAGE_STATE_REVISION_CONFLICT", 409),
  );
});

test("fails closed when Weekly Usage storage is unavailable", async () => {
  const store = createSharedWeeklyUsageStore({
    env: makeEnvironment(),
    fetchImpl: createSupabaseFetch(makeRow(), { missingTable: true }),
  });
  await assert.rejects(
    store.read(),
    (error) => assertStoreError(error, "WEEKLY_USAGE_STATE_UNAVAILABLE", 503),
  );
});
