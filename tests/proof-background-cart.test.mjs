import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const background = readFileSync(new URL("../chrome-extension/bees-cart-builder/background.js", import.meta.url), "utf8");
const branch = background.slice(background.indexOf('  if (message?.type === "CHECK_PROOF_CART")'), background.indexOf('  if (message?.type === "START_VENDOR_CART")'));
const ownershipSource = background.slice(background.indexOf("function ownsProofWorker("), background.indexOf("chrome.runtime.onMessage.addListener"));

function harness(fail = false) {
  const calls = [];
  const state = { vendor: "proof", requestId: "request-1", status: "working", workerTabId: 10 };
  const context = {
    ORDER_KEY: "order", temporaryStorage: { get: async () => ({ order: state }) },
    waitForTabComplete: async (id) => calls.push(["loaded", id]),
    setTimeout: (callback) => callback(),
    chrome: { tabs: {
      create: async (options) => { calls.push(["create", options]); return { id: 99 }; },
      sendMessage: async (id, message) => { if (fail) throw Error("Tab closed"); calls.push(["read", id, message.type]); return { ok: true, counts: [1] }; },
      remove: async (id) => calls.push(["remove", id]),
    } },
  };
  runInNewContext(`${ownershipSource}\nfunction handle(message, sender) { ${branch} }`, context);
  return { context, calls };
}

test("Proof verifies in an inactive reader tab and closes only that tab", async () => {
  const h = harness();
  const result = await h.context.handle({ type: "CHECK_PROOF_CART", requestId: "request-1" }, { tab: { id: 10 }, url: "https://shop.sgproof.com/search?text=38000" });
  assert.equal(result.ok, true);
  assert.equal(h.calls[0][1].active, false);
  assert.equal(h.calls[0][1].url, "https://shop.sgproof.com/sgws/en/usd/cart#onpar-cart-check");
  assert.deepEqual(h.calls.slice(1), [["loaded", 99], ["read", 99, "READ_PROOF_CART"], ["remove", 99]]);
});

test("background cart reads reject other origins and expired requests", async () => {
  for (const [url, requestId] of [["https://example.com/", "request-1"], ["https://shop.sgproof.com/", "old-request"]]) {
    const h = harness();
    const result = await h.context.handle({ type: "CHECK_PROOF_CART", requestId }, { tab: { id: 10 }, url });
    assert.equal(result.ok, false);
    assert.equal(h.calls.length, 0);
  }
});

test("a failed background read cleans up its reader tab without touching the product tab", async () => {
  const h = harness(true);
  const result = await h.context.handle({ type: "CHECK_PROOF_CART", requestId: "request-1" }, { tab: { id: 10 }, url: "https://shop.sgproof.com/" });
  assert.equal(result.ok, false);
  assert.deepEqual(h.calls.at(-1), ["remove", 99]);
});

test("another Proof tab cannot read the active worker's cart", async () => {
  const h = harness();
  const result = await h.context.handle({ type: "CHECK_PROOF_CART", requestId: "request-1" }, { tab: { id: 11 }, url: "https://shop.sgproof.com/" });
  assert.equal(result.ok, false);
  assert.deepEqual(h.calls, []);
});
