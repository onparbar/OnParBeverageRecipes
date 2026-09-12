import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("pricing advisor exposes a confirmed Owner-only PMB update flow", async () => {
  const [page, dashboard, styles] = await Promise.all([
    readFile("app/page.jsx", "utf8"),
    readFile("public/dashboard.js", "utf8"),
    readFile("app/globals.css", "utf8"),
  ]);

  assert.match(page, /82% Price Suggestions/);
  assert.match(page, /<th>Owner approval<\/th>/);
  assert.doesNotMatch(page, /cannot publish a live change/);
  assert.match(dashboard, /data-pmb-price-update/);
  assert.match(dashboard, /Save price to PMB/);
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

test("tap price advisors retain editors and liquor prices stay directly editable", async () => {
  const dashboard = await readFile("public/dashboard.js", "utf8");
  const renderStart = dashboard.indexOf("function renderPricing()");
  const renderEnd = dashboard.indexOf("function bindShotPricingControls", renderStart);
  const renderers = dashboard.slice(renderStart, renderEnd);
  assert.equal(renderers.split("advisorButton.replaceWith(editor)").length - 1, 1);
  assert.match(renderers, /else row\.children\[3\]\?\.append\(editor\)/);
  assert.match(renderers, /chargeCell\.replaceChildren\(editor\)/);
  const advisor = dashboard.slice(dashboard.indexOf("function renderPricingAdvisor("), dashboard.indexOf("function buildPricingAdvisorInput("));
  const editorMarkup = advisor.slice(advisor.indexOf("pricingAdvisorTable.innerHTML ="));
  assert.doesNotMatch(editorMarkup, /scrollIntoView|addEventListener\("click"/);
  assert.doesNotMatch(advisor, /renderPricingAdvisor\(visibleTapRows\);/);
  assert.equal(advisor.split("renderPricing();").length - 1, 2);
  assert.match(dashboard, /\[pricingTable, pricingAdvisorTable\]\.flatMap/);
  assert.match(dashboard, /\[shotPricingTable, pricingAdvisorTable\]\.flatMap/);
  assert.match(dashboard, /candidate\.dataset\.pricingAdvisorKey === key && candidate\.querySelector\("\[data-pmb-price-input\]"\)/);
});
