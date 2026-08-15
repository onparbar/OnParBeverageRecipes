const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export const DASHBOARD_OVERVIEW_TARGETS = Object.freeze({
  sharedDashboardSetup: "shared-dashboard-setup",
  weeklyPlan: "weekly-plan",
  kegLevels: "keg-levels",
  pricing: "pricing",
  inventory: "inventory",
  weeklyUsage: "weekly-usage",
  recipes: "recipes",
  addProduct: "add",
});

const SHARED_SOURCE_DEFINITIONS = Object.freeze([
  { key: "dashboard", label: "Dashboard setup", target: DASHBOARD_OVERVIEW_TARGETS.sharedDashboardSetup },
  { key: "inventory", label: "Inventory", target: DASHBOARD_OVERVIEW_TARGETS.inventory },
  { key: "weeklyUsage", label: "Weekly Usage", target: DASHBOARD_OVERVIEW_TARGETS.weeklyUsage },
  { key: "kegLevels", label: "Keg Levels", target: DASHBOARD_OVERVIEW_TARGETS.kegLevels },
]);

const ALERT_SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, info: 2 });
const VALID_PLAN_STATUSES = new Set(["ready", "review", "stale", "blocked"]);
const VALID_FEED_STATUSES = new Set(["online", "partial", "offline", "loading", "not-checked", "stale"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function count(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function nonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseTime(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : 0;
  }
  const time = new Date(value || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function formatCount(value) {
  return count(value).toLocaleString("en-US");
}

function formatQuantity(value) {
  const amount = nonNegativeNumber(value);
  return amount.toLocaleString("en-US", {
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  });
}

function formatCurrency(value) {
  return nonNegativeNumber(value).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function plural(value, singular, pluralValue = `${singular}s`) {
  return count(value) === 1 ? singular : pluralValue;
}

function cleanList(values) {
  return (Array.isArray(values) ? values : []).map(clean).filter(Boolean);
}

function joinLabels(values) {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function makeAction(label, target) {
  return { label, target };
}

function makeAlert({
  id,
  severity,
  priority,
  title,
  message,
  details = [],
  action,
}) {
  return {
    id,
    severity,
    priority,
    title,
    message,
    details: cleanList(details),
    action,
  };
}

export function sortDashboardOverviewAlerts(alerts = []) {
  return [...alerts].sort((left, right) => (
    (ALERT_SEVERITY_RANK[left.severity] ?? 99) - (ALERT_SEVERITY_RANK[right.severity] ?? 99)
    || Number(left.priority || 0) - Number(right.priority || 0)
    || clean(left.id).localeCompare(clean(right.id))
  ));
}

function normalizeSharedSource(definition, rawSource) {
  const source = rawSource && typeof rawSource === "object" ? rawSource : {};
  const checked = source.checked === true
    || Object.hasOwn(source, "initialized")
    || Object.hasOwn(source, "provisioned")
    || Object.hasOwn(source, "available");
  const available = checked
    && source.available !== false
    && source.provisioned !== false;
  const initialized = available && source.initialized === true;
  const saveError = clean(source.saveError || source.error);
  const unsavedCount = Math.max(
    count(source.unsavedCount),
    count(source.outboxCount),
    source.hasOutbox === true ? 1 : 0,
  );
  const savePending = source.savePending === true || source.saving === true || unsavedCount > 0;

  return {
    ...definition,
    checked,
    available,
    initialized,
    saveError,
    savePending,
    unsavedCount,
    durable: source.durable !== false,
    setupMessage: clean(source.setupMessage),
    setupActionAvailable: source.setupActionAvailable === true,
  };
}

function normalizeFeed(rawFeed = {}) {
  const feed = rawFeed && typeof rawFeed === "object" ? rawFeed : {};
  const capturedCount = count(feed.capturedCount ?? feed.returnedCount ?? feed.matchedCount);
  const expectedCount = count(feed.expectedCount ?? feed.totalCount ?? feed.eligibleCount);
  const coveragePartial = feed.complete === false
    || (expectedCount > 0 && capturedCount < expectedCount);
  let status = clean(feed.status).toLowerCase();

  if (!VALID_FEED_STATUSES.has(status)) status = "";
  if (feed.loading === true) status = "loading";
  else if (feed.online === false || clean(feed.error)) status = "offline";
  else if (coveragePartial) status = "partial";
  else if (!status && (feed.online === true || clean(feed.updatedAt))) status = "online";
  else if (!status) status = "not-checked";

  return {
    status,
    capturedCount,
    expectedCount,
    updatedAt: clean(feed.updatedAt),
    error: clean(feed.error),
  };
}

function getFeedCoverageText(feed) {
  return feed.expectedCount > 0
    ? `${formatCount(feed.capturedCount)} of ${formatCount(feed.expectedCount)}`
    : `${formatCount(feed.capturedCount)}`;
}

function getAgeState(timestamp, nowTime, maxAgeMs) {
  const time = parseTime(timestamp);
  if (!time || !nowTime || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return "unknown";
  return nowTime - time > maxAgeMs ? "stale" : "current";
}

function getPlanState(weeklyPlan, nowTime, staleAfterDays) {
  const readiness = weeklyPlan?.readiness && typeof weeklyPlan.readiness === "object"
    ? weeklyPlan.readiness
    : {};
  const status = VALID_PLAN_STATUSES.has(clean(readiness.status).toLowerCase())
    ? clean(readiness.status).toLowerCase()
    : "unknown";
  const generatedAt = clean(weeklyPlan?.generatedAt || readiness.generatedAt);
  const ageState = generatedAt
    ? getAgeState(generatedAt, nowTime, nonNegativeNumber(staleAfterDays) * DAY_MS)
    : "unknown";
  const lockedForWeek = weeklyPlan?.lockedForWeek === true;
  const ageStale = !lockedForWeek && ageState === "stale";
  const details = [
    ...cleanList(readiness.blockers),
    ...cleanList(readiness.staleReasons),
    ...cleanList(readiness.reviewReasons),
  ];

  return {
    readiness,
    status,
    label: clean(readiness.label) || ({
      ready: "Ready to order",
      review: "Ready with review",
      stale: "Refresh required",
      blocked: "Not ready to order",
      unknown: "Not checked",
    })[status],
    details,
    generatedAt,
    ageStale,
    lockedForWeek,
    actionable: ["ready", "review"].includes(status) && !ageStale,
  };
}

function getUsageState(rawUsage = {}) {
  const usage = rawUsage && typeof rawUsage === "object" ? rawUsage : {};
  const performance = usage.performance && typeof usage.performance === "object"
    ? usage.performance
    : usage;
  const eligibleCount = count(performance.eligibleCount);
  const capturedCount = count(performance.capturedCount);
  const latestLabel = clean(performance.latestLabel);
  const previousLabel = clean(performance.previousLabel);
  const hasCurrentPeriod = Boolean(latestLabel) && eligibleCount > 0;
  const currentComplete = hasCurrentPeriod
    && performance.currentComplete === true
    && capturedCount >= eligibleCount;
  const comparableCount = Math.min(eligibleCount, count(performance.comparableCount));
  const excludedComparisonTaps = (Array.isArray(performance.excludedComparisonTaps)
    ? performance.excludedComparisonTaps
    : [])
    .map((item) => ({
      tapNumber: count(item?.tapNumber),
      name: clean(item?.name),
      reason: clean(item?.reason),
      likelyNewTap: item?.likelyNewTap === true,
    }))
    .filter((item) => item.tapNumber || item.name || item.reason);

  return {
    initialized: usage.initialized !== false,
    eligibleCount,
    capturedCount,
    latestLabel,
    previousLabel,
    hasCurrentPeriod,
    currentComplete,
    trendComplete: currentComplete && performance.trendComplete === true,
    comparableCount,
    excludedComparisonTaps,
    totalCurrentOz: nonNegativeNumber(performance.totalCurrentOz),
    totalTrendOz: Number.isFinite(Number(performance.totalTrendOz))
      ? Number(performance.totalTrendOz)
      : null,
    totalTrendPercent: Number.isFinite(Number(performance.totalTrendPercent))
      ? Number(performance.totalTrendPercent)
      : null,
    lastSyncAt: clean(usage.lastSyncAt || usage.updatedAt || performance.updatedAt),
  };
}

function getPricingState(rawPricing = {}) {
  const pricing = rawPricing && typeof rawPricing === "object" ? rawPricing : {};
  const summary = pricing.advisorSummary && typeof pricing.advisorSummary === "object"
    ? pricing.advisorSummary
    : pricing.summary && typeof pricing.summary === "object"
      ? pricing.summary
      : pricing;
  return {
    total: count(summary.total),
    belowFloorCount: count(summary.priceChangeCount ?? summary.belowFloorCount),
    onTargetCount: count(summary.onTargetCount),
    reviewCount: count(summary.reviewCount),
    blockedCount: count(summary.blockedCount),
    targetMarginPercent: nonNegativeNumber(pricing.targetMarginPercent || summary.targetMarginPercent || 82),
  };
}

function buildSharedAlerts(sharedSources) {
  const alerts = [];
  const unavailable = sharedSources.filter((source) => !source.checked || !source.available);
  const uninitialized = sharedSources.filter((source) => source.available && !source.initialized);
  const uninitializedOperations = uninitialized.filter((source) => source.key !== "dashboard");
  const pending = sharedSources.filter((source) => source.savePending && !source.saveError && source.durable);

  if (unavailable.length) {
    const labels = unavailable.map((source) => source.label);
    alerts.push(makeAlert({
      id: "shared-state-unavailable",
      severity: "critical",
      priority: 20,
      title: "Shared data could not be verified",
      message: `${joinLabels(labels)} ${unavailable.length === 1 ? "is" : "are"} unavailable or not yet checked. Treat local values as unconfirmed until shared storage is reachable.`,
      action: makeAction("Check shared data", unavailable[0].target),
    }));
  }

  if (uninitializedOperations.length) {
    const labels = uninitializedOperations.map((source) => source.label);
    alerts.push(makeAlert({
      id: "shared-setup-incomplete",
      severity: "critical",
      priority: 30,
      title: "Shared setup is incomplete",
      message: `${joinLabels(labels)} ${uninitializedOperations.length === 1 ? "still needs" : "still need"} the one-time service-computer import. Weekly ordering is not reliable until setup is complete.`,
      action: makeAction("Finish shared setup", uninitializedOperations[0].target),
    }));
  }

  if (pending.length) {
    const labels = pending.map((source) => source.label);
    alerts.push(makeAlert({
      id: "shared-changes-pending",
      severity: "warning",
      priority: 40,
      title: "Shared changes are still saving",
      message: `${joinLabels(labels)} ${pending.length === 1 ? "has" : "have"} unpublished changes. Wait for confirmation before ordering or switching devices.`,
      action: makeAction("Review pending changes", pending[0].target),
    }));
  }

  return {
    alerts,
    blocksPlanNumbers: unavailable.length > 0
      || uninitializedOperations.length > 0
      || pending.length > 0,
  };
}

function buildPlanAlerts(planState, staleAfterDays) {
  if (planState.status === "unknown") {
    return [makeAlert({
      id: "weekly-plan-unchecked",
      severity: "critical",
      priority: 50,
      title: "Weekly Plan readiness has not been checked",
      message: "Order and prep quantities stay unavailable until the required shared inputs and recommendation freshness are evaluated.",
      action: makeAction("Check Weekly Plan", DASHBOARD_OVERVIEW_TARGETS.weeklyPlan),
    })];
  }

  if (planState.status === "blocked") {
    return [makeAlert({
      id: "weekly-plan-blocked",
      severity: "critical",
      priority: 50,
      title: "Weekly Plan is not ready to order",
      message: planState.details[0] || "A required ordering input is incomplete.",
      details: planState.details,
      action: makeAction("Fix Weekly Plan", DASHBOARD_OVERVIEW_TARGETS.weeklyPlan),
    })];
  }

  if (planState.status === "stale") {
    return [makeAlert({
      id: "weekly-plan-stale",
      severity: "critical",
      priority: 50,
      title: "Weekly Plan must be refreshed",
      message: planState.details[0] || "The saved order and prep recommendations are stale, so their quantities should not be used.",
      details: planState.details,
      action: makeAction("Refresh Weekly Plan", DASHBOARD_OVERVIEW_TARGETS.weeklyPlan),
    })];
  }

  if (planState.ageStale) {
    return [makeAlert({
      id: "weekly-plan-age-stale",
      severity: "critical",
      priority: 50,
      title: "Weekly Plan is too old to use",
      message: `The recommendations are more than ${formatQuantity(staleAfterDays)} days old. Refresh them before ordering.`,
      action: makeAction("Refresh Weekly Plan", DASHBOARD_OVERVIEW_TARGETS.weeklyPlan),
    })];
  }

  if (planState.status === "review") {
    return [makeAlert({
      id: "weekly-plan-review",
      severity: "warning",
      priority: 50,
      title: "Weekly Plan is ready with review items",
      message: planState.details[0] || "At least one held, excluded, or missing-price item needs an owner review.",
      details: planState.details,
      action: makeAction("Review Weekly Plan", DASHBOARD_OVERVIEW_TARGETS.weeklyPlan),
    })];
  }

  return [];
}

function buildKegLevelAlerts(feed, ageState) {
  if (feed.status === "loading") {
    return [makeAlert({
      id: "pmb-keg-levels-loading",
      severity: "info",
      priority: 60,
      title: "PMB keg levels are refreshing",
      message: "Live quantities remain unconfirmed until the refresh finishes.",
      action: makeAction("Open Keg Levels", DASHBOARD_OVERVIEW_TARGETS.kegLevels),
    })];
  }
  if (feed.status === "partial") {
    const coverage = feed.expectedCount > 0 ? `${getFeedCoverageText(feed)} expected taps returned data.` : "Some expected taps did not return data.";
    return [makeAlert({
      id: "pmb-keg-levels-partial",
      severity: "critical",
      priority: 60,
      title: "PMB keg-level coverage is partial",
      message: `${coverage} Missing PMB rows are not treated as empty or zero.`,
      action: makeAction("Retry Keg Levels", DASHBOARD_OVERVIEW_TARGETS.kegLevels),
    })];
  }
  if (feed.status === "offline") {
    return [makeAlert({
      id: "pmb-keg-levels-offline",
      severity: "critical",
      priority: 60,
      title: "Live PMB keg levels are unavailable",
      message: feed.error || "Current keg quantities could not be verified. Previously loaded levels must not be assumed current.",
      action: makeAction("Retry Keg Levels", DASHBOARD_OVERVIEW_TARGETS.kegLevels),
    })];
  }
  if (feed.status === "not-checked") {
    return [makeAlert({
      id: "pmb-keg-levels-unchecked",
      severity: "critical",
      priority: 60,
      title: "Live PMB keg levels have not been checked",
      message: "Refresh from the work network before relying on current keg quantities.",
      action: makeAction("Refresh Keg Levels", DASHBOARD_OVERVIEW_TARGETS.kegLevels),
    })];
  }
  if (feed.status === "stale" || ageState === "stale") {
    return [makeAlert({
      id: "pmb-keg-levels-stale",
      severity: "critical",
      priority: 60,
      title: "Live keg levels are stale",
      message: "Refresh PMB before using the displayed keg quantities for this week's plan.",
      action: makeAction("Refresh Keg Levels", DASHBOARD_OVERVIEW_TARGETS.kegLevels),
    })];
  }
  return [];
}

function buildUsageAlerts(usage, ageState) {
  const alerts = [];
  const newTapExclusions = usage.excludedComparisonTaps.filter((item) => item.likelyNewTap);
  const actionableExclusions = usage.excludedComparisonTaps.filter((item) => !item.likelyNewTap);
  const excludedCount = Math.max(
    actionableExclusions.length,
    usage.eligibleCount - usage.comparableCount - newTapExclusions.length,
  );
  const exclusionDetails = actionableExclusions.map((item) => {
    const identity = [item.tapNumber ? `Tap ${formatCount(item.tapNumber)}` : "", item.name]
      .filter(Boolean)
      .join(" · ");
    return [identity, item.reason].filter(Boolean).join(": ");
  });
  const partialMovementCopy = usage.comparableCount > 0
    ? `Weekly movement uses the ${formatCount(usage.comparableCount)} ${plural(usage.comparableCount, "tap")} captured in both weeks; ${formatCount(excludedCount)} ${plural(excludedCount, "tap is", "taps are")} excluded rather than treated as zero.`
    : "No tap has usable PMB ounces in both weeks, so weekly movement is unavailable.";
  if (!usage.initialized || !usage.hasCurrentPeriod) {
    alerts.push(makeAlert({
      id: "weekly-usage-unavailable",
      severity: "warning",
      priority: 70,
      title: "Weekly Usage is not ready for trends",
      message: "A complete current PMB week is not available. Rankings and week-over-week conclusions should stay unavailable.",
      action: makeAction("Update Weekly Usage", DASHBOARD_OVERVIEW_TARGETS.weeklyUsage),
    }));
    return alerts;
  }

  if (!usage.currentComplete) {
    alerts.push(makeAlert({
      id: "weekly-usage-partial",
      severity: "warning",
      priority: 70,
      title: "Weekly Usage coverage is partial",
      message: `${formatCount(usage.capturedCount)} of ${formatCount(usage.eligibleCount)} active PMB taps have data for ${usage.latestLabel}. Highest-poured results describe captured taps only and lowest-poured rankings stay withheld. ${partialMovementCopy}`,
      details: exclusionDetails,
      action: makeAction("Complete Weekly Usage", DASHBOARD_OVERVIEW_TARGETS.weeklyUsage),
    }));
  } else if (!usage.trendComplete && (!usage.previousLabel || excludedCount > 0)) {
    alerts.push(makeAlert({
      id: "weekly-usage-trend-incomplete",
      severity: "warning",
      priority: 72,
      title: usage.comparableCount > 0
        ? `Week-over-week comparison excludes ${formatCount(excludedCount)} ${plural(excludedCount, "tap")}`
        : "Week-over-week trend coverage is incomplete",
      message: usage.previousLabel
        ? partialMovementCopy
        : "The current PMB week is complete, but there is not yet a complete prior PMB week for comparison.",
      details: exclusionDetails,
      action: makeAction("Review Beverage Trends", DASHBOARD_OVERVIEW_TARGETS.weeklyUsage),
    }));
  }

  if (ageState === "stale") {
    alerts.push(makeAlert({
      id: "weekly-usage-stale",
      severity: "warning",
      priority: 74,
      title: "Weekly Usage has not been refreshed recently",
      message: "Pull the latest completed Monday-Sunday PMB report before using usage trends for this week's decisions.",
      action: makeAction("Refresh Weekly Usage", DASHBOARD_OVERVIEW_TARGETS.weeklyUsage),
    }));
  }
  return alerts;
}

function buildPricingAlerts(feed, feedAgeState, pricing) {
  const alerts = [];
  const priceFeedCurrent = feed.status === "online" && feedAgeState !== "stale";

  if (feed.status === "loading") {
    alerts.push(makeAlert({
      id: "pmb-pricing-loading",
      severity: "info",
      priority: 80,
      title: "PMB tap pricing is refreshing",
      message: "Margin checks and live price controls remain unverified until the refresh completes.",
      action: makeAction("Open Tap Pricing", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  } else if (feed.status === "partial") {
    alerts.push(makeAlert({
      id: "pmb-pricing-partial",
      severity: "warning",
      priority: 80,
      title: "PMB tap-price coverage is partial",
      message: `${getFeedCoverageText(feed)} current tap prices were verified. Unmatched rows must not be treated as current.`,
      action: makeAction("Retry Tap Pricing", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  } else if (feed.status === "offline") {
    alerts.push(makeAlert({
      id: "pmb-pricing-offline",
      severity: "warning",
      priority: 80,
      title: "Tap pricing is offline",
      message: feed.error || "Current PMB prices cannot be verified, and live price updates are unavailable. Stored dashboard calculations may not reflect the wall.",
      action: makeAction("Retry Tap Pricing", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  } else if (feed.status === "not-checked") {
    alerts.push(makeAlert({
      id: "pmb-pricing-unchecked",
      severity: "warning",
      priority: 80,
      title: "Current tap pricing has not been checked",
      message: "Connect from the work network to verify PMB prices before using margin advice or live price controls.",
      action: makeAction("Check Tap Pricing", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  } else if (feed.status === "stale" || feedAgeState === "stale") {
    alerts.push(makeAlert({
      id: "pmb-pricing-stale",
      severity: "warning",
      priority: 80,
      title: "Tap pricing needs a fresh PMB check",
      message: "The last verified wall-price read is too old for current margin advice or live updates.",
      action: makeAction("Refresh Tap Pricing", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  }

  if (priceFeedCurrent && pricing.belowFloorCount > 0) {
    alerts.push(makeAlert({
      id: "pricing-below-floor",
      severity: "warning",
      priority: 82,
      title: `${formatCount(pricing.belowFloorCount)} ${plural(pricing.belowFloorCount, "tap is", "taps are")} below the ${formatQuantity(pricing.targetMarginPercent)}% floor`,
      message: "The advisor recommends increases for verified beer and cocktail taps only. It never recommends lowering a price.",
      action: makeAction("Review Pricing Advice", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  }

  if (priceFeedCurrent && pricing.blockedCount > 0) {
    alerts.push(makeAlert({
      id: "pricing-checks-blocked",
      severity: "warning",
      priority: 84,
      title: `${formatCount(pricing.blockedCount)} pricing ${plural(pricing.blockedCount, "check needs", "checks need")} data`,
      message: "A missing cost, price, or verified PMB identity prevents a safe margin recommendation.",
      action: makeAction("Review Tap Pricing", DASHBOARD_OVERVIEW_TARGETS.pricing),
    }));
  }

  return { alerts, priceFeedCurrent };
}

function combinePmbConnectionAlerts({
  kegFeed,
  kegAlerts,
  pricingFeed,
  pricingResult,
}) {
  if (kegFeed.status !== "offline" || pricingFeed.status !== "offline") {
    return [...kegAlerts, ...pricingResult.alerts];
  }

  const connectionDetails = [...new Set([
    clean(kegFeed.error),
    clean(pricingFeed.error),
  ].filter(Boolean))];

  return [makeAlert({
    id: "pmb-connection-offline",
    severity: "critical",
    priority: 60,
    title: "PMB connection is unavailable",
    message: "Live keg levels and tap pricing could not be refreshed. Saved information remains visible, but treat it as unverified until PMB reconnects.",
    details: connectionDetails,
    action: makeAction("Retry PMB Connection", DASHBOARD_OVERVIEW_TARGETS.kegLevels),
  })];
}

function buildKpis({
  planState,
  summary,
  planNumbersAvailable,
  usage,
  pricing,
  priceFeedCurrent,
  deferred,
}) {
  const orderLineCount = count(summary.orderLineCount);
  const beerKegTotal = nonNegativeNumber(summary.beerKegTotal);
  const inventoryLineCount = count(summary.inventoryLineCount);
  const cocktailBatchTotal = nonNegativeNumber(summary.cocktailBatchTotal);
  const cocktailLineCount = count(summary.cocktailLineCount);
  const estimatedKnownPurchaseCost = nonNegativeNumber(summary.estimatedKnownPurchaseCost);
  const missingPriceCount = count(summary.missingPriceCount);
  const costComplete = summary.estimatedPurchaseCostComplete === true && missingPriceCount === 0;
  const hasUsageCoverage = usage.hasCurrentPeriod;
  const pricingKnown = priceFeedCurrent && pricing.total > 0;
  const planUnavailableDetail = "Hidden until readiness, shared-save, PMB, and Weekly Usage checks are current.";

  return [
    {
      id: "order-readiness",
      label: "Order readiness",
      value: planState.label,
      rawValue: planState.status,
      detail: planState.details[0] || (planState.status === "ready"
        ? "All required Weekly Plan inputs passed their readiness checks."
        : "Open Weekly Plan for the complete readiness review."),
      tone: planState.actionable ? (planState.status === "review" ? "warning" : "positive") : "critical",
      confidence: planState.actionable ? "verified" : "unavailable",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyPlan,
    },
    {
      id: "items-to-order",
      label: "Items to order",
      value: planNumbersAvailable ? formatCount(orderLineCount) : "—",
      rawValue: planNumbersAvailable ? orderLineCount : null,
      detail: planNumbersAvailable
        ? `${formatQuantity(beerKegTotal)} beer ${plural(beerKegTotal, "keg")} · ${formatCount(inventoryLineCount)} inventory ${plural(inventoryLineCount, "line")}`
        : planUnavailableDetail,
      tone: planNumbersAvailable ? (orderLineCount > 0 ? "accent" : "neutral") : "critical",
      confidence: planNumbersAvailable ? "verified" : "unavailable",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyPlan,
    },
    {
      id: "cocktails-to-make",
      label: "Cocktails to make",
      value: planNumbersAvailable ? formatQuantity(cocktailBatchTotal) : "—",
      rawValue: planNumbersAvailable ? cocktailBatchTotal : null,
      detail: planNumbersAvailable
        ? `${formatCount(cocktailLineCount)} cocktail ${plural(cocktailLineCount, "line")}${deferred.cocktailIngredientNetting !== false ? " · batch prep only; ingredient netting deferred" : ""}`
        : planUnavailableDetail,
      tone: planNumbersAvailable ? (cocktailBatchTotal > 0 ? "accent" : "neutral") : "critical",
      confidence: planNumbersAvailable ? "verified" : "unavailable",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyPlan,
    },
    {
      id: "purchase-cost",
      label: "Estimated purchase cost",
      value: planNumbersAvailable ? formatCurrency(estimatedKnownPurchaseCost) : "—",
      rawValue: planNumbersAvailable ? estimatedKnownPurchaseCost : null,
      detail: !planNumbersAvailable
        ? planUnavailableDetail
        : costComplete
          ? "All active purchase lines have a known price."
          : `${formatCount(missingPriceCount)} active ${plural(missingPriceCount, "line is", "lines are")} unpriced; this is the known subtotal, not a complete estimate.`,
      tone: !planNumbersAvailable ? "critical" : costComplete ? "neutral" : "warning",
      confidence: !planNumbersAvailable ? "unavailable" : costComplete ? "verified" : "partial",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyPlan,
    },
    {
      id: "usage-coverage",
      label: "PMB usage coverage",
      value: hasUsageCoverage ? `${formatCount(usage.capturedCount)} / ${formatCount(usage.eligibleCount)}` : "—",
      rawValue: hasUsageCoverage ? usage.capturedCount : null,
      detail: !hasUsageCoverage
        ? "No complete current PMB week is available."
        : usage.currentComplete
          ? `${usage.latestLabel} · all active taps captured${usage.trendComplete ? " · trend comparable" : usage.comparableCount ? ` · ${formatCount(usage.comparableCount)} taps comparable` : " · no comparable prior-week taps"}`
          : `${usage.latestLabel} · partial capture; ${formatCount(usage.comparableCount)} taps comparable for movement`,
      tone: usage.currentComplete && usage.trendComplete ? "positive" : "warning",
      confidence: !hasUsageCoverage ? "unavailable" : usage.currentComplete ? (usage.trendComplete ? "verified" : "partial") : "partial",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyUsage,
    },
    {
      id: "pricing-floor",
      label: `${formatQuantity(pricing.targetMarginPercent)}% pricing floor`,
      value: pricingKnown ? `${formatCount(pricing.onTargetCount)} / ${formatCount(pricing.total)}` : "—",
      rawValue: pricingKnown ? pricing.onTargetCount : null,
      detail: !pricingKnown
        ? "Requires a current PMB price read before advisor counts can be trusted."
        : `${formatCount(pricing.belowFloorCount)} below floor · ${formatCount(pricing.blockedCount)} blocked · beer and cocktails only`,
      tone: !pricingKnown ? "warning" : pricing.belowFloorCount > 0 || pricing.blockedCount > 0 ? "warning" : "positive",
      confidence: pricingKnown ? (pricing.blockedCount > 0 ? "partial" : "verified") : "unavailable",
      target: DASHBOARD_OVERVIEW_TARGETS.pricing,
    },
  ];
}

function buildQuickActions({
  planState,
  sharedSources,
  kegFeed,
  usage,
  pricingFeed,
  pricing,
  inventory,
  recipes,
}) {
  const inventoryShared = sharedSources.find((source) => source.key === "inventory");
  const inventoryNeedsAttention = count(inventory.missingCurrentCount) > 0
    || inventoryShared?.savePending
    || Boolean(inventoryShared?.saveError)
    || !inventoryShared?.initialized;
  const usageNeedsRefresh = !usage.hasCurrentPeriod || !usage.currentComplete || !usage.trendComplete;
  const kegNeedsRefresh = kegFeed.status !== "online";
  const pricingNeedsRefresh = pricingFeed.status !== "online";
  const missingRecipeCount = count(recipes.missingRecipeCount);
  const actions = [
    {
      id: "weekly-plan",
      label: planState.actionable ? "Review Weekly Plan" : "Fix Weekly Plan",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyPlan,
      priority: 10,
      tone: planState.actionable ? "primary" : "critical",
    },
    {
      id: "inventory",
      label: inventoryNeedsAttention ? "Finish Inventory Counts" : "Review Inventory",
      target: DASHBOARD_OVERVIEW_TARGETS.inventory,
      priority: inventoryNeedsAttention ? 20 : 60,
      tone: inventoryNeedsAttention ? "warning" : "secondary",
    },
    {
      id: "keg-levels",
      label: kegNeedsRefresh ? "Refresh Keg Levels" : "Open Keg Levels",
      target: DASHBOARD_OVERVIEW_TARGETS.kegLevels,
      priority: kegNeedsRefresh ? 25 : 65,
      tone: kegNeedsRefresh ? "warning" : "secondary",
    },
    {
      id: "weekly-usage",
      label: usageNeedsRefresh ? "Refresh Weekly Usage" : "View Beverage Trends",
      target: DASHBOARD_OVERVIEW_TARGETS.weeklyUsage,
      priority: usageNeedsRefresh ? 30 : 50,
      tone: usageNeedsRefresh ? "warning" : "secondary",
    },
    {
      id: "pricing",
      label: pricingNeedsRefresh
        ? "Check Tap Pricing"
        : pricing.belowFloorCount > 0 || pricing.blockedCount > 0
          ? "Review Pricing Alerts"
          : "Open Tap Pricing",
      target: DASHBOARD_OVERVIEW_TARGETS.pricing,
      priority: pricingNeedsRefresh || pricing.belowFloorCount > 0 || pricing.blockedCount > 0 ? 35 : 70,
      tone: pricingNeedsRefresh || pricing.belowFloorCount > 0 || pricing.blockedCount > 0 ? "warning" : "secondary",
    },
  ];

  if (missingRecipeCount > 0) {
    actions.push({
      id: "recipes",
      label: "Add Missing Recipe Cards",
      target: DASHBOARD_OVERVIEW_TARGETS.recipes,
      priority: 40,
      tone: "warning",
    });
  }

  return actions.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

/**
 * Builds the initial owner Dashboard view model from data already derived by
 * Weekly Plan, shared-store, PMB, Weekly Usage, inventory, recipe, and pricing
 * logic. It deliberately returns display strings and stable navigation targets,
 * but never reads the DOM or starts a network request.
 */
export function buildDashboardOverview(signals = {}, options = {}) {
  const nowTime = parseTime(options.now) || Date.now();
  const staleAfterDays = nonNegativeNumber(options.planStaleAfterDays ?? 8) || 8;
  const usageFreshAfterDays = nonNegativeNumber(options.usageFreshAfterDays ?? 8) || 8;
  const kegLevelFreshAfterHours = nonNegativeNumber(options.kegLevelFreshAfterHours ?? 24) || 24;
  const pricingFreshAfterHours = nonNegativeNumber(options.pricingFreshAfterHours ?? 24) || 24;
  const weeklyPlan = signals.weeklyPlan && typeof signals.weeklyPlan === "object" ? signals.weeklyPlan : {};
  const summary = weeklyPlan.summary && typeof weeklyPlan.summary === "object" ? weeklyPlan.summary : {};
  const planState = getPlanState(weeklyPlan, nowTime, staleAfterDays);
  const shared = signals.shared && typeof signals.shared === "object" ? signals.shared : {};
  const sharedSources = SHARED_SOURCE_DEFINITIONS.map((definition) => (
    normalizeSharedSource(definition, shared[definition.key])
  ));
  const sharedResult = buildSharedAlerts(sharedSources);
  const kegFeed = normalizeFeed(signals.pmb?.kegLevels);
  const pricingFeed = normalizeFeed(signals.pmb?.pricing);
  const kegFeedAgeState = getAgeState(kegFeed.updatedAt, nowTime, kegLevelFreshAfterHours * HOUR_MS);
  const pricingFeedAgeState = getAgeState(pricingFeed.updatedAt, nowTime, pricingFreshAfterHours * HOUR_MS);
  const usage = getUsageState(signals.usage);
  const usageAgeState = getAgeState(usage.lastSyncAt, nowTime, usageFreshAfterDays * DAY_MS);
  const pricing = getPricingState(signals.pricing);
  const inventory = signals.inventory && typeof signals.inventory === "object" ? signals.inventory : {};
  const recipes = signals.recipes && typeof signals.recipes === "object" ? signals.recipes : {};
  const deferred = signals.deferred && typeof signals.deferred === "object" ? signals.deferred : {};
  const kegAlerts = buildKegLevelAlerts(kegFeed, kegFeedAgeState);
  const usageAlerts = buildUsageAlerts(usage, usageAgeState);
  const pricingResult = buildPricingAlerts(pricingFeed, pricingFeedAgeState, pricing);
  const pmbAlerts = combinePmbConnectionAlerts({
    kegFeed,
    kegAlerts,
    pricingFeed,
    pricingResult,
  });
  const planAlerts = buildPlanAlerts(planState, staleAfterDays);
  const extraAlerts = [];

  const notReceivedItems = Array.isArray(signals.orders?.notReceivedItems)
    ? signals.orders.notReceivedItems.filter((item) => item && typeof item === "object")
    : [];
  if (notReceivedItems.length > 0) {
    extraAlerts.push(makeAlert({
      id: "weekly-order-not-received",
      severity: "critical",
      priority: 55,
      title: `${formatCount(notReceivedItems.length)} ordered ${plural(notReceivedItems.length, "item was", "items were")} short or not received`,
      message: "A delivery was checked and at least one planned quantity was missing. Review the vendor order and arrange the follow-up.",
      details: notReceivedItems.map((item) => {
        const quantity = nonNegativeNumber(item.quantity);
        const receivedQuantity = nonNegativeNumber(item.receivedQuantity);
        const missingQuantity = nonNegativeNumber(item.missingQuantity || quantity - receivedQuantity);
        const identity = [clean(item.vendor), clean(item.name)].filter(Boolean).join(" · ");
        const unit = clean(item.unit) || plural(quantity, "unit");
        const amount = quantity
          ? `${formatQuantity(receivedQuantity)} of ${formatQuantity(quantity)} ${unit} received${missingQuantity ? ` (${formatQuantity(missingQuantity)} missing)` : ""}`
          : "";
        const reporter = clean(item.handledBy) ? `reported by ${clean(item.handledBy)}` : "";
        return [identity, amount, reporter].filter(Boolean).join(" · ");
      }),
      action: makeAction("Review Delivery", DASHBOARD_OVERVIEW_TARGETS.weeklyPlan),
    }));
  }

  const missingCurrentCount = count(inventory.missingCurrentCount);
  if (missingCurrentCount > 0) {
    extraAlerts.push(makeAlert({
      id: "inventory-counts-missing",
      severity: "critical",
      priority: 65,
      title: `${formatCount(missingCurrentCount)} inventory ${plural(missingCurrentCount, "count is", "counts are")} not current`,
      message: "These items are using an old baseline. Related order quantities must remain held until a current count is saved.",
      action: makeAction("Finish Inventory Counts", DASHBOARD_OVERVIEW_TARGETS.inventory),
    }));
  }

  const missingRecipeCount = count(recipes.missingRecipeCount);
  if (missingRecipeCount > 0) {
    extraAlerts.push(makeAlert({
      id: "recipe-coverage-missing",
      severity: "warning",
      priority: 100,
      title: `${formatCount(missingRecipeCount)} wall ${plural(missingRecipeCount, "cocktail needs", "cocktails need")} a recipe card`,
      message: "Add or match the missing recipes so costing, search, and prep details cover every cocktail tap.",
      action: makeAction("View Missing Recipes", DASHBOARD_OVERVIEW_TARGETS.recipes),
    }));
  }

  const alerts = sortDashboardOverviewAlerts([
    ...sharedResult.alerts,
    ...planAlerts,
    ...pmbAlerts,
    ...usageAlerts,
    ...extraAlerts,
  ]);
  const usageBlocksPlanNumbers = !planState.lockedForWeek && (
    !usage.hasCurrentPeriod || !usage.currentComplete
  );
  const kegBlocksPlanNumbers = !planState.lockedForWeek && (
    ["partial", "offline", "not-checked", "stale"].includes(kegFeed.status)
    || kegFeedAgeState === "stale"
  );
  const inventoryBlocksPlanNumbers = !planState.lockedForWeek && missingCurrentCount > 0;
  const sharedBlocksPlanNumbers = !planState.lockedForWeek && sharedResult.blocksPlanNumbers;
  const planNumbersAvailable = planState.actionable
    && !sharedBlocksPlanNumbers
    && !usageBlocksPlanNumbers
    && !kegBlocksPlanNumbers
    && !inventoryBlocksPlanNumbers;
  const kpis = buildKpis({
    planState,
    summary,
    planNumbersAvailable,
    usage,
    pricing,
    priceFeedCurrent: pricingResult.priceFeedCurrent,
    deferred,
  });
  const quickActions = buildQuickActions({
    planState,
    sharedSources,
    kegFeed,
    usage,
    pricingFeed,
    pricing,
    inventory,
    recipes,
  });
  const alertCounts = {
    critical: alerts.filter((alert) => alert.severity === "critical").length,
    warning: alerts.filter((alert) => alert.severity === "warning").length,
    info: alerts.filter((alert) => alert.severity === "info").length,
  };
  const status = alertCounts.critical > 0 ? "critical" : alertCounts.warning > 0 ? "warning" : "ready";

  return {
    status,
    statusLabel: status === "critical" ? "Action required" : status === "warning" ? "Review needed" : "Operations ready",
    planNumbersAvailable,
    alertCounts,
    alerts,
    kpis,
    quickActions,
  };
}
