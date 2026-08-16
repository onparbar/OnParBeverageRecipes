import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getVendorHandoffConfig,
  getVendorHandoffPath,
} from "../lib/vendor-handoff-config.mjs";

test("vendor destinations are fixed and exposed to the browser only through same-origin paths", () => {
  assert.equal(getVendorHandoffPath("BEES"), "/api/vendor-handoff?vendor=heidelberg");
  assert.equal(getVendorHandoffPath("Proof"), "/api/vendor-handoff?vendor=proof");
  assert.equal(getVendorHandoffPath("OHLQ"), "/api/vendor-handoff?vendor=ohlq");
  assert.equal(getVendorHandoffPath("Bonbright"), null);
  assert.equal(
    getVendorHandoffConfig("Heidelberg").externalUrl,
    "https://mybeesapp.com/customer/account",
  );
});

test("browser handoff code cannot message, email, cart, checkout, or embed external destinations", async () => {
  const source = await readFile(
    new URL("../public/assisted-order-direct-ui.mjs", import.meta.url),
    "utf8",
  );
  const dashboardSource = await readFile(
    new URL("../public/dashboard.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /sms:|mailto:|addToCart|submitOrder|placeOrder|checkoutCart|https?:\/\//i,
  );
  assert.match(source, /\/api\/vendor-handoff\?vendor=/);
  assert.match(
    dashboardSource,
    /window\.open\(view\.vendorPath, "_blank", "noopener,noreferrer"\)/,
  );
});

test("dashboard loads the enhancer and the vendor route requires owner access", async () => {
  const [dashboard, route] = await Promise.all([
    readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/vendor-handoff/route.js", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /from "\.\/assisted-order-direct-ui\.mjs"/);
  assert.match(route, /requireDashboardRequestRole\(request, \{ owner: true \}\)/);
  assert.match(route, /getVendorHandoffConfig/);
});

test("assisted-order controls stack on narrow screens and stay out of printouts", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.assisted-order-handoff__button\s*\{[^}]*width: 100%/);
  assert.match(css, /@media print[\s\S]*\.assisted-order-handoff[\s\S]*display: none !important/);
});
