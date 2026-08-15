import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, dashboard, updateRoute, tapPricingRoute] = await Promise.all([
  readFile("app/page.jsx", "utf8"),
  readFile("public/dashboard.js", "utf8"),
  readFile("app/api/pmb-portion-price-update/route.js", "utf8"),
  readFile("app/api/tap-pricing/route.js", "utf8"),
]);

test("shot pricing is a separate two-portion owner workflow", () => {
  assert.match(page, /id="shot-pricing-title">Shot pricing/);
  assert.match(page, /id="shot-pricing-table"/);
  assert.match(dashboard, /buildShotPricingRows/);
  assert.match(dashboard, /Update both in PMB/);
  assert.match(dashboard, /Update both shot prices/);
  assert.match(dashboard, /fetch\("\/api\/pmb-portion-price-update"/);
  assert.match(dashboard, /expectedAssignments: row\.assignments\.map/);
  assert.match(dashboard, /expectedPriceRaw: portion\.priceRaw/);
  assert.match(dashboard, /newPrice: \(validation\.cents\[index\]/);
});

test("the portion endpoint authenticates first and remains fail-closed until the PMB form is verified", () => {
  const authIndex = updateRoute.indexOf("requireDashboardRequestRole");
  const jsonIndex = updateRoute.indexOf("request.json()");
  assert.ok(authIndex >= 0 && authIndex < jsonIndex);
  assert.match(updateRoute, /PMB_PORTION_FORM_UNVERIFIED/);
  assert.match(updateRoute, /No price was changed/);
  assert.match(tapPricingRoute, /PMB_PORTION_ITEM_ID_FIELD/);
  assert.match(tapPricingRoute, /PMB_PORTION_QUANTITY_FIELD/);
  assert.match(tapPricingRoute, /writeAvailable: false/);
});
