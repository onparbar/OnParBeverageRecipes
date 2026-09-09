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
    isOhlqCheckoutPage: () => false,
    currentVendor: () => "proof",
    isLoginPage: () => false,
    chrome: { runtime: { sendMessage: async () => ({ ok: true, state }) } },
    saveState: async (value) => saved.push(JSON.parse(JSON.stringify(value))),
    vendorSearchUrl: (_, sku) => `https://shop.sgproof.com/search?text=${sku}`,
    location: { assign: (url) => destinations.push(url) },
    renderOverlay: () => {},
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
  return { vendor: "proof", status: "pending", phase, searchCursor: 0, results: [], lines: [{ name: "Bitters", vendorSku: "38000" }, { name: "Watermelon", vendorSku: "49357" }] };
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
