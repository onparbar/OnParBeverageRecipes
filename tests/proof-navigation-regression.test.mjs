import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8");
const startSource = source.slice(source.indexOf("async function start()"), source.indexOf("chrome.runtime.onMessage.addListener"));
const searchSource = source.slice(source.indexOf("async function submitSearch("), source.indexOf("async function waitForResults("));
const waitSource = source.slice(source.indexOf("async function waitForResults("), source.indexOf("function isOhlqCheckoutPage("));

function harness(state) {
  const saved = [], destinations = [], added = [], waits = [];
  const context = {
    running: false,
    navigationPending: false,
    isOhlqCheckoutPage: () => false,
    currentVendor: () => "proof",
    isLoginPage: () => false,
    chrome: { runtime: { sendMessage: async () => ({ ok: true, state }) } },
    saveState: async (value) => saved.push(JSON.parse(JSON.stringify(value))),
    vendorSearchUrl: (_, sku) => `https://shop.sgproof.com/search?text=${sku}`,
    location: { assign: (url) => destinations.push(url) },
    renderOverlay: () => {},
    checkProofCart: async () => false,
    addResultOnce: (value, result) => value.results.push(result),
    VENDOR_CONFIG: { proof: { label: "Proof" } },
    waitForResults: async (...args) => { waits.push(args); return true; },
    addExactMatch: async (_, index) => { added.push(index); return { lineIndex: index, status: "added" }; },
    finishFromResults: async () => { throw Error("Must navigate before finishing"); },
    finish: async (_, __, message) => { throw Error(message); },
  };
  runInNewContext(searchSource + startSource, context);
  return { context, saved, destinations, added, waits };
}

function order(phase = "start") {
  return { vendor: "proof", status: "pending", phase, searchCursor: 0, results: [], proofCartCounts: [0, 0], lines: [{ name: "Bitters", vendorSku: "38000", quantity: 1, quantityKind: "cases" }, { name: "Watermelon", vendorSku: "49357", quantity: 1, quantityKind: "cases" }] };
}

test("Proof saves the cursor and stops immediately when search navigation starts", async () => {
  const h = harness(order());
  await h.context.start();
  assert.deepEqual(h.destinations, ["https://shop.sgproof.com/search?text=38000"]);
  assert.deepEqual(h.added, []);
  assert.deepEqual(h.waits, []);
  assert.equal(h.saved.at(-1).searchCursor, 0);
  assert.equal(h.saved.at(-1).phase, "search-results");
});

test("Proof ignores duplicate starts while navigation is pending", async () => {
  const h = harness(order());
  await h.context.start();
  await h.context.start();
  assert.deepEqual(h.destinations, ["https://shop.sgproof.com/search?text=38000"]);
  assert.deepEqual(h.added, []);
});

test("Proof claims the worker before its asynchronous state read", async () => {
  const h = harness(order());
  await Promise.all([h.context.start(), h.context.start()]);
  assert.deepEqual(h.destinations, ["https://shop.sgproof.com/search?text=38000"]);
});

test("Proof resumes the saved item and navigates away before checking the next", async () => {
  const h = harness(order("search-results"));
  await h.context.start();
  assert.deepEqual(h.added, [0]);
  assert.equal(h.waits[0][0], 90000);
  assert.equal(h.waits[0][1].vendorSku, "38000");
  assert.deepEqual(h.destinations, ["https://shop.sgproof.com/search?text=49357"]);
  assert.equal(h.saved.at(-1).searchCursor, 1);
  assert.equal(h.saved.at(-1).phase, "search-results");
});

test("Proof waits for the requested product despite unrelated Add buttons", async () => {
  let elapsed = 0;
  const context = {
    Date: { now: () => elapsed },
    delay: async (ms) => { elapsed += ms; },
    addButtons: () => [{}],
    exactMatches: (line) => line.vendorSku === "38000" && elapsed >= 30000 ? [{}] : [],
  };
  runInNewContext(waitSource, context);
  assert.equal(await context.waitForResults(90000, { vendorSku: "38000" }, { status: "working" }), true);
  assert.equal(elapsed, 30000);
  assert.equal(await context.waitForResults(90000, { vendorSku: "38000" }, { status: "cancelled" }), false);
});

test("Proof stops on an uncertain addition without navigating to another item", async () => {
  const state = order("search-results");
  const h = harness(state);
  let finished;
  h.context.addExactMatch = async () => ({ lineIndex: 0, status: "unconfirmed" });
  h.context.finish = async (_, status) => { finished = status; };
  await h.context.start();
  assert.equal(finished, "needs_review");
  assert.deepEqual(h.destinations, []);
  assert.equal(state.searchCursor, 0);
  assert.equal(state.results[0].status, "unconfirmed");
});

test("Proof hands an interrupted addition to the cart checkpoint before attempting anything", async () => {
  const state = order("search-results");
  state.pendingAdd = { lineIndex: 0, name: "Bitters" };
  const h = harness(state);
  let checked;
  h.context.checkProofCart = async (value) => { checked = value.pendingAdd; return true; };
  await h.context.start();
  assert.equal(checked.lineIndex, 0);
  assert.deepEqual(h.added, []);
  assert.deepEqual(h.destinations, []);
});

test("Proof skips bitters already confirmed in the cart and searches for the next item", async () => {
  const state = order();
  state.proofCartCounts = [1, 0];
  const h = harness(state);
  await h.context.start();
  assert.deepEqual(h.added, []);
  assert.equal(state.results[0].status, "added");
  assert.deepEqual(h.destinations, ["https://shop.sgproof.com/search?text=49357"]);
});

const confirmationSource = source.slice(source.indexOf("function proofCartQuantity("), source.indexOf("async function waitForAddConfirmation("));

function confirmationHarness(textAt) {
  let elapsed = 0;
  const context = {
    clean: (value) => String(value ?? "").replace(/\s+/g, " ").trim(),
    exactMatches: () => [{ root: { innerText: textAt(elapsed) } }],
    Date: { now: () => elapsed },
    delay: async (ms) => { elapsed += ms; },
  };
  runInNewContext(confirmationSource, context);
  return context;
}

test("Proof confirms a delayed item-specific cart increase without a toast or header change", async () => {
  const h = confirmationHarness((elapsed) => elapsed >= 12000 ? "Bitters 1 Case In Cart" : "Bitters Add to Cart");
  const line = { quantityKind: "cases", quantity: 1 };
  const before = h.proofCartQuantity(line);
  assert.equal(before, 0);
  assert.equal(await h.waitForProofAddConfirmation(line, before), true);
});

test("Proof does not count an unchanged existing cart badge as a successful addition", async () => {
  const h = confirmationHarness(() => "Bitters 1 Case In Cart");
  const line = { quantityKind: "cases", quantity: 1 };
  assert.equal(await h.waitForProofAddConfirmation(line, h.proofCartQuantity(line)), false);
});

test("Proof distinguishes cases and bottles and rejects unknown cart badge wording", () => {
  const h = confirmationHarness(() => "Bitters 2 Cases In Cart 3 Bottles In Cart");
  assert.equal(h.proofCartQuantity({ quantityKind: "cases" }), 2);
  assert.equal(h.proofCartQuantity({ quantityKind: "units" }), 3);
  const unknown = confirmationHarness(() => "Bitters In Cart");
  assert.equal(unknown.proofCartQuantity({ quantityKind: "cases" }), null);
});
