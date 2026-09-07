import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("live weekly plan renders receiving after the vendor ordering workspace", () => {
  const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("const liveWeeklyPlanBody ="), source.indexOf("let weeklyPlanBody = liveWeeklyPlanBody"));
  const orders = body.indexOf("renderVendorOrderDraftWorkspace(");
  const receiving = body.indexOf("renderWeeklyPlanFinishWeek(");
  assert.ok(orders >= 0);
  assert.ok(receiving > orders);
  assert.equal(body.split("renderWeeklyPlanFinishWeek(").length - 1, 1);
});
