import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, dashboard, updateRoute, tapPricingRoute, itemManagement, portionSchema] = await Promise.all([
  readFile("app/page.jsx", "utf8"),
  readFile("public/dashboard.js", "utf8"),
  readFile("app/api/pmb-portion-price-update/route.js", "utf8"),
  readFile("app/api/tap-pricing/route.js", "utf8"),
  readFile("lib/pmb-item-management.mjs", "utf8"),
  readFile("lib/pmb-portion-schema.mjs", "utf8"),
]);

test("shot pricing edits both portions inside the unified tap pricing table", () => {
  assert.doesNotMatch(page, /id="shot-pricing-title"/);
  assert.doesNotMatch(page, /id="shot-pricing-table"/);
  assert.match(dashboard, /const shotPricingTable = document.querySelector\("#pricing-table"\)/);
  assert.match(dashboard, /buildShotPricingRows/);
  assert.match(dashboard, /Update both in PMB/);
  assert.match(dashboard, /Update both shot prices/);
  assert.match(dashboard, /fetch\("\/api\/pmb-portion-price-update"/);
  assert.match(dashboard, /expectedAssignments: row\.assignments\.map/);
  assert.match(dashboard, /expectedPriceRaw: portion\.priceRaw/);
  assert.match(dashboard, /newPrice: \(validation\.cents\[index\]/);
});

test("shot price drafts remain editable during verification but saving stays gated", () => {
  const editor = dashboard.slice(dashboard.indexOf("function renderShotPricing("), dashboard.indexOf("function bindShotPricingControls("));
  const inputs = editor.slice(editor.indexOf("const editors ="), editor.indexOf("const editor = document.createElement"));
  assert.doesNotMatch(inputs, /!row\.canEdit/);
  assert.match(inputs, /activePmbPortionPriceUpdateKey \? "disabled"/);
  assert.match(editor, /data-shot-price-update[^\n]+!row\.canEdit/);
  assert.match(editor, /draft\?\.values\[index\]/);
  assert.match(editor, /draft\.identity !== draftIdentity/);
  assert.match(editor, /editor\.addEventListener\("input", rememberDraft\)/);
  assert.match(editor, /editor\.addEventListener\("toggle", rememberDraft\)/);
});

test("the portion endpoint authenticates first and remains fail-closed until the PMB form is verified", () => {
  const authIndex = updateRoute.indexOf("requireDashboardRequestRole");
  const jsonIndex = updateRoute.indexOf("request.json()");
  assert.ok(authIndex >= 0 && authIndex < jsonIndex);
  assert.match(itemManagement, /PMB_PORTION_FORM_UNVERIFIED/);
  assert.match(itemManagement, /key === "price_input"/);
  assert.match(updateRoute, /No unverified price was left in place/);
  assert.match(updateRoute, /verifyPmbPortionReadback/);
  assert.match(updateRoute, /rollbackSavedEdits/);
  assert.match(portionSchema, /PMB_PORTION_ITEM_ID_FIELD/);
  assert.match(portionSchema, /PMB_PORTION_QUANTITY_FIELD/);
  assert.match(tapPricingRoute, /writeAvailable: Boolean\(portionSchema\.ok && portionManagement\.ok\)/);
});
