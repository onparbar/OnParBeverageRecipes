import assert from "node:assert/strict";
import test from "node:test";
import { createWeeklyOrderPractice, renderPracticeSupplier } from "../public/weekly-order-practice.mjs";
import { createWeeklyOrderController } from "../public/weekly-order-controller.mjs";
import { WEEKLY_ORDER_STEPS, renderWeeklyOrderView } from "../public/weekly-order-view.mjs";

function rootStub() {
  const listeners = new Map();
  return {
    innerHTML: "",
    addEventListener(name, handler) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    querySelector() { return null; }, querySelectorAll() { return []; }, setAttribute() {}, contains() { return true; },
    async click(action, practice = false) {
      const dataset = practice ? { practiceAction: action } : { weeklyOrderAction: action };
      const button = { dataset, closest: (selector) => selector.includes(practice ? "[data-practice-action]" : "[data-weekly-order-action]") ? button : null };
      for (const handler of [...(listeners.get("click") || [])]) handler({ target: button, preventDefault() {} });
      await new Promise((resolve) => setImmediate(resolve));
    },
    input(id, value) {
      for (const handler of [...(listeners.get("input") || [])]) handler({ target: { dataset: { weeklyOrderCount: id }, value, removeAttribute() {} } });
    },
  };
}

test("practice completes all counting stops and reviews suppliers without storage, count, plan, or supplier writes", async () => {
  const root = rootStub();
  const rows = Object.fromEntries(WEEKLY_ORDER_STEPS.map(({ id }) => [id, [{ id, name: id, value: "2", expectedValue: "2" }]]));
  const drafts = [{ vendor: "Heidelberg", lines: [{ productName: "Test keg", requestedUnits: 2, lineType: "Beer keg", extendedCost: 100 }], estimatedTotal: 100 }];
  let exited = 0;
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("Practice touched live browser progress"); } });
  try {
    const practice = createWeeklyOrderPractice({ root, getRows: (id) => rows[id], getSupplierDrafts: () => drafts, exit: () => { exited += 1; } });
    practice.open();
    await root.click("start");
    for (const { id } of WEEKLY_ORDER_STEPS) {
      assert.match(root.innerHTML, new RegExp(`data-weekly-order-count="${id}"`));
      root.input(id, "17");
      await root.click("next");
    }
    assert.match(root.innerHTML, /Review supplier orders/);
    await root.click("save");
    assert.match(root.innerHTML, /Heidelberg/);
    assert.match(root.innerHTML, /Practice only — no order sent/);
    assert.doesNotMatch(root.innerHTML, /data-assisted-order|data-weekly-order-place|data-order-adjustment/);
    assert.ok(Object.values(rows).every(([row]) => row.value === "2"));
    assert.equal(drafts[0].lines[0].requestedUnits, 2);
    practice.refresh();
    assert.match(root.innerHTML, /Heidelberg/);
    await root.click("next", true);
    assert.match(root.innerHTML, /Practice complete/);
    await root.click("restart", true);
    await root.click("start");
    assert.match(root.innerHTML, /value="2"/);
    assert.doesNotMatch(root.innerHTML, /value="17"/);
    await root.click("exit");
    assert.equal(exited, 1);
    practice.destroy();
  } finally {
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else delete globalThis.localStorage;
  }
});

test("a locked plan offers practice before the live-lock navigation guard without invoking save", async () => {
  let practiced = 0;
  let opened = 0;
  const controller = createWeeklyOrderController({ storage: null, getContext: () => ({ ready: true, planLocked: true, canPractice: true }), practice: () => { practiced += 1; }, openPlan: () => { opened += 1; } });
  await controller.act("practice");
  assert.equal(practiced, 1);
  assert.equal(opened, 0);
  assert.match(renderWeeklyOrderView({ planLocked: true, canPractice: true }), /Practice inventory &amp; ordering/);
  assert.doesNotMatch(renderWeeklyOrderView({ planLocked: true }), /data-weekly-order-action="practice"/);
  controller.destroy();
});

test("supplier preview escapes names and has no actionable supplier links", () => {
  const html = renderPracticeSupplier({ drafts: [{ vendor: '<script>bad</script>', lines: [{ productName: '<img src=x onerror=bad>', requestedUnits: 1 }] }] });
  assert.doesNotMatch(html, /<script>|<img|href=|data-assisted-order/);
  assert.match(html, /&lt;script&gt;/);
});
