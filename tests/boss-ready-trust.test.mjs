import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ordinary keg-level edits do not send a config update", async () => {
  const dashboard = await readFile("public/dashboard.js", "utf8");
  const start = dashboard.indexOf("async function pushKegLevelAdjustment");
  const end = dashboard.indexOf("function clearAllKegOnHand", start);
  assert.match(dashboard.slice(start, end), /sendConfigUpdate: false/);
});

test("pricing health includes orderable inventory outside the tap walls", async () => {
  const dashboard = await readFile("public/dashboard.js", "utf8");
  const start = dashboard.indexOf("function getMissingPriceAlerts");
  const end = dashboard.indexOf("function getMondayRunModel", start);
  assert.match(dashboard.slice(start, end), /getWeeklyPlanInventoryItems\(\)/);
  assert.match(dashboard.slice(start, end), /item\?\.unitCost/);
});

test("live PMB level and config writes require owner access and record activity", async () => {
  const routes = await Promise.all([
    readFile("app/api/keg-level-adjust/route.js", "utf8"),
    readFile("app/api/keg-config-update/route.js", "utf8"),
  ]);
  routes.forEach((source) => {
    assert.match(source, /requireDashboardRequestRole\(request, \{ owner: true \}\)/);
    assert.match(source, /recordDashboardActivity/);
  });
  assert.match(routes[1], /acknowledgeTapInterruption/);
});

test("successful quality checks on main automatically select the exact commit for deployment", async () => {
  const workflow = await readFile(".github/workflows/deploy-on-site.yml", "utf8");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/);
  assert.match(workflow, /workflow_run\.head_sha/);
});
