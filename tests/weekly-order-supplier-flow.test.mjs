import assert from "node:assert/strict";
import test from "node:test";
import { createSupplierOrderFlow, renderSupplierOrderFlow } from "../public/weekly-order-supplier-flow.mjs";

const scope = "2026-10-12T16:00:00.000Z:live";

function memoryStorage() {
  const saved = new Map();
  return { getItem: (key) => saved.get(key), setItem: (key, value) => saved.set(key, value) };
}

function element(dataset = {}) {
  const listeners = new Set();
  return {
    dataset, hidden: false, textContent: "", disabled: false, focusCount: 0,
    addEventListener(_type, handler) { listeners.add(handler); },
    removeEventListener(_type, handler) { listeners.delete(handler); },
    click() { for (const handler of [...listeners]) handler({ preventDefault() {} }); },
    focus() { this.focusCount++; }, scrollIntoView() {},
    listenerCount: () => listeners.size,
  };
}

function fixture(suppliers = ["OHLQ", "Proof", "Beer supplier"]) {
  const cards = suppliers.map((supplier) => {
    const spec = typeof supplier === "string" ? { name: supplier } : supplier;
    return { ...element({ supplierOrderCard: spec.name, supplierOrderPlaced: spec.placed ? "true" : "false" }), input: { value: spec.value || "draft quantity" } };
  });
  const title = element();
  const progress = element();
  const orders = element();
  const prep = element();
  const empty = element();
  const back = element({ supplierOrderNav: "back" });
  const next = element({ supplierOrderNav: "next" });
  const selectors = new Map([
    ["[data-supplier-order-title]", title], ["[data-supplier-order-progress]", progress],
    ["[data-supplier-order-orders]", orders], ["[data-supplier-order-prep]", prep],
    ["[data-supplier-order-empty]", empty],
    ['[data-supplier-order-nav="back"]', back], ['[data-supplier-order-nav="next"]', next],
  ]);
  const flow = {
    matches: (selector) => selector === "[data-supplier-order-flow]",
    querySelector: (selector) => selectors.get(selector) || null,
    querySelectorAll: (selector) => selector === "[data-supplier-order-card]" ? cards : [],
  };
  return { flow, cards, title, progress, orders, prep, empty, back, next,
    visible: () => cards.filter((card) => !card.hidden).map((card) => card.dataset.supplierOrderCard) };
}

test("renderer retains supplied order/prep markup and exposes dedicated navigation", () => {
  const html = renderSupplierOrderFlow({ ordersHtml: '<article data-supplier-order-card="Proof"><input value="3"></article>', prepHtml: '<div id="existing-prep">Prep controls</div>' });
  assert.match(html, /data-supplier-order-flow/);
  assert.match(html, /data-supplier-order-title tabindex="-1"/);
  assert.match(html, /data-supplier-order-prep hidden/);
  assert.match(html, /<input value="3">/);
  assert.match(html, /id="existing-prep"/);
  assert.match(html, /data-supplier-order-nav="back"/);
  assert.match(html, /data-supplier-order-nav="next"/);
});

test("suppliers are one screen each followed by Prep, without altering order inputs or placed state", () => {
  let exits = 0;
  const f = fixture();
  const pager = createSupplierOrderFlow({ storage: memoryStorage(), onExit: () => exits++ });
  pager.bind({ root: f.flow, scope });
  assert.deepEqual(f.visible(), ["OHLQ"]);
  assert.equal(f.progress.textContent, "Order 1 of 3");
  assert.equal(f.title.focusCount, 0);
  f.cards[0].input.value = "12";
  for (const supplier of ["Proof", "Beer supplier"]) {
    f.next.click();
    assert.deepEqual(f.visible(), [supplier]);
  }
  f.next.click();
  assert.equal(f.title.textContent, "Prep plan");
  assert.equal(f.prep.hidden, false);
  assert.equal(f.orders.hidden, true);
  assert.deepEqual(f.visible(), []);
  assert.equal(f.next.textContent, "Done");
  f.next.click();
  assert.equal(exits, 1);
  assert.equal(f.cards[0].input.value, "12");
  assert.ok(f.cards.every((card) => card.dataset.supplierOrderPlaced === "false"));
  assert.equal(f.title.focusCount, 3);
});

test("Back walks from Prep through suppliers and exits only before the first supplier", () => {
  let exits = 0;
  const f = fixture();
  const pager = createSupplierOrderFlow({ storage: memoryStorage(), onExit: () => exits++ });
  pager.bind({ root: f.flow, scope });
  pager.show("prep");
  for (const supplier of ["Beer supplier", "Proof", "OHLQ"]) {
    f.back.click();
    assert.deepEqual(f.visible(), [supplier]);
  }
  assert.equal(exits, 0);
  f.back.click();
  assert.equal(exits, 1);
});

test("show orders starts at the first unplaced supplier and keeps all placed suppliers reachable", () => {
  const f = fixture([{ name: "OHLQ", placed: true }, { name: "Proof" }, { name: "Beer supplier", placed: true }]);
  const pager = createSupplierOrderFlow({ storage: memoryStorage() });
  pager.bind({ root: f.flow, scope });
  pager.show("orders");
  assert.deepEqual(f.visible(), ["Proof"]);
  f.back.click();
  assert.deepEqual(f.visible(), ["OHLQ"]);
  f.cards[1].dataset.supplierOrderPlaced = "true";
  pager.show("orders");
  assert.deepEqual(f.visible(), ["OHLQ"]);
  f.next.click();
  assert.deepEqual(f.visible(), ["Proof"]);
  f.next.click();
  assert.deepEqual(f.visible(), ["Beer supplier"]);
});

test("marking an order placed and repeated binds preserve the current card without duplicate listeners", () => {
  const f = fixture();
  const pager = createSupplierOrderFlow({ storage: memoryStorage() });
  pager.bind({ root: f.flow, scope });
  f.cards[0].dataset.supplierOrderPlaced = "true";
  pager.bind({ root: f.flow, scope });
  pager.bind({ root: f.flow, scope });
  assert.deepEqual(f.visible(), ["OHLQ"]);
  assert.equal(f.next.listenerCount(), 1);
  f.next.click();
  assert.deepEqual(f.visible(), ["Proof"]);
  assert.equal(f.title.focusCount, 1);
});

test("refresh and reload restore exact supplier-name progress; new week or mode resets it", () => {
  const storage = memoryStorage();
  const first = fixture();
  const pager = createSupplierOrderFlow({ storage });
  pager.bind({ root: first.flow, scope });
  first.next.click();
  const refreshed = fixture(["Beer supplier", "Proof", "OHLQ"]);
  pager.bind({ root: refreshed.flow, scope });
  assert.deepEqual(refreshed.visible(), ["Proof"]);
  assert.equal(first.next.listenerCount(), 0);
  assert.equal(refreshed.title.focusCount, 0);
  const reloaded = createSupplierOrderFlow({ storage });
  const latest = fixture();
  reloaded.bind({ root: latest.flow, scope });
  assert.deepEqual(latest.visible(), ["Proof"]);
  reloaded.bind({ root: latest.flow, scope: "2026-10-19T16:00:00.000Z:live" });
  assert.deepEqual(latest.visible(), ["OHLQ"]);
  latest.next.click();
  reloaded.bind({ root: latest.flow, scope: "2026-10-19T16:00:00.000Z:other-mode" });
  assert.deepEqual(latest.visible(), ["OHLQ"]);
});

test("added suppliers preserve the current page and a removed supplier recovers to an available order", () => {
  const pager = createSupplierOrderFlow({ storage: memoryStorage() });
  const first = fixture();
  pager.bind({ root: first.flow, scope });
  first.next.click();
  const added = fixture(["New supplier", "OHLQ", "Proof", "Beer supplier"]);
  pager.bind({ root: added.flow, scope });
  assert.deepEqual(added.visible(), ["Proof"]);
  assert.equal(added.progress.textContent, "Order 3 of 4");
  const removed = fixture([{ name: "OHLQ", placed: true }, "Beer supplier"]);
  pager.bind({ root: removed.flow, scope });
  assert.deepEqual(removed.visible(), ["Beer supplier"]);
});

test("zero suppliers still has an Orders page before Prep with reversible navigation", () => {
  let exits = 0;
  const f = fixture([]);
  const pager = createSupplierOrderFlow({ storage: memoryStorage(), onExit: () => exits++ });
  pager.bind({ root: f.flow, scope });
  assert.equal(f.empty.hidden, false);
  assert.equal(f.prep.hidden, true);
  f.back.click();
  assert.equal(exits, 1);
  f.next.click();
  assert.equal(f.prep.hidden, false);
  f.back.click();
  assert.equal(f.empty.hidden, false);
  assert.equal(f.prep.hidden, true);
  assert.equal(f.next.textContent, "Next");
});

test("unavailable storage, special supplier names, and missing DOM remain safe", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const f = fixture(['A & B "supplier" <name>']);
  const pager = createSupplierOrderFlow({ storage });
  assert.equal(pager.bind({ root: null, scope }), false);
  assert.equal(pager.show("prep"), false);
  pager.bind({ root: f.flow, scope });
  assert.equal(f.title.textContent, "Prep plan");
  pager.show("orders");
  assert.equal(f.title.textContent, 'A & B "supplier" <name>');
  assert.equal(pager.show("invalid"), false);
  pager.destroy();
  assert.equal(f.next.listenerCount(), 0);
});
