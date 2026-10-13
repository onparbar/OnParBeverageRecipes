import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { buildWeeklyOrderInventoryRows, buildWeeklyOrderCoolerRows, weeklyOrderRowsChanged } from "../public/weekly-order-data.mjs";
import { WEEKLY_ORDER_STEPS } from "../public/weekly-order-view.mjs";
import { buildMondayRunModel, renderMondayRunCompact } from "../public/monday-run-view.mjs";

test("all countable inventory appears exactly once, including custom items and remaining Other stock", () => {
  const items = [
    { id: "vodka", name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "2" },
    { id: "lime", name: "Lime juice", group: "Mixer Cabinet", onHandDisplay: "0", casePackaged: true, packSize: 12 },
    { id: "non-alcoholic-beer", name: "Non Alcoholic Beer", group: "Other", onHandDisplay: "24" },
    { id: "simple-syrup", name: "Simple Syrup", group: "Other", onHandDisplay: "3" },
    { id: "custom", name: "Custom stock", group: "New shelf", isCustomInventory: true, onHandDisplay: "" },
    { id: "custom-korbel", name: "Korbel Brut 750mL", group: "Other", isCustomInventory: true, onHandDisplay: "6" },
    { id: "sour-mix", name: "Sour Mix", group: "Other" },
    { id: "vanilla", name: "Vanilla Syrup", group: "Other" },
    { id: "cold-brew", name: "Cold Brew", group: "Mixer Cabinet" },
  ];
  const rows = ["Karaoke Cooler", "Liquor Cabinet", "Mixer Cabinet", "Other"].flatMap((group) => buildWeeklyOrderInventoryRows(items, group, { vodka: "2" }));
  assert.deepEqual(rows.map((row) => row.id), ["simple-syrup", "vodka", "lime", "non-alcoholic-beer", "custom", "custom-korbel"]);
  assert.ok(rows.every((row) => row.kind === "inventory"));
  assert.equal(rows[0].unit, "1-gallon containers");
  assert.equal(rows[0].detail, "Karaoke cooler.");
  assert.equal(rows[1].unit, "bottles");
  assert.equal(rows[1].expectedValue, "2");
  assert.match(rows[2].detail, /12 bottles/);
  assert.equal(rows[3].unit, "cans");
  assert.equal(rows[4].value, "", "missing count must not become an assumed zero");
  assert.equal(rows[5].name, "Champagne (Korbel Brut)");
  assert.equal(rows[5].unit, "bottles");
  assert.match(rows[5].detail, /^Patio cooler/);
  assert.equal(rows[5].identity, "custom-korbel:Korbel Brut 750mL:Other:bottles");
  assert.equal(items[5].name, "Korbel Brut 750mL", "display label does not rename inventory");
  assert.equal(items[3].group, "Other", "physical location does not regroup stock accounting");
});

test("Simple Syrup uses the Karaoke count stop regardless of its saved cabinet group", () => {
  for (const group of ["Liquor Cabinet", "Mixer Cabinet", "Other"]) {
    const items = [
      { id: "custom-syrup", name: "Simple Syrup", group },
      { id: "flavored-syrup", name: "Raspberry Simple Syrup", group },
    ];
    assert.deepEqual(buildWeeklyOrderInventoryRows(items, "Karaoke Cooler").map((row) => row.id), ["custom-syrup"]);
    assert.deepEqual(buildWeeklyOrderInventoryRows(items, group).map((row) => row.id), ["flavored-syrup"]);
  }
  assert.deepEqual(buildWeeklyOrderInventoryRows([], "Other"), [], "a missing champagne record is not recreated");
});

test("cooler verification includes patio backups and On Deck stock with their existing units", () => {
  const items = [
    { key: "main", name: "Main beer", wall: "Main", tapNumber: 28, onHand: "0" },
    { key: "patio", name: "Patio beer", wall: "Patio", tapNumber: 88, onHand: "1" },
    { key: "karaoke", name: "Karaoke cocktail", wall: "Karaoke", tapNumber: 80, onHand: "2" },
    { key: "liquor", name: "Tap liquor", wall: "Main", tapNumber: 1, isLiquorTap: true },
    { key: "deck", name: "", wall: "Main", tapNumber: 4, onDeck: { comingSoonId: "next", name: "Next product", kind: "liquor", onHand: "12.5" } },
  ];
  const main = buildWeeklyOrderCoolerRows(items, "main");
  assert.deepEqual(main.map((row) => row.id), ["on-deck:deck", "keg:main", "keg:patio"]);
  assert.equal(main[0].unit, "ounces");
  assert.equal(main[0].allowsDecimal, true);
  assert.equal(main[1].value, "0");
  assert.deepEqual(buildWeeklyOrderCoolerRows(items, "karaoke").map((row) => row.id), ["keg:karaoke"]);
});

test("new products, added rows and conflicting balances require review before a save", () => {
  const row = { id: "a", identity: "vodka", expectedValue: "2", value: "3" };
  assert.equal(weeklyOrderRowsChanged([row], [{ ...row, expectedValue: "4", value: "4" }]), true);
  assert.equal(weeklyOrderRowsChanged([row], [{ ...row, expectedValue: "3", value: "3" }]), false);
  assert.equal(weeklyOrderRowsChanged([row], [{ ...row, identity: "gin" }]), true);
  assert.equal(weeklyOrderRowsChanged([row], [row, { ...row, id: "b" }]), true);
  assert.equal(weeklyOrderRowsChanged([row], []), true);
});

test("the Home order card always enters the separate module, including a locked plan", () => {
  for (const planLocked of [false, true]) {
    const html = renderMondayRunCompact(buildMondayRunModel({ planLocked }));
    assert.match(html, /data-dashboard-target="weekly-order"/);
    assert.doesNotMatch(html, /data-dashboard-target="(?:inventory|keg-levels)"/);
    if (!planLocked) assert.match(html, /WEEKLY ORDER — START HERE/);
  }
});

const dashboard = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function source(name) {
  const start = dashboard.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0);
  return dashboard.slice(start, dashboard.indexOf("\n}\n", start) + 2);
}

function adapterFixture({ type = "cooler", mixed = false, flush = async () => true, acceptInventory = true } = {}) {
  const writes = [];
  const completed = [];
  const id = mixed ? "karaoke" : type === "cooler" ? "main" : "liquor";
  const row = { id: "stock", key: "stock", kind: type === "cooler" ? "keg" : "inventory", identity: "stock:Product", name: "Product", value: "2", expectedValue: "2" };
  const syrup = { id: "simple-syrup", kind: "inventory", identity: "simple-syrup:Simple Syrup:Other:1-gallon containers", name: "Simple Syrup", value: "1", expectedValue: "1" };
  const rows = mixed ? [row, syrup] : [row];
  const context = {
    WEEKLY_ORDER_STEPS, weeklyOrderRowsChanged,
    hasPublishedWeeklyPlanRecommendations: () => false,
    parAgentState: { initialized: true },
    kegOnHandOverrides: { stock: "2" }, kegOnDeckOverrides: {}, inventoryOnHandOverrides: { stock: "2", "simple-syrup": "1" },
    flushPendingParAgentStateSync: flush,
    requestParAgentState: async () => ({ initialized: true }), applyParAgentState() {},
    getWeeklyOrderRows: () => rows.map((entry) => {
      const value = entry.kind === "inventory" ? context.inventoryOnHandOverrides[entry.id] : context.kegOnHandOverrides[entry.key];
      return { ...entry, value, expectedValue: value };
    }),
    saveKegOnHandOverrides() { writes.push("kegs"); }, saveKegOnDeckOverrides() {},
    scheduleParAgentStateSync() { writes.push("sync"); },
    completeCoolerWallCount(wall) { completed.push(wall); },
    renderKegLevels() {}, renderInventory() {}, renderDashboardOverview() {},
    refreshInventoryForSubmit: async () => { writes.push("refresh"); },
    clean: (value) => String(value ?? "").trim(),
    runSharedInventoryAction: async (body) => {
      writes.push(body);
      if (acceptInventory) for (const change of body.changes) context.inventoryOnHandOverrides[change.id] = change.value;
      return true;
    },
  };
  vm.runInContext(["weeklyOrderCountsChangedError", "saveWeeklyOrderStep"].map(source).join("\n"), vm.createContext(context));
  return { context, writes, completed, id, row, save: (value, syrupValue = "4") => context.saveWeeklyOrderStep(id,
    mixed ? [{ ...row, value }, { ...syrup, value: syrupValue }] : [{ ...row, value }]) };
}

test("weekly order routes syrup to Karaoke and labels existing patio champagne exactly once", () => {
  const context = {
    WEEKLY_ORDER_STEPS, buildWeeklyOrderCoolerRows, buildWeeklyOrderInventoryRows,
    inventoryItems: [
      { id: "simple-syrup", name: "Simple Syrup", group: "Other", onHandDisplay: "2" },
      { id: "custom-korbel", name: "Korbel Brut", group: "Other", onHandDisplay: "3", isCustomInventory: true },
    ],
    inventoryOnHandOverrides: { "simple-syrup": "2", "custom-korbel": "3" },
    groupInventoryForDisplay: (items) => [["all", items]],
    kegWallItems: [{ key: "karaoke-beer", name: "Beer", wall: "Karaoke", tapNumber: 90 }],
    getKegDisplayBrand: (item) => item.name, getKegLiveRow: () => null, getKegItemKey: (item) => item.key,
    getTapOrderProductName: (item) => item.name, getSavedTapOrderProduct: () => null,
    weeklyUsageItems: [], weeklyUsageArchivedItems: [], isLiquorOunceTap: () => false, toNumber: Number,
    kegOnHandOverrides: { "karaoke-beer": "1" }, getKegOnDeckItem: () => null,
  };
  vm.runInContext(source("getWeeklyOrderRows"), vm.createContext(context));
  const karaoke = context.getWeeklyOrderRows("karaoke");
  assert.deepEqual(karaoke.map((row) => row.id), ["keg:karaoke-beer", "simple-syrup"]);
  const all = WEEKLY_ORDER_STEPS.flatMap((step) => context.getWeeklyOrderRows(step.id));
  assert.equal(all.filter((row) => row.id === "simple-syrup").length, 1);
  assert.equal(all.filter((row) => row.id === "custom-korbel").length, 1);
  assert.match(context.getWeeklyOrderRows("other")[0].detail, /Patio cooler/);
});

test("Karaoke verifies only after keg and syrup counts both save through their own stores", async () => {
  const fixture = adapterFixture({ mixed: true });
  let accept;
  let start;
  const started = new Promise((resolve) => { start = resolve; });
  fixture.context.runSharedInventoryAction = (body) => {
    start(body);
    return new Promise((resolve) => { accept = () => {
      for (const change of body.changes) fixture.context.inventoryOnHandOverrides[change.id] = change.value;
      resolve(true);
    }; });
  };
  const saving = fixture.save("3");
  const body = await started;
  assert.deepEqual(fixture.writes, ["refresh", "kegs", "sync"]);
  assert.deepEqual(fixture.completed, []);
  assert.deepEqual(fixture.context.kegOnHandOverrides, { stock: "3" });
  assert.equal(body.source, "section-count");
  assert.equal(body.changes.length, 1);
  assert.equal(body.changes[0].id, "simple-syrup");
  assert.equal(body.changes[0].expectedValue, "1");
  accept();
  await saving;
  assert.equal(fixture.context.inventoryOnHandOverrides["simple-syrup"], "4");
  assert.deepEqual(fixture.completed, ["karaoke"]);
});

test("a failed syrup save keeps Karaoke unverified and can retry the partially saved screen", async () => {
  const fixture = adapterFixture({ mixed: true });
  const saveInventory = fixture.context.runSharedInventoryAction;
  fixture.context.runSharedInventoryAction = async () => null;
  await assert.rejects(fixture.save("3"), /inventory counts have not finished saving/);
  assert.deepEqual(fixture.completed, []);
  assert.deepEqual(fixture.context.kegOnHandOverrides, { stock: "3" });
  fixture.context.runSharedInventoryAction = saveInventory;
  await fixture.save("3");
  assert.deepEqual(fixture.completed, ["karaoke"]);
  assert.deepEqual(fixture.context.kegOnHandOverrides, { stock: "3" }, "retry sets the same count, never adds stock");
  assert.equal(fixture.context.inventoryOnHandOverrides["simple-syrup"], "4");
});

test("changed syrup counts or newly added syrup require review before any Karaoke writes", async () => {
  const fixture = adapterFixture({ mixed: true });
  fixture.context.refreshInventoryForSubmit = async () => { fixture.context.inventoryOnHandOverrides["simple-syrup"] = "5"; };
  await assert.rejects(fixture.save("3"), (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED");
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.completed, []);
  const added = adapterFixture({ mixed: true });
  await assert.rejects(added.context.saveWeeklyOrderStep("karaoke", [{ ...added.row, value: "3" }]),
    (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED" && error.latestRows.length === 2);
  assert.deepEqual(added.writes, ["refresh"]);
  assert.deepEqual(added.completed, []);
});

test("a syrup field skipped by inventory prevents Karaoke from being marked verified", async () => {
  const fixture = adapterFixture({ mixed: true, acceptInventory: false });
  await assert.rejects(fixture.save("3"), (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED");
  assert.deepEqual(fixture.completed, []);
});

test("a syrup change arriving during keg saving cannot become the accepted inventory baseline", async () => {
  const fixture = adapterFixture({ mixed: true });
  let calls = 0;
  fixture.context.flushPendingParAgentStateSync = async () => {
    if (++calls === 2) fixture.context.inventoryOnHandOverrides["simple-syrup"] = "5";
    return true;
  };
  await assert.rejects(fixture.save("3"), (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED");
  assert.equal(fixture.context.inventoryOnHandOverrides["simple-syrup"], "5");
  assert.deepEqual(fixture.writes, ["refresh", "kegs", "sync"], "no stale inventory write is submitted");
  assert.deepEqual(fixture.completed, []);
});

test("an item added while saving cannot be omitted from a verified cooler", async () => {
  const fixture = adapterFixture({ mixed: true });
  const getRows = fixture.context.getWeeklyOrderRows;
  const saveInventory = fixture.context.runSharedInventoryAction;
  fixture.context.runSharedInventoryAction = async (body) => {
    const saved = await saveInventory(body);
    fixture.context.getWeeklyOrderRows = () => [...getRows(), {
      id: "keg:added", identity: "added:New beer", name: "New beer", value: "0", expectedValue: "0",
    }];
    return saved;
  };
  await assert.rejects(fixture.save("3"), (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED" && error.latestRows.length === 3);
  assert.deepEqual(fixture.completed, []);
});

test("cooler Next waits for durable save and never verifies failed saves", async () => {
  let calls = 0;
  const fixture = adapterFixture({ flush: async () => ++calls === 1 });
  await assert.rejects(fixture.save("3"), /not finished saving/);
  assert.deepEqual(fixture.completed, []);
  assert.equal(fixture.context.kegOnHandOverrides.stock, "3", "failed save keeps the entered value");
  fixture.context.flushPendingParAgentStateSync = async () => true;
  await fixture.save("3");
  assert.deepEqual(fixture.completed, ["main"]);
});

test("a changed cooler balance is returned for review before any write", async () => {
  const fixture = adapterFixture();
  fixture.context.applyParAgentState = () => { fixture.context.kegOnHandOverrides.stock = "4"; };
  await assert.rejects(fixture.save("3"), (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED" && error.latestRows[0].value === "4");
  assert.deepEqual(fixture.writes, []);
  assert.deepEqual(fixture.completed, []);
});

test("cabinet verification uses the shared count path and checks the accepted values", async () => {
  const fixture = adapterFixture({ type: "inventory" });
  await fixture.save("3");
  assert.equal(fixture.writes[0], "refresh");
  assert.equal(fixture.writes[1].source, "section-count");
  assert.equal(fixture.writes[1].changes[0].expectedValue, "2");
  assert.equal(fixture.context.inventoryOnHandOverrides.stock, "3");
  const skipped = adapterFixture({ type: "inventory", acceptInventory: false });
  await assert.rejects(skipped.save("3"), (error) => error.code === "WEEKLY_ORDER_COUNTS_CHANGED");
});

test("a plan locked elsewhere blocks further count writes", async () => {
  const fixture = adapterFixture();
  fixture.context.hasPublishedWeeklyPlanRecommendations = () => true;
  await assert.rejects(fixture.save("3"), /already saved/);
  assert.deepEqual(fixture.writes, []);
});
