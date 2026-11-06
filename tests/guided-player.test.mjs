import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import nextConfig from "../next.config.mjs";
import { isEmployeeAllowedDashboardRequest } from "../lib/dashboard-access.mjs";

const playerRoot = new URL("../public/guided-player/", import.meta.url);
const [source, catalog] = await Promise.all([
  readFile(new URL("player.js", playerRoot), "utf8"),
  readFile(new URL("assets/recipes/catalog.json", playerRoot), "utf8").then(JSON.parse),
]);
const readyRecipes = catalog.recipes.filter((recipe) => recipe.status === "ready" && recipe.active !== false);

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    async emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) await listener(event);
    },
  };
}

function element() {
  return {
    ...eventTarget(),
    children: [], style: {}, hidden: false, disabled: false, textContent: "", value: "",
    setAttribute(name, value) { this[name] = value; },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    get firstElementChild() { return this.children[0]; },
  };
}

function boot(search = "") {
  const nodes = Object.fromEntries([
    "video", "recipe-select", "error", "back", "next", "pause", "step-description", "timeline", "sound", "fullscreen", "stage",
  ].map((id) => [id, element()]));
  nodes["recipe-select"].parentElement = element();
  const video = nodes.video;
  Object.assign(video, {
    currentTime: 0, paused: true, seeking: false,
    pause() { this.paused = true; },
    async play() { this.paused = false; },
    load() {},
  });
  const document = {
    ...eventTarget(), hidden: false,
    getElementById: (id) => nodes[id], createElement: element,
    documentElement: { classList: { add() {} } },
  };
  const parent = {};
  const window = {
    ...eventTarget(), document, parent,
    location: { search, origin: "https://onpar.example" },
    RECIPE_CATALOG: catalog,
    RECIPE_PLAYER_SETTINGS: { defaultRecipeId: "old-fashioned-bulleit", holdLeadSeconds: 0.055 },
  };
  let frame = 0;
  vm.runInNewContext(source, {
    window, document, URLSearchParams,
    requestAnimationFrame: () => ++frame, cancelAnimationFrame() {},
  });
  return { nodes, video, document, window, player: window.recipePlayer };
}

test("all 26 guided recipes have local media and complete, contiguous steps", async () => {
  assert.equal(readyRecipes.length, 26);
  assert.equal(new Set(readyRecipes.map((recipe) => recipe.id)).size, 26);
  for (const recipe of readyRecipes) {
    for (const path of [recipe.video, recipe.poster, recipe.config]) {
      assert.match(path, /^assets\/recipes\/[a-z0-9-]+\.(mp4|jpg|json)$/);
      assert.ok((await stat(new URL(path, playerRoot))).size > 0, `${recipe.id}: missing ${path}`);
    }
    assert.equal(recipe.stages[0].start, 0);
    recipe.stages.forEach((step, index) => {
      assert.ok(step.end > step.start, `${recipe.id}: nonpositive step`);
      if (index) assert.ok(Math.abs(step.start - recipe.stages[index - 1].end) < 0.001);
    });
    assert.ok(Math.abs(recipe.stages.at(-1).end - recipe.duration) < 0.001);
  }
});

test("embedded selection opens the exact requested recipe and cannot switch cocktails", () => {
  const recipe = readyRecipes.at(-1);
  const { nodes, video, player } = boot(`?recipe=${recipe.id}&embed=1`);
  assert.equal(player.getState().recipeId, recipe.id);
  assert.equal(video.src, recipe.video);
  assert.equal(video.paused, true);
  assert.equal(nodes["recipe-select"].disabled, true);
  assert.equal(nodes["recipe-select"].parentElement.hidden, true);
  assert.equal(player.selectRecipe(readyRecipes[0].id), false);
  assert.equal(player.getState().recipeId, recipe.id);
});

test("missing, unknown, or inactive recipe IDs never fall back to a different cocktail", () => {
  for (const search of ["?embed=1", "?embed=1&recipe=", "?embed=1&recipe=unknown", "?recipe=unknown", "?recipe=gin-juice-bombay&embed=1"]) {
    const { nodes, video, player } = boot(search);
    assert.equal(player.getState().recipeId, undefined, search);
    assert.equal(video.src, undefined, search);
    assert.equal(nodes.error.hidden, false, search);
    assert.equal(nodes.next.disabled, true, search);
    assert.equal(nodes.back.disabled, true, search);
  }
  const { player } = boot();
  assert.equal(player.getState().recipeId, "old-fashioned-bulleit");
  assert.equal(player.selectRecipe(readyRecipes[0].id), true);
});

test("every recipe pauses at each step until Next; Back and final replay preserve navigation", async () => {
  for (const recipe of readyRecipes) {
    const { nodes, video, player } = boot(`?recipe=${recipe.id}&embed=1`);
    await video.emit("loadedmetadata");
    for (let index = 0; index < recipe.stages.length; index += 1) {
      await nodes.next.emit("click");
      assert.equal(player.getState().current, index, recipe.id);
      assert.equal(player.getState().mode, "playing", recipe.id);
      assert.equal(video.currentTime, recipe.stages[index].start, recipe.id);
      video.currentTime = recipe.stages[index].end;
      await video.emit("timeupdate");
      const held = player.getState();
      assert.equal(held.mode, index === recipe.stages.length - 1 ? "finished" : "waiting", recipe.id);
      assert.equal(video.paused, true, recipe.id);
      assert.ok(video.currentTime < recipe.stages[index].end, recipe.id);
      assert.equal(held.visited[index], true, recipe.id);
      await video.emit("timeupdate");
      assert.equal(player.getState().current, index, recipe.id);
    }
    await nodes.back.emit("click");
    assert.equal(player.getState().current, recipe.stages.length - 2, recipe.id);
    assert.equal(video.currentTime, recipe.stages.at(-2).start, recipe.id);
    await nodes.next.emit("click");
    await nodes.next.emit("click");
    assert.equal(player.getState().current, 0, recipe.id);
    assert.equal(video.currentTime, 0, recipe.id);
    await nodes.back.emit("click");
    assert.equal(player.getState().current, 0, recipe.id);
  }
});

test("only an embedded player's same-origin parent can pause it, and resume keeps its position", async () => {
  const { nodes, video, player, window, document } = boot(`?recipe=${readyRecipes[0].id}&embed=1`);
  await video.emit("loadedmetadata");
  await nodes.next.emit("click");
  video.currentTime = 1.5;
  const data = { type: "onpar:guided-player:pause" };
  await window.emit("message", { data, origin: "https://other.example", source: window.parent });
  await window.emit("message", { data, origin: window.location.origin, source: {} });
  assert.equal(player.getState().mode, "playing");
  await window.emit("message", { data, origin: window.location.origin, source: window.parent });
  assert.equal(player.getState().mode, "paused");
  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 1.5);
  await nodes.pause.emit("click");
  assert.equal(player.getState().mode, "playing");
  assert.equal(video.currentTime, 1.5);
  document.hidden = true;
  await document.emit("visibilitychange");
  assert.equal(player.getState().mode, "paused");
  document.hidden = false;
  await document.emit("visibilitychange");
  assert.equal(player.getState().mode, "paused");
});

test("video errors stop playback and do not re-enable controls on a later media event", async () => {
  const { nodes, video, player } = boot(`?recipe=${readyRecipes[0].id}&embed=1`);
  await video.emit("loadedmetadata");
  await nodes.next.emit("click");
  await video.emit("error");
  await video.emit("timeupdate");
  assert.equal(nodes.error.hidden, false);
  assert.equal(video.paused, true);
  assert.equal(nodes.next.disabled, true);
  assert.equal(nodes.back.disabled, true);
  assert.equal(player.getState().canNext, false);
});

test("same-origin framing is enabled only for guided-player assets", async () => {
  const rules = await nextConfig.headers();
  const general = rules.find((rule) => rule.source === "/(.*)");
  const player = rules.find((rule) => rule.source === "/guided-player/:path*");
  assert.ok(rules.indexOf(player) > rules.indexOf(general));
  const defaults = Object.fromEntries(general.headers.map(({ key, value }) => [key, value]));
  const playerHeaders = Object.fromEntries(player.headers.map(({ key, value }) => [key, value]));
  assert.equal(defaults["X-Frame-Options"], "DENY");
  assert.match(defaults["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(playerHeaders["X-Frame-Options"], "SAMEORIGIN");
  assert.match(playerHeaders["Content-Security-Policy"], /frame-ancestors 'self'/);
});

test("staff can read player files and media without gaining broader dashboard access", () => {
  const paths = [
    "/guided-player/index.html", "/guided-player/player.js", "/guided-player/player.css",
    "/guided-player/recipe-config.js", "/guided-player/assets/recipes/catalog.js",
    ...readyRecipes.flatMap((recipe) => [recipe.video, recipe.poster, recipe.config].map((path) => `/guided-player/${path}`)),
  ];
  for (const pathname of paths) {
    assert.equal(isEmployeeAllowedDashboardRequest({ pathname }), true, pathname);
    assert.equal(isEmployeeAllowedDashboardRequest({ pathname, method: "HEAD" }), true, pathname);
    assert.equal(isEmployeeAllowedDashboardRequest({ pathname, method: "POST" }), false, pathname);
  }
  assert.equal(isEmployeeAllowedDashboardRequest({ pathname: "/recipe-guide.mjs" }), true);
  for (const pathname of ["/guided-player/private.js", "/guided-player/assets/recipes/custom.js", "/guided-player/assets/recipes/../player.js", "/dashboard.js", "/data/cocktails.json", "/api/dashboard-state"]) {
    assert.equal(isEmployeeAllowedDashboardRequest({ pathname }), false, pathname);
  }
});
