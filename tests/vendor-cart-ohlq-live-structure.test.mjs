import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const background = readFileSync(new URL("../chrome-extension/bees-cart-builder/background.js", import.meta.url), "utf8");
const vendorCart = readFileSync(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8");

function catalogWaitHarness(readyAt, cancelAt = Infinity) {
  let elapsed = 0;
  const state = { status: "running" };
  const messages = [];
  const context = {
    Date: { now: () => elapsed },
    renderOverlay: (_, message) => messages.push(message),
    ohlqCatalogRows: () => elapsed >= readyAt ? [{}] : [],
    delay: async (ms) => { elapsed += ms; if (elapsed >= cancelAt) state.status = "cancelled"; },
  };
  const source = vendorCart.slice(vendorCart.indexOf("async function waitForOhlqCatalog("), vendorCart.indexOf("function addResultOnce("));
  runInNewContext(source, context);
  return { state, messages, elapsed: () => elapsed, wait: context.waitForOhlqCatalog };
}

test("OHLQ waits for a catalog that arrives after the old 12-second limit", async () => {
  const h = catalogWaitHarness(30000);
  assert.equal(await h.wait(h.state), true);
  assert.equal(h.elapsed(), 30000);
  assert.match(h.messages[0], /Waiting for OHLQ's catalog/);
});

test("OHLQ catalog wait has a bounded 90-second timeout", async () => {
  const h = catalogWaitHarness(Infinity);
  assert.equal(await h.wait(h.state), false);
  assert.equal(h.elapsed(), 90000);
});

test("OHLQ Stop cancels the loading wait before quantities are staged", async () => {
  const h = catalogWaitHarness(30000, 5000);
  assert.equal(await h.wait(h.state), false);
  assert.equal(h.elapsed(), 5000);
});

test("OHLQ also waits for delayed filter controls", async () => {
  const h = catalogWaitHarness(Infinity);
  assert.equal(await h.wait(h.state, 90000, () => h.elapsed() >= 20000), true);
  assert.equal(h.elapsed(), 20000);
});

test("OHLQ rehearsal wakes the cart worker after navigation", () => {
  assert.match(background, /waitForTabComplete\(focused\.tab\.id\)/);
  assert.match(background, /VENDOR_CART_START/);
  assert.match(background, /return temporaryStorage\.get\(ORDER_KEY\)/);
});

test("OHLQ exact matches use the live purchased-product cards", () => {
  assert.match(vendorCart, /product-item--minimal-previously-purchased/);
  assert.match(vendorCart, /exactOhlqRows\(line\)/);
  assert.match(vendorCart, /await delay\(1500\)/);
});

test("older verified OHLQ items use exact product pages without substitutions", () => {
  assert.match(vendorCart, /"0068B": "111805928192876"/);
  assert.match(vendorCart, /"0893L": "180221973987424"/);
  assert.match(vendorCart, /"9674D": "103610807059918"/);
  assert.match(vendorCart, /state\.ohlqDirectQueue/);
  assert.match(vendorCart, /location\.assign\(ohlqProductUrl/);
});

test("exact product pages prefer the ancestor that owns the quantity control", () => {
  assert.match(vendorCart, /let fallback = null/);
  assert.match(vendorCart, /if \(quantity\) return candidate/);
  assert.match(vendorCart, /return fallback/);
});
