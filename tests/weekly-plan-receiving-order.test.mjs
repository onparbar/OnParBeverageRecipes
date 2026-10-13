import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("live weekly plan embeds receiving in orders and completion in prep", () => {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const prep = source.slice(source.indexOf("const prepWorkspace ="), source.indexOf("const liveWeeklyPlanBody ="));
  const body = source.slice(source.indexOf("const liveWeeklyPlanBody ="), source.indexOf("let weeklyPlanBody = liveWeeklyPlanBody"));
  const orders = body.indexOf("renderVendorOrderDraftWorkspace(");
  const receiving = body.indexOf("renderWeeklyPlanFinishWeek(");
  assert.ok(orders >= 0);
  assert.ok(receiving > orders);
  assert.equal(body.split("renderWeeklyPlanFinishWeek(").length - 1, 1);
  assert.match(body, /planLocked\s*\? renderSupplierOrderFlow\(\{/);
  assert.match(body, /ordersHtml: `<section id="weekly-plan-orders">\$\{renderVendorOrderDraftWorkspace\(plan, freshness, vendorOrderModel, \{ guided: true \}\)/);
  assert.match(body, /renderWeeklyPlanFinishWeek\(planLocked, Boolean\(orderStep\?\.complete\), "deliveries"\)\}<\/section>/);
  assert.match(body, /prepHtml: prepWorkspace/);
  assert.equal(prep.split("renderWeeklyPlanFinishWeek(").length - 1, 1);
  assert.match(prep, /renderWeeklyPlanFinishWeek\(planLocked, Boolean\(orderStep\?\.complete\), "prep"\)/);
  assert.match(prep, /renderWeeklyIngredientPrep\(plan\.prep\.ingredients\)/);
  assert.match(prep, /renderWeeklyPlanCocktailRows\(plan\.prep\.cocktails, \{ editable: planLocked \}\)/);
  assert.match(prep, /renderWeeklyPlanLiquorRefillRows\(plan\.orders\.liquorTapBottles\)/);
  assert.doesNotMatch(body, /id="weekly-plan-finish-week"/);
});

test("supplier navigation binds after the existing actions and only for the live plan", () => {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("function renderWeeklyPlan()"), source.indexOf("function renderKegLevels()"));
  assert.ok(body.indexOf("supplierOrderFlow.bind(") > body.indexOf("bindWeeklyPlanController("));
  assert.match(body, /if \(!orderRehearsalMode\) supplierOrderFlow\.bind\(\{ root: weeklyPlan, scope: `live:\$\{clean\(recommendations\?\.generatedAt\)\}` \}\)/);
  assert.match(body, /const orderWorkspace = demoModel\.currentStep\.id === "orders"\s*\? renderVendorOrderDraftWorkspace\(plan, freshness, vendorOrderModel\)/);
});
