import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pricing advisor exposes a confirmed Owner-only PMB update flow", async () => {
  const [page, dashboard] = await Promise.all([
    readFile("app/page.jsx", "utf8"),
    readFile("public/dashboard.js", "utf8"),
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
});
