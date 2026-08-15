import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeGlobalSearchText,
  parseDashboardDataQuery,
  searchDashboardData,
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

test("dashboard data search parses natural-language filters and comparisons", () => {
  const parsed = parseDashboardDataQuery("show me cocktails on main wall under 10 ounces");

  assert.equal(parsed.status, "ready");
  assert.deepEqual(parsed.intent, {
    category: "cocktail",
    wall: "main",
    visibility: "active",
    metric: "ounces",
    comparison: { operator: "lt", threshold: 10 },
    period: "recent",
    sort: null,
    nameTerms: [],
  });
});

test("dashboard data search follows a parsed ranking path", () => {
  const items = [
    {
      id: "beer:one",
      name: "First Beer",
      wall: "main",
      category: "beer",
      hidden: false,
      periods: { "last-week": { label: "Last week", ounces: 42, dollars: 84 } },
    },
    {
      id: "beer:two",
      name: "Second Beer",
      wall: "patio",
      category: "beer",
      hidden: false,
      periods: { "last-week": { label: "Last week", ounces: 75, dollars: 150 } },
    },
  ];

  const search = searchDashboardData(items, "which beer had highest pour last week");
  assert.equal(search.status, "ready");
  assert.deepEqual(search.results.map((item) => item.id), ["beer:two"]);
  assert.equal(search.results[0].value, 75);
});
