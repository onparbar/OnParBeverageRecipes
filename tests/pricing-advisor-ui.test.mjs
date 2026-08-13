import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pricing advisor exposes a confirmed Owner-only PMB update flow", async () => {
  const [page, dashboard, styles] = await Promise.all([
    readFile("app/page.jsx", "utf8"),
    readFile("public/dashboard.js", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.match(page, /Owner review required/);
  assert.match(page, /<th>Owner approval<\/th>/);
  assert.match(page, /Current-wall reference list/);
  assert.match(page, /Nothing is sent until you confirm the live change/);
  assert.doesNotMatch(page, /cannot publish a live change/);
  assert.match(dashboard, /data-pmb-price-update/);
  assert.match(dashboard, /Approve & update PMB/);
  assert.match(dashboard, /Current PMB price:/);
  assert.match(dashboard, /New PMB price:/);
  assert.match(dashboard, /Affected assignment:/);
  assert.match(dashboard, /fetch\("\/api\/pmb-price-update"/);
  assert.match(dashboard, /expectedCurrentPricePerOz: eligibility\.currentPricePerOz/);
  assert.match(dashboard, /exactIdentity: eligibility\.identity/);
  assert.match(dashboard, /expectedAssignments: assignments\.map/);
  assert.match(dashboard, /\{\s*tapNumber,\s*deviceId,\s*lineNum,?\s*\}/s);
  assert.match(dashboard, /result\?\.ok !== true/);
  assert.match(dashboard, /PMB price verified at/);
  assert.match(dashboard, /Do not submit this price again/);
  assert.match(styles, /\.pricing-advisor-action label \{[\s\S]*display: flex;/);
  assert.match(styles, /\.pricing-advisor-action__currency \{[\s\S]*position: static;/);
  assert.match(styles, /\.pricing-advisor-action input \{[\s\S]*min-width: 0;/);
  assert.match(styles, /\.pricing-advisor-action \{[\s\S]*width: 100%;[\s\S]*min-width: 0;/);
  assert.match(styles, /\.pricing-advisor-action \.mini-button \{[\s\S]*white-space: normal;/);
});
