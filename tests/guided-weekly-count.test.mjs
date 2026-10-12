import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildMondayRunModel } from "../public/monday-run-view.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.notEqual(start, -1, name);
  return source.slice(start, source.indexOf("\n}\n", start) + 2);
}
function harness(overrides = {}) {
  const navigation = [];
  const verified = new Set();
  const button = {};
  const feedback = {};
  const scope = {
    activeKegWallFilter: "all", inventorySpeechKegScope: "all",
    coolerCountVerifying: false, coolerCountVerificationMessage: "",
    parAgentState: { initialized: true }, parAgentError: "",
    hasPublishedWeeklyPlanRecommendations: () => false,
    completeCoolerWallCount: wall => verified.add(wall),
    hasCompletedCoolerWallCount: wall => verified.has(wall),
    flushPendingParAgentStateSync: async () => true,
    clean: value => String(value || "").trim(),
    switchTab: tab => navigation.push(tab),
    renderKegLevels: () => scope.renderCoolerCountVerification(),
    renderInventory: () => {}, renderWeeklyPlan: () => {}, renderDashboardOverview: () => {},
    requestAnimationFrame: action => action(),
    kegWalls: { querySelector: () => null },
    document: { querySelector: () => null, getElementById: id => id === "cooler-count-continue" ? button : feedback },
    ...overrides,
  };
  vm.runInContext(["openCoolerCountWall", "openMondayRunStep", "renderCoolerCountVerification", "verifyCoolerCountAndContinue"].map(functionSource).join("\n"), vm.createContext(scope));
  return { scope, navigation, verified, button, feedback };
}

test("Start Count always selects Main, then saved verifications lead through Karaoke to inventory", async () => {
  const { scope, navigation, verified, button } = harness({ activeKegWallFilter: "patio" });
  scope.openMondayRunStep("cooler", "keg-levels");
  assert.equal(scope.activeKegWallFilter, "main");
  assert.equal(scope.inventorySpeechKegScope, "main");
  assert.equal(button.textContent, "Main Cooler Count Verified");
  await scope.verifyCoolerCountAndContinue();
  assert.deepEqual([...verified], ["main"]);
  assert.equal(scope.activeKegWallFilter, "karaoke");
  assert.equal(scope.inventorySpeechKegScope, "karaoke");
  assert.equal(button.textContent, "Karaoke Cooler Count Verified");
  await scope.verifyCoolerCountAndContinue();
  assert.deepEqual([...verified], ["main", "karaoke"]);
  assert.deepEqual(navigation, ["keg-levels", "keg-levels", "inventory"]);
  assert.equal(scope.coolerCountVerificationMessage, "");
});

test("cooler verification waits for saves, blocks duplicate clicks, and does not advance on failure", async () => {
  let finish;
  let saves = 0;
  const h = harness({ activeKegWallFilter: "main", flushPendingParAgentStateSync: () => { saves++; return new Promise(resolve => { finish = resolve; }); } });
  const first = h.scope.verifyCoolerCountAndContinue();
  assert.equal(h.button.disabled, true);
  assert.equal(h.button.textContent, "Saving cooler counts...");
  await h.scope.verifyCoolerCountAndContinue();
  assert.equal(saves, 1);
  assert.equal(h.navigation.length, 0);
  finish(false);
  await first;
  assert.equal(h.verified.size, 0);
  assert.equal(h.navigation.length, 0);
  assert.equal(h.button.disabled, false);
  assert.match(h.feedback.textContent, /not finished saving/);
  h.scope.flushPendingParAgentStateSync = async () => true;
  await h.scope.verifyCoolerCountAndContinue();
  assert.equal(h.scope.activeKegWallFilter, "karaoke");
});

test("verifying Karaoke first routes to the unverified Main cooler before inventory", async () => {
  const h = harness({ activeKegWallFilter: "karaoke" });
  await h.scope.verifyCoolerCountAndContinue();
  assert.equal(h.scope.activeKegWallFilter, "main");
  assert.deepEqual(h.navigation, ["keg-levels"]);
});

test("weekly progress resumes each verified cooler independently", () => {
  const main = buildMondayRunModel();
  assert.equal(main.nextStep.id, "cooler");
  const karaoke = buildMondayRunModel({ mainCoolerCountComplete: true });
  assert.equal(karaoke.nextStep.id, "karaoke");
  const inventory = buildMondayRunModel({ mainCoolerCountComplete: true, karaokeCoolerCountComplete: true, inventorySharedInitialized: true });
  assert.equal(inventory.nextStep.id, "inventory");
  const plan = buildMondayRunModel({ planLocked: true });
  assert.equal(plan.nextStep.id, "orders");
});

test("cooler progress survives reopening but does not carry into the next week", async () => {
  const saved = new Map();
  const previous = globalThis.localStorage;
  globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  try {
    const first = await import("../public/weekly-run-progress.mjs?first");
    const monday = new Date("2026-10-12T16:00:00Z");
    first.completeCoolerWallCount("main", monday);
    const reopened = await import("../public/weekly-run-progress.mjs?reopened");
    assert.equal(reopened.hasCompletedCoolerWallCount("main", monday), true);
    assert.equal(reopened.hasCompletedCoolerWallCount("karaoke", monday), false);
    reopened.completeCoolerWallCount("karaoke", monday);
    assert.equal(reopened.hasCompletedCoolerWallCount("karaoke", monday), true);
    assert.equal(reopened.hasCompletedCoolerWallCount("main", new Date("2026-10-19T16:00:00Z")), false);
    assert.equal(reopened.hasCompletedCoolerWallCount("karaoke", new Date("2026-10-19T16:00:00Z")), false);
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("entering bottle inventory resets an old cabinet filter so the whole count is visible", () => {
  const options = ["all", "Liquor Cabinet", "Mixer Cabinet"].map(group => ({ dataset: { inventoryGroupFilter: group }, classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } }));
  const title = {};
  const filter = { dataset: { group: "Mixer Cabinet" }, open: true, querySelector: () => title, querySelectorAll: () => options };
  const h = harness();
  h.scope.document.querySelector = selector => selector === "#inventory-group-filter" ? filter : null;
  h.scope.openMondayRunStep("inventory", "inventory");
  assert.equal(filter.dataset.group, "all");
  assert.equal(title.textContent, "Current Inventory");
  assert.equal(options[0]["aria-pressed"], "true");
  assert.equal(options[2]["aria-pressed"], "false");
  assert.deepEqual(h.navigation, ["inventory"]);
});

test("bottle verification uses the existing saved-snapshot flow to open the weekly plan", () => {
  const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
  assert.match(page, /id="inventory-submit-count"[^>]*>Bottle inventory verified<\/button>/);
  assert.match(functionSource("renderInventoryStockTable"), /inventorySubmitCountButton.onclick = \(\) => void submitInventoryCount\(\)/);
  assert.match(functionSource("submitInventoryCount"), /await runWeeklyPlanUpdate\(\)/);
  assert.match(functionSource("runWeeklyPlanUpdate"), /if \(lockedSuccessfully\) openMondayRunStep\("orders", "weekly-plan"\)/);
});
