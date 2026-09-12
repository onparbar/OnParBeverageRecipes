import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("live weekly plan embeds receiving in orders and completion in prep", () => {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const liveWeeklyPlanBody ="), source.indexOf("let weeklyPlanBody = liveWeeklyPlanBody"));
  const orders = body.indexOf("renderVendorOrderDraftWorkspace(");
  const receiving = body.indexOf("renderWeeklyPlanFinishWeek(");
  assert.ok(orders >= 0);
  assert.ok(receiving > orders);
  assert.equal(body.split("renderWeeklyPlanFinishWeek(").length - 1, 2);
  assert.match(body, /renderWeeklyPlanFinishWeek\(planLocked, Boolean\(orderStep\?\.complete\), "deliveries"\)\}<\/details>/);
  assert.match(body, /renderWeeklyPlanFinishWeek\(planLocked, Boolean\(orderStep\?\.complete\), "prep"\)/);
  assert.doesNotMatch(body, /id="weekly-plan-finish-week"/);
});
