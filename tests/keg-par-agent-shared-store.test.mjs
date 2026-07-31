import assert from "node:assert/strict";
import test from "node:test";
import {
  KegParAgentStateError,
  createEmptyKegParAgentData,
  createSharedKegParAgentStore,
} from "../lib/keg-par-agent-shared-store.mjs";

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fetchFor(initial) {
  let row = structuredClone(initial);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = String(init.method || "GET").toUpperCase();
    calls.push({ method, url });
    if (method === "GET") return response([structuredClone(row)]);
    const revision = Number(String(url.searchParams.get("revision") || "").replace("eq.", ""));
    const initialized = String(url.searchParams.get("initialized") || "").replace("eq.", "") === "true";
    if (row.revision !== revision || row.initialized !== initialized) return response([]);
    row = { ...row, ...JSON.parse(init.body) };
    return response([structuredClone(row)]);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function store(fetchImpl) {
  return createSharedKegParAgentStore({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_test-only" },
    fetchImpl,
    now: () => new Date("2026-07-31T17:00:00.000Z"),
  });
}

function assertError(error, code) {
  assert.ok(error instanceof KegParAgentStateError);
  assert.equal(error.code, code);
  return true;
}

test("Keg Levels reads an empty row without importing this browser", async () => {
  const fetchImpl = fetchFor({ id: "keg-par-agent", revision: 0, initialized: false, data: {}, initialized_at: null, updated_at: "2026-07-31T12:00:00.000Z", updated_by_role: "" });
  const state = await store(fetchImpl).read();
  assert.equal(state.initialized, false);
  assert.deepEqual(state.data, createEmptyKegParAgentData());
  assert.deepEqual(fetchImpl.calls.map((call) => call.method), ["GET"]);
});

test("Keg Levels requires an explicit service-computer initialization before saves", async () => {
  const fetchImpl = fetchFor({ id: "keg-par-agent", revision: 0, initialized: false, data: {}, initialized_at: null, updated_at: "2026-07-31T12:00:00.000Z", updated_by_role: "" });
  const shared = store(fetchImpl);
  await assert.rejects(shared.replace({ expectedRevision: 0, data: createEmptyKegParAgentData() }), (error) => assertError(error, "KEG_STATE_NOT_INITIALIZED"));
  const data = createEmptyKegParAgentData();
  data.onHandOverrides = { "main-1": "2" };
  const initialized = await shared.initialize({ expectedRevision: 0, data });
  assert.equal(initialized.initialized, true);
  assert.equal(initialized.revision, 1);
  const patch = fetchImpl.calls.find((call) => call.method === "PATCH");
  assert.equal(patch.url.searchParams.get("initialized"), "eq.false");
  await assert.rejects(shared.replace({ expectedRevision: 0, data }), (error) => assertError(error, "KEG_STATE_REVISION_CONFLICT"));
});

test("Keg Levels rejects unknown shared fields before writing anything", async () => {
  const fetchImpl = fetchFor({ id: "keg-par-agent", revision: 0, initialized: false, data: {}, initialized_at: null, updated_at: "2026-07-31T12:00:00.000Z", updated_by_role: "" });
  const data = { ...createEmptyKegParAgentData(), unknownField: true };
  await assert.rejects(
    store(fetchImpl).initialize({ expectedRevision: 0, data }),
    (error) => assertError(error, "INVALID_KEG_STATE"),
  );
  assert.deepEqual(fetchImpl.calls.map((call) => call.method), ["GET"]);
});

test("Keg Levels fails closed when shared storage is unavailable", async () => {
  const unavailableFetch = async () => response({ code: "PGRST205" }, 404);
  await assert.rejects(
    store(unavailableFetch).read(),
    (error) => assertError(error, "KEG_STATE_UNAVAILABLE"),
  );
});
