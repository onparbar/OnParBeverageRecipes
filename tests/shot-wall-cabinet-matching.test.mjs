import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRollingCocktailIngredientOrders, netRollingLiquorTapRecommendations } from "../public/rolling-cocktail-ingredients.mjs";
import { buildWeeklyActionPlan, createWeeklyPlanSnapshot, isRecommendationForOperatingWeek, normalizeLiquorTapProductName } from "../public/weekly-action-plan.mjs";
import { normalizeVendorOrderPolicy } from "../public/vendor-order-drafts.mjs";
import { sanitizeKegPlanSnapshot } from "../lib/inventory-store.mjs";
import { applyStaffPrepPlanUpdate, buildStaffPrepPlan } from "../lib/staff-prep-plan.mjs";
import { findCatalogItem } from "../lib/inventory-contributions.mjs";

const generatedAt = "2026-11-02T16:57:27.987Z";
const products = [
  { id: "don-julio-blanco", name: "Don Julio Blanco", tapName: "Don Julio Blanco Tequila 3", tapNumber: 4, sku: "2722D", cost: 98.7 },
  { id: "crown-royal-peach", name: "Crown Royal Peach", tapName: "Crown Royal Peach Whiskey 3", tapNumber: 17, sku: "2375D", cost: 53.58 },
  { id: "woodford-reserve", name: "Woodford Reserve", tapName: "Woodford Reserve Bourbon 3", tapNumber: 18, sku: "9674D", cost: 66.74 },
];
const cabinet = products.map(product => ({
  id: product.id, name: product.name, group: "Liquor Cabinet", onHand: 2,
  hasCurrentCount: true, bottleOz: 59.1745, packSize: 1, casePackaged: false,
  vendor: "OHLQ", vendorSku: product.sku, unitCost: product.cost,
}));
const refills = products.map(product => ({
  key: `patio-${product.tapNumber}`, name: product.tapName, orderProductName: product.tapName,
  tapNumber: product.tapNumber, wall: "Patio", isLiquorTap: true, actionType: "order",
  orderQty: 2, bottleOz: 59.1745,
}));
function rolling(items = cabinet, options = {}) {
  return buildRollingCocktailIngredientOrders({ inventoryItems: items, cocktails: [], ...options });
}
function dashboardFunction(name, scope) {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const fn = source.slice(start, source.indexOf("\n}\n", start) + 2);
  return new Function(...Object.keys(scope), `${fn}\nreturn ${name};`)(...Object.values(scope));
}

test("the three counted cabinet products cover the actual PMB shot-wall names without supplier metadata", () => {
  const inventory = rolling();
  assert.deepEqual(inventory.map(item => [item.rollingIngredientVersion, item.onHand, item.cocktailPrepRequiredBottles, item.rollingReserveUnits, item.orderHoldReason]),
    products.map(() => [1, 2, 0, 0, ""]));
  const before = structuredClone({ inventory, refills });
  const result = netRollingLiquorTapRecommendations(refills, inventory);
  assert.deepEqual(result.map(item => [item.orderQty, item.cabinetUsedQty, item.actionType, item.cabinetInventoryId]),
    products.map(product => [0, 2, "none", product.id]));
  assert.deepEqual({ inventory, refills }, before, "Netting does not consume physical counts or rewrite raw refill requirements");
  assert.deepEqual(netRollingLiquorTapRecommendations(refills, inventory), result, "Recalculating the same inputs is stable");
  assert.equal(createWeeklyPlanSnapshot({ generatedAt, recommendations: result, inventoryItems: inventory }).plan.orders.liquorTapBottles.length, 0);
});

test("preview and server publication both subtract those same saved bottles", async () => {
  const inventory = rolling();
  const preview = dashboardFunction("getWeeklyPlanRecommendations", {
    getCurrentMondayKegPlanSnapshot: () => ({ items: refills }),
    netRollingLiquorTapRecommendations, getWeeklyPlanInventoryItems: () => inventory,
    normalizeIngredientAlias: String, normalizeLiquorTapProductName,
    slugify: value => value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    inventoryItems: [], getVendorMapping: () => null, getWeeklyPlanLiquorBottleCost: () => 0,
  })();
  assert.deepEqual(preview.map(item => item.orderQty), [0, 0, 0]);
  const source = readFileSync(new URL("../lib/par-agent.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function publishWeeklyPlanSnapshot(");
  const fn = source.slice(start, source.indexOf("\n}\n", start) + 2).replace("export async", "async");
  const writes = [];
  const scope = {
    Date: class extends Date { constructor(value = generatedAt) { super(value); } },
    readParAgentState: async () => ({ initialized: true, revision: 7 }),
    writeParAgentState: async (value, options) => { writes.push({ value, options }); return value; },
    sanitizeKegPlanSnapshot, isRecommendationForOperatingWeek, netRollingLiquorTapRecommendations,
    clean: value => String(value ?? "").trim(), toNumber: Number, normalizeVendorOrderPolicy, createWeeklyPlanSnapshot,
  };
  const publish = new Function(...Object.keys(scope), `${fn}\nreturn publishWeeklyPlanSnapshot;`)(...Object.values(scope));
  const saved = await publish({ inventoryItems: inventory, kegPlanSnapshot: { generatedAt, items: refills },
    recommendationPricing: products.map((product, index) => ({ key: refills[index].key, vendor: "OHLQ", vendorSku: product.sku, vendorProductName: product.tapName, unitCost: product.cost })) });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.expectedRevision, 7);
  assert.deepEqual(saved.recommendations.items.map(item => item.orderQty), [0, 0, 0]);
  assert.equal(saved.recommendations.weeklyPlanSnapshot.plan.orders.liquorTapBottles.length, 0);
  assert.deepEqual(saved.recommendations.weeklyPlanSnapshot.plan.prep.liquorRefills.map(item => [item.quantity, item.inventoryItemId]).sort(),
    products.map(product => [2, product.id]).sort());
  const before = buildStaffPrepPlan({ generatedAt, items: refills });
  const after = buildStaffPrepPlan(saved.recommendations);
  assert.deepEqual(after.liquorRefills.map(item => [item.id, item.quantity]), before.liquorRefills.map(item => [item.id, item.quantity]),
    "Purchase netting preserves all three physical refills and their existing completion IDs");
  assert.deepEqual(after.liquorRefills.map(item => item.inventoryItemId).sort(), products.map(product => product.id).sort());
  const completed = applyStaffPrepPlanUpdate(saved.recommendations, {
    generatedAt, itemId: before.liquorRefills[0].id, completed: true, preparedBy: "Sam", actualQuantity: 2,
  });
  assert.equal(buildStaffPrepPlan(completed).liquorRefills[0].completed, true);
  const legacyCompleted = applyStaffPrepPlanUpdate({ generatedAt, items: refills }, {
    generatedAt, itemId: before.liquorRefills[1].id, completed: true, preparedBy: "Sam", actualQuantity: 2,
  });
  assert.equal(buildStaffPrepPlan({ ...saved.recommendations, prepChecklist: legacyCompleted.prepChecklist }).liquorRefills[1].completed, true,
    "An existing completion survives cabinet matching without a new ledger identity");
  const roundtrip = sanitizeKegPlanSnapshot({ generatedAt, items: saved.recommendations.items });
  assert.equal(roundtrip.items.length, 3, "Physical refills survive sanitizing even when all purchase quantities are zero");
  assert.deepEqual(roundtrip.items.map(item => [item.orderQty, item.refillBottleQty, item.bottleOz, item.cabinetUsedQty, item.cabinetInventoryId]),
    products.map(product => [0, 2, 59.1745, 2, product.id]));
  assert.deepEqual(buildStaffPrepPlan(roundtrip).liquorRefills, after.liquorRefills);
});

test("aliases allocate each cabinet balance only once across multiple physical taps", () => {
  for (const [index, product] of products.entries()) {
    const results = netRollingLiquorTapRecommendations([refills[index], { ...refills[index], key: "karaoke-other", name: product.name, orderProductName: product.name }], rolling());
    assert.deepEqual(results.map(item => [item.orderQty, item.cabinetUsedQty]), [[0, 2], [2, 0]]);
  }
});

test("prep, reserves, missing counts and holds still protect cabinet stock", () => {
  const woodfordPrep = rolling(cabinet, {
    cocktails: [{ name: "Example", tapNumber: 50, actionType: "make", orderQty: 1 }],
    recipes: [{ title: "Example", ingredients: [{ inventoryId: "woodford-reserve", name: "Woodford Reserve", oz: 59.1745 }] }],
  });
  assert.equal(woodfordPrep[2].cocktailPrepRequiredBottles, 1);
  const [partial] = netRollingLiquorTapRecommendations([refills[2]], woodfordPrep);
  assert.equal(partial.cabinetUsedQty, 1);
  assert.equal(partial.orderQty, 2, "The uncovered refill retains its existing purchase-batch rounding");
  assert.equal(partial.refillBottleQty, 2, "Physical refills do not add the cabinet bottle to a rounded purchase batch");
  assert.equal(buildWeeklyActionPlan({ recommendations: [partial] }).prep.liquorRefills[0].quantity, 2);
  for (const change of [
    { hasCurrentCount: false }, { onHand: null }, { onHand: "" }, { onHand: 0 },
    { orderHoldReason: "Recipe quantity needs review" }, { rollingReserveUnits: 2 },
  ]) {
    const inventory = rolling().map(item => ({ ...item, ...change }));
    const result = netRollingLiquorTapRecommendations(refills, inventory);
    assert.deepEqual(result.map(item => item.orderQty), [2, 2, 2]);
  }
});

test("bounded names do not match different expressions or choose an ambiguous cabinet row", () => {
  for (const name of ["Don Julio Reposado Tequila 3", "Don Julio 1942 Tequila 3", "Crown Royal Apple Whiskey 3", "Woodford Reserve Double Oaked Bourbon 3"]) {
    const refill = { ...refills[0], name, orderProductName: name };
    assert.deepEqual(netRollingLiquorTapRecommendations([refill], rolling()), [refill]);
  }
  const ambiguous = rolling([...cabinet, { ...cabinet[2], id: "other-woodford", name: "Woodford Reserve Bourbon" }]);
  assert.deepEqual(netRollingLiquorTapRecommendations([refills[2]], ambiguous), [refills[2]]);
  const whisky = { ...refills[1], name: "Crown Royal Peach Whisky 3", orderProductName: "Crown Royal Peach Whisky 3" };
  assert.equal(netRollingLiquorTapRecommendations([whisky], rolling())[0].orderQty, 0);
});

test("explicit physical quantities survive capture while legacy and explicit zero remain distinct", () => {
  const captured = sanitizeKegPlanSnapshot({ generatedAt, items: [
    { ...refills[0], refillBottleQty: 4 }, { ...refills[1], refillBottleQty: 0 }, refills[2],
  ] });
  assert.equal(captured.items[0].refillBottleQty, 4);
  assert.equal(captured.items[1].refillBottleQty, 0);
  assert.equal(Object.hasOwn(captured.items[2], "refillBottleQty"), false);
  const tasks = buildStaffPrepPlan(captured).liquorRefills;
  assert.deepEqual(tasks.map(item => item.quantity).sort(), [2, 4]);
});

test("manager prep renders physical refill rows and falls back for already saved legacy plans", () => {
  const modern = buildWeeklyActionPlan({ recommendations: netRollingLiquorTapRecommendations(refills, rolling()) });
  const legacy = buildWeeklyActionPlan({ recommendations: refills });
  delete legacy.prep.liquorRefills;
  for (const plan of [modern, legacy]) {
    let displayed;
    const stopAfterPrep = new Error("prep rendered");
    const render = dashboardFunction("renderWeeklyPlan", {
      toNumber: Number,
      dashboardRenderCoordinator: { defer: () => false }, weeklyOrderController: null,
      weeklyPlan: {}, parAgentState: { recommendations: { generatedAt } },
      getWeeklyPlanModel: () => plan, getWeeklyPlanFreshness: () => ({}),
      getVendorOrderDraftModel: () => ({}), getCurrentWeeklyPlanSnapshot: () => ({}),
      buildWeeklyPlanPresentationModel: () => ({}), isEasternMonday: () => false,
      getMondayRunModel: () => ({ steps: [] }), dashboardStaffPrepPlan: { available: false },
      formatPrepCompletionSummary: () => "", ORDER_REHEARSAL_AVAILABLE: false,
      orderRehearsalMode: false, renderWeeklyIngredientPrep: () => "",
      renderWeeklyPlanCocktailRows: () => "",
      renderWeeklyPlanLiquorRefillRows: (items) => { displayed = items; throw stopAfterPrep; },
    });
    assert.throws(render, error => error === stopAfterPrep);
    assert.deepEqual(displayed.map(item => item.quantity), [2, 2, 2]);
  }
});

test("the actual contribution planner deducts the linked cabinet item for the accepted Whisky spelling", async () => {
  const whisky = { ...refills[1], name: "Crown Royal Peach Whisky 3", orderProductName: "Crown Royal Peach Whisky 3" };
  const netted = netRollingLiquorTapRecommendations([whisky], rolling());
  const target = buildStaffPrepPlan(sanitizeKegPlanSnapshot({ generatedAt, items: netted })).liquorRefills[0];
  assert.equal(target.inventoryItemId, "crown-royal-peach");
  const source = readFileSync(new URL("../lib/inventory-contributions.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function planPrepInventoryContributions(");
  const fn = source.slice(start, source.indexOf("\n}\n", start) + 2).replace("export async", "async");
  const scope = {
    readSharedInventoryState: async () => ({}),
    buildInventoryCatalog: async () => cabinet.map(item => ({ ...item, baseline: item.onHand })),
    clean: value => String(value ?? "").trim(), number: Number, findCatalogItem,
    normalizePlan: plan => plan,
    loadRecipes: () => { throw new Error("Exact linked cabinet identity should not need recipe inference"); },
  };
  const plan = new Function(...Object.keys(scope), `${fn}\nreturn planPrepInventoryContributions;`)(...Object.values(scope));
  const result = await plan({ target, generatedAt, completed: true, actualQuantity: 2 });
  assert.deepEqual(result.sources, [{
    sourceId: `liquor-refill:${generatedAt}:${target.id}`,
    reason: "Crown Royal Peach Whisky added to keg",
    contributions: [{ id: "crown-royal-peach", quantity: -2, baseline: 2 }],
  }]);
  assert.deepEqual((await plan({ target, generatedAt, completed: false })).sources[0].contributions, []);
  assert.deepEqual(cabinet.map(item => item.onHand), [2, 2, 2], "Planning never consumes the physical count before prep completion");
});
