import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDashboardOverview,
  DASHBOARD_OVERVIEW_TARGETS,
  sortDashboardOverviewAlerts,
} from "../public/dashboard-overview.mjs";

const now = "2026-08-12T12:00:00.000Z";

function readyShared() {
  return {
    dashboard: { available: true, initialized: true },
    inventory: { available: true, initialized: true },
    weeklyUsage: { available: true, initialized: true },
    kegLevels: { available: true, initialized: true },
  };
}

function readySignals() {
  return {
    weeklyPlan: {
      readiness: {
        status: "ready",
        label: "Ready to order",
        blockers: [],
        staleReasons: [],
        reviewReasons: [],
      },
      generatedAt: "2026-08-12T10:00:00.000Z",
      summary: {
        orderLineCount: 9,
        inventoryLineCount: 6,
        beerKegTotal: 5,
        cocktailBatchTotal: 3,
        cocktailLineCount: 2,
        estimatedKnownPurchaseCost: 486.5,
        missingPriceCount: 0,
        estimatedPurchaseCostComplete: true,
      },
    },
    shared: readyShared(),
    pmb: {
      kegLevels: {
        status: "online",
        capturedCount: 102,
        expectedCount: 102,
        updatedAt: "2026-08-12T11:30:00.000Z",
      },
      pricing: {
        status: "online",
        capturedCount: 47,
        expectedCount: 47,
        updatedAt: "2026-08-12T11:25:00.000Z",
      },
    },
    usage: {
      initialized: true,
      lastSyncAt: "2026-08-12T11:00:00.000Z",
      performance: {
        latestLabel: "8/3/26 - 8/9/26",
        previousLabel: "7/27/26 - 8/2/26",
        eligibleCount: 102,
        capturedCount: 102,
        comparableCount: 102,
        currentComplete: true,
        trendComplete: true,
        totalCurrentOz: 12_500,
        totalTrendOz: 388,
        totalTrendPercent: 3.2,
      },
    },
    pricing: {
      targetMarginPercent: 82,
      advisorSummary: {
        total: 47,
        priceChangeCount: 0,
        onTargetCount: 47,
        reviewCount: 0,
        blockedCount: 0,
      },
    },
    inventory: { missingCurrentCount: 0 },
    recipes: { missingRecipeCount: 0 },
    products: { pendingPublishCount: 0 },
    deferred: {
      cocktailIngredientNetting: false,
    },
  };
}

test("builds a clear overview from fully verified source signals", () => {
  const overview = buildDashboardOverview(readySignals(), { now });

  assert.equal(overview.status, "ready");
  assert.equal(overview.statusLabel, "Operations ready");
  assert.equal(overview.planNumbersAvailable, true);
  assert.deepEqual(overview.alertCounts, { critical: 0, warning: 0, info: 0 });
  assert.deepEqual(overview.alerts, []);

  const kpis = Object.fromEntries(overview.kpis.map((item) => [item.id, item]));
  assert.equal(kpis["order-readiness"].value, "Ready to order");
  assert.equal(kpis["items-to-order"].value, "9");
  assert.equal(kpis["cocktails-to-make"].value, "3");
  assert.equal(kpis["purchase-cost"].value, "$486.50");
  assert.equal(kpis["usage-coverage"].value, "102 / 102");
  assert.equal(kpis["pricing-floor"].value, "47 / 47");
  assert.equal(overview.quickActions.find((item) => item.id === "weekly-usage")?.label, "View Beverage Trends");
});

test("stale plans hide order, prep, and cost numbers instead of presenting old quantities", () => {
  const signals = readySignals();
  signals.weeklyPlan.readiness = {
    status: "stale",
    label: "Refresh required",
    staleReasons: ["Weekly Usage changed after these recommendations were generated."],
  };

  const overview = buildDashboardOverview(signals, { now });
  const kpis = Object.fromEntries(overview.kpis.map((item) => [item.id, item]));

  assert.equal(overview.status, "critical");
  assert.equal(overview.planNumbersAvailable, false);
  assert.equal(overview.alerts[0].id, "weekly-plan-stale");
  assert.match(overview.alerts[0].message, /Weekly Usage changed/);
  assert.equal(kpis["items-to-order"].value, "—");
  assert.equal(kpis["cocktails-to-make"].value, "—");
  assert.equal(kpis["purchase-cost"].value, "—");
  assert.equal(kpis["items-to-order"].rawValue, null);
  assert.equal(overview.quickActions[0].label, "Fix Weekly Plan");
});

test("partial Weekly Usage keeps lowest-pour claims guarded while using comparable taps for movement", () => {
  const signals = readySignals();
  signals.usage.performance.capturedCount = 94;
  signals.usage.performance.comparableCount = 90;
  signals.usage.performance.currentComplete = false;
  signals.usage.performance.trendComplete = false;
  signals.usage.performance.excludedComparisonTaps = [
    { tapNumber: 91, name: "New tap", reason: "No prior-week usage was saved." },
  ];

  const overview = buildDashboardOverview(signals, { now });
  const alert = overview.alerts.find((item) => item.id === "weekly-usage-partial");
  const coverage = overview.kpis.find((item) => item.id === "usage-coverage");

  assert.ok(alert);
  assert.equal(alert.severity, "warning");
  assert.match(alert.message, /94 of 102/);
  assert.match(alert.message, /Highest-poured results describe captured taps only/);
  assert.match(alert.message, /lowest-poured rankings stay withheld/);
  assert.match(alert.message, /Weekly movement uses the 90 taps captured in both weeks/);
  assert.match(alert.details[0], /Tap 91.*No prior-week usage/i);
  assert.equal(coverage.value, "94 / 102");
  assert.equal(coverage.confidence, "partial");
  assert.match(coverage.detail, /90 taps comparable/);
  assert.equal(overview.planNumbersAvailable, false);
});

test("a complete current week does not alert for expected new-tap exclusions", () => {
  const signals = readySignals();
  signals.usage.performance.comparableCount = 100;
  signals.usage.performance.trendComplete = false;
  signals.usage.performance.excludedComparisonTaps = [
    { tapNumber: 101, name: "New Cocktail", likelyNewTap: true, reason: "No prior-week or older PMB usage is saved; this may be a new tap." },
    { tapNumber: 102, name: "New Cocktail 2", likelyNewTap: true, reason: "No prior-week or older PMB usage is saved; this may be a new tap." },
  ];

  const overview = buildDashboardOverview(signals, { now });
  const alert = overview.alerts.find((item) => item.id === "weekly-usage-trend-incomplete");
  const coverage = overview.kpis.find((item) => item.id === "usage-coverage");

  assert.equal(alert, undefined);
  assert.match(coverage.detail, /100 taps comparable/);
});

test("a real reporting gap still produces a week-over-week alert when new taps are also present", () => {
  const signals = readySignals();
  signals.usage.performance.comparableCount = 99;
  signals.usage.performance.trendComplete = false;
  signals.usage.performance.excludedComparisonTaps = [
    { tapNumber: 100, name: "Established Gap", reason: "Prior week PMB usage is missing even though older PMB history exists." },
    { tapNumber: 101, name: "New Cocktail", likelyNewTap: true, reason: "No prior-week or older PMB usage is saved; this may be a new tap." },
    { tapNumber: 102, name: "New Cocktail 2", likelyNewTap: true, reason: "No prior-week or older PMB usage is saved; this may be a new tap." },
  ];

  const overview = buildDashboardOverview(signals, { now });
  const alert = overview.alerts.find((item) => item.id === "weekly-usage-trend-incomplete");

  assert.equal(alert.title, "Week-over-week comparison excludes 1 tap");
  assert.equal(alert.details.length, 1);
  assert.match(alert.details[0], /Established Gap/);
  assert.doesNotMatch(alert.details[0], /New Cocktail/);
});

test("shared setup failures alert without a duplicate shared-save warning", () => {
  const signals = readySignals();
  signals.shared = {
    dashboard: { available: false, initialized: false },
    inventory: {
      available: true,
      initialized: true,
      saveError: "Revision conflict",
      hasOutbox: true,
    },
    weeklyUsage: { available: true, initialized: false },
    kegLevels: {
      available: true,
      initialized: true,
      savePending: true,
      durable: false,
    },
  };

  const overview = buildDashboardOverview(signals, { now });
  const ids = overview.alerts.map((item) => item.id);

  assert.equal(overview.status, "critical");
  assert.equal(overview.planNumbersAvailable, false);
  assert.deepEqual(ids.slice(0, 2), [
    "shared-state-unavailable",
    "shared-setup-incomplete",
  ]);
  assert.ok(!ids.includes("shared-save-failed"));
  assert.ok(!ids.includes("shared-changes-pending"), "failed saves should not also be presented as ordinary in-progress saves");
});

test("shared save recovery issues stay in their workspace instead of creating a dashboard alert", () => {
  const signals = readySignals();
  signals.shared.inventory = {
    available: true,
    initialized: true,
    saveError: "Revision conflict",
    hasOutbox: true,
  };

  const overview = buildDashboardOverview(signals, { now });

  assert.ok(!overview.alerts.some((item) => item.id === "shared-save-failed"));
  assert.ok(!overview.alerts.some((item) => item.title === "Shared changes are not safely published"));
  assert.equal(overview.planNumbersAvailable, true);
});

test("dashboard-only setup does not create an alert or hide weekly plan numbers", () => {
  const signals = readySignals();
  signals.shared.dashboard = {
    available: true,
    initialized: false,
    setupActionAvailable: true,
  };

  const overview = buildDashboardOverview(signals, { now });

  assert.ok(!overview.alerts.some((item) => item.id === "shared-dashboard-setup-incomplete"));
  assert.ok(!overview.alerts.some((item) => item.id === "shared-setup-incomplete"));
  assert.equal(overview.planNumbersAvailable, true);
});

test("a refresh error without unpublished changes is not mislabeled as a shared-save failure", () => {
  const signals = readySignals();
  signals.shared.kegLevels = {
    available: true,
    initialized: true,
    saveError: "Weekly Plan refresh failed.",
    savePending: false,
  };

  const overview = buildDashboardOverview(signals, { now });

  assert.ok(!overview.alerts.some((item) => item.id === "shared-save-failed"));
  assert.equal(overview.planNumbersAvailable, true);
});

test("a blocked dashboard import still does not create a setup alert", () => {
  const signals = readySignals();
  signals.shared.dashboard = {
    available: true,
    initialized: false,
    setupMessage: "Shared setup is not initialized, and import is blocked because this browser has no saved non-default configuration.",
    setupActionAvailable: false,
  };

  const overview = buildDashboardOverview(signals, { now });

  assert.ok(!overview.alerts.some((item) => item.id === "shared-dashboard-setup-incomplete"));
  assert.equal(overview.planNumbersAvailable, true);
});

test("partial PMB keg reads are critical and never interpret missing rows as zero", () => {
  const signals = readySignals();
  signals.pmb.kegLevels = {
    status: "online",
    capturedCount: 101,
    expectedCount: 102,
    updatedAt: "2026-08-12T11:30:00.000Z",
  };

  const overview = buildDashboardOverview(signals, { now });
  const alert = overview.alerts.find((item) => item.id === "pmb-keg-levels-partial");

  assert.ok(alert);
  assert.equal(alert.severity, "critical");
  assert.match(alert.message, /101 of 102/);
  assert.match(alert.message, /not treated as empty or zero/);
  assert.equal(overview.planNumbersAvailable, false);
});

test("offline price sync suppresses advisor claims while keeping the owner action visible", () => {
  const signals = readySignals();
  signals.pmb.pricing = {
    status: "offline",
    error: "Connect from the work network.",
  };
  signals.pricing.advisorSummary.priceChangeCount = 4;
  signals.pricing.advisorSummary.onTargetCount = 43;

  const overview = buildDashboardOverview(signals, { now });
  const alertIds = overview.alerts.map((item) => item.id);
  const pricingKpi = overview.kpis.find((item) => item.id === "pricing-floor");
  const pricingAction = overview.quickActions.find((item) => item.id === "pricing");

  assert.ok(alertIds.includes("pmb-pricing-offline"));
  assert.ok(!alertIds.includes("pricing-below-floor"), "stale/offline advisor counts must not be promoted as current");
  assert.equal(pricingKpi.value, "—");
  assert.equal(pricingKpi.confidence, "unavailable");
  assert.equal(pricingAction.label, "Check Tap Pricing");
  assert.equal(pricingAction.target, DASHBOARD_OVERVIEW_TARGETS.pricing);
});

test("one PMB connection alert replaces duplicate keg-level and pricing failures", () => {
  const signals = readySignals();
  signals.pmb.kegLevels = {
    status: "offline",
    error: "Could not connect to PMB.",
  };
  signals.pmb.pricing = {
    status: "offline",
    error: "Could not connect to PMB.",
  };

  const overview = buildDashboardOverview(signals, { now });
  const pmbAlerts = overview.alerts.filter((item) => item.id.startsWith("pmb-"));

  assert.equal(pmbAlerts.length, 1);
  assert.equal(pmbAlerts[0].id, "pmb-connection-offline");
  assert.equal(pmbAlerts[0].severity, "critical");
  assert.match(pmbAlerts[0].message, /keg levels and tap pricing/i);
  assert.deepEqual(pmbAlerts[0].details, ["Could not connect to PMB."]);
  assert.equal(pmbAlerts[0].action.label, "Retry PMB Connection");
  assert.equal(overview.planNumbersAvailable, false);
});

test("a pricing-only PMB failure keeps its specific alert", () => {
  const signals = readySignals();
  signals.pmb.pricing = {
    status: "offline",
    error: "Could not load current prices.",
  };

  const overview = buildDashboardOverview(signals, { now });

  assert.ok(overview.alerts.some((item) => item.id === "pmb-pricing-offline"));
  assert.ok(!overview.alerts.some((item) => item.id === "pmb-connection-offline"));
});

test("deferred cocktail ingredient netting stays explicit without a duplicate alert", () => {
  const signals = readySignals();
  delete signals.deferred;

  const overview = buildDashboardOverview(signals, { now });
  const cocktailKpi = overview.kpis.find((item) => item.id === "cocktails-to-make");

  assert.equal(overview.alerts.some((item) => item.id === "deferred-order-netting"), false);
  assert.match(cocktailKpi.detail, /ingredient netting deferred/);
  assert.equal(overview.status, "ready", "a disclosed deferred feature is not a false blocker or duplicate alert");
});

test("timestamps use the supplied clock to identify stale plan and PMB signals", () => {
  const signals = readySignals();
  signals.weeklyPlan.generatedAt = "2026-08-01T10:00:00.000Z";
  signals.pmb.kegLevels.updatedAt = "2026-08-10T09:00:00.000Z";
  signals.pmb.pricing.updatedAt = "2026-08-10T09:00:00.000Z";
  signals.usage.lastSyncAt = "2026-08-01T09:00:00.000Z";

  const overview = buildDashboardOverview(signals, {
    now,
    planStaleAfterDays: 8,
    kegLevelFreshAfterHours: 24,
    pricingFreshAfterHours: 24,
    usageFreshAfterDays: 8,
  });
  const ids = overview.alerts.map((item) => item.id);

  assert.ok(ids.includes("weekly-plan-age-stale"));
  assert.ok(ids.includes("pmb-keg-levels-stale"));
  assert.ok(ids.includes("pmb-pricing-stale"));
  assert.ok(ids.includes("weekly-usage-stale"));
  assert.equal(overview.planNumbersAvailable, false);
});

test("adds operational alerts and stable action targets for recipes and pricing", () => {
  const signals = readySignals();
  signals.recipes.missingRecipeCount = 2;
  signals.products.pendingPublishCount = 3;
  signals.pricing.advisorSummary.priceChangeCount = 1;
  signals.pricing.advisorSummary.onTargetCount = 46;

  const overview = buildDashboardOverview(signals, { now });
  const byId = Object.fromEntries(overview.alerts.map((item) => [item.id, item]));

  assert.equal(byId["pricing-below-floor"].action.target, DASHBOARD_OVERVIEW_TARGETS.pricing);
  assert.match(byId["pricing-below-floor"].message, /never recommends lowering/);
  assert.equal(byId["recipe-coverage-missing"].action.target, DASHBOARD_OVERVIEW_TARGETS.recipes);
  assert.equal(byId["pmb-products-pending"], undefined);
  assert.equal(overview.quickActions.find((item) => item.id === "recipes")?.label, "Add Missing Recipe Cards");
});

test("a delivery item marked not received creates an owner dashboard alert", () => {
  const signals = readySignals();
  signals.orders = {
    notReceivedItems: [{
      vendor: "Heidelberg",
      name: "Bud Light",
      quantity: 2,
      receivedQuantity: 0,
      missingQuantity: 2,
      unit: "kegs",
      handledBy: "Jordan",
    }],
  };

  const overview = buildDashboardOverview(signals, { now });
  const alert = overview.alerts.find((item) => item.id === "weekly-order-not-received");

  assert.equal(alert.severity, "critical");
  assert.match(alert.title, /1 ordered item was short or not received/);
  assert.match(alert.details[0], /Heidelberg.*Bud Light.*0 of 2 kegs received.*2 missing.*Jordan/);
  assert.equal(alert.action.target, DASHBOARD_OVERVIEW_TARGETS.weeklyPlan);
});

test("a locked Monday plan keeps its numbers when later keg levels are unavailable", () => {
  const signals = readySignals();
  signals.weeklyPlan.lockedForWeek = true;
  signals.pmb.kegLevels = {
    status: "offline",
    error: "PMB is temporarily unavailable.",
  };

  const overview = buildDashboardOverview(signals, { now });
  const kpis = Object.fromEntries(overview.kpis.map((item) => [item.id, item]));

  assert.ok(overview.alerts.some((item) => item.id === "pmb-keg-levels-offline"));
  assert.equal(overview.planNumbersAvailable, true);
  assert.equal(kpis["items-to-order"].value, "9");
  assert.equal(kpis["cocktails-to-make"].value, "3");
});

test("a locked Monday plan keeps its numbers when later usage, inventory, or shared checks change", () => {
  const signals = readySignals();
  signals.weeklyPlan.lockedForWeek = true;
  signals.weeklyPlan.generatedAt = "2026-08-10T10:00:00.000Z";
  signals.usage.performance.currentComplete = false;
  signals.inventory.missingCurrentCount = 3;
  signals.shared.kegLevels.available = false;

  const overview = buildDashboardOverview(signals, {
    now: "2026-08-16T18:00:00.000Z",
    planStaleAfterDays: 1,
  });

  assert.equal(overview.planNumbersAvailable, true);
  assert.equal(overview.kpis.find((item) => item.id === "items-to-order")?.value, "9");
  assert.equal(overview.alerts.some((item) => item.id === "weekly-plan-age-stale"), false);
  assert.ok(overview.alerts.some((item) => item.id === "shared-state-unavailable"));
  assert.ok(overview.alerts.some((item) => item.id === "inventory-counts-missing"));
});

test("alert sorting is severity-first, then priority, then stable id", () => {
  const sorted = sortDashboardOverviewAlerts([
    { id: "z", severity: "warning", priority: 2 },
    { id: "b", severity: "critical", priority: 1 },
    { id: "a", severity: "critical", priority: 1 },
    { id: "i", severity: "info", priority: 0 },
  ]);

  assert.deepEqual(sorted.map((item) => item.id), ["a", "b", "z", "i"]);
});

test("the view model fails closed when no source signals have been checked", () => {
  const overview = buildDashboardOverview({}, { now });
  const ids = overview.alerts.map((item) => item.id);

  assert.equal(overview.status, "critical");
  assert.equal(overview.planNumbersAvailable, false);
  assert.ok(ids.includes("shared-state-unavailable"));
  assert.ok(ids.includes("weekly-plan-unchecked"));
  assert.ok(ids.includes("pmb-keg-levels-unchecked"));
  assert.ok(ids.includes("weekly-usage-unavailable"));
  assert.ok(ids.includes("pmb-pricing-unchecked"));
  assert.equal(overview.kpis.find((item) => item.id === "items-to-order")?.value, "—");
});
