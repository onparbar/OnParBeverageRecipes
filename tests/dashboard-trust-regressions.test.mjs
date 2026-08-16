import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("owner startup has one PMB synchronization path", async () => {
  const source = await readProjectFile("public/dashboard.js");
  assert.match(source, /runOwnerLoginSync/);
  assert.equal(source.includes("scheduleAutomaticPmbRefresh"), false);
});

test("search does not present unavailable sales as zero", async () => {
  const source = await readProjectFile("public/dashboard.js");
  assert.match(source, /dollarsAvailable/);
  assert.match(source, /Sales unavailable/);
  assert.doesNotMatch(source, /item\.dollars === null \? "Poured volume"/);
});

test("missing price alerts use canonical structured tap data", async () => {
  const source = await readProjectFile("public/dashboard.js");
  const start = source.indexOf("function getMissingPriceAlerts()");
  const end = source.indexOf("  const alerts = [];", start);
  const alertSource = source.slice(start, end);
  assert.match(alertSource, /getKegCanonicalResolution/);
  assert.match(alertSource, /resolution\.operationallyVerified/);
  assert.match(alertSource, /pricing\.chargeAvailable/);
  assert.equal(alertSource.includes("pricing.chargeHtml"), false);
});

test("PMB write routes require an owner inside the handler", async () => {
  const productRoute = await readProjectFile("app/api/pmb-products/route.js");
  const tapRoute = await readProjectFile("app/api/pmb-tap-product/route.js");
  assert.match(productRoute, /requireDashboardRequestRole\(request, \{ owner: true \}\)/);
  assert.match(tapRoute, /requireDashboardRequestRole\(request, \{ owner: true \}\)/);
  assert.match(tapRoute, /headers\.Cookie = cookie/);
});

test("narrow layout contains the menu within the viewport", async () => {
  const css = await readProjectFile("app/globals.css");
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /width: min\(220px, calc\(100vw - 24px\)\)/);
  assert.match(css, /overflow-x: clip/);
  assert.match(css, /\.tap-sheet-header \{[^\n]*align-items: flex-end;/);
});
