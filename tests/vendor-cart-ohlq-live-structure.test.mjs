import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const background = readFileSync(new URL("../chrome-extension/bees-cart-builder/background.js", import.meta.url), "utf8");
const vendorCart = readFileSync(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8");

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
