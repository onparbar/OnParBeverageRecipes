import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, dashboardSource] = await Promise.all([
  readFile(new URL("../app/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
]);

test("the owner dashboard is the initial page and recipes appear later in navigation", () => {
  const dashboardTab = pageSource.indexOf('data-tab="dashboard"');
  const operationsTab = pageSource.indexOf('data-tab="operations"');
  const usageTab = pageSource.indexOf('data-tab="weekly-usage"');
  const recipesTab = pageSource.indexOf('data-tab="recipes"');
  const addTab = pageSource.indexOf('data-tab="add"');

  assert.ok(dashboardTab >= 0);
  assert.ok(dashboardTab < operationsTab);
  assert.ok(operationsTab < usageTab);
  assert.ok(usageTab < recipesTab);
  assert.ok(recipesTab < addTab);
  assert.match(pageSource, /className="panel is-active" id="dashboard-panel"/);
  assert.doesNotMatch(pageSource, /className="panel is-active" id="recipes-panel"/);
});

test("current and old recipes share one Recipes workspace", () => {
  assert.match(pageSource, /id="current-recipes-view"/);
  assert.match(pageSource, /id="old-recipes-view"/);
  assert.match(pageSource, /data-recipe-view="current"/);
  assert.match(pageSource, /data-recipe-view="old"/);
  assert.doesNotMatch(pageSource, /id="old-panel"/);
  assert.match(dashboardSource, /function switchRecipeView\(/);
  assert.match(dashboardSource, /recipeView: inactive \? "old" : "current"/);
});

test("Dashboard and Weekly Plan render the new overview and PMB trend layers", () => {
  assert.match(pageSource, /id="dashboard-overview"/);
  assert.match(dashboardSource, /buildDashboardOverview\(/);
  assert.match(dashboardSource, /buildWeeklyPlanTrends\(/);
  assert.match(dashboardSource, /What changed in the pours/);
  assert.match(dashboardSource, /Pour My Beer ounces—not drinks sold or revenue/);
});

test("Tap Pricing displays only PMB-verified current wall products", () => {
  assert.match(dashboardSource, /liveTapPriceItems = filterCurrentTapPricingItems\(result\.items\)/);
  assert.match(dashboardSource, /if \(!liveTapPriceItems\.length\) return \[\];/);
  assert.match(pageSource, /82% minimum gross-margin suggestions/);
  assert.match(pageSource, /Nothing is sent until you confirm the live change/);
  assert.match(dashboardSource, /Approve & update PMB/);
});

test("owner login automatically attempts every read-only PMB refresh", () => {
  assert.match(dashboardSource, /void runOwnerLoginSync\(\)/);
  assert.match(dashboardSource, /acquireOwnerLoginSyncLock\(\)/);
  assert.match(dashboardSource, /releaseOwnerLoginSyncLock\(lockToken\)/);
  assert.match(dashboardSource, /runKegLevelSync\(\)/);
  assert.match(dashboardSource, /runTapPricingSync\(\)/);
  assert.match(dashboardSource, /runPmbWeeklyUsageSync\(\{ automatic: true \}\)/);
  assert.match(dashboardSource, /flushPendingSharedWeeklyUsageSave\(\)/);
  assert.match(dashboardSource, /flushPendingInventoryFieldSyncs\(\)/);
  assert.match(dashboardSource, /flushPendingParAgentStateSync\(\)/);
  assert.match(dashboardSource, /isRecommendationForOperatingWeek/);
  assert.match(dashboardSource, /shouldRefreshMondayPlanForUsage/);
  assert.match(dashboardSource, /if \(!mondayPlanIsCurrent\) await runKegParAgent\(\)/);
  assert.match(dashboardSource, /parAgentRunning = false;\s+renderKegLevels\(\);\s+renderWeeklyPlan\(\);\s+renderDashboardOverview\(\)/);
  assert.match(dashboardSource, /Automatic PMB check paused for owner review/);
  assert.match(dashboardSource, /nothing was accepted or saved automatically/);
  assert.match(dashboardSource, /pending Weekly Usage report was already saved by another dashboard tab/);

  const ownerSyncStart = dashboardSource.indexOf("async function runOwnerLoginSync()");
  const ownerSyncEnd = dashboardSource.indexOf("function acquireOwnerLoginSyncLock", ownerSyncStart);
  const ownerSyncSource = dashboardSource.slice(ownerSyncStart, ownerSyncEnd);
  assert.match(ownerSyncSource, /runKegLevelSync\(\)/);
  assert.match(ownerSyncSource, /if \(!kegResult\) kegResult = await runKegLevelSync\(\)/);
  assert.match(ownerSyncSource, /runTapPricingSync\(\)/);
  assert.match(ownerSyncSource, /lockToken\s*\? runPmbWeeklyUsageSync/);
  assert.doesNotMatch(ownerSyncSource, /if \(!lockToken\) return;/);
});

test("PMB refresh alerts distinguish attempted failures from unchecked feeds", () => {
  assert.match(dashboardSource, /fetchPmbJsonWithRetry\(\{\s*fetcher: \(\) => fetch\("\/api\/keg-levels"/s);
  assert.match(dashboardSource, /kegSyncAttempted\s*\?\s*"offline"\s*:\s*"not-checked"/s);
  assert.match(dashboardSource, /tapPricingSyncAttempted\s*\?\s*"offline"\s*:\s*"not-checked"/s);

  const kegSyncStart = dashboardSource.indexOf("async function runKegLevelSync()");
  const kegSyncEnd = dashboardSource.indexOf("async function runTapPricingSync()", kegSyncStart);
  assert.doesNotMatch(dashboardSource.slice(kegSyncStart, kegSyncEnd), /kegSyncAttempted = false/);
});

test("Tap Pricing gives slow PMB configuration reads time to finish and marks them retryable", async () => {
  const tapPricingRoute = await readFile("app/api/tap-pricing/route.js", "utf8");
  assert.match(tapPricingRoute, /PMB_TAP_CONFIG_TIMEOUT_MS = 15000/);
  assert.match(tapPricingRoute, /status: upstreamFailure \? 503 : 500/);
});

test("the authoritative computer can initialize shared setup from bundled defaults", () => {
  assert.match(dashboardSource, /Initialize the official shared dashboard setup with this release's bundled defaults/);
  assert.match(dashboardSource, /Future owner edits will then sync normally across devices/);
  assert.match(dashboardSource, /Type \$\{SHARED_DASHBOARD_IMPORT_PHRASE\}/);
});

test("every Weekly Usage tap row renders an accessible week-by-week trend graph", () => {
  assert.match(dashboardSource, /buildWeeklyUsageTrend\(item\.history, historyHeaders\)/);
  assert.match(dashboardSource, /Avg weekly \+ trend/);
  assert.match(dashboardSource, /missing .* shown as a gap, not zero/);
  assert.match(dashboardSource, /weekly-usage-trend__point/);
});

test("the initial Dashboard prioritizes On Par rankings and change-only Ohio compliance", () => {
  assert.match(dashboardSource, /On Par performance/);
  assert.match(dashboardSource, /Show per list/);
  assert.match(dashboardSource, /data-seller-ranking-list-size/);
  assert.match(dashboardSource, /Top \$\{formatNumber\(listSize\)\}/);
  assert.match(dashboardSource, /Bottom \$\{formatNumber\(listSize\)\}/);
  assert.match(dashboardSource, /Last 6 saved weeks/);
  assert.match(dashboardSource, /All saved PMB weeks/);
  assert.match(dashboardSource, /Cocktails/);
  assert.match(dashboardSource, /Liquor/);
  assert.match(dashboardSource, /Main wall/);
  assert.match(dashboardSource, /Karaoke wall/);
  assert.match(dashboardSource, /Patio liquor wall/);
  assert.doesNotMatch(dashboardSource, />All walls</);
  assert.match(dashboardSource, /let sellerRankingWall = "main"/);
  assert.match(dashboardSource, />1 week</);
  assert.match(dashboardSource, />6 weeks</);
  assert.match(dashboardSource, />All time</);
  assert.match(dashboardSource, /Est\. profit \(today's rates\)/);
  assert.match(dashboardSource, /fetch\(`\/api\/beverage-news\?scope=compliance/);
  assert.doesNotMatch(dashboardSource, /Beverage radar/);
  assert.doesNotMatch(dashboardSource, /Industry &amp; trend stories/);
  assert.match(dashboardSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(dashboardSource, /official Ohio/);
});
