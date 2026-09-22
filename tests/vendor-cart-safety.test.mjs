import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

test("vendor handoff uses extension-private storage and remains review-only", async () => {
  const [background, vendorCart, manifestText, beesCart, checkoutReview, dashboardSource] = await Promise.all([
    readFile(new URL("../chrome-extension/bees-cart-builder/background.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/bees-cart.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/checkout-review.js", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
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

  const proofIdentityBlock = vendorCart.match(/const PROOF_PRODUCT_IDENTITIES = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(proofIdentityBlock, "Proof product identities should remain explicit");
  const proofIdentitySkus = new Set(
    [...proofIdentityBlock[1].matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]),
  );
  const configuredProofSkus = [
    ...dashboardSource.matchAll(/^\s*(?:"[^"]+"|[a-z][a-z0-9-]*):\s*\{\s*vendor:\s*"Proof",[^\n]*preferredSku:\s*"([^"]+)"/gm),
  ].map((match) => match[1]);
  assert.ok(configuredProofSkus.length >= 14);
  assert.equal(new Set(configuredProofSkus).size, configuredProofSkus.length);
  assert.deepEqual(
    configuredProofSkus.filter((sku) => !proofIdentitySkus.has(sku)),
    [],
  );
  assert.match(vendorCart, /candidate\.text\.includes\(sku\)\) return 1000/);
  assert.match(vendorCart, /proofIdentity\?\.include\.every[\s\S]*return 900/);

  const identityBlock = beesCart.match(/const PRODUCT_IDENTITIES = Object\.freeze\(\{([\s\S]*?)\n\}\);/);
  assert.ok(identityBlock, "BEES product identities should remain explicit");
  const identityKeys = new Set(
    [...identityBlock[1].matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]),
  );
  const heidelbergKeys = [
    ...dashboardSource.matchAll(/^\s*(?:"([^"]+)"|([a-z][a-z0-9-]*)):\s*\{\s*vendor:\s*"Heidelberg",/gm),
  ].map((match) => (match[1] || match[2]).replaceAll("-", " "));
  const missingBeesIdentities = heidelbergKeys.filter((key) => !identityKeys.has(key));
  assert.deepEqual(missingBeesIdentities, []);
  assert.ok(identityKeys.has("non alcoholic beer"));
  assert.ok(identityKeys.has("blakes hard cider triple jam"));

  assert.match(checkoutReview, /i have kegs\? to \(\?:be \)\?pick/);
  assert.match(checkoutReview, /input\[type="radio"\].*\[role="switch"\]/s);
  assert.match(checkoutReview, /const discoveryDeadline = Date\.now\(\) \+ 15000/);
  assert.match(checkoutReview, /const confirmationDeadline = Date\.now\(\) \+ 15000/);
  assert.match(checkoutReview, /beesKegPickupIsChecked\(matches\[0\]\)/);
  assert.match(checkoutReview, /Keg pickup is checked\. Review the order and submit it yourself\./);
});

test("BEES waits for its exact keg-pickup choice and verifies a re-rendered control", async () => {
  const checkoutReview = await readFile(
    new URL("../chrome-extension/bees-cart-builder/checkout-review.js", import.meta.url),
    "utf8",
  );
  let elapsed = 0;
  let clicked = false;
  const control = (checked) => ({
    checked,
    disabled: false,
    labels: [],
    textContent: "",
    getAttribute(name) {
      if (name === "aria-label") return "I have kegs to pick up";
      return null;
    },
    closest() { return null; },
    matches() { return true; },
    click() { clicked = true; },
  });
  const stale = control(false);
  const confirmed = control(true);
  const context = {
    Date: { now: () => elapsed },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [clicked && elapsed >= 700 ? confirmed : stale],
    },
    pause: async (milliseconds) => { elapsed += milliseconds; },
    visible: () => true,
  };
  const source = checkoutReview.slice(
    checkoutReview.indexOf("function beesKegPickupText("),
    checkoutReview.indexOf("function stop("),
  );
  runInNewContext(source, context);

  await context.selectBeesKegPickup();
  assert.equal(clicked, true);
  assert.equal(elapsed, 700);
});
