import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { getRecipeGuide, renderRecipeGuide } from "../public/recipe-guide.mjs";
import { renderWeeklyPlanCocktailRows, renderWeeklyPlanLiquorRefillRows } from "../public/weekly-plan-view.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = JSON.parse(read("../public/guided-player/assets/recipes/catalog.json"));

test("every available catalog video maps from its full cocktail title to its own player", () => {
  const ready = catalog.recipes.filter((recipe) => recipe.status === "ready");
  assert.equal(ready.length, 26);
  for (const recipe of ready) {
    const guide = getRecipeGuide(recipe);
    assert.equal(guide?.id, recipe.id, recipe.title);
    const url = new URL(guide.src, "https://beverage.example");
    assert.equal(url.pathname, "/guided-player/index.html");
    assert.equal(url.searchParams.get("recipe"), recipe.id);
    assert.equal(url.searchParams.get("embed"), "1");
  }
});

test("dashboard aliases and weekly prep labels resolve without confusing different cocktails", () => {
  for (const [title, id] of [
    ["Whiskey Smash (Jim Beam)", "whiskey-smash"],
    ["Whiskey Smash", "whiskey-smash"],
    ["Apple Jack (Whiskey)", "apple-jack-whiskey"],
    ["Apple Jack (Jack Fire)", "apple-jack-whiskey"],
    ["On Par Tee", "on-par-tee"],
    ["On Par Tee (Crown Royal)", "on-par-tee"],
    ["Strawberry Señorita (Tequilla)", "strawberry-senorita-jose-cuervo"],
    ["Crown Apple 'rita(Whiskey)", "crown-apple-rita"],
    ["Washington Apple 2", "washington-apple-crown-royal-apple"],
    ["Spiked Pink Lemonade (Vodka)", "spiked-pink-lemonade-tito-s"],
    ["Spiked Strawberry Lemonade (Vodka)", "spiked-strawberry-lemonade-tito-s"],
  ]) assert.equal(getRecipeGuide(title)?.id, id, title);
});

test("inactive catalog entries and unknown recipes never fall back to another cocktail's video", () => {
  const inactive = catalog.recipes.filter((recipe) => recipe.status !== "ready");
  assert.equal(inactive.length, 4);
  const missing = [null, {}, "", "New Cocktail", "Margarita", "Strawberry Lemonade", "Whiskey Smash Sour"];
  for (const recipe of [...inactive, ...missing]) {
    assert.equal(getRecipeGuide(recipe), null);
    const markup = renderRecipeGuide(recipe);
    assert.match(markup, /not available/);
    assert.doesNotMatch(markup, /<iframe/);
  }
});

test("guide markup is lazy, safely escaped, and does not echo supplied HTML", () => {
  const markup = renderRecipeGuide({ title: 'House Margarita (\"><script>alert</script>)' });
  assert.match(markup, /<iframe[^>]+data-recipe-guide-src="\/guided-player\/index\.html\?recipe=house-margarita-jose-cuervo&amp;embed=1"/);
  assert.match(markup, /title="House Margarita step-by-step guide"/);
  assert.match(markup, /rel="noopener"/);
  assert.doesNotMatch(markup, /<script|alert|\ssrc=/);
  const fallback = renderRecipeGuide({ title: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(fallback, /<img|onerror|alert/);
});

const prepItems = [
  { name: "Whiskey Smash", walls: ["Main"], tapNumbers: [45], batchSizeOz: 1500, quantity: 1 },
  { name: "On Par Tee", walls: ["Karaoke"], tapNumbers: [79], batchSizeOz: 1200, quantity: 2 },
];

function dashboardCocktailRenderer() {
  const dashboard = read("../public/dashboard.js");
  const start = dashboard.indexOf("function renderWeeklyPlanCocktailRows(");
  assert.ok(start >= 0);
  const declaration = dashboard.slice(start, dashboard.indexOf("\n}\n", start) + 2);
  return runInNewContext(`(${declaration})`, {
    dashboardStaffPrepPlan: { available: false },
    dashboardFinishWeekSaving: false,
    formatNumber: String,
    getWeeklyPlanProductViewItem: (item) => item,
    renderWeeklyPlanCocktailRowsView: renderWeeklyPlanCocktailRows,
  });
}

test("weekly cocktail rows render recipe details for each item through the dashboard wrapper", () => {
  const render = dashboardCocktailRenderer();
  const calls = [];
  const output = render(prepItems, {
    editable: false,
    recipeDetails: (item) => {
      calls.push(item.name);
      return `<details data-test-recipe="${item.name}">${renderRecipeGuide(item)}</details>`;
    },
  });
  assert.deepEqual(calls, ["Whiskey Smash", "On Par Tee"]);
  assert.equal((output.match(/data-recipe-guide-src=/g) || []).length, 2);
  assert.match(output, /recipe=whiskey-smash/);
  assert.match(output, /recipe=on-par-tee/);
});

test("recipe details remain optional and are never attached to liquor refill rows", () => {
  assert.doesNotMatch(renderWeeklyPlanCocktailRows(prepItems, { editable: false }), /recipe-guide|undefined/);
  const output = renderWeeklyPlanLiquorRefillRows(prepItems, {
    recipeDetails: () => { assert.fail("liquor refill rows must not invoke cocktail recipes"); },
  });
  assert.doesNotMatch(output, /recipe-guide|prep-recipe-row/);
});

function observerHarness({ intersections = true } = {}) {
  const frames = [];
  const messages = [];
  const animationFrames = [];
  const listeners = {};
  let intersection;
  let mutation;
  const document = {
    body: {}, hidden: false,
    querySelectorAll: () => frames.filter((frame) => frame.isConnected),
    addEventListener: (name, callback) => { listeners[name] = callback; },
  };
  const scope = {
    document,
    window: { location: { origin: "https://beverage.example" } },
    requestAnimationFrame: (callback) => animationFrames.push(callback),
    MutationObserver: class {
      constructor(callback) { mutation = { callback }; }
      observe(_target, options) { mutation.options = options; }
    },
    ...(intersections ? { IntersectionObserver: class {
      constructor(callback) { intersection = { callback, observed: new Set() }; }
      observe(frame) { intersection.observed.add(frame); }
      unobserve(frame) { intersection.observed.delete(frame); }
    } } : {}),
  };
  const initialize = runInNewContext(`${read("../public/recipe-guide.mjs").replace(/^export /gm, "")}\ninitializeRecipeGuides;`, scope);
  return {
    initialize, document, messages, listeners,
    addFrame(visible) {
      const frame = {
        isConnected: true, visible,
        dataset: { recipeGuideSrc: "/guided-player/index.html?recipe=whiskey-smash&embed=1" },
        getClientRects() { return this.visible ? [{}] : []; },
        hasAttribute(name) { return name === "src" && typeof this.src === "string"; },
        contentWindow: { postMessage: (message, origin) => messages.push({ message, origin }) },
      };
      frames.push(frame);
      return frame;
    },
    intersect(frame, isIntersecting) { intersection.callback([{ target: frame, isIntersecting }]); },
    mutate() { mutation.callback(); while (animationFrames.length) animationFrames.shift()(); },
    observed: () => intersection.observed,
  };
}

test("guides load only when visible and pause on collapse, scrolling away, or leaving the tab", () => {
  const h = observerHarness();
  const visible = h.addFrame(true);
  const collapsed = h.addFrame(false);
  h.initialize();
  assert.equal(visible.src, undefined, "initialization must not fetch every video");
  h.intersect(collapsed, true);
  assert.equal(collapsed.src, undefined);
  h.intersect(visible, true);
  assert.equal(visible.src, visible.dataset.recipeGuideSrc);
  h.intersect(visible, false);
  visible.visible = false;
  h.mutate();
  h.document.hidden = true;
  h.listeners.visibilitychange();
  assert.equal(h.messages.length, 3);
  for (const { message, origin } of h.messages) {
    assert.equal(message.type, "onpar:guided-player:pause");
    assert.equal(origin, "https://beverage.example");
  }
  collapsed.visible = true;
  h.intersect(collapsed, true);
  assert.equal(collapsed.src, undefined, "hidden documents must not begin loading a video");
  h.document.hidden = false;
  h.intersect(collapsed, true);
  assert.equal(collapsed.src, collapsed.dataset.recipeGuideSrc);
  visible.isConnected = false;
  h.initialize();
  assert.equal(h.observed().has(visible), false, "rerendered cards must be released from the observer");
});

test("without IntersectionObserver, collapsed recipes remain unloaded until opened", () => {
  const h = observerHarness({ intersections: false });
  const collapsed = h.addFrame(false);
  h.initialize();
  assert.equal(collapsed.src, undefined);
  collapsed.visible = true;
  h.mutate();
  assert.equal(collapsed.src, collapsed.dataset.recipeGuideSrc);
});
