import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { getInventoryCountSections } from "../public/inventory-weekly-counts.mjs";
import { getUncountedInventoryAmount } from "../public/inventory-count-policy.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/page.jsx", import.meta.url), "utf8");
const now = new Date("2026-09-14T15:00:00.000Z");
const stamp = now.toISOString();

function functionSource(name) {
  const pattern = new RegExp(`^(?:async )?function ${name}\\(`, "m");
  const start = source.search(pattern);
  assert.notEqual(start, -1, `Missing ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `Missing end of ${name}`);
  return source.slice(start, end + 2);
}

function makeHarness(overrides = {}) {
  const writes = [];
  const confirmations = [];
  const scope = {
    inventorySharedInitialized: true,
    inventoryCountSubmitting: false,
    weeklyPlanUpdating: false, parAgentRunning: false, parAgentState: {},
    getCurrentWeeklyPlanSnapshot: () => null,
    openMondayRunStep: () => {},
    document: { querySelector: () => null },
    isEasternMonday: () => true,
    inventoryHistory: [], getCurrentMondayInventorySnapshot: () => null,
    runWeeklyPlanUpdate: async () => true, weeklyPlanRefreshMessage: "",
    renderDashboardOverview: () => {},
    inventorySubmitCountButton: { disabled: false, textContent: "Submit inventory" },
    inventorySharedMessage: "",
    inventoryItems: [
      { id: "vodka", name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "3" },
      { id: "gin", name: "Gin", group: "Liquor Cabinet", onHandDisplay: "4" },
      { id: "lime", name: "Lime", group: "Mixer Cabinet", onHandDisplay: "5" },
      { id: "garnish", name: "Garnish", group: "Other", onHandDisplay: "2" },
      { id: "na-beer", name: "Non Alcoholic Beer", group: "Other", onHandDisplay: "45" },
      { id: "sour-mix", name: "Sour Mix", group: "Other" },
      { id: "cold-brew", name: "Cold Brew", group: "Other" },
    ],
    inventoryCountedItemsAt: { vodka: stamp, lime: stamp, "na-beer": stamp, gin: "2026-09-06T15:00:00.000Z" },
    clean: (value) => String(value ?? "").trim(),
    isRecommendationForOperatingWeek: (value) => value === stamp,
    getUncountedInventoryAmount,
    getInventoryCountSections: (items, counts) => getInventoryCountSections(items, counts, now),
    Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [stamp])); }
    },
    flushPendingInventorySyncs: async () => true,
    confirmDashboardAction: (...args) => { confirmations.push(args); return true; },
    runSharedInventoryAction: async (action) => { writes.push(structuredClone(action)); return true; },
    renderInventory: () => {},
    renderWeeklyPlan: () => {},
    ...overrides,
  };
  const context = vm.createContext(scope);
  vm.runInContext(`${functionSource("buildCompletedInventorySectionChanges")}\n${functionSource("submitInventoryCount")}`, context);
  return { scope, writes, confirmations, submit: () => scope.submitInventoryCount() };
}

test("inventory has one submit control below the table and no section submit controls", () => {
  assert.equal((page.match(/id="inventory-submit-count"/g) || []).length, 1);
  const tableStart = page.indexOf('<tbody id="inventory-table">');
  const tableEnd = page.indexOf("</table>", tableStart);
  const button = page.indexOf('id="inventory-submit-count"');
  assert.ok(tableStart >= 0 && button > tableEnd);
  assert.ok(button < page.indexOf("</section>", tableEnd));
  assert.doesNotMatch(source, /Submit section count|submitInventorySectionCount/);
  assert.doesNotMatch(source, /Ordering hold:/);
});

test("one atomic submission verifies all running counts without zeroing older counts", async () => {
  const harness = makeHarness();
  await harness.submit();
  assert.equal(harness.writes.length, 1);
  const [action] = harness.writes;
  assert.equal(action.action, "batch-update-fields");
  assert.equal(action.source, "section-count");
  assert.deepEqual(Object.fromEntries(action.changes.map(({ id, value }) => [id, value])), {
    vodka: "3", lime: "5", "na-beer": "45", gin: "4", garnish: "2",
  });
  assert.ok(action.changes.every(({ field }) => field === "onHand"));
  assert.equal(harness.confirmations.length, 0);
  assert.equal(harness.scope.inventoryCountSubmitting, false);
});

test("an unknown count blocks submission without replacing it with zero", async () => {
  const harness = makeHarness();
  harness.scope.inventoryItems[1].onHandDisplay = "";
  await harness.submit();
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.scope.inventoryItems[0].onHandDisplay, "3");
  assert.equal(harness.scope.inventoryCountSubmitting, false);
});

test("pending-save failure blocks the submission and preserves counts for retry", async () => {
  const harness = makeHarness({ flushPendingInventorySyncs: async () => false });
  await harness.submit();
  assert.equal(harness.writes.length, 0);
  assert.match(harness.scope.inventorySharedMessage, /not finished saving/);
  assert.equal(harness.scope.inventoryItems[0].onHandDisplay, "3");
  assert.equal(harness.scope.inventoryCountSubmitting, false);
});

test("submission failure retains current counts and reports a retryable save error", async () => {
  const harness = makeHarness({ runSharedInventoryAction: async () => false });
  await harness.submit();
  assert.match(harness.scope.inventorySharedMessage, /preserved for retry/);
  assert.equal(harness.scope.inventoryItems[0].onHandDisplay, "3");
  assert.equal(harness.scope.inventoryCountedItemsAt.vodka, stamp);
  assert.equal(harness.scope.inventoryCountSubmitting, false);
});

test("uninitialized shared inventory cannot be submitted", async () => {
  const harness = makeHarness({ inventorySharedInitialized: false });
  await harness.submit();
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.confirmations.length, 0);
});

test("duplicate clicks cannot submit inventory twice while a save is pending", async () => {
  let finishFlush;
  const pending = new Promise((resolve) => { finishFlush = resolve; });
  const harness = makeHarness({ flushPendingInventorySyncs: () => pending });
  const first = harness.submit();
  assert.equal(harness.scope.inventorySubmitCountButton.disabled, true);
  await harness.submit();
  assert.equal(harness.writes.length, 0);
  finishFlush(true);
  await first;
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.scope.inventoryCountSubmitting, false);
});

test("the submission reads the latest entered values after pending inputs finish saving", async () => {
  const harness = makeHarness();
  harness.scope.flushPendingInventorySyncs = async () => {
    harness.scope.inventoryItems[0].onHandDisplay = "7";
    return true;
  };
  await harness.submit();
  assert.equal(harness.writes[0].changes.find(({ id }) => id === "vodka").value, "7");
});

test("empty inventory does not send an empty submission", async () => {
  const harness = makeHarness({ inventoryItems: [], inventoryCountedItemsAt: {} });
  await harness.submit();
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.scope.inventoryCountSubmitting, false);
});


test("a locked plan routes to orders without re-saving inventory", async () => {
  const routes = [];
  const h = makeHarness({ getCurrentWeeklyPlanSnapshot: () => ({ generatedAt: stamp }), openMondayRunStep: (...args) => routes.push(args) });
  await h.submit();
  assert.equal(h.writes.length, 0);
  assert.deepEqual(routes, [["orders", "weekly-plan"]]);
});

test("a snapshot failure keeps verified counts and permits a snapshot-only retry", async () => {
  let publications = 0;
  const h = makeHarness({ runWeeklyPlanUpdate: async () => { publications++; return false; } });
  await h.submit();
  assert.equal(h.writes.length, 1);
  assert.match(h.scope.inventorySharedMessage, /snapshot needs a retry/);
  assert.equal(h.scope.inventoryItems[1].onHandDisplay, "4");
  h.scope.getCurrentMondayInventorySnapshot = () => ({ savedAt: stamp });
  h.scope.runWeeklyPlanUpdate = async () => { publications++; return true; };
  await h.submit();
  assert.equal(h.writes.length, 1);
  assert.equal(publications, 2);
  assert.match(h.scope.inventorySharedMessage, /saved to the weekly snapshot/);
});
