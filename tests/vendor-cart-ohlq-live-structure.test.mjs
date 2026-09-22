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
  assert.match(vendorCart, /skuPattern\.test\(text\)/);
  assert.match(vendorCart, /lineScore\(candidate, line\) > 0/);
});

test("OHLQ delivery-date verification accepts the formats used by its checkout", () => {
  const context = { Intl };
  const source = [
    vendorCart.slice(vendorCart.indexOf("function clean("), vendorCart.indexOf("function escapeHtml(")),
    vendorCart.slice(vendorCart.indexOf("function ohlqDateLabel("), vendorCart.indexOf("function renderOhlqDeliveryNotice(")),
    vendorCart.slice(vendorCart.indexOf("function ohlqDateValueMatches("), vendorCart.indexOf("function ohlqDeliveryDateWasAccepted(")),
  ].join("\n");
  runInNewContext(source, context);

  for (const value of [
    "9/24/2026",
    "09/24/2026",
    "9-24-2026",
    "2026-09-24",
    "Thursday, September 24, 2026",
  ]) {
    assert.equal(context.ohlqDateValueMatches(value, "2026-09-24"), true, value);
  }
  assert.equal(context.ohlqDateValueMatches("9/25/2026", "2026-09-24"), false);
});

test("OHLQ re-finds an Angular-replaced input before rejecting the selected date", async () => {
  let elapsed = 0;
  const input = (value) => ({
    value,
    click() {},
    getAttribute(name) { return name === "value" ? value : null; },
  });
  const staleInput = input("");
  const updatedInput = input("9/24/2026");
  const context = {
    Date: { now: () => elapsed },
    clean: (value) => String(value ?? "").trim(),
    delay: async (milliseconds) => { elapsed += milliseconds; },
    findOhlqDeliveryDateInput: () => elapsed >= 700 ? updatedInput : staleInput,
    findOhlqDateChoice: () => ({ matches: () => true, click() {} }),
    ohlqDateLabel: () => "Thursday, September 24, 2026",
  };
  const source = vendorCart.slice(
    vendorCart.indexOf("function ohlqDateValueMatches("),
    vendorCart.indexOf("function findOhlqDeliveryTimeSelect("),
  );
  runInNewContext(source, context);

  await context.selectOhlqDeliveryDate("2026-09-24");
  assert.equal(elapsed, 700);
});

test("OHLQ allows up to 15 seconds for delayed date confirmation", () => {
  assert.match(vendorCart, /const confirmationDeadline = Date\.now\(\) \+ 15000/);
});
