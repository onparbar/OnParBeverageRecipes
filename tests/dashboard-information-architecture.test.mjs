import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [pageSource, dashboardSource, inventorySource, staffDashboardSource, beveragePulseSource] = await Promise.all([
  readFile(new URL("../app/page.jsx", import.meta.url), "utf8"),
  readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/data/inventory-2026-06-01.csv", import.meta.url), "utf8"),
  readFile(new URL("../public/staff-dashboard.js", import.meta.url), "utf8"),
  readFile(new URL("../public/dashboard-beverage-pulse.mjs", import.meta.url), "utf8"),
]);

test("the owner dashboard is the initial page and recipes appear later in navigation", () => {
  const dashboardTab = pageSource.indexOf('data-tab="dashboard"');
  const operationsTab = pageSource.indexOf('data-tab="operations"');
  const searchTab = pageSource.indexOf('data-tab="search"');

  assert.ok(dashboardTab >= 0);
  assert.ok(dashboardTab < operationsTab);
  assert.ok(operationsTab < searchTab);
  assert.match(pageSource, /className="dashboard-menu dashboard-owner-only"/);
  assert.match(pageSource, /data-menu-tab="weekly-usage"/);
  assert.match(pageSource, /data-menu-tab="performance"/);
  assert.match(pageSource, /data-menu-tab="recipes"/);
  assert.match(pageSource, /data-menu-tab="add"/);
  assert.match(pageSource, /data-menu-tab="pricing"/);
  assert.match(pageSource, /data-menu-tab="ingredients"/);
  assert.match(pageSource, /\["keg-levels", "Keg Levels"\],[\s\S]*\["inventory", "Inventory"\],[\s\S]*\["weekly-plan", "Weekly Plan"\]/);
  assert.match(pageSource, /data-tab="dashboard"[^>]*>Home<\/button>/);
  assert.doesNotMatch(pageSource, /\["insights", "Insights"\]/);
  assert.match(pageSource, /className="panel is-active" id="dashboard-panel"/);
  assert.doesNotMatch(pageSource, /className="panel is-active" id="recipes-panel"/);
  assert.match(pageSource, /id="performance-panel"/);
  assert.doesNotMatch(pageSource, /id="insights-panel"/);
  assert.match(pageSource, /id="onpar-insights"/);
  assert.match(dashboardSource, /option value="sales"/);
  assert.match(dashboardSource, /option value="profit"/);
  assert.match(dashboardSource, /option value="twelve-weeks"/);
  assert.doesNotMatch(dashboardSource, /data-order-draft-export/);
});

test("Performance keeps shot filters compatible and top and bottom lists distinct", () => {
  assert.match(dashboardSource, /function keepSellerRankingFiltersCompatible/);
  assert.match(dashboardSource, /sellerRankingCategory === "liquor" && sellerRankingWall === "main"/);
  assert.match(dashboardSource, /sellerRankingWall = "patio"/);
  assert.match(dashboardSource, /function getDisjointSellerRankingPeriod/);
  assert.match(dashboardSource, /topLimit: 25/);
  assert.match(dashboardSource, /bottomLimit: 25/);
  assert.match(dashboardSource, /!topIdentities\.has\(getSellerRankingRowIdentity\(row\)\)/);
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

test("recipe coverage requires an exact PMB tap and excludes Coming Soon placeholders", () => {
  const start = dashboardSource.indexOf("function getWallCocktailRecipeCoverage()");
  const end = dashboardSource.indexOf("function findRecipeForWallProduct", start);
  const coverageSource = dashboardSource.slice(start, end);
  assert.match(coverageSource, /kegLiveLevels\.get\(`tap:\$\{toNumber\(item\.tapNumber\)\}`\)/);
  assert.doesNotMatch(coverageSource, /getKegLiveRow\(item\)/);
  assert.equal(coverageSource.includes('if (/^coming soon\\b/i.test(clean(productName))) return null;'), true);
});

test("speech inventory assigns On Deck units only where the On Deck product is defined", () => {
  const start = dashboardSource.indexOf("function getInventorySpeechSourceItems()");
  const onDeckStart = dashboardSource.indexOf("const onDeckSources", start);
  const end = dashboardSource.indexOf("function renderInventorySpeechAssistant", onDeckStart);
  const currentKegSource = dashboardSource.slice(start, onDeckStart);
  const onDeckSource = dashboardSource.slice(onDeckStart, end);
  assert.doesNotMatch(currentKegSource, /onDeck\.kind/);
  assert.match(currentKegSource, /unit: "kegs"/);
  assert.match(onDeckSource, /unit: normalizeTitle\(onDeck\.kind\) === "liquor" \? "oz" : "kegs"/);
});

test("tap editing puts On Deck before detailed tap controls", () => {
  const start = dashboardSource.indexOf("function renderKegLevelAdjustRow");
  const end = dashboardSource.indexOf("function syncKegAdjustPercentInput", start);
  const editPanelSource = dashboardSource.slice(start, end);
  assert.ok(editPanelSource.indexOf("renderKegOnDeckControl(item)") < editPanelSource.indexOf("keg-edit-section--level"));
});

test("tap rows show On Deck beneath the current product", () => {
  const start = dashboardSource.indexOf("function renderTapChangeControls");
  const end = dashboardSource.indexOf("function getMappedIngredientUnitCost", start);
  const controlsSource = dashboardSource.slice(start, end);
  assert.ok(controlsSource.indexOf("tap-product-current") < controlsSource.indexOf("keg-on-deck-summary"));
  assert.ok(controlsSource.indexOf("keg-on-deck-summary") < controlsSource.indexOf("tap-change-controls"));
});

test("Keg Levels keeps customer tap pricing in the dedicated pricing workspace", () => {
  const wallStart = dashboardSource.indexOf("function renderKegWallBlock");
  const wallEnd = dashboardSource.indexOf("function getKegCanonicalResolution", wallStart);
  const wallSource = dashboardSource.slice(wallStart, wallEnd);
  const financeStart = dashboardSource.indexOf("function renderKegEditFinancialPanel");
  const financeEnd = dashboardSource.indexOf("function renderKegOnDeckControl", financeStart);
  const financeSource = dashboardSource.slice(financeStart, financeEnd);
  assert.doesNotMatch(wallSource, /<th>Tap price<\/th>/);
  assert.doesNotMatch(financeSource, /Tap price|Cost \/ oz|Margin/);
  assert.match(financeSource, /<span>Par<\/span>/);
});

test("late Monday snapshots use an inline reason instead of an unsupported prompt", () => {
  assert.match(dashboardSource, /id="weekly-plan-late-reason"/);
  assert.match(dashboardSource, /weeklyPlanOutsideMondayReason/);
  assert.doesNotMatch(dashboardSource, /window\.prompt\("Why are you saving this Monday snapshot late\?"\)/);
});

test("Weekly Plan source freshness uses compact provenance items", () => {
  assert.equal((dashboardSource.match(/weekly-plan-provenance__item/g) || []).length, 4);
  assert.match(pageSource, /id="weekly-plan"/);
});

test("new recipe cards use spirit labels without physical-wall suffixes", () => {
  assert.match(dashboardSource, /canonicalTitle: "Whiskey Smash \(Jim Beam\)"/);
  assert.match(dashboardSource, /canonicalTitle: "Apple Jack \(Jack Fire\)"/);
  assert.match(dashboardSource, /canonicalTitle: "On Par Tee \(Crown Royal\)"/);
  assert.match(dashboardSource, /canonicalTitle: "Bacardi Sunset"/);
  assert.doesNotMatch(dashboardSource, /canonicalTitle: "(?:Whiskey Smash|Apple Jack|On Par Tee|Bacardi Sunset)[^"]*\) 1"/);
  assert.doesNotMatch(dashboardSource, /\["WHISKEY SMASH", "Whiskey Smash"\]/);
  assert.doesNotMatch(dashboardSource, /\["ON PAR TEE", "On Par Tee"\]/);
  assert.match(dashboardSource, /function getCanonicalProductDisplayName\(/);
  assert.match(dashboardSource, /getCanonicalProductDisplayName\(item\.name\)/);
  assert.match(dashboardSource, /getCanonicalProductDisplayName\(item\.name\)/);
  assert.match(dashboardSource, /getCanonicalProductDisplayName\(recommendation\.orderProductName\)/);
});

test("Home owns compact Guest Favorites while deeper analysis stays in Performance", () => {
  assert.match(pageSource, /id="dashboard-overview"/);
  assert.match(dashboardSource, /buildDashboardOverview\(/);
  assert.match(dashboardSource, /buildWeeklyPlanTrends\(/);
  assert.doesNotMatch(pageSource, /id="insights-panel"/);
  assert.match(pageSource, /id="dashboard-guest-favorites"/);
  assert.match(dashboardSource, /Guest favorites/);

  const weeklyPlanStart = dashboardSource.indexOf("function renderWeeklyPlan()");
  const weeklyPlanEnd = dashboardSource.indexOf("function renderKegLevels", weeklyPlanStart);
  assert.doesNotMatch(dashboardSource.slice(weeklyPlanStart, weeklyPlanEnd), /renderWeeklyPlanTrends\(\)/);
});

test("Weekly Plan uses one Monday lock action without print or CSV controls", () => {
  assert.match(dashboardSource, /Save & Lock Plan/);
  assert.match(dashboardSource, /Recall Plan/);
  assert.match(dashboardSource, /action: "recall-weekly-plan"/);
  assert.match(dashboardSource, /id="weekly-plan-orders"/);
  assert.doesNotMatch(dashboardSource, /id="export-weekly-plan"/);
  assert.doesNotMatch(dashboardSource, /id="print-weekly-plan"/);
  assert.doesNotMatch(dashboardSource, /function exportWeeklyPlanCsv/);
});

test("prepared ingredients expose purchased package prices instead of editable diluted yields", () => {
  assert.match(pageSource, /<th>Package size<\/th>/);
  assert.match(pageSource, /<th>Package price<\/th>/);
  assert.match(dashboardSource, /getPreparedIngredientYieldNote/);
  assert.match(dashboardSource, /preparedPurchase\?\.priceInputLabel/);
});

test("pricing rows omit redundant vendor-sync badges", () => {
  assert.doesNotMatch(dashboardSource, />via Provi<\/span>/);
  assert.doesNotMatch(dashboardSource, /title="\$\{escapeHtml\(ingredient\.vendorProduct\.productName\)\}">\$\{escapeHtml\(ingredient\.vendorProduct\.vendor\)\}<\/span>/);
  assert.doesNotMatch(dashboardSource, /title="\$\{escapeHtml\(kegItem\.vendorProduct\.productName\)\}">Provi<\/span>/);
});

test("Triple Jam and Truly use exact Heidelberg half-barrel mappings", () => {
  assert.match(dashboardSource, /productName: "Blake's Hard Cider Triple Jam"/);
  assert.match(dashboardSource, /preferredSku: "41189"/);
  assert.match(dashboardSource, /productName: "TRULY Hard Seltzer Wild Berry"/);
  assert.match(dashboardSource, /preferredSku: "42517"/);
});

test("weekly prep is a wall-specific cocktail label list without redundant order-type identifiers", () => {
  assert.match(dashboardSource, /function renderWeeklyPlanCocktailRows\(/);
  assert.match(dashboardSource, /batchSizeOz/);
  assert.match(dashboardSource, /label\${item\.quantity === 1 \? "" : "s"}/);
  assert.match(staffDashboardSource, /item\.wall.*wall/);
  assert.match(staffDashboardSource, /item\.batchSizeOz/);

  const vendorRendererStart = dashboardSource.indexOf("function renderWeeklyPlanByVendor");
  const vendorRendererEnd = dashboardSource.indexOf("function renderWeeklyPlanReview", vendorRendererStart);
  assert.doesNotMatch(dashboardSource.slice(vendorRendererStart, vendorRendererEnd), /escapeHtml\(item\.lineType\)/);
  assert.doesNotMatch(staffDashboardSource, /clean\(item\.lineType\)/);
});

test("the owner dashboard keeps completed cocktail prep visible for the current Monday plan", () => {
  assert.match(dashboardSource, /Cocktails Prepped/);
  assert.match(dashboardSource, /Prepped by \$\{escapeHtml\(item\.preparedBy\)\}/);
  assert.match(dashboardSource, /formatDashboardPrepTime\(item\.completedAt\)/);
  assert.match(dashboardSource, /fetch\("\/api\/staff-prep-plan"/);
  assert.match(dashboardSource, /refreshDashboardStaffPrepPlan\(\)/);
  assert.match(dashboardSource, /window\.setInterval\([\s\S]*refreshDashboardStaffPrepPlan\(\)[\s\S]*30_000/);
});

test("locking a new Monday plan clears the prior plan's prep history", async () => {
  const parAgentSource = await readFile("lib/par-agent.mjs", "utf8");
  const publishStart = parAgentSource.indexOf("export async function publishWeeklyPlanSnapshot");
  const publishEnd = parAgentSource.indexOf("export function validateTapConfigCoverage", publishStart);
  const publishSource = parAgentSource.slice(publishStart, publishEnd);
  assert.match(publishSource, /prepChecklist: \{\}/);
});

test("Tap Pricing displays only PMB-verified current wall products", () => {
  assert.match(dashboardSource, /liveTapPriceItems = filterCurrentTapPricingItems\(result\.items\)/);
  assert.match(dashboardSource, /if \(!liveTapPriceItems\.length\) return \[\];/);
  assert.match(dashboardSource, /const pricedTapCount = kegWallItems\.filter/);
  assert.match(dashboardSource, /\^coming soon!\?\$/i);
  assert.match(pageSource, /82% Price Suggestions/);
  assert.match(dashboardSource, /Approve & update PMB/);
});

test("owner login automatically attempts PMB and defers mapped vendor price refreshes", () => {
  assert.match(dashboardSource, /void runOwnerLoginSync\(\)/);
  assert.match(dashboardSource, /acquireOwnerLoginSyncLock\(\)/);
  assert.match(dashboardSource, /releaseOwnerLoginSyncLock\(lockToken\)/);
  assert.match(dashboardSource, /runKegLevelSync\(\)/);
  assert.match(dashboardSource, /runTapPricingSync\(\)/);
  assert.match(dashboardSource, /runPmbWeeklyUsageSync\(\{ automatic: true \}\)/);
  assert.match(dashboardSource, /runVendorSync\(\{ automatic: true \}\)/);
  assert.match(dashboardSource, /flushPendingSharedWeeklyUsageSave\(\)/);
  assert.match(dashboardSource, /flushPendingInventoryFieldSyncs\(\)/);
  assert.match(dashboardSource, /flushPendingParAgentStateSync\(\)/);
  assert.match(dashboardSource, /isRecommendationForOperatingWeek/);
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
  assert.match(ownerSyncSource, /window\.setTimeout\([\s\S]*runVendorSync\(\{ automatic: true \}\)/);
  const ownerCoreStart = ownerSyncSource.indexOf("await Promise.allSettled([");
  const ownerCoreEnd = ownerSyncSource.indexOf("let kegResult", ownerCoreStart);
  assert.doesNotMatch(ownerSyncSource.slice(ownerCoreStart, ownerCoreEnd), /runVendorSync/);
  assert.match(ownerSyncSource, /mondaySnapshot\?\.kegPlanSnapshot/);
  assert.doesNotMatch(ownerSyncSource, /runKegParAgent\(\)/);
  assert.doesNotMatch(ownerSyncSource, /if \(!lockToken\) return;/);
});

test("vendor price sync remains automatic at login but stays outside the unified PMB refresh", () => {
  assert.match(dashboardSource, /async function runVendorSync\(\{ automatic = false \} = \{\}\)/);
  assert.match(dashboardSource, /const syncScope = automatic \? "all" : vendorSyncScope/);
  assert.match(dashboardSource, /Prices sync automatically/);
  assert.match(pageSource, /id="refresh-all-pmb"/);
  assert.match(dashboardSource, /async function runUnifiedPmbRefresh\(\)/);
  const unifiedStart = dashboardSource.indexOf("async function runUnifiedPmbRefresh()");
  const unifiedEnd = dashboardSource.indexOf("document.querySelector(\"#refresh-all-pmb\")", unifiedStart);
  assert.doesNotMatch(dashboardSource.slice(unifiedStart, unifiedEnd), /runVendorSync/);
  assert.doesNotMatch(dashboardSource, /id="run-vendor-sync"/);
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

test("Weekly Plan ignores food-department Sour Mix ordering while inventory keeps its COGS value", () => {
  assert.match(dashboardSource, /isFoodDepartmentOrderedInventoryItem/);
  assert.match(dashboardSource, /item\.orderHoldReason \|\| isFoodDepartmentOrderedInventoryItem\(item\.name\)/);
  assert.match(inventorySource, /Bombay Sapphire,3,,\$42\.30,,\$126\.90,,0,0,Bombay Sapphire,/);
  assert.match(inventorySource, /sweet and sour.*Ordered by the food department; included in beverage cost of goods\./);
});

test("straight liquor tap bottles stay in the Liquor Cabinet inventory group", () => {
  assert.match(dashboardSource, /STRAIGHT_LIQUOR_TAP_INGREDIENTS\.some\(\(item\) => item\.toLowerCase\(\) === normalized\)\) return "Liquor"/);
  ["Jameson", "Screwball", "Pink Whitney", "Patron Silver"].forEach((name) => {
    assert.match(dashboardSource, new RegExp(`"${name}"`));
  });
});

test("retired Bottle Service inventory is removed without removing liquor-cabinet products", () => {
  assert.doesNotMatch(inventorySource, /Bottle Service Karaoke Cooler/);
  assert.doesNotMatch(dashboardSource, /"Bottle Service"/);
  assert.match(inventorySource, /^Patron,,,\$94\.00/m);
});

test("voice inventory can focus matching on the liquor and mixer cabinets", () => {
  assert.match(dashboardSource, /data-speech-inventory-scope="cabinet"/);
  assert.match(dashboardSource, /inventorySpeechInventoryScope !== "cabinet"/);
  assert.match(dashboardSource, /\["liquor cabinet", "mixer cabinet"\]\.includes/);
  assert.match(dashboardSource, /item\.id === "korbel-brut"/);
});

test("voice inventory reuses granted microphone access for later counts", () => {
  assert.match(dashboardSource, /let inventorySpeechMicrophoneAuthorized = false/);
  assert.match(dashboardSource, /if \(!inventorySpeechMicrophoneAuthorized\)/);
  assert.match(dashboardSource, /inventorySpeechMicrophoneAuthorized = true/);
  assert.match(dashboardSource, /function cleanInventorySpeechRecognitionText/);
  assert.match(dashboardSource, /const words = cleanInventorySpeechRecognitionText/);
});

test("inventory keeps advanced controls behind one row Edit action and retires Bubbly", () => {
  assert.match(dashboardSource, /inventory-row-edit-toggle/);
  assert.doesNotMatch(dashboardSource, /inventory-par-toggle/);
  assert.doesNotMatch(dashboardSource, /custom-inventory-price/);
  assert.doesNotMatch(dashboardSource, />Find price</);
  assert.match(dashboardSource, /if \(currentSection === "Bubbly in patio cooler"\) return;/);
  assert.doesNotMatch(dashboardSource, /\["Liquor Cabinet", "Mixer Cabinet", "Other", "Bubbly"\]/);
});

test("custom cabinet bottles inherit the requested Proof and OHLQ mappings", () => {
  assert.match(dashboardSource, /"korbel-brut": \{ vendor: "Proof"/);
  assert.match(dashboardSource, /"buffalo-trace": \{ vendor: "OHLQ"/);
  assert.match(dashboardSource, /"makers-mark": \{ vendor: "OHLQ"/);
  assert.match(dashboardSource, /const vendorProduct = getVendorMapping\(id\) \|\| item\.vendorProduct/);
  assert.match(dashboardSource, /vendorProduct\?\.syncVendor \|\| vendorProduct\?\.vendor/);
  assert.doesNotMatch(dashboardSource, /item\.priceUpdatedAt \? item\.vendorProduct\?\.vendor/);
});

test("Weekly Plan previews live needs and locks from the current Monday inventory snapshot", () => {
  assert.match(dashboardSource, /getCurrentMondayInventorySnapshot\(inventoryHistory/);
  assert.match(dashboardSource, /getInventorySnapshotItems\(\)/);
  assert.match(dashboardSource, /parAgentState\.recommendations\.items/);
  assert.match(dashboardSource, /Save & Lock Plan/);
  assert.doesNotMatch(dashboardSource, /id="save-inventory-snapshot"/);
  assert.match(dashboardSource, /kegPlanSnapshot: mondaySnapshot\.kegPlanSnapshot/);
  assert.match(dashboardSource, /tapInputs: \(parAgentState\.recommendations\.items \|\| \[\]\)\.map/);
  assert.match(dashboardSource, /backup\/on-hand keg fields are cleared for the next count/);
  const lockStart = dashboardSource.indexOf("async function runWeeklyPlanUpdate()");
  const lockEnd = dashboardSource.indexOf("async function initializeSharedKegLevelsFromServiceComputer", lockStart);
  const lockSource = dashboardSource.slice(lockStart, lockEnd);
  assert.match(lockSource, /publishCurrentWeeklyPlanSnapshot\(\)/);
  assert.doesNotMatch(lockSource, /runKegParAgent\(\)/);
  assert.doesNotMatch(lockSource, /runKegLevelSync\(\)/);
  assert.doesNotMatch(lockSource, /runPmbWeeklyUsageSync\(\)/);
});

test("Weekly Usage keeps averages and history without rising or falling labels", () => {
  assert.match(dashboardSource, /Avg weekly/);
  assert.doesNotMatch(dashboardSource, /buildWeeklyUsageTrend/);
  assert.doesNotMatch(dashboardSource, /renderWeeklyUsageTrend/);
  assert.doesNotMatch(dashboardSource, /weekly-usage-trend-label/);
  assert.doesNotMatch(dashboardSource, /getWeeklyUsageTrendDirectionCopy/);
  assert.doesNotMatch(pageSource, /Compared with the prior completed week/);
});

test("the initial Dashboard uses a light visual beverage pulse and change-only Ohio compliance", () => {
  const pulseSource = `${dashboardSource}\n${beveragePulseSource}`;
  assert.match(pulseSource, /Crowd favorite/);
  assert.match(pulseSource, /Gaining attention/);
  assert.match(pulseSource, /Worth a glance/);
  assert.match(pulseSource, /Top beers/);
  assert.match(pulseSource, /Top cocktails/);
  assert.match(pulseSource, /Top liquor/);
  assert.match(pulseSource, /Rank by/);
  assert.match(pulseSource, /buildLastWeekPourLeaders/);
  assert.match(pulseSource, /No liquor pours were saved for the Patio or Karaoke wall last week/);
  assert.match(pulseSource, /Projected sales mix/);
  assert.match(pulseSource, /const projectedSalesMix = buildLastWeekProjectedSalesMix\(/);
  assert.doesNotMatch(pulseSource, /PMB ounces × saved\/current prices/);
  assert.match(pulseSource, /dashboard-pulse-bar/);
  assert.match(pulseSource, /data-seller-ranking-wall/);
  assert.match(pulseSource, /Main wall/);
  assert.match(pulseSource, /Karaoke wall/);
  assert.match(pulseSource, /Patio liquor wall/);
  assert.match(pulseSource, /let sellerRankingWall = "main"/);
  assert.doesNotMatch(dashboardSource, /Quick actions/);
  assert.match(dashboardSource, /fetch\(`\/api\/beverage-news\?scope=compliance/);
  assert.doesNotMatch(dashboardSource, /Beverage radar/);
  assert.doesNotMatch(dashboardSource, /Industry &amp; trend stories/);
  assert.match(dashboardSource, /target="_blank" rel="noopener noreferrer"/);
  assert.match(dashboardSource, /official Ohio/);
});

test("dashboard workspaces omit redundant eyebrow labels and explanatory blurbs", () => {
  [
    /Product builder/,
    /Batch cocktail costing/,
    /Weekly Beverage Operations/,
    /All required shared inputs are current and no review warnings remain/,
    /Calculation scope:/,
    /Submit separately to/,
    /One weekly checklist/,
    /Current-wall reference list/,
  ].forEach((pattern) => {
    assert.doesNotMatch(`${pageSource}\n${dashboardSource}`, pattern);
  });
  assert.match(pageSource, /<h2 id="recipe-form-title">Add cocktail product<\/h2>/);
  assert.doesNotMatch(dashboardSource, /Update needs/);
  assert.match(dashboardSource, /Try again/);
  assert.match(dashboardSource, /const mappedCostPerOz = getMappedIngredientUnitCost\(onDeck\.name\)/);
});
