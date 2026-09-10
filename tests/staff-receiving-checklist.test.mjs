import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { kegDestination } from "../public/keg-destination.mjs";
import { isEmployeeAllowedDashboardRequest } from "../lib/dashboard-access.mjs";

const source = readFileSync(new URL("../public/staff-receiving-view.mjs", import.meta.url), "utf8")
  .replace(/^import .*;\n/gm, "").replace("export function renderStaffReceiving", "function renderStaffReceiving");
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.value = ""; this.ownText = ""; this.classList = { add() {} }; }
  set textContent(text) { this.ownText = text; }
  get textContent() { return [this.ownText, ...this.children.map((child) => child.textContent)].join(" ").trim(); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute() {}
  addEventListener(name, callback) { this.events[name] = callback; }
  fire(name) { return this.events[name]?.({ preventDefault() {} }); }
  focus() {}
}
function all(root, predicate) { return [root, ...root.children.flatMap((child) => all(child, () => true))].filter(predicate); }
function action(root, text) { return all(root, (node) => node.tag === "button" && node.textContent.includes(text))[0]; }
const settle = () => new Promise((resolve) => setImmediate(resolve));
function harness({ fail = false, paused = false } = {}) {
  const root = new Element("div");
  const storage = new Map();
  const calls = [];
  const confirmations = [];
  let release;
  const tracking = { available: true, generatedAt: "2026-09-07", vendors: [{
    id: "proof", vendor: "Proof", ordered: true, items: [
      { id: "lime", name: "Lime", quantity: 2, unit: "cases", inventoryUnitsPerReceiptUnit: 12, status: "pending" },
      { id: "triple", name: "Triple Sec", quantity: 1, unit: "case", inventoryUnitsPerReceiptUnit: 12, status: "pending" },
    ],
  }] };
  const context = vm.createContext({
    document: { createElement: (tag) => new Element(tag) }, kegDestination,
    sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    window: { confirm: (text) => { confirmations.push(text); return true; } },
  });
  vm.runInContext(source, context);
  const saveReceipts = async (vendor, lines) => {
    calls.push(JSON.parse(JSON.stringify(lines)));
    if (paused) await new Promise((resolve) => { release = resolve; });
    if (fail) throw new Error("Connection interrupted");
    const next = structuredClone(tracking);
    for (const line of lines) {
      const item = next.vendors[0].items.find((entry) => entry.id === line.itemId);
      Object.assign(item, line, { handledBy: "Employee" });
    }
    return { tracking: next, warning: "" };
  };
  const render = () => context.renderStaffReceiving({ root, tracking, saveReceipts });
  render();
  return { root, tracking, render, calls, confirmations, storage, release: () => release() };
}

test("bulk receive excludes a difference typed after the delivery first rendered", async () => {
  const h = harness();
  action(h.root, "Proof").fire("click");
  const bulk = action(h.root, "Everything unchecked");
  const count = all(h.root, (node) => node.tag === "input")[0];
  count.value = "1";
  count.fire("input");
  bulk.fire("click");
  await settle();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].map((line) => line.itemId), ["triple"]);
  assert.match(h.confirmations[0], /Triple Sec: 1 case/);
  assert.doesNotMatch(h.confirmations[0], /Lime: 2 cases/);
  assert.match(h.confirmations[0], /unsaved difference drafts will not change/);
});

test("bulk action does nothing when every unchecked item now has a draft", () => {
  const h = harness(); action(h.root, "Proof").fire("click");
  const bulk = action(h.root, "Everything unchecked");
  for (const input of all(h.root, (node) => node.tag === "input")) { input.value = "0"; input.fire("input"); }
  bulk.fire("click");
  assert.equal(h.calls.length, 0);
  assert.equal(h.confirmations.length, 0);
  assert.match(h.root.textContent, /Save those differences individually/);
});

test("one-tap receiving saves receipt units once and blocks repeat clicks while saving", async () => {
  const h = harness({ paused: true }); action(h.root, "Proof").fire("click");
  assert.match(h.root.textContent, /2 cases \/ 24 individual units/);
  const receive = action(h.root, "Received as ordered");
  receive.fire("click"); receive.fire("click");
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0].receivedQuantity, 2);
  h.release(); await settle();
  assert.match(h.root.textContent, /Saved\. Inventory/);
  assert.match(h.root.textContent, /Received items \(1\)/);
});

test("failed discrepancy saves keep the entered quantity and do not claim success", async () => {
  const h = harness({ fail: true }); action(h.root, "Proof").fire("click");
  const input = all(h.root, (node) => node.tag === "input")[0]; input.value = "1"; input.fire("input");
  all(h.root, (node) => node.tag === "form")[0].fire("submit"); await settle();
  assert.equal(h.calls[0][0].status, "partial");
  assert.match(h.root.textContent, /Connection interrupted/);
  assert.doesNotMatch(h.root.textContent, /Saved\. Inventory/);
  assert.equal(all(h.root, (node) => node.tag === "input")[0].value, "1");
  assert.ok([...h.storage.values()].some((value) => value.includes('"quantity":"1"')));
});

test("unplaced orders stay out of the actionable delivery picker", () => {
  const h = harness(); h.tracking.vendors[0].ordered = false; h.render();
  assert.equal(action(h.root, "Proof"), undefined);
  assert.match(h.root.textContent, /waiting for a manager/);
});

test("employee accounts can load the receiving module and stylesheet read-only", () => {
  for (const pathname of ["/staff-receiving-view.mjs", "/staff-receiving.css"]) {
    assert.equal(isEmployeeAllowedDashboardRequest({ pathname, method: "GET" }), true);
    assert.equal(isEmployeeAllowedDashboardRequest({ pathname, method: "POST" }), false);
  }
});
