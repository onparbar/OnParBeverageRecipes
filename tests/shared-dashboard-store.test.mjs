import assert from "node:assert/strict";
import test from "node:test";
import {
  SharedDashboardStoreError,
  applySharedDashboardPatch,
  createEmptySharedDashboardData,
  createSharedDashboardStore,
  projectSharedDashboardStateForRole,
} from "../lib/shared-dashboard-store.mjs";

function makeRow(overrides = {}) {
  return {
    id: "dashboard-config",
    revision: 0,
    initialized: false,
    data: {},
    initialized_at: null,
    updated_at: "2026-07-30T12:00:00.000Z",
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

  fetchImpl.getRow = () => structuredClone(row);
  fetchImpl.calls = calls;
  return fetchImpl;
}

function assertStoreError(error, code, status) {
  assert.ok(error instanceof SharedDashboardStoreError);
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
}

test("fails closed when server-side Supabase credentials are missing", async () => {
  let fetched = false;
  const store = createSharedDashboardStore({
    env: { SUPABASE_URL: "https://example.supabase.co" },
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    store.read(),
    (error) => assertStoreError(error, "SHARED_STATE_UNAVAILABLE", 503),
  );
  assert.equal(fetched, false);
});

test("reads an uninitialized row without auto-seeding it", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
  });

  const state = await store.read();
  assert.equal(state.initialized, false);
  assert.equal(state.revision, 0);
  assert.deepEqual(state.data, createEmptySharedDashboardData());
  assert.deepEqual(fetchImpl.calls.map((call) => call.method), ["GET"]);
});

test("requires a complete explicit import at expectedRevision 0", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
    now: () => new Date("2026-07-30T15:00:00.000Z"),
  });

  await assert.rejects(
    store.initialize({
      expectedRevision: 1,
      data: createEmptySharedDashboardData(),
    }),
    (error) => assertStoreError(error, "INVALID_SHARED_STATE_REVISION", 400),
  );

  const incomplete = createEmptySharedDashboardData();
  delete incomplete.products.tapReplacementOverrides;
  await assert.rejects(
    store.initialize({ expectedRevision: 0, data: incomplete }),
    (error) => assertStoreError(error, "INVALID_SHARED_STATE", 400),
  );

  const data = createEmptySharedDashboardData();
  data.pricing.ingredientPriceOverrides = {
    vodka: { bottleOz: "59.1745", bottlePrice: "25.85" },
  };
  const initialized = await store.initialize({ expectedRevision: 0, data }, "owner");

  assert.equal(initialized.initialized, true);
  assert.equal(initialized.revision, 1);
  assert.equal(initialized.initializedAt, "2026-07-30T15:00:00.000Z");
  assert.deepEqual(initialized.data, data);

  const patchCall = fetchImpl.calls.find((call) => call.method === "PATCH");
  assert.equal(patchCall.url.searchParams.get("id"), "eq.dashboard-config");
  assert.equal(patchCall.url.searchParams.get("revision"), "eq.0");
  assert.equal(patchCall.url.searchParams.get("initialized"), "eq.false");
  assert.equal(patchCall.headers.Authorization, undefined);
  assert.equal(patchCall.headers.apikey, "sb_secret_test-only");
});

test("allows only one concurrent initializer to claim revision 0", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const firstStore = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
  });
  const secondStore = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
  });

  const firstData = createEmptySharedDashboardData();
  firstData.recipes.customRecipes = [{ id: "first" }];
  const secondData = createEmptySharedDashboardData();
  secondData.recipes.customRecipes = [{ id: "second" }];

  const results = await Promise.allSettled([
    firstStore.initialize({ expectedRevision: 0, data: firstData }),
    secondStore.initialize({ expectedRevision: 0, data: secondData }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assertStoreError(rejected[0].reason, "SHARED_STATE_ALREADY_INITIALIZED", 409);
  assert.equal(fetchImpl.getRow().revision, 1);
});

test("sends legacy service-role JWTs as both apikey and bearer credentials", async () => {
  const legacyKey = "eyJhbGciOiJIUzI1NiJ9.test.signature";
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedDashboardStore({
    env: makeEnvironment({
      SUPABASE_SECRET_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: legacyKey,
    }),
    fetchImpl,
  });

  await store.read();
  assert.equal(fetchImpl.calls[0].headers.apikey, legacyKey);
  assert.equal(fetchImpl.calls[0].headers.Authorization, `Bearer ${legacyKey}`);
});

test("prefers the opaque Supabase secret when both credential formats are configured", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedDashboardStore({
    env: makeEnvironment({
      SUPABASE_SECRET_KEY: "sb_secret_preferred",
      SUPABASE_SERVICE_ROLE_KEY: "eyJhbGciOiJIUzI1NiJ9.legacy.signature",
    }),
    fetchImpl,
  });

  await store.read();
  assert.equal(fetchImpl.calls[0].headers.apikey, "sb_secret_preferred");
  assert.equal(fetchImpl.calls[0].headers.Authorization, undefined);
});

test("rejects plain HTTP before sending the Supabase secret", async () => {
  let fetched = false;
  const store = createSharedDashboardStore({
    env: makeEnvironment({ SUPABASE_URL: "http://example.supabase.co" }),
    fetchImpl: async () => {
      fetched = true;
      return jsonResponse([]);
    },
  });

  await assert.rejects(
    store.read(),
    (error) => assertStoreError(error, "SHARED_STATE_UNAVAILABLE", 503),
  );
  assert.equal(fetched, false);
});

test("allows explicitly opted-in loopback HTTP for local Supabase development", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedDashboardStore({
    env: makeEnvironment({
      SUPABASE_URL: "http://127.0.0.1:54321",
      SUPABASE_ALLOW_INSECURE_LOCALHOST: "true",
    }),
    fetchImpl,
  });

  await store.read();
  assert.equal(fetchImpl.calls.length, 1);
});

test("uses the migrated shared-state table even if a stale table override exists", async () => {
  const fetchImpl = createSupabaseFetch(makeRow());
  const store = createSharedDashboardStore({
    env: makeEnvironment({ SUPABASE_DASHBOARD_STATE_TABLE: "unmigrated_override" }),
    fetchImpl,
  });

  await store.read();
  assert.equal(fetchImpl.calls[0].url.pathname, "/rest/v1/dashboard_shared_state");
});

test("replaces multiple cross-slice fields in one atomic revision update", async () => {
  const original = createEmptySharedDashboardData();
  original.pricing.chargeOverrides = { martini: "12" };
  original.recipes.customRecipes = [{ id: "old", name: "Old Recipe" }];
  original.products.comingSoonItems = [{ id: "old-beer", name: "Old Beer" }];

  const fetchImpl = createSupabaseFetch(makeRow({
    revision: 7,
    initialized: true,
    initialized_at: "2026-07-29T12:00:00.000Z",
    data: original,
  }));
  const store = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
    now: () => new Date("2026-07-30T16:00:00.000Z"),
  });

  const state = await store.patch({
    expectedRevision: 7,
    patch: {
      recipes: {
        customRecipes: [{ id: "new", name: "New Recipe" }],
        inactiveRecipeIds: ["retired-recipe"],
      },
      products: {
        comingSoonItems: [{ id: "new-beer", name: "New Beer" }],
      },
    },
  });

  assert.equal(state.revision, 8);
  assert.deepEqual(state.data.recipes.customRecipes, [{ id: "new", name: "New Recipe" }]);
  assert.deepEqual(state.data.recipes.inactiveRecipeIds, ["retired-recipe"]);
  assert.deepEqual(state.data.products.comingSoonItems, [{ id: "new-beer", name: "New Beer" }]);
  assert.deepEqual(state.data.pricing.chargeOverrides, { martini: "12" });
  assert.equal(fetchImpl.calls.filter((call) => call.method === "PATCH").length, 1);
});

test("same-revision concurrent writers cannot silently overwrite one another", async () => {
  const data = createEmptySharedDashboardData();
  const fetchImpl = createSupabaseFetch(makeRow({
    revision: 4,
    initialized: true,
    initialized_at: "2026-07-29T12:00:00.000Z",
    data,
  }));
  const firstStore = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
  });
  const secondStore = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl,
  });

  const results = await Promise.allSettled([
    firstStore.patch({
      expectedRevision: 4,
      patch: { pricing: { chargeOverrides: { oldFashioned: "14" } } },
    }),
    secondStore.patch({
      expectedRevision: 4,
      patch: { products: { customBeerKegs: [{ id: "lager" }] } },
    }),
  ]);

  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assertStoreError(rejected[0].reason, "SHARED_STATE_REVISION_CONFLICT", 409);
  assert.equal(rejected[0].reason.details.currentRevision, 5);
  assert.equal(Object.hasOwn(rejected[0].reason.details, "currentState"), false);
  assert.equal(fetchImpl.getRow().revision, 5);
});

test("rejects unknown patch fields before attempting a write", () => {
  const data = createEmptySharedDashboardData();
  assert.throws(
    () => applySharedDashboardPatch(data, {
      pricing: { ingredientPrices: {} },
    }),
    (error) => assertStoreError(error, "INVALID_SHARED_STATE", 400),
  );
});

test("maps a missing Supabase table to a typed unavailable error", async () => {
  const store = createSharedDashboardStore({
    env: makeEnvironment(),
    fetchImpl: createSupabaseFetch(makeRow(), { missingTable: true }),
  });

  await assert.rejects(
    store.read(),
    (error) => assertStoreError(error, "SHARED_STATE_UNAVAILABLE", 503),
  );
});

test("owner projection preserves the complete state without sharing object references", () => {
  const data = createEmptySharedDashboardData();
  data.pricing.ingredientPriceOverrides = { vodka: { bottlePrice: "25.85" } };
  data.recipes.customRecipes = [{ id: "recipe-1", title: "Owner Recipe", batchCost: 31 }];
  data.products.comingSoonItems = [{ id: "beer-1", kegCost: 120 }];
  const state = {
    version: 1,
    id: "dashboard-config",
    revision: 9,
    initialized: true,
    initializedAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T13:00:00.000Z",
    updatedByRole: "owner",
    data,
  };

  const projected = projectSharedDashboardStateForRole(state, "owner");
  assert.deepEqual(projected, state);
  assert.notEqual(projected, state);
  assert.notEqual(projected.data, state.data);

  projected.data.pricing.ingredientPriceOverrides.vodka.bottlePrice = "0";
  assert.equal(state.data.pricing.ingredientPriceOverrides.vodka.bottlePrice, "25.85");
});

test("employee projection returns operational recipes without live pricing or products", () => {
  const data = createEmptySharedDashboardData();
  data.pricing.ingredientPriceOverrides = {
    vodka: { bottleOz: "59.1745", bottlePrice: "25.85" },
  };
  data.pricing.kegPriceOverrides = { lager: { kegPrice: "135" } };
  data.pricing.chargeOverrides = { "profit-punch": "2.25" };
  data.products.customBeerKegs = [{ id: "lager", kegCost: 135, targetMargin: 82 }];
  data.products.customLiquorTaps = [{ id: "vodka-tap", bottleCost: 25.85 }];
  data.products.comingSoonItems = [{ id: "secret-beer", pricePerOz: 0.42 }];
  data.products.tapReplacementOverrides = { "tap-1": { newChargePerOz: 0.42 } };
  data.recipes.customRecipes = [{
    id: "profit-punch",
    title: "Profit Punch",
    category: "Cocktail",
    status: "active",
    batch: "12 gallons",
    defaultChargePerOz: 2.25,
    batchCost: 43.5,
    wholesale: 31,
    cogs: 29,
    fee: 4,
    imageUrl: "https://example.com/profit-punch.jpg",
    instructions: ["Mix", "Chill", "Pour"],
    ingredients: [{
      id: "vodka",
      name: "Vodka",
      quantity: 3,
      oz: 177.5,
      raw: "3 bottles",
      unitCost: 25.85,
      supplier: {
        bottlePrice: 25.85,
        notes: "Keep this operational note",
      },
    }],
    metrics: [
      { label: "Total price", value: "$43.50" },
      { label: "Profit margin", value: "82%" },
      { label: "Total oz", value: "1536" },
      { label: "Total $", value: "$41.35" },
    ],
    nested: {
      pricing: { retail: 2.25 },
      recipeNotes: "Use the blue pitcher",
      revenueProjection: 3456,
    },
  }];
  data.recipes.inactiveRecipeIds = ["retired-recipe"];
  data.recipes.editedRecipes = {
    "wall-recipe": {
      title: "Wall Recipe",
      description: "Employee-visible directions",
      defaultChargePerOz: 2,
      ingredients: [{ name: "Gin", oz: 90, costPerOz: 0.75 }],
    },
  };

  const state = {
    version: 1,
    id: "dashboard-config",
    revision: 12,
    initialized: true,
    initializedAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T13:00:00.000Z",
    updatedByRole: "owner",
    data,
  };

  const projected = projectSharedDashboardStateForRole(state, "employee");
  assert.deepEqual(projected.data.pricing, createEmptySharedDashboardData().pricing);
  assert.deepEqual(projected.data.products, createEmptySharedDashboardData().products);
  assert.deepEqual(projected.data.recipes.inactiveRecipeIds, ["retired-recipe"]);

  const recipe = projected.data.recipes.customRecipes[0];
  assert.equal(recipe.id, "profit-punch");
  assert.equal(recipe.title, "Profit Punch");
  assert.equal(recipe.category, "Cocktail");
  assert.equal(recipe.status, "active");
  assert.equal(recipe.batch, "12 gallons");
  assert.equal(recipe.imageUrl, "https://example.com/profit-punch.jpg");
  assert.deepEqual(recipe.instructions, ["Mix", "Chill", "Pour"]);
  assert.equal(recipe.ingredients[0].name, "Vodka");
  assert.equal(recipe.ingredients[0].quantity, 3);
  assert.equal(recipe.ingredients[0].oz, 177.5);
  assert.equal(recipe.ingredients[0].unitCost, undefined);
  assert.equal(recipe.ingredients[0].supplier, undefined);
  assert.equal(recipe.metrics, undefined);
  assert.equal(recipe.defaultChargePerOz, undefined);
  assert.equal(recipe.batchCost, undefined);
  assert.equal(recipe.wholesale, undefined);
  assert.equal(recipe.cogs, undefined);
  assert.equal(recipe.fee, undefined);
  assert.equal(recipe.nested, undefined);

  const edits = projected.data.recipes.editedRecipes["wall-recipe"];
  assert.equal(edits.title, "Wall Recipe");
  assert.equal(edits.description, "Employee-visible directions");
  assert.equal(edits.defaultChargePerOz, undefined);
  assert.equal(edits.ingredients[0].costPerOz, undefined);
  assert.equal(edits.ingredients[0].oz, 90);

  assert.equal(JSON.stringify(projected).includes("secret-beer"), false);
  assert.equal(JSON.stringify(projected).includes("25.85"), false);
  assert.equal(JSON.stringify(projected).includes("$41.35"), false);
  assert.equal(data.recipes.customRecipes[0].batchCost, 43.5);
});

test("unrecognized roles receive the same restricted projection as employees", () => {
  const data = createEmptySharedDashboardData();
  data.pricing.chargeOverrides = { martini: "14" };
  data.products.comingSoonItems = [{ id: "private-product" }];
  data.recipes.customRecipes = [{ id: "safe-recipe", title: "Safe Recipe", recipeCost: 10 }];
  const state = {
    version: 1,
    id: "dashboard-config",
    revision: 1,
    initialized: true,
    initializedAt: "2026-07-30T12:00:00.000Z",
    updatedAt: "2026-07-30T12:00:00.000Z",
    updatedByRole: "owner",
    data,
  };

  assert.deepEqual(
    projectSharedDashboardStateForRole(state, ""),
    projectSharedDashboardStateForRole(state, "employee"),
  );
});
