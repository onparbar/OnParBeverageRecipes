import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyInventoryState,
  createSharedInventoryStore,
} from "../lib/inventory-shared-store.mjs";
import { InventoryStateError } from "../lib/inventory-store.mjs";

function makeRow(overrides = {}) {
  return {
    id: "inventory-state",
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
    calls.push({
      method,
      url,
      headers: { ...init.headers },
      body: init.body ? JSON.parse(init.body) : null,
    });

    if (missingTable) {
      return jsonResponse(
        { code: "PGRST205", message: "Could not find the table in the schema cache" },
        404,
      );
    }
    if (method === "GET") return jsonResponse(row ? [structuredClone(row)] : []);
    if (method !== "PATCH") return jsonResponse({ code: "TEST", message: "Unsupported" }, 405);

    const expectedId = String(url.searchParams.get("id") || "").replace(/^eq\./, "");
    const expectedRevision = Number(
      String(url.searchParams.get("revision") || "").replace(/^eq\./, ""),
    );
    const expectedInitialized =
      String(url.searchParams.get("initialized") || "").replace(/^eq\./, "") === "true";

    if (
      !row
      || row.id !== expectedId
      || row.revision !== expectedRevision
      || row.initialized !== expectedInitialized
    ) {
      return jsonResponse([]);
    }

    row = { ...row, ...JSON.parse(init.body) };
    return jsonResponse([structuredClone(row)]);
  };

  fetchImpl.calls = calls;
  fetchImpl.getRow = () => structuredClone(row);
  return fetchImpl;
}

function assertStoreError(error, code, status) {
  assert.ok(error instanceof InventoryStateError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
}

test("fails closed when Supabase credentials are unavailable", async () => {
  let fetched = false;
  const store = createSharedInventoryStore({
    env: { SUPABASE_URL: "https://example.supabase.co" },
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    store.read(),
    (error) => assertStoreError(error, "INVENTORY_STATE_UNAVAILABLE", 503),
  );
  assert.equal(fetched, false);
});

test("reads an uninitialized inventory row without publishing browser data", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedInventoryStore({
    env: makeEnvironment(),
    fetchImpl,
  });

  const state = await store.read();
  const empty = createEmptyInventoryState();
  assert.equal(state.initialized, false);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.current.onHandOverrides, empty.current.onHandOverrides);
  assert.deepEqual(state.snapshots, []);
  assert.deepEqual(fetchImpl.calls.map((call) => call.method), ["GET"]);
});

test("requires explicit revision-zero initialization", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedInventoryStore({
    env: makeEnvironment(),
    fetchImpl,
    now: () => new Date("2026-07-31T15:00:00.000Z"),
  });

  await assert.rejects(
    store.initialize({ expectedRevision: 1, data: {} }),
    (error) => assertStoreError(error, "INVALID_INVENTORY_STATE_REVISION", 400),
  );

  const state = await store.initialize({
    expectedRevision: 0,
    data: {
      onHandOverrides: { vodka: "3" },
      parOverrides: { vodka: "5" },
      customItems: [],
      itemOrder: ["vodka"],
      snapshots: [],
    },
  });

  assert.equal(state.initialized, true);
  assert.equal(state.revision, 1);
  assert.equal(state.initializedAt, "2026-07-31T15:00:00.000Z");
  assert.equal(state.current.onHandOverrides.vodka, "3");
  assert.equal(state.current.parOverrides.vodka, "5");

  const patchCall = fetchImpl.calls.find((call) => call.method === "PATCH");
  assert.equal(patchCall.url.searchParams.get("id"), "eq.inventory-state");
  assert.equal(patchCall.url.searchParams.get("revision"), "eq.0");
  assert.equal(patchCall.url.searchParams.get("initialized"), "eq.false");
});

test("rejects normal writes until service-computer initialization", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedInventoryStore({
    env: makeEnvironment(),
    fetchImpl,
  });

  await assert.rejects(
    store.mutate("update-field", { id: "vodka", field: "onHand", value: "4" }),
    (error) => assertStoreError(error, "INVENTORY_STATE_NOT_INITIALIZED", 409),
  );
  assert.equal(fetchImpl.calls.filter((call) => call.method === "PATCH").length, 0);
});

test("retries revision conflicts so concurrent item edits are both preserved", async () => {
  const initialState = createEmptyInventoryState();
  initialState.initialized = true;
  initialState.initializedAt = "2026-07-31T14:00:00.000Z";
  const fetchImpl = createSupabaseFetch(makeRow({
    revision: 1,
    initialized: true,
    initialized_at: initialState.initializedAt,
    data: {
      current: initialState.current,
      snapshots: [],
    },
  }));
  let tick = 0;
  const nextTime = () => new Date(`2026-07-31T15:00:0${tick += 1}.000Z`);
  const firstStore = createSharedInventoryStore({
    env: makeEnvironment(),
    fetchImpl,
    now: nextTime,
  });
  const secondStore = createSharedInventoryStore({
    env: makeEnvironment(),
    fetchImpl,
    now: nextTime,
  });

  const results = await Promise.all([
    firstStore.mutate("update-field", { id: "vodka", field: "onHand", value: "2" }),
    secondStore.mutate("update-field", { id: "gin", field: "onHand", value: "4" }),
  ]);

  assert.equal(results.every((state) => state.initialized), true);
  assert.equal(fetchImpl.getRow().revision, 3);
  assert.deepEqual(fetchImpl.getRow().data.current.onHandOverrides, {
    vodka: "2",
    gin: "4",
  });
});

test("maps a missing inventory table to a typed unavailable error", async () => {
  const store = createSharedInventoryStore({
    env: makeEnvironment(),
    fetchImpl: createSupabaseFetch(makeRow(), { missingTable: true }),
  });

  await assert.rejects(
    store.read(),
    (error) => assertStoreError(error, "INVENTORY_STATE_UNAVAILABLE", 503),
  );
});
