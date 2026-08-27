import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("vendor handoff uses extension-private storage and remains review-only", async () => {
  const [background, vendorCart, manifestText] = await Promise.all([
    readFile(new URL("../chrome-extension/bees-cart-builder/background.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/manifest.json", import.meta.url), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  assert.match(background, /const temporaryStorage = chrome\.storage\.local;/);
  assert.doesNotMatch(background, /chrome\.storage\.session/);
  assert.match(background, /home: "https:\/\/portal\.ohlq\.com\/Previously-Purchased"/);
  assert.match(vendorCart, /Nothing was submitted\./);
  assert.match(vendorCart, /function exactOhlqRows\(line\)/);
  assert.match(vendorCart, /This exact OHLQ item ID was not in the 90-day purchased catalog/);
  assert.match(vendorCart, /state\.phase = "ohlq-adding";\s*await saveState\(state\);\s*addButton\.click\(\);/s);
  assert.match(vendorCart, /if \(vendor === "ohlq"\) \{\s*await runOhlqCatalog\(state\);\s*return;/s);
  assert.doesNotMatch(vendorCart, /(?:checkout|place order|submit order)[^\n]{0,80}\.click\(/i);
  assert.ok(manifest.permissions.includes("storage"));
  assert.ok(manifest.host_permissions.includes("https:\/\/\*.ohlq.com\/*"));
  assert.ok(manifest.host_permissions.includes("https:\/\/\*.sgproof.com\/*"));
});
