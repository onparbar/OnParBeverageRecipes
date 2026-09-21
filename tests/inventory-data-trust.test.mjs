import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyInventoryStateAction,
  createEmptyInventoryState,
} from "../lib/inventory-store.mjs";
import {
  assertInventoryContributionPlan,
  buildRecipeInventoryContributions,
  classifyLiquorInventoryPolicy,
  findCatalogItem,
  isInventoryRecipeIngredient,
} from "../lib/inventory-contributions.mjs";
import {
  executeInventoryBackedOperation,
  InventoryBackedOperationError,
} from "../lib/inventory-backed-operation.mjs";
import { recordDashboardActivity } from "../lib/dashboard-activity-log.mjs";

function initializedInventory() {
  const state = createEmptyInventoryState();
  state.initialized = true;
  state.current.onHandOverrides = { titos: "10" };
  return state;
}

test("cocktail prep inventory excludes recipe calculations but keeps real ingredients", () => {
  [
    { name: "Tito's", raw: "Tito's=6 bottles (1.75L)", oz: 355 },
    { name: "Strawberry Lemonade", raw: "8 Gallons Strawberry Lemonade", oz: 1024 },
  ].forEach((ingredient) => assert.equal(isInventoryRecipeIngredient(ingredient), true));

  [
    "Price we're charging",
    "Profit per oz",
    "Profit margin",
    "Cost for 1.5 oz of liquor",
    "How many oz per shot",
  ].forEach((label) => assert.equal(isInventoryRecipeIngredient({ name: label, raw: label }), false));
});

test("cocktail ingredients prefer the canonical inventory item when duplicate names exist", () => {
  const catalog = [
    { id: "titos-1-75l", name: "Tito's 1.75L" },
    { id: "titos", name: "Tito's" },
  ];
  assert.equal(findCatalogItem(catalog, { name: "Tito's" })?.id, "titos");
});

test("vanilla syrup recipes keep the existing vanilla inventory identity", () => {
  const catalog = [{ id: "vanilla", name: "Vanilla", baseline: 2 }];
  assert.equal(findCatalogItem(catalog, { name: "Vanilla Syrup" })?.id, "vanilla");
});

test("liquor refill policy separates cabinet stock from direct-to-keg products", () => {
  const activeRecipes = [{
    id: "spiked-lemonade",
    ingredients: [{ name: "Tito's", raw: "Tito's=6 bottles (1.75L)", oz: 355 }],
  }, {
    id: "old-fashioned",
    inactive: true,
    ingredients: [{ name: "Woodford Reserve", raw: "Woodford Reserve", oz: 50 }],
  }];

  assert.equal(classifyLiquorInventoryPolicy({
    catalog: [{ id: "titos", name: "Tito's", baseline: 8 }],
    recipes: activeRecipes,
    target: { name: "Tito's Vodka" },
  }).policy, "cabinet-backed");
  assert.equal(classifyLiquorInventoryPolicy({
    catalog: [],
    recipes: activeRecipes,
    target: { name: "Tito's Vodka" },
  }).policy, "cabinet-review");
  assert.equal(classifyLiquorInventoryPolicy({
    catalog: [],
    recipes: activeRecipes,
    target: { name: "Woodford Reserve Bourbon" },
  }).policy, "direct-to-keg");
  assert.equal(classifyLiquorInventoryPolicy({
    catalog: [],
    recipes: activeRecipes,
    target: { name: "Absolut Raspberri Vodka" },
  }).policy, "direct-to-keg");
});

test("cocktail prep deducts only tracked on-hand ingredients using the requested bottle size", () => {
  const catalog = [
    { id: "titos", name: "Tito's", baseline: 4 },
    { id: "titos-1-75l", name: "Tito's 1.75L", baseline: 10 },
    { id: "strawberry-lemonade", name: "Strawberry Lemonade", baseline: 12 },
  ];
  const recipe = {
    ingredients: [
      { name: "Tito's", raw: "Tito's=6 bottles (1.75L)", oz: 355 },
      { name: "Strawberry Lemonade", raw: "8 Gallons Strawberry Lemonade", oz: 1024 },
      { name: "Profit margin", raw: "Profit margin", oz: 91.7 },
    ],
  };

  assert.deepEqual(buildRecipeInventoryContributions(recipe, catalog, {
    batchSizeOz: 1379,
    quantity: 1,
  }), [{ id: "titos-1-75l", quantity: -6, baseline: 10 }]);
});

test("excluded prep juices need no inventory match and still contribute to batch scaling", () => {
  for (const name of ["Strawberry lemonade", "Cranberry juice", "Cranberry"]) {
    const recipe = { ingredients: [
      { name: "Tito's", raw: "Tito's=6 bottles (1.75L)", oz: 355 },
      { name, oz: 1024 },
    ] };
    assert.deepEqual(buildRecipeInventoryContributions(recipe, [
      { id: "titos", name: "Tito's", baseline: 12 },
    ], { batchSizeOz: 1379 / 2, quantity: 2 }), [
      { id: "titos", quantity: -6, baseline: 12 },
    ]);
  }
});

test("the source recipe's pomegrante spelling maps to counted pomegranate schnapps", () => {
  const recipe = { ingredients: [{ name: "Pomegrante Schnapps", raw: "Pomegrante Schnapps (1 Liter)=22 bottles", oz: 743.9 }] };
  assert.deepEqual(buildRecipeInventoryContributions(recipe, [
    { id: "pomegranate-schnapps", name: "Pomegranate Schnapps", baseline: 30 },
  ]), [{ id: "pomegranate-schnapps", quantity: -22, baseline: 30 }]);
});

test("counted ingredients require a match and usable package quantity", () => {
  const recipe = { title: "Test cocktail", ingredients: [{ name: "Test juice", oz: 10 }] };
  assert.throws(() => buildRecipeInventoryContributions(recipe, []), error => error.code === "INVENTORY_IDENTITY_REVIEW_REQUIRED");
  assert.throws(() => buildRecipeInventoryContributions(recipe, [{ id: "test-juice", name: "Test juice" }]), error => error.code === "INVENTORY_PACKAGE_REVIEW_REQUIRED");
  assert.deepEqual(buildRecipeInventoryContributions(recipe, [{ id: "test-juice", name: "Test juice", notCounted: true }]), []);
  assert.deepEqual(buildRecipeInventoryContributions({ ingredients: [{ name: "Water", oz: 10 }, { name: "Sour Mix", oz: 10 }] }, []), []);
});

test("inventory contribution retries do not subtract twice", () => {
  const payload = {
    sources: [{
      sourceId: "liquor-refill:week:item",
      reason: "Tito's added to keg",
      contributions: [{ id: "titos", quantity: -2, baseline: 10 }],
    }],
  };
  const first = applyInventoryStateAction(initializedInventory(), "apply-contributions", payload, "employee");
  const retry = applyInventoryStateAction(first, "apply-contributions", payload, "employee");
  assert.equal(first.current.onHandOverrides.titos, "8");
  assert.equal(retry.current.onHandOverrides.titos, "8");
});

test("changing an already-recorded contribution applies only the difference", () => {
  const source = (quantity) => ({
    sources: [{
      sourceId: "liquor-refill:week:item",
      reason: "Tito's added to keg",
      contributions: [{ id: "titos", quantity, baseline: 10 }],
    }],
  });
  const first = applyInventoryStateAction(initializedInventory(), "apply-contributions", source(-2), "employee");
  const corrected = applyInventoryStateAction(first, "apply-contributions", source(-3), "employee");
  const reopened = applyInventoryStateAction(corrected, "apply-contributions", {
    sources: [{ sourceId: "liquor-refill:week:item", reason: "Reopened", contributions: [] }],
  }, "employee");
  assert.equal(corrected.current.onHandOverrides.titos, "7");
  assert.equal(reopened.current.onHandOverrides.titos, "10");
});

test("unmatched inventory identities block before persistence", async () => {
  let persisted = false;
  const plan = { sources: [], unmatched: [{ id: "mystery", name: "Mystery Product" }] };
  await assert.rejects(
    executeInventoryBackedOperation({
      plan,
      assertPlan: assertInventoryContributionPlan,
      persist: async () => { persisted = true; },
      applyInventory: async () => ({}),
      recordActivity: async () => {},
    }),
    (error) => error.code === "INVENTORY_IDENTITY_REVIEW_REQUIRED",
  );
  assert.equal(persisted, false);
});

test("inventory and activity failures remain explicitly retryable", async () => {
  const plan = { sources: [{ sourceId: "test", contributions: [] }], unmatched: [] };
  await assert.rejects(
    executeInventoryBackedOperation({
      plan,
      assertPlan: assertInventoryContributionPlan,
      persist: async () => ({ revision: 1 }),
      applyInventory: async () => { throw new Error("offline"); },
      recordActivity: async () => {},
    }),
    (error) => error instanceof InventoryBackedOperationError
      && error.details.stage === "inventory"
      && error.details.retryable === true,
  );
  const result = await executeInventoryBackedOperation({
    plan, assertPlan: assertInventoryContributionPlan,
    persist: async () => ({ revision: 1 }),
    applyInventory: async () => ({ appliedItemCount: 0 }),
    recordActivity: async () => { throw new Error("offline"); },
  });
  assert.equal(result.activityRecorded, false);
  assert.equal(result.saved.revision, 1);
});

test("activity retries detect an existing matching record", async () => {
  const calls = [];
  const result = await recordDashboardActivity({
    area: "Inventory",
    action: "consumed cocktail ingredients",
    role: "employee",
    revision: 12,
    summary: "Test operation",
    dedupe: true,
  }, {
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "secret" },
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, json: async () => [{ id: 1 }] };
    },
  });
  assert.deepEqual(result, { recorded: false, duplicate: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
});

test("pending receiving lines require an explicit user choice", async () => {
  const source = await readFile(new URL("../public/staff-receiving-view.mjs", import.meta.url), "utf8");
  assert.match(source, /item\.status === "pending" \? "Received" : "Receive remaining"/);
  assert.match(source, /item\.status === "pending"\s*\? ""/);
  assert.match(source, /window\.confirm\(`Confirm these/);
  assert.match(source, /if \(!count\.value\.trim\(\)/);
});
