import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGlobalSearchText,
  searchDashboardItems,
} from "../public/global-dashboard-search.mjs";

const ITEMS = [
  {
    id: "section:pricing",
    kind: "section",
    title: "Tap Pricing",
    section: "Dashboard section",
    searchText: ["prices", "margin", "pour my beer"],
  },
  {
    id: "recipe:titos-lemon-drop",
    kind: "recipe",
    title: "Tito’s Lemon Drop",
    section: "Recipes",
    searchText: ["Vodka", "lemon juice", "simple syrup"],
  },
  {
    id: "ingredient:lemon-juice",
    kind: "ingredient",
    title: "Lemon Juice",
    section: "Ingredient & Keg Costs",
    searchText: ["Proof", "mixer"],
  },
  {
    id: "inventory:titos",
    kind: "inventory",
    title: "Tito's",
    section: "Inventory",
    searchText: ["Liquor Cabinet", "OHLQ"],
  },
];

test("global search normalizes punctuation, apostrophes, and accents", () => {
  assert.equal(normalizeGlobalSearchText("Tito’s — Crème"), "titos creme");
});

test("global search requires every query token and matches them out of order", () => {
  const results = searchDashboardItems(ITEMS, "juice lemon");
  assert.deepEqual(results.map((item) => item.id), ["ingredient:lemon-juice", "recipe:titos-lemon-drop"]);
  assert.deepEqual(searchDashboardItems(ITEMS, "lemon tequila"), []);
});

test("a title match ranks above a keyword-only match", () => {
  const results = searchDashboardItems(ITEMS, "titos");
  assert.deepEqual(results.map((item) => item.id), [
    "inventory:titos",
    "recipe:titos-lemon-drop",
  ]);
});

test("empty global search shows section shortcuts only", () => {
  const results = searchDashboardItems(ITEMS, "");
  assert.deepEqual(results.map((item) => item.id), ["section:pricing"]);
});

test("global search de-duplicates IDs, honors limits, and does not mutate inputs", () => {
  const duplicate = { ...ITEMS[2], title: "Duplicate Lemon" };
  const source = [...ITEMS, duplicate];
  const snapshot = structuredClone(source);
  const results = searchDashboardItems(source, "lemon", { limit: 1 });

  assert.equal(results.length, 1);
  assert.equal(new Set(searchDashboardItems(source, "lemon").map((item) => item.id)).size, 2);
  assert.deepEqual(source, snapshot);
});
