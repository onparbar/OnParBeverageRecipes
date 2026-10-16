import assert from "node:assert/strict";
import test from "node:test";
import { buildRecipeInventoryContributions, findCatalogItem } from "../lib/inventory-contributions.mjs";
import { applyInventoryStateAction, createEmptyInventoryState } from "../lib/inventory-store.mjs";
import { applyStaffPrepPlanUpdate, buildStaffPrepPlan } from "../lib/staff-prep-plan.mjs";
import { applyPrepKegCounts } from "../lib/prep-keg-counts.mjs";

const catalog = [
  { id: "jack-daniels", name: "Jack Daniels", baseline: 10 },
  { id: "bacardi", name: "Bacardi", baseline: 6 },
  { id: "jack-daniel-s", name: "Jack Daniel's", baseline: 16 },
];
const recipes = [
  { title: "Bacardi Sunset", ingredients: [
    { name: "Bacardi Superior", raw: "Bacardi Superior = 6 bottles (1.75L)", oz: 355.05 },
    { name: "Strawberry Lemonade", raw: "Strawberry Lemonade = 8 gallons", oz: 1024 },
  ] },
  { title: "Jacked Up Strawberry Lemonade (Whiskey)", ingredients: [
    { name: "Jack Daniels", raw: "Jack Daniels=6 bottles (1.75L)", oz: 355 },
    { name: "Strawberry Lemonade", raw: "1024 oz Strawberry Lemonade", oz: 1024 },
  ] },
];

test("Bacardi prep and vendor names resolve to its counted cabinet item", () => {
  for (const name of ["Bacardi", "Bacardi Superior", "Bacardi Superior Traveler (Rum) 1.75L"]) {
    assert.equal(findCatalogItem(catalog, { name })?.id, "bacardi", name);
  }
  assert.deepEqual(buildRecipeInventoryContributions(recipes[0], catalog), [{ id: "bacardi", quantity: -6, baseline: 6 }]);
});

test("Jack Daniel's new prep uses the visible cabinet instead of the old CSV duplicate", () => {
  for (const items of [catalog, [...catalog].reverse()]) {
    assert.equal(findCatalogItem(items, { name: "Jack Daniels", raw: "Jack Daniels=6 bottles (1.75L)" })?.id, "jack-daniel-s");
    assert.deepEqual(buildRecipeInventoryContributions(recipes[1], items), [{ id: "jack-daniel-s", quantity: -6, baseline: 16 }]);
  }
});

test("explicit historical identities remain usable and flavors are never substituted", () => {
  assert.equal(findCatalogItem(catalog, { id: "jack-daniels", name: "Jack Daniels" })?.id, "jack-daniels");
  assert.equal(findCatalogItem(catalog, { name: "Jack Daniel's Fire" }), null);
  assert.equal(findCatalogItem(catalog, { name: "Bacardi Limon" }), null);
  assert.equal(findCatalogItem([{ id: "other", name: "Bacardi Limon" }], { name: "Bacardi Superior" }), null);
});

test("both cocktail checkoffs deduct six bottles once and credit their own cooler keg", () => {
  const generatedAt = "2026-10-12T19:23:03.740Z";
  const keys = ["main-48-captain-quencher-captain-morgan-1", "main-68-jacked-up-strawberry-lemonade-jack-daniels-1"];
  const state = { onHandOverrides: Object.fromEntries(keys.map(key => [key, "0"])), recommendations: {
    generatedAt, items: recipes.map((recipe, index) => ({
      key: keys[index], name: `${recipe.title} 1`, tapNumber: index ? 68 : 48,
      wall: "Main", actionType: "make", isKegTap: true, orderQty: 1,
    })),
  } };
  const targets = buildStaffPrepPlan(state.recommendations).items;
  const sources = targets.map(target => ({
    sourceId: `cocktail-prep:${generatedAt}:${target.id}`, reason: `${target.name} completed`,
    contributions: buildRecipeInventoryContributions(recipes.find(recipe => target.name.startsWith(recipe.title)), catalog, target),
  }));
  let inventory = createEmptyInventoryState();
  inventory.initialized = true;
  inventory.current.onHandOverrides = { bacardi: "6", "jack-daniel-s": "16", "jack-daniels": "10" };
  const changes = targets.map(target => ({ target, update: { itemId: target.id, generatedAt, completed: true, preparedBy: "Test preparer" } }));
  const recommendations = changes.reduce((result, { update }) => applyStaffPrepPlanUpdate(result, update), state.recommendations);
  const completed = applyPrepKegCounts(state, recommendations, changes);
  inventory = applyInventoryStateAction(inventory, "apply-contributions", { sources }, "employee");
  assert.equal(buildStaffPrepPlan(completed.recommendations).completedCount, 2);
  assert.deepEqual(completed.onHandOverrides, Object.fromEntries(keys.map(key => [key, "1"])));
  assert.deepEqual(inventory.current.onHandOverrides, { bacardi: "0", "jack-daniel-s": "10", "jack-daniels": "10" });
  assert.deepEqual(inventory.current.contributionShortfalls, {});
  const retry = applyInventoryStateAction(inventory, "apply-contributions", { sources }, "employee");
  assert.deepEqual(retry.current.onHandOverrides, inventory.current.onHandOverrides);
  assert.deepEqual(applyPrepKegCounts(completed, completed.recommendations, changes).onHandOverrides, completed.onHandOverrides);
});
