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

test("Tito's and Jose recipes resolve to the live cabinet inventory identities", () => {
  const catalog = [
    { id: "tito-s-1-75l", name: "Tito's 1.75L" },
    { id: "tito-s", name: "Tito's" },
    { id: "jose-cuervo", name: "Jose Cuervo" },
    { id: "jose-cuervo-silver", name: "Jose Cuervo Silver" },
  ];
  assert.equal(findCatalogItem(catalog, { name: "Tito's", raw: "Tito's=6 bottles (1.75L)" })?.id, "tito-s");
  assert.equal(findCatalogItem(catalog, { name: "Jose Cuervo", raw: "Jose Cuervo=8 bottles (1.75L)" })?.id, "jose-cuervo-silver");
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

test("a one-ounce nominal batch mismatch does not create fractional bottle deductions", () => {
  const catalog = [
    { id: "lime-juice", name: "Lime Juice", baseline: 24 },
    { id: "raspberry-schnapps", name: "Raspberry Schnapps", baseline: 10 },
  ];
  const recipe = { ingredients: [
    { name: "Lime Juice", raw: "Lime Juice=8 bottles (1L)", oz: 270 },
    { name: "Raspberry Schnapps", raw: "Raspberry Schnapps=8 bottles (1L)", oz: 270 },
    { name: "Water", raw: "Water", oz: 999 },
  ] };
  const contribution = buildRecipeInventoryContributions(recipe, catalog, { batchSizeOz: 1540, quantity: 1 });
  assert.deepEqual(contribution, [
    { id: "lime-juice", quantity: -8, baseline: 24 },
    { id: "raspberry-schnapps", quantity: -8, baseline: 10 },
  ]);
  assert.equal(
    buildRecipeInventoryContributions(recipe, catalog, { batchSizeOz: 770, quantity: 1 })[0].quantity,
    -5,
    "a scaled bottle requirement is rounded up to the complete bottle actually used",
  );
});

test("rounded ingredient ounces always deduct complete bottles", () => {
  const catalog = [
    { id: "tito-s", name: "Tito's", baseline: 20 },
    { id: "triple-sec", name: "Triple Sec", baseline: 20 },
    { id: "korbel-brut", name: "Korbel Brut", baseline: 20 },
  ];
  const recipe = { ingredients: [
    { name: "Tito's", raw: "Tito's=5 bottles (1.75L)", oz: 295.9 },
    { name: "Triple Sec", raw: "Triple Sec=5 bottles (1L)", oz: 169.1 },
    { name: "Korbel Brut", raw: "Korbel Brut=5 bottles (750mL)", oz: 126.8 },
  ] };

  assert.deepEqual(buildRecipeInventoryContributions(recipe, catalog, {
    // The planned yield is intentionally half an ounce above the rounded
    // ingredient total. Each written five-bottle amount remains five bottles.
    batchSizeOz: 592.3,
    quantity: 1,
  }), [
    { id: "tito-s", quantity: -5, baseline: 20 },
    { id: "triple-sec", quantity: -5, baseline: 20 },
    { id: "korbel-brut", quantity: -5, baseline: 20 },
  ]);
});

test("uncounted prep mixers need no inventory match and still contribute to batch scaling", () => {
  for (const name of [
    "Strawberry lemonade",
    "Cranberry juice",
    "Cranberry",
    "Lemonade",
    "gallon lemonade",
    "Sweet Tea",
    "Simple Syrup",
    "Mint",
    "1152 blue dot juice",
  ]) {
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

test("this week's Arnold Palmer and Cranberry Lemonade deduct only Tito's", () => {
  const catalog = [{ id: "titos-1-75l", name: "Tito's 1.75L", baseline: 18 }];
  const recipes = [{
    title: "Spiked Arnold Palmer (Vodka)",
    ingredients: [
      { name: "Titos", raw: "Titos=6 bottles (1.75L bts)", oz: 355 },
      { name: "Lemonade", raw: "4.5 Gallons Lemonade", oz: 576 },
      { name: "Sweet Tea", raw: "4.5 Gallons Sweet Tea", oz: 576 },
    ],
    batchSizeOz: 1507,
  }, {
    title: "Spiked Cranberry Lemonade (Vodka)",
    ingredients: [
      { name: "Tito's", raw: "Tito's 6 bottles (1.75L)", oz: 355 },
      { name: "Lemonade", raw: "5 Gallons Lemonade", oz: 640 },
      { name: "Cranberry", raw: "3 Gallons Cranberry", oz: 384 },
    ],
    batchSizeOz: 1379,
  }];

  recipes.forEach((recipe) => assert.deepEqual(buildRecipeInventoryContributions(recipe, catalog, {
    batchSizeOz: recipe.batchSizeOz,
    quantity: 1,
  }), [{ id: "titos-1-75l", quantity: -6, baseline: 18 }]));
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
