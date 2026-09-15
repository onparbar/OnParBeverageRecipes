import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { buildStaffPrepPlan, applyStaffPrepPlanUpdate } from "../lib/staff-prep-plan.mjs";
import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";
import { getCocktailRecipeYieldOz, normalizeCocktailRecipeName } from "../public/cocktail-recipe-yields.mjs";

const source = readFileSync(new URL("../lib/weekly-prep-additions.mjs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/weekly-prep-additions/route.js", import.meta.url), "utf8");
const executable = s => s.replace(/^import[\s\S]*?;\n/gm, "").replace(/^export /gm, "");
function harness() {
  const generatedAt = "2026-09-14T15:00:00.000Z";
  const items = [
    { name: "House Special 1", tapNumber: 47, wall: "Main", actionType: "make", orderQty: 1, batchSizeOz: 777 },
    { name: "House Special 2", tapNumber: 93, wall: "Karaoke", actionType: "make", orderQty: 0, batchSizeOz: 777 },
  ];
  let state = { initialized: true, revision: 2, recommendations: { generatedAt, items, prepChecklist: {}, weeklyPlanSnapshot: { generatedAt, plan: buildWeeklyActionPlan({ recommendations: items }) } } };
  const initialOrders = structuredClone(state.recommendations.weeklyPlanSnapshot.plan.orders);
  let writes = 0;
  const recipes = [{ id: "house", title: "House Special", ingredients: [{ name: "Vodka", oz: 77 }, { name: "Mixer", oz: 700 }] }];
  const context = vm.createContext({
    randomUUID, structuredClone, buildStaffPrepPlan, buildWeeklyActionPlan,
    getCocktailRecipeYieldOz, normalizeCocktailRecipeName, COCKTAIL_RECIPE_YIELDS: [],
    getCurrentWeeklyPlanSnapshot: rec => rec.weeklyPlanSnapshot,
    readParAgentState: async () => structuredClone(state),
    readPrepRecipes: async () => recipes,
    findPrepRecipe: () => recipes[0],
    readSharedInventoryState: async () => ({ snapshots: [] }),
    recordDashboardActivity: async () => {},
    writeParAgentState: async (next, { expectedRevision }) => {
      assert.equal(expectedRevision, state.revision);
      state = structuredClone({ ...next, revision: expectedRevision + 1 }); writes++;
      return structuredClone(state);
    },
  });
  vm.runInContext(executable(source), context);
  return { context, state: () => state, writes: () => writes, initialOrders,
    body: (extra = {}) => ({ generatedAt, expectedRevision: state.revision, requestId: randomUUID(), cocktailId: "tap:93", cooler: "Karaoke", quantity: 1, ...extra }),
    identity: { role: "owner", name: "Test manager" } };
}

test("prep choices retain individual taps even when a tap currently needs no prep", async () => {
  const h = harness(); const result = await h.context.readWeeklyPrepChoices();
  assert.deepEqual(Array.from(result.tapCocktails, x => [x.id, x.name, x.wall]), [["tap:47", "House Special 1", "Main"], ["tap:93", "House Special 2", "Karaoke"]]);
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

test("completed batches, mismatched coolers and stale revisions cannot be changed", async () => {
  const h = harness();
  await assert.rejects(h.context.addWeeklyPrepCocktail(h.body({ cooler: "Main" }), h.identity), /different cooler/);
  await assert.rejects(h.context.addWeeklyPrepCocktail(h.body({ expectedRevision: 0 }), h.identity), /another session/);
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
