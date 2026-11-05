import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildStaffPrepPlan, applyStaffPrepPlanUpdate } from "../lib/staff-prep-plan.mjs";
import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";
import { getCocktailRecipeYieldOz, normalizeCocktailRecipeName } from "../public/cocktail-recipe-yields.mjs";
import { applyPrepKegCounts } from "../lib/prep-keg-counts.mjs";
import { isInHousePrepIngredient, refreshWeeklyIngredientPrep } from "../public/in-house-ingredient-prep.mjs";
import { refreshIngredientPurchases } from "../lib/weekly-ingredient-refresh.mjs";

const source = readFileSync(new URL("../lib/weekly-prep-additions.mjs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/weekly-prep-additions/route.js", import.meta.url), "utf8");
const executable = s => s.replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
function harness({ lemonDrop = false } = {}) {
  const generatedAt = "2026-09-14T15:00:00.000Z";
  const items = [
    { key: "main-47-house-special-1", name: "House Special 1", tapNumber: 47, wall: "Main", actionType: "make", orderQty: 1, batchSizeOz: 777 },
    { key: "karaoke-93-house-special-2", name: "House Special 2", tapNumber: 93, wall: "Karaoke", actionType: "make", orderQty: 0, batchSizeOz: 777 },
  ];
  if (lemonDrop) items.forEach((item, index) => {
    item.name = `Lemon Drop Martini (Absolut Citron) ${index + 1}`;
    item.batchSizeOz = 1448;
  });
  let state = { initialized: true, revision: 2, recommendations: { generatedAt, items, prepChecklist: {}, weeklyPlanSnapshot: { ingredientPlanningVersion: 2, generatedAt, plan: buildWeeklyActionPlan({ recommendations: items }) } } };
  const initialOrders = structuredClone(state.recommendations.weeklyPlanSnapshot.plan.orders);
  let writes = 0;
  const recipes = lemonDrop
    ? [{ id: "lemon-drop-martini-vodka", title: "Lemon Drop Martini(Vodka)", ingredients: [
      { name: "Vodka", oz: 828 }, { name: "Lemon Juice", oz: 300 }, { name: "Simple Syrup", oz: 320 },
    ] }]
    : [{ id: "house", title: "House Special", ingredients: [{ name: "Vodka", oz: 77 }, { name: "Mixer", oz: 700 }] }];
  const inventory = { current: { onHandOverrides: {} }, snapshots: [{
    kegPlanSnapshot: { generatedAt, tapInputs: items.map(item => ({ ...item, currentStockKegs: 1, avgWeeklyKegs: 0 })) }, items: [{ id: "simple-syrup", name: "Simple Syrup", onHandDisplay: "0" }],
  }] };
  const context = vm.createContext({
    MINIMUM_KEG_CUSHION: 0.25,
    randomUUID, structuredClone, buildStaffPrepPlan, buildWeeklyActionPlan,
    isInHousePrepIngredient, refreshWeeklyIngredientPrep, refreshIngredientPurchases,
    getCocktailRecipeYieldOz, normalizeCocktailRecipeName, COCKTAIL_RECIPE_YIELDS: [],
    getCurrentWeeklyPlanSnapshot: rec => rec.weeklyPlanSnapshot,
    readParAgentState: async () => structuredClone(state),
    readPrepRecipes: async () => recipes,
    findPrepRecipe: () => recipes[0],
    readSharedInventoryState: async () => structuredClone(inventory),
    recordDashboardActivity: async () => {},
    writeParAgentState: async (next, { expectedRevision }) => {
      assert.equal(expectedRevision, state.revision);
      state = structuredClone({ ...next, revision: expectedRevision + 1 }); writes++;
      return structuredClone(state);
    },
  });
  vm.runInContext(executable(source), context);
  return { context, state: () => state, writes: () => writes, initialOrders, inventory,
    body: (extra = {}) => ({ generatedAt, expectedRevision: state.revision, requestId: randomUUID(), cocktailId: "tap:93", cooler: "Karaoke", quantity: 1, ...extra }),
    identity: { role: "owner", name: "Test manager" } };
}

test("prep choices retain individual taps even when a tap currently needs no prep", async () => {
  const h = harness(); const result = await h.context.readWeeklyPrepChoices();
  assert.deepEqual(Array.from(result.tapCocktails, x => [x.id, x.name, x.wall]), [["tap:47", "House Special 1", "Main"], ["tap:93", "House Special 2", "Karaoke"]]);
});

test("adding and subtracting Lemon Drop recalculates exact syrup prep without replacing other records", async () => {
  const h = harness({ lemonDrop: true });
  h.state().recommendations.items[0].orderQty = 0;
  const snapshot = h.state().recommendations.weeklyPlanSnapshot;
  snapshot.plan.prep.ingredients = [{ id: "other-prep", name: "Other prep", quantity: 1 }];
  snapshot.plan.prep.note = "Keep chilled";
  const originalInventory = structuredClone(h.inventory);
  await h.context.addWeeklyPrepCocktail(h.body(), h.identity);
  let prep = h.state().recommendations.weeklyPlanSnapshot.plan.prep;
  assert.equal(prep.ingredients[1].quantity, 2.5);
  assert.equal(prep.ingredients[1].requiredGallons, 2.5);
  assert.equal(prep.note, "Keep chilled");
  assert.deepEqual(prep.ingredients[0], { id: "other-prep", name: "Other prep", quantity: 1 });
  assert.deepEqual(h.state().recommendations.weeklyPlanSnapshot.plan.orders, h.initialOrders);
  assert.deepEqual(h.inventory, originalInventory);
  const added = buildStaffPrepPlan(h.state().recommendations).items.find(item => item.prepAdditionId);
  await h.context.subtractWeeklyPrepCocktail(h.body({ itemId: added.id }), h.identity);
  prep = h.state().recommendations.weeklyPlanSnapshot.plan.prep;
  assert.deepEqual(prep.ingredients, [{ id: "other-prep", name: "Other prep", quantity: 1 }]);
  assert.equal(prep.note, "Keep chilled");
  assert.deepEqual(h.state().recommendations.weeklyPlanSnapshot.plan.orders, h.initialOrders);
});

test("syrup prep retains completed batch demand because completion leaves the syrup count unchanged", async () => {
  const h = harness({ lemonDrop: true });
  const original = buildStaffPrepPlan(h.state().recommendations).items[0];
  h.state().recommendations = applyStaffPrepPlanUpdate(h.state().recommendations, {
    generatedAt: h.state().recommendations.generatedAt, itemId: original.id, completed: true, preparedBy: "Test",
  });
  const checklist = structuredClone(h.state().recommendations.prepChecklist);
  h.inventory.current.onHandOverrides["simple-syrup"] = "3";
  await h.context.addWeeklyPrepCocktail(h.body({ quantity: 2 }), h.identity);
  let syrup = h.state().recommendations.weeklyPlanSnapshot.plan.prep.ingredients[0];
  assert.equal(syrup.requiredGallons, 7.5);
  assert.equal(syrup.quantity, 4.5);
  const added = buildStaffPrepPlan(h.state().recommendations).items.find(item => item.prepAdditionId);
  await h.context.subtractWeeklyPrepCocktail(h.body({ itemId: added.id }), h.identity);
  syrup = h.state().recommendations.weeklyPlanSnapshot.plan.prep.ingredients[0];
  assert.equal(syrup.requiredGallons, 5);
  assert.equal(syrup.quantity, 2);
  assert.equal(h.inventory.current.onHandOverrides["simple-syrup"], "3");
  assert.deepEqual(h.state().recommendations.prepChecklist, checklist);
});

test("a blank current syrup count holds prep instead of falling back to an older saved count", async () => {
  const h = harness({ lemonDrop: true });
  h.inventory.current.onHandOverrides["simple-syrup"] = "";
  await h.context.addWeeklyPrepCocktail(h.body(), h.identity);
  const syrup = h.state().recommendations.weeklyPlanSnapshot.plan.prep.ingredients[0];
  assert.match(syrup.holdReason, /Verify the Simple Syrup count/);
  assert.equal(syrup.onHandGallons, null);
});

test("adding custom batches is idempotent, keeps correct cooler/yield and leaves orders unchanged", async () => {
  const h = harness(); const body = h.body({ quantity: 2 });
  await h.context.addWeeklyPrepCocktail(body, h.identity);
  await h.context.addWeeklyPrepCocktail(body, h.identity);
  assert.equal(h.writes(), 1);
  const added = buildStaffPrepPlan(h.state().recommendations).items.find(i => i.prepAdditionId);
  assert.equal(added.quantity, 2); assert.equal(added.batchSizeOz, 777); assert.equal(added.wall, "Karaoke");
  assert.deepEqual(h.state().recommendations.weeklyPlanSnapshot.plan.orders, h.initialOrders);
  await assert.rejects(h.context.addWeeklyPrepCocktail({ ...body, quantity: 3 }, h.identity), /different details/);
});

test("extra batches do not inherit completion from the original cocktail", async () => {
  const h = harness(); const original = buildStaffPrepPlan(h.state().recommendations).items[0];
  h.state().recommendations = applyStaffPrepPlanUpdate(h.state().recommendations, { generatedAt: h.state().recommendations.generatedAt, itemId: original.id, completed: true, preparedBy: "Test" });
  await h.context.addWeeklyPrepCocktail(h.body({ cocktailId: "tap:47", cooler: "Main" }), h.identity);
  const items = buildStaffPrepPlan(h.state().recommendations).items;
  assert.equal(items.find(i => i.id === original.id).completed, true);
  assert.equal(items.find(i => i.prepAdditionId).completed, false);
});

test("adding then completing prep carries its cooler key separately from its checklist key", async () => {
  const h = harness();
  await h.context.addWeeklyPrepCocktail(h.body({ quantity: 2 }), h.identity);
  const state = h.state();
  const row = state.recommendations.items.find(item => item.prepAdditionId);
  assert.equal(row.inventoryKey, "karaoke-93-house-special-2");
  assert.match(row.key, /^prep-addition:/);
  const target = buildStaffPrepPlan(state.recommendations).items.find(item => item.prepAdditionId);
  const update = { itemId: target.id, generatedAt: state.recommendations.generatedAt, completed: true, preparedBy: "Molly" };
  const next = applyPrepKegCounts(state, applyStaffPrepPlanUpdate(state.recommendations, update), [{ target, update }]);
  assert.equal(next.onHandOverrides[row.inventoryKey], "2");
  assert.equal(next.onHandOverrides[row.key], undefined);
});

test("subtract removes only one unprepared batch and retries do not subtract twice", async () => {
  const h = harness(); await h.context.addWeeklyPrepCocktail(h.body({ quantity: 2 }), h.identity);
  const added = buildStaffPrepPlan(h.state().recommendations).items.find(i => i.prepAdditionId);
  const body = h.body({ itemId: added.id });
  await h.context.subtractWeeklyPrepCocktail(body, h.identity);
  await h.context.subtractWeeklyPrepCocktail(body, h.identity);
  assert.equal(h.writes(), 2);
  assert.equal(buildStaffPrepPlan(h.state().recommendations).items.find(i => i.id === added.id).quantity, 1);
  assert.deepEqual(h.state().recommendations.weeklyPlanSnapshot.plan.orders, h.initialOrders);
});

test("subtract removes an ordinary planned cocktail", async () => {
  const h = harness();
  const planned = buildStaffPrepPlan(h.state().recommendations).items.find(i => !i.prepAdditionId);
  await h.context.subtractWeeklyPrepCocktail(h.body({ itemId: planned.id }), h.identity);
  assert.equal(h.writes(), 1);
  assert.equal(buildStaffPrepPlan(h.state().recommendations).items.some(i => i.id === planned.id), false);
  assert.deepEqual(h.state().recommendations.weeklyPlanSnapshot.plan.orders, h.initialOrders);
});

test("completed batches, mismatched coolers and stale revisions cannot be changed", async () => {
  const h = harness();
  await assert.rejects(h.context.addWeeklyPrepCocktail(h.body({ cooler: "Main" }), h.identity), /different cooler/);
  await assert.rejects(
    h.context.addWeeklyPrepCocktail(h.body({ expectedRevision: 0 }), h.identity),
    error => error.code === "WEEKLY_PREP_REVISION_CONFLICT" && /another session/.test(error.message),
  );
  const item = buildStaffPrepPlan(h.state().recommendations).items[0];
  h.state().recommendations = applyStaffPrepPlanUpdate(h.state().recommendations, { generatedAt: h.state().recommendations.generatedAt, itemId: item.id, completed: true, preparedBy: "Test" });
  await assert.rejects(h.context.subtractWeeklyPrepCocktail(h.body({ itemId: item.id }), h.identity), /already prepared/);
  assert.equal(h.writes(), 0);
});

test("prep API denies staff and cross-site writes before changing the plan", async () => {
  let role = "staff"; let writes = 0;
  const ctx = vm.createContext({ NextResponse: { json: (body, options) => ({ body, ...options }) }, requireDashboardRequestIdentity: async () => ({ role }), readWeeklyPrepChoices: async () => ({}), addWeeklyPrepCocktail: async () => { writes++; }, subtractWeeklyPrepCocktail: async () => { writes++; } });
  vm.runInContext(executable(route), ctx);
  assert.equal((await ctx.POST({})).status, 403);
  assert.equal((await ctx.GET({})).status, 403);
  role = "owner";
  assert.equal((await ctx.POST({ headers: { get: () => "cross-site" } })).status, 403);
  assert.equal(writes, 0);
});

test("prep API exposes conflict codes used by the safe removal retry", async () => {
  const conflict = Object.assign(new Error("The plan changed."), {
    status: 409,
    code: "WEEKLY_PREP_REVISION_CONFLICT",
  });
  const ctx = vm.createContext({
    NextResponse: { json: (body, options) => ({ body, ...options }) },
    requireDashboardRequestIdentity: async () => ({ role: "owner" }),
    readWeeklyPrepChoices: async () => ({}),
    addWeeklyPrepCocktail: async () => ({}),
    subtractWeeklyPrepCocktail: async () => { throw conflict; },
  });
  vm.runInContext(executable(route), ctx);
  const response = await ctx.POST({
    headers: { get: () => "same-origin" },
    json: async () => ({ action: "subtract" }),
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "WEEKLY_PREP_REVISION_CONFLICT");
});

test("editing prep in an existing legacy week preserves its published purchases", async () => {
  const h = harness();
  delete h.state().recommendations.weeklyPlanSnapshot.ingredientPlanningVersion;
  const beforeInventory = structuredClone(h.inventory);
  const beforeOrders = structuredClone(h.state().recommendations.weeklyPlanSnapshot.plan.orders);
  await h.context.addWeeklyPrepCocktail(h.body(), h.identity);
  assert.equal(h.writes(), 1);
  assert.deepEqual(h.inventory, beforeInventory);
  assert.deepEqual(h.state().recommendations.weeklyPlanSnapshot.plan.orders, beforeOrders);
  assert.equal(h.state().recommendations.weeklyPlanSnapshot.ingredientPlanningVersion, undefined);
});

test("retired ingredient migration requests cannot change an existing published plan", async () => {
  let writes = 0;
  const ctx = vm.createContext({
    NextResponse: { json: (body, options) => ({ body, ...options }) },
    requireDashboardRequestIdentity: async () => ({ role: "owner" }),
    addWeeklyPrepCocktail: async () => { writes++; },
    subtractWeeklyPrepCocktail: async () => { writes++; },
  });
  vm.runInContext(executable(route), ctx);
  const result = await ctx.POST({ headers: { get: () => "same-origin" }, json: async () => ({ action: "refresh-ingredients" }) });
  assert.equal(result.status, 400);
  assert.equal(writes, 0);
});
