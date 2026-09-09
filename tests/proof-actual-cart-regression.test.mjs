import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8");
const parserSource = source.slice(source.indexOf("function proofCartCounts("), source.indexOf("async function checkProofCart("));
const checkpointSource = source.slice(source.indexOf("async function checkProofCart("), source.indexOf("let running = false;"));
const addSource = source.slice(source.indexOf("async function addExactMatch("), source.indexOf("async function submitSearch("));
const line = { name: "Bitters", vendorSku: "38000", quantity: 1, quantityKind: "cases" };
const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

test("actual-cart parser reads the exact SKU and separates cases from units", () => {
  const root = { cases: { value: "1" }, units: { value: "3" }, parentElement: null };
  const context = {
    clean, URL,
    location: { href: "https://shop.sgproof.com/sgws/en/usd/cart" },
    document: { body: { innerText: "Order Summary Total Items: 1" }, querySelectorAll: () => [{ href: "https://shop.sgproof.com/ANGOSTURA/p/38000?frompage=cartPage", parentElement: root }] },
    quantityControls: () => [root.cases, root.units],
    quantityControlForKind: (item, kind) => item[kind],
  };
  runInNewContext(parserSource, context);
  assert.deepEqual(Array.from(context.proofCartCounts({ lines: [line, { ...line, quantityKind: "units" }, { ...line, vendorSku: "49357" }] })), [1, 3, 0]);
  root.cases.value = "";
  assert.equal(context.proofCartCounts({ lines: [line] }), null);
  context.document.body.innerText = "Loading";
  assert.equal(context.proofCartCounts({ lines: [line] }), null);
});

function checkpoint(countsAt, pathname = "/sgws/en/usd/cart") {
  let elapsed = 0;
  const saved = [], destinations = [], finished = [];
  const context = {
    Date: { now: () => elapsed }, delay: async (ms) => { elapsed += ms; },
    location: { pathname, assign: (url) => destinations.push(url) },
    proofCartCounts: () => countsAt(elapsed), renderOverlay: () => {},
    saveState: async (state) => saved.push(JSON.parse(JSON.stringify(state))),
    addResultOnce: (state, result) => state.results.push(result),
    finish: async (_, status) => finished.push(status),
  };
  runInNewContext(checkpointSource, context);
  return { context, saved, destinations, finished };
}

test("a new Proof run checks the actual cart before searching or adding", async () => {
  const h = checkpoint(() => null, "/search");
  const state = { lines: [line], results: [] };
  assert.equal(await h.context.checkProofCart(state), true);
  assert.equal(h.saved[0].phase, "proof-cart-baseline");
  assert.deepEqual(h.destinations, ["https://shop.sgproof.com/sgws/en/usd/cart"]);
});

test("an interrupted add resumes by confirming the actual cart and advancing once", async () => {
  const h = checkpoint((elapsed) => elapsed < 10000 ? [0] : [1]);
  const state = { lines: [line], results: [], searchCursor: 0, pendingAdd: { lineIndex: 0, name: "Bitters", targetQuantity: 1 } };
  assert.equal(await h.context.checkProofCart(state), false);
  assert.equal(state.results[0].status, "added");
  assert.equal(state.searchCursor, 1);
  assert.equal(state.pendingAdd, null);
  assert.deepEqual(h.destinations, []);
  assert.equal(h.saved.length, 1);
});

test("insufficient or unreadable actual-cart quantities stop without a retry", async () => {
  for (const counts of [[0], null]) {
    const h = checkpoint(() => counts);
    const state = { lines: [line], results: [], pendingAdd: { lineIndex: 0, name: "Bitters", targetQuantity: 1 } };
    assert.equal(await h.context.checkProofCart(state), true);
    assert.deepEqual(h.finished, ["needs_review"]);
    assert.deepEqual(h.destinations, []);
    assert.equal(state.results[0].status, "unconfirmed");
  }
});

test("Proof adds only the missing quantity, persists before clicking, and opens the actual cart", async () => {
  const events = [];
  const control = {};
  const button = { disabled: false, click: () => events.push("click") };
  const context = {
    exactMatches: () => [{ root: { innerText: "Bitters" }, button }],
    quantityControls: () => [control], quantityControlForKind: () => control,
    setQuantity: (_, quantity) => { events.push(["quantity", quantity]); return true; },
    delay: async () => {}, cartLinkSnapshot: () => "",
    saveState: async (state) => events.push(["saved", state.pendingAdd.targetQuantity]),
    renderOverlay: () => {}, location: { assign: (url) => events.push(["navigate", url]) },
  };
  runInNewContext(addSource, context);
  const state = { vendor: "proof", lines: [{ ...line, quantity: 3 }], proofCartCounts: [1] };
  const result = await context.addExactMatch(state, 0);
  assert.equal(result.status, "verifying");
  assert.deepEqual(events, [["quantity", 2], ["saved", 3], "click", ["navigate", "https://shop.sgproof.com/sgws/en/usd/cart"]]);
  assert.equal(state.lines[0].quantity, 3);
});
