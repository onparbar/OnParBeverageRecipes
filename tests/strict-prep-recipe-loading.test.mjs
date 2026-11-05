import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = (await readFile(new URL("../lib/inventory-contributions.mjs", import.meta.url), "utf8"))
  .replace(/^import[\s\S]*?;\n/gm, "")
  .replace(/^export \{.*\};$/gm, "")
  .replace(/^export /gm, "");
const initialized = { initialized: true, data: { recipes: { editedRecipes: {}, customRecipes: [], inactiveRecipeIds: [] } } };

function reader(readSharedDashboardState, overrides = {}) {
  const context = { readFile, path, process, readSharedDashboardState, ...overrides };
  runInNewContext(source, context);
  return context.loadRecipes;
}

test("strict purchasing reads saved recipe edits and inactive flags instead of CSV defaults", async () => {
  const state = structuredClone(initialized);
  state.data.recipes.editedRecipes["lemon-drop-martini-vodka"] = {
    title: "Lemon Drop Martini(Vodka)", ingredients: [{ name: "Absolut Citron", oz: 900 }],
  };
  state.data.recipes.inactiveRecipeIds = ["whiskey-smash"];
  const recipes = await reader(async () => state)({ requireShared: true });
  assert.equal(recipes.find(recipe => recipe.id === "lemon-drop-martini-vodka").ingredients[0].oz, 900);
  assert.equal(recipes.find(recipe => recipe.id === "whiskey-smash").inactive, true);
});

test("strict purchasing aborts during a shared recipe outage while default reads retain their fallback", async () => {
  const load = reader(async () => { throw new Error("Shared storage unavailable"); });
  await assert.rejects(load({ requireShared: true }), error => error.code === "SHARED_RECIPES_UNAVAILABLE" && error.status === 503);
  const fallback = await load();
  assert.ok(fallback.some(recipe => recipe.id === "lemon-drop-martini-vodka"));
});

test("strict purchasing refuses missing, uninitialized, and malformed shared recipe state", async () => {
  for (const state of [null, { ...initialized, initialized: false }, { initialized: true, data: {} }, { initialized: true, data: { recipes: [] } }]) {
    await assert.rejects(reader(async () => state)({ requireShared: true }), error => error.code === "SHARED_RECIPES_UNAVAILABLE");
  }
});

test("strict purchasing requires both base recipe files rather than silently dropping one", async () => {
  const load = reader(async () => initialized, {
    readFile: async (filename, encoding) => {
      if (filename.endsWith("new-cocktails.csv")) throw new Error("File unavailable");
      return readFile(filename, encoding);
    },
  });
  await assert.rejects(load({ requireShared: true }), error => error.code === "RECIPE_SOURCE_UNAVAILABLE" && error.status === 503);
  assert.ok((await load()).some(recipe => recipe.id === "lemon-drop-martini-vodka"));
});

test("strict purchasing rejects an empty base recipe file", async () => {
  const load = reader(async () => initialized, {
    readFile: async (filename, encoding) => filename.endsWith("new-cocktails.csv") ? "" : readFile(filename, encoding),
  });
  await assert.rejects(load({ requireShared: true }), error => error.code === "RECIPE_SOURCE_UNAVAILABLE");
});
