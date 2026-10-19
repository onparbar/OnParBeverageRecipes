import assert from "node:assert/strict";
import test from "node:test";
import { createWeeklyOrderController, isValidWeeklyOrderCount } from "../public/weekly-order-controller.mjs";
import { WEEKLY_ORDER_STEPS } from "../public/weekly-order-view.mjs";

const MONDAY = "2026-10-12T16:00:00.000Z";
const NEXT_MONDAY = "2026-10-19T16:00:00.000Z";
const KEY = "onpar-weekly-order-wizard-v1";
const ids = WEEKLY_ORDER_STEPS.map(({ id }) => id);

function memoryStorage() {
  const saved = new Map();
  return { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
}

function node(dataset = {}) {
  return {
    dataset, value: "", disabled: false, hidden: false, focused: 0,
    classList: { toggle() {} },
    focus() { this.focused += 1; }, scrollIntoView() {},
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; },
  };
}

function rootStub() {
  const title = node();
  const status = node();
  const reason = node();
  const reasonField = node();
  const actions = ["start", "resume", "back", "next", "save", "plan", "exit"].map((action) => node({ weeklyOrderAction: action }));
  return {
    renders: 0, html: "", countInputs: [], actions, title, status, reason, reasonField, listeners: new Map(),
    set innerHTML(value) { this.renders += 1; this.html = value; },
    setAttribute() {},
    addEventListener(name, handler) { this.listeners.set(name, handler); },
    removeEventListener(name) { this.listeners.delete(name); },
    contains() { return true; },
    querySelector(selector) {
      return { ".weekly-order-title": title, "[data-weekly-order-status]": status, "[data-weekly-order-reason]": reason, "[data-weekly-order-reason-field]": reasonField }[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-weekly-order-count]") return this.countInputs;
      if (selector === "[data-weekly-order-action]") return actions;
      return [];
    },
  };
}

function harness(options = {}) {
  const root = rootStub();
  const current = { ready: true, planLocked: false, needsReason: false, weekLabel: "Oct 12 - 18", ...options.context };
  const rows = Object.fromEntries(ids.map((id) => [id, [{ id: `${id}-item`, name: `${id} item`, unit: "items", value: "2", expectedValue: "2", identity: `${id}-product`, opaque: { tap: 1 } }]]));
  const saves = [];
  const plans = [];
  const opened = [];
  const exited = [];
  const storage = options.storage || memoryStorage();
  let date = MONDAY;
  const controller = createWeeklyOrderController({
    root, getContext: () => current, getRows: (id) => rows[id], storage,
    now: () => new Date(date),
    saveStep: async (id, submitted) => { saves.push({ id, rows: structuredClone(submitted) }); },
    savePlan: async (reason) => { plans.push(reason); },
    openPlan: () => opened.push(true), exit: () => exited.push(true),
    ...options.callbacks,
  });
  return { controller, root, current, rows, saves, plans, opened, exited, storage, setDate(value) { date = value; } };
}

async function finishCounts(h) {
  await h.controller.act("start");
  for (const id of ids) {
    assert.equal(h.controller.getState().screen, id);
    assert.equal(await h.controller.act("next"), true);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("counts require finite nonnegative numbers and reject fractional whole units", () => {
  for (const invalid of ["", " ", "-1", "NaN", "Infinity", "1e3", "0x10", "1,000", "abc", "2.5"]) {
    assert.equal(isValidWeeklyOrderCount(invalid), false, invalid);
  }
  for (const valid of ["0", "02", " 2 ", "2.0"]) assert.equal(isValidWeeklyOrderCount(valid), true, valid);
  assert.equal(isValidWeeklyOrderCount("2.5", true), true);
  assert.equal(isValidWeeklyOrderCount(".5", true), true);
  assert.equal(isValidWeeklyOrderCount("-0.5", true), false);
});

test("six successful saves reach review; final save opens the existing plan", async () => {
  const h = harness();
  h.controller.open();
  assert.equal(h.controller.getState().screen, "landing");
  await finishCounts(h);
  assert.deepEqual(h.saves.map(({ id }) => id), ids);
  assert.deepEqual(h.controller.getState().completed, ids);
  assert.equal(h.controller.getState().screen, "review");
  assert.equal(h.plans.length, 0);
  assert.equal(await h.controller.act("save"), true);
  assert.deepEqual(h.plans, [""]);
  assert.equal(h.opened.length, 1);
  assert.equal(h.controller.getState().screen, "landing");
});

test("Next waits for save acknowledgement and ignores duplicate clicks, edits and Back", async () => {
  const saving = deferred();
  let calls = 0;
  const h = harness({ callbacks: { saveStep: () => { calls += 1; return saving.promise; } } });
  await h.controller.act("start");
  const first = h.controller.act("next");
  assert.equal(h.controller.getState().busy, true);
  assert.deepEqual(h.controller.getState().completed, []);
  assert.equal(await h.controller.act("next"), false);
  assert.equal(await h.controller.act("back"), false);
  assert.equal(h.controller.editCount("main-item", "7"), false);
  assert.equal(calls, 1);
  assert.ok(h.root.actions.every((button) => button.disabled));
  saving.resolve();
  await first;
  assert.equal(h.controller.getState().screen, "karaoke");
  assert.deepEqual(h.controller.getState().completed, ["main"]);
});

test("failed saves keep the edited count and original baseline for a retry", async () => {
  let calls = 0;
  const submitted = [];
  const h = harness({ callbacks: { saveStep: async (id, rows) => {
    submitted.push(structuredClone(rows));
    if (++calls === 1) throw new Error("Connection interrupted. Try Next again.");
  } } });
  await h.controller.act("start");
  h.controller.editCount("main-item", "7");
  assert.equal(await h.controller.act("next"), false);
  const failed = h.controller.getState();
  assert.equal(failed.screen, "main");
  assert.equal(failed.drafts.main[0].value, "7");
  assert.equal(failed.drafts.main[0].expectedValue, "2");
  assert.deepEqual(failed.completed, []);
  assert.match(h.root.status.textContent, /Connection interrupted/);
  await h.controller.act("next");
  assert.deepEqual(submitted[0], submitted[1]);
  assert.equal(h.controller.getState().drafts.main[0].expectedValue, "7");
});

test("Back preserves drafts without saving or verifying them, and Start retains current drafts", async () => {
  const h = harness();
  await h.controller.act("start");
  h.controller.editCount("main-item", "9");
  await h.controller.act("back");
  assert.equal(h.controller.getState().screen, "landing");
  assert.equal(h.saves.length, 0);
  assert.deepEqual(h.controller.getState().completed, []);
  await h.controller.act("start");
  assert.equal(h.controller.getState().drafts.main[0].value, "9");
});

test("edits invalidate verification and final saving requires all six completed steps", async () => {
  const h = harness();
  await h.controller.act("start");
  assert.equal(await h.controller.act("save"), false);
  assert.equal(h.plans.length, 0);
  await finishCounts(h);
  await h.controller.act("step", "main");
  h.controller.editCount("main-item", "3");
  assert.ok(!h.controller.getState().completed.includes("main"));
  assert.equal(await h.controller.act("save"), false);
  assert.equal(h.plans.length, 0);
});

test("invalid input focuses the first invalid row and never submits; explicit zero saves", async () => {
  const h = harness();
  await h.controller.act("start");
  const input = node({ weeklyOrderCount: "main-item" });
  h.root.countInputs = [input];
  h.controller.editCount("main-item", "");
  assert.equal(await h.controller.act("next"), false);
  assert.equal(h.saves.length, 0);
  assert.equal(input.focused, 1);
  assert.equal(input["aria-invalid"], "true");
  h.controller.editCount("main-item", "0");
  assert.equal(await h.controller.act("next"), true);
  assert.equal(h.saves[0].rows[0].value, "0");
});

test("reload restores original row identity and expected value along with draft progress", async () => {
  const storage = memoryStorage();
  const first = harness({ storage });
  await first.controller.act("start");
  await first.controller.act("next");
  first.controller.editCount("karaoke-item", "8");
  const reopened = harness({ storage });
  reopened.rows.karaoke[0] = { ...reopened.rows.karaoke[0], value: "99", expectedValue: "99", identity: "replacement" };
  reopened.controller.open();
  assert.equal(reopened.controller.getState().screen, "landing");
  await reopened.controller.act("resume");
  assert.equal(reopened.controller.getState().screen, "karaoke");
  const row = reopened.controller.getState().drafts.karaoke[0];
  assert.equal(row.value, "8");
  assert.equal(row.expectedValue, "2");
  assert.equal(row.identity, "karaoke-product");
  assert.deepEqual(row.opaque, { tap: 1 });
  assert.deepEqual(reopened.controller.getState().completed, ["main"]);
});

test("an old saved week resets without being restamped into the current week", async () => {
  const h = harness();
  await h.controller.act("start");
  h.controller.editCount("main-item", "8");
  const oldSaved = JSON.parse(h.storage.getItem(KEY));
  h.setDate(NEXT_MONDAY);
  h.controller.refresh();
  const fresh = h.controller.getState();
  assert.equal(fresh.screen, "landing");
  assert.deepEqual(fresh.drafts, {});
  assert.deepEqual(fresh.completed, []);
  assert.equal(JSON.parse(h.storage.getItem(KEY)).updatedAt, oldSaved.updatedAt);
  await h.controller.act("start");
  assert.equal(h.controller.getState().drafts.main[0].value, "2");
  assert.equal(JSON.parse(h.storage.getItem(KEY)).updatedAt, NEXT_MONDAY);
});

test("an in-progress old route moves the entered Korbel count to Patio without losing verification elsewhere", async () => {
  const storage = memoryStorage();
  const oldIds = ids.filter((id) => id !== "patio");
  const korbel = { id: "custom-korbel", name: "Champagne (Korbel Brut)", identity: "custom-korbel:Korbel Brut:Other:bottles",
    unit: "bottles", value: "7", expectedValue: "2" };
  const drafts = Object.fromEntries(oldIds.map((id) => [id, [{ id: `${id}-item`, name: `${id} item`, value: "3", expectedValue: "3" }]]));
  drafts.other.push(korbel);
  storage.setItem(KEY, JSON.stringify({ version: 1, updatedAt: MONDAY, lastScreen: "review", completed: oldIds, drafts }));
  const h = harness({ storage });
  const loaded = h.controller.getState();
  assert.deepEqual(loaded.drafts.patio, [korbel]);
  assert.deepEqual(loaded.drafts.other.map((row) => row.id), ["other-item"]);
  assert.deepEqual(loaded.completed, oldIds);
  assert.equal(loaded.drafts.liquor[0].value, "3");
  assert.equal(await h.controller.act("save"), false);
  assert.equal(h.plans.length, 0);
  await h.controller.act("resume");
  assert.equal(h.controller.getState().screen, "patio");
  assert.equal(h.saves.length, 0, "moving the draft must not write stock or verify the location");
  await h.controller.act("next");
  assert.equal(h.saves[0].id, "patio");
  assert.equal(h.saves[0].rows[0].value, "7");
  assert.equal(h.saves[0].rows[0].expectedValue, "2", "preserve conflict protection from the original count");
  assert.deepEqual(h.controller.getState().completed, ids);
  const reopened = harness({ storage });
  assert.equal(reopened.controller.getState().drafts.patio[0].value, "7");
  assert.equal(reopened.controller.getState().drafts.other.some((row) => row.id === korbel.id), false);
});

test("a successful old-week save cannot verify or advance a new week's count", async () => {
  const pending = deferred();
  const h = harness({ callbacks: { saveStep: () => pending.promise } });
  await h.controller.act("start");
  const saving = h.controller.act("next");
  h.setDate(NEXT_MONDAY);
  pending.resolve();
  assert.equal(await saving, false);
  assert.equal(h.controller.getState().screen, "landing");
  assert.deepEqual(h.controller.getState().completed, []);
  assert.deepEqual(h.controller.getState().drafts, {});
  assert.equal(h.controller.getState().busy, false);
});

test("a refresh across the operating-week boundary also ignores a late save failure", async () => {
  const pending = deferred();
  const h = harness({ callbacks: { saveStep: () => pending.promise } });
  await h.controller.act("start");
  const saving = h.controller.act("next");
  h.setDate(NEXT_MONDAY);
  h.controller.refresh();
  pending.reject(new Error("Old-week failure"));
  await saving;
  assert.equal(h.controller.getState().error, "");
  assert.deepEqual(h.controller.getState().drafts, {});
});

test("loading never freezes an empty step snapshot, and Next waits until the stores are ready", async () => {
  const h = harness({ context: { ready: false } });
  await h.controller.act("start");
  assert.equal(Object.hasOwn(h.controller.getState().drafts, "main"), false);
  assert.equal(await h.controller.act("next"), false);
  assert.equal(h.saves.length, 0);
  h.rows.main[0].value = "6";
  h.current.ready = true;
  h.controller.refresh();
  assert.equal(h.controller.getState().drafts.main[0].value, "6");
  assert.equal(await h.controller.act("next"), true);
});

test("background refresh preserves typed values, input nodes, focus, and conflict baselines", async () => {
  const h = harness();
  await h.controller.act("start");
  const input = node({ weeklyOrderCount: "main-item" });
  input.value = "15";
  h.root.countInputs = [input];
  h.root.listeners.get("input")({ target: input });
  const renders = h.root.renders;
  const focused = h.root.title.focused;
  h.rows.main[0].value = "100";
  h.rows.main[0].expectedValue = "100";
  h.current.ready = false;
  h.controller.refresh();
  assert.equal(h.root.renders, renders);
  assert.equal(h.root.title.focused, focused);
  assert.equal(input.value, "15");
  assert.equal(h.controller.getState().drafts.main[0].value, "15");
  assert.equal(h.controller.getState().drafts.main[0].expectedValue, "2");
  assert.equal(h.root.actions.find((button) => button.dataset.weeklyOrderAction === "next").disabled, true);
});

test("a locked plan opens the existing plan and cannot change or submit counts", async () => {
  const h = harness({ context: { planLocked: true } });
  await h.controller.act("start");
  assert.equal(h.opened.length, 1);
  assert.deepEqual(h.controller.getState().drafts, {});
  assert.equal(h.controller.editCount("main-item", "8"), false);
  await h.controller.act("save");
  assert.equal(h.saves.length, 0);
  assert.equal(h.plans.length, 0);
});

test("a lock arriving during editing makes the input read-only without blurring it", async () => {
  const h = harness();
  await h.controller.act("start");
  const input = node({ weeklyOrderCount: "main-item" });
  h.root.countInputs = [input];
  const renders = h.root.renders;
  h.current.planLocked = true;
  h.controller.refresh();
  assert.equal(h.root.renders, renders);
  assert.equal(input.disabled, false);
  assert.equal(input.readOnly, true);
  assert.equal(h.root.actions.find((button) => button.dataset.weeklyOrderAction === "plan").hidden, false);
  assert.equal(h.root.actions.find((button) => button.dataset.weeklyOrderAction === "next").hidden, true);
  await h.controller.act("next");
  assert.equal(h.saves.length, 0);
});

test("non-Monday saving requires a reason, saves it once, and survives a failed final save", async () => {
  let calls = 0;
  const reasons = [];
  const h = harness({ context: { needsReason: true }, callbacks: { savePlan: async (reason) => {
    reasons.push(reason);
    if (++calls === 1) throw new Error("Snapshot unavailable. Try saving again.");
  } } });
  await finishCounts(h);
  assert.equal(await h.controller.act("save"), false);
  assert.equal(calls, 0);
  assert.equal(h.root.reason.focused, 1);
  h.controller.setReason(" Delivery delay ");
  assert.equal(await h.controller.act("save"), false);
  assert.deepEqual(h.controller.getState().completed, ids);
  assert.equal(h.controller.getState().screen, "review");
  assert.equal(h.controller.getState().reason, " Delivery delay ");
  assert.equal(await h.controller.act("save"), true);
  assert.deepEqual(reasons, ["Delivery delay", "Delivery delay"]);
});

test("reason requirements can change during review without replacing or focusing the form", async () => {
  const h = harness();
  await finishCounts(h);
  const renders = h.root.renders;
  h.current.needsReason = true;
  h.controller.refresh();
  assert.equal(h.root.renders, renders);
  assert.equal(h.root.reasonField.hidden, false);
  assert.equal(h.root.reason.required, true);
  assert.equal(h.root.reason.focused, 0);
});

test("final save also blocks duplicate clicks and cannot open an old week's plan after rollover", async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness({ callbacks: { savePlan: () => { calls += 1; return pending.promise; } } });
  await finishCounts(h);
  const first = h.controller.act("save");
  assert.equal(await h.controller.act("save"), false);
  assert.equal(calls, 1);
  h.setDate(NEXT_MONDAY);
  pending.resolve();
  assert.equal(await first, false);
  assert.equal(h.opened.length, 0);
  assert.deepEqual(h.controller.getState().completed, []);
});

test("conflicts retain typed counts for the same product but blank replacements and new items", async () => {
  let calls = 0;
  const submitted = [];
  const h = harness({ callbacks: { saveStep: async (id, rows) => {
    submitted.push(structuredClone(rows));
    if (++calls === 1) {
      const error = new Error("Saved counts changed. Check the numbers and choose Next again.");
      error.code = "WEEKLY_ORDER_COUNTS_CHANGED";
      error.latestRows = [
        { id: "main-item", identity: "main-product", name: "Same product", value: "5", expectedValue: "5", opaque: { tap: 2 } },
        { id: "replaced", identity: "new-product", name: "New product", value: "9", expectedValue: "9" },
        { id: "added", identity: "added-product", name: "Added item", value: "6", expectedValue: "6" },
      ];
      throw error;
    }
  } } });
  h.rows.main.push({ id: "replaced", identity: "old-product", name: "Old product", value: "1", expectedValue: "1" });
  h.rows.main.push({ id: "removed", identity: "removed-product", name: "Removed product", value: "1", expectedValue: "1" });
  await h.controller.act("start");
  h.controller.editCount("main-item", "8");
  await h.controller.act("next");
  const rows = h.controller.getState().drafts.main;
  assert.deepEqual(rows.map(({ id }) => id), ["main-item", "replaced", "added"]);
  assert.equal(rows[0].value, "8");
  assert.equal(rows[0].expectedValue, "5");
  assert.deepEqual(rows[0].opaque, { tap: 2 });
  assert.match(rows[0].detail, /Saved count is now 5/);
  assert.equal(rows[1].value, "");
  assert.equal(rows[2].value, "");
  assert.deepEqual(h.controller.getState().completed, []);
  assert.equal(await h.controller.act("next"), false);
  h.controller.editCount("replaced", "0");
  h.controller.editCount("added", "6");
  assert.equal(await h.controller.act("next"), true);
  assert.equal(submitted[1][0].expectedValue, "5");
});

test("unavailable local storage keeps the count workflow usable", async () => {
  const h = harness({ storage: { getItem() { throw new Error("Unavailable"); }, setItem() { throw new Error("Unavailable"); } } });
  await finishCounts(h);
  assert.equal(h.controller.getState().screen, "review");
});

test("event delegation invokes navigation and can be removed on destroy", async () => {
  const h = harness();
  const button = node({ weeklyOrderAction: "start" });
  h.root.listeners.get("click")({ target: { closest: () => button }, preventDefault() {} });
  assert.equal(h.controller.getState().screen, "main");
  h.controller.destroy();
  assert.equal(h.root.listeners.size, 0);
  assert.equal(await h.controller.act("next"), false);
});
