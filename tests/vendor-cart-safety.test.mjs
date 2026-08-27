import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("vendor handoff uses extension-private storage and remains review-only", async () => {
  const [background, vendorCart, manifestText, beesCart, dashboardSource] = await Promise.all([
    readFile(new URL("../chrome-extension/bees-cart-builder/background.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/vendor-cart.js", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/manifest.json", import.meta.url), "utf8"),
    readFile(new URL("../chrome-extension/bees-cart-builder/bees-cart.js", import.meta.url), "utf8"),
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
});
