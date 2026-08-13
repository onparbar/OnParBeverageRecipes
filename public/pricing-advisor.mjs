const DAY_MS = 24 * 60 * 60 * 1000;

export const PRICING_ADVISOR_DEFAULTS = Object.freeze({
  targetMarginPercent: 82,
  priceIncrement: 0.01,
  sellableYieldPercent: 100,
  maxCostAgeDays: 35,
  maxLivePriceAgeHours: 24,
  maxRecommendedChangePercent: 10,
});

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value) {
  return Math.max(0, finiteNumber(value));
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function parsePricingTimestamp(value) {
  const text = clean(value);
  if (!text) return 0;
  const embeddedDate = text.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
  const time = new Date(embeddedDate || text).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function calculateGrossMarginPercent(costPerOz, pricePerOz) {
  const cost = positiveNumber(costPerOz);
  const price = positiveNumber(pricePerOz);
  if (!cost || !price) return 0;
  return ((price - cost) / price) * 100;
}

export function isPricingAdvisorEligibleKind(value) {
  return ["beer", "cocktail"].includes(clean(value).toLowerCase());
}

function normalizeIdentityNumber(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function getVerifiedPmbPriceIdentity(input = {}) {
  const firstAssignment = Array.isArray(input.assignments) ? input.assignments[0] || {} : {};
  const plu = normalizeIdentityNumber(input.plu);
  const tapNumber = normalizeIdentityNumber(input.tapNumber || firstAssignment.tapNumber);
  const deviceId = normalizeIdentityNumber(input.deviceId || firstAssignment.deviceId);
  const lineNum = normalizeIdentityNumber(input.lineNum || firstAssignment.lineNum);
  const name = clean(input.name || firstAssignment.name);
  const tapMatchSource = clean(input.tapMatchSource).toLowerCase();
  const verified = (input.identityVerified === true || (
    input.isCurrentTap === true && tapMatchSource === "pmb-tap-config"
  ))
    && plu
    && tapNumber
    && deviceId
    && lineNum
    && name;
  if (!verified) return null;
  return { tapNumber, deviceId, lineNum, name };
}

export function getPmbPriceUpdateEligibility(input = {}, options = {}) {
  const kind = clean(input.kind).toLowerCase();
  const currentPricePerOz = positiveNumber(input.currentPricePerOz);
  const livePriceUpdatedAt = clean(input.livePriceUpdatedAt);
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const identity = getVerifiedPmbPriceIdentity(input);
  const blockers = [];

  if (!isPricingAdvisorEligibleKind(kind)) blockers.push("Beer and cocktail taps only.");
  if (!identity) blockers.push("Current PMB tap identity is not verified.");
  const assignments = Array.isArray(input.assignments) ? input.assignments : [];
  if (assignments.length && assignments.some((assignment) => (
    !normalizeIdentityNumber(assignment?.tapNumber)
    || !normalizeIdentityNumber(assignment?.deviceId)
    || !normalizeIdentityNumber(assignment?.lineNum)
  ))) {
    blockers.push("One or more affected tap assignments is missing verified PMB identity.");
  }
  if (!currentPricePerOz) blockers.push("No current PMB price was loaded.");
  const livePriceAgeMs = getAgeMs(livePriceUpdatedAt, now);
  if (!Number.isFinite(livePriceAgeMs)) {
    blockers.push("The current PMB price has not been freshness-checked.");
  } else if (livePriceAgeMs > positiveNumber(options.maxLivePriceAgeHours ?? PRICING_ADVISOR_DEFAULTS.maxLivePriceAgeHours) * 60 * 60 * 1000) {
    blockers.push(`The PMB price check is more than ${options.maxLivePriceAgeHours ?? PRICING_ADVISOR_DEFAULTS.maxLivePriceAgeHours} hours old.`);
  }

  return {
    eligible: blockers.length === 0,
    blockers,
    identity,
    plu: normalizeIdentityNumber(input.plu),
    kind,
    currentPricePerOz,
  };
}

export function validatePmbPriceIncrease(input = {}) {
  const currentPricePerOz = positiveNumber(input.currentPricePerOz);
  const newPricePerOz = positiveNumber(input.newPricePerOz);
  if (!currentPricePerOz || !newPricePerOz) {
    return { valid: false, message: "Enter a valid current and new price." };
  }
  if (newPricePerOz <= currentPricePerOz) {
    return { valid: false, message: "The new PMB price must be higher than the current price." };
  }
  return { valid: true, message: "" };
}

export function getPmbPriceEditorDefault(recommendation = {}) {
  const currentPricePerOz = positiveNumber(recommendation.currentPricePerOz);
  const recommendedPricePerOz = positiveNumber(recommendation.recommendedPricePerOz);
  const unsafeSuggestionCodes = new Set([
    "mapping-unverified",
    "missing-cost",
  ]);
  const suggestionBlocked = Array.isArray(recommendation.issues)
    && recommendation.issues.some((entry) => unsafeSuggestionCodes.has(clean(entry?.code)));
  return recommendation.action === "increase" && recommendedPricePerOz > currentPricePerOz && !suggestionBlocked
    ? recommendedPricePerOz
    : currentPricePerOz;
}

export function calculateTargetPricePerOz({
  costPerOz,
  targetMarginPercent = PRICING_ADVISOR_DEFAULTS.targetMarginPercent,
  priceIncrement = PRICING_ADVISOR_DEFAULTS.priceIncrement,
  sellableYieldPercent = PRICING_ADVISOR_DEFAULTS.sellableYieldPercent,
} = {}) {
  const cost = positiveNumber(costPerOz);
  const target = finiteNumber(targetMarginPercent);
  const increment = positiveNumber(priceIncrement);
  const sellableYield = finiteNumber(sellableYieldPercent) / 100;
  if (!cost || target <= 0 || target >= 100 || !increment || sellableYield <= 0 || sellableYield > 1) {
    return 0;
  }

  const effectiveCostPerOz = cost / sellableYield;
  const exactPrice = effectiveCostPerOz / (1 - (target / 100));
  const roundedUp = Math.ceil((exactPrice / increment) - 1e-9) * increment;
  return Math.round(roundedUp * 10000) / 10000;
}

function getAgeMs(timestamp, now) {
  const time = parsePricingTimestamp(timestamp);
  if (!time) return Number.POSITIVE_INFINITY;
  return Math.max(0, now.getTime() - time);
}

function issue(code, severity, message) {
  return { code, severity, message };
}

export function evaluatePricingRecommendation(input = {}, options = {}) {
  const settings = { ...PRICING_ADVISOR_DEFAULTS, ...options };
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const costPerOz = positiveNumber(input.costPerOz);
  const currentPricePerOz = positiveNumber(input.currentPricePerOz);
  const minimumPricePerOz = calculateTargetPricePerOz({
    costPerOz,
    targetMarginPercent: settings.targetMarginPercent,
    priceIncrement: settings.priceIncrement,
    sellableYieldPercent: settings.sellableYieldPercent,
  });
  const currentMarginPercent = calculateGrossMarginPercent(costPerOz, currentPricePerOz);
  const issues = [];

  if (!input.mappingVerified) {
    issues.push(issue("mapping-unverified", "blocker", "Tap-to-cost mapping needs review."));
  }
  if (!costPerOz) {
    issues.push(issue("missing-cost", "blocker", "No usable product cost is available."));
  }
  if (!currentPricePerOz) {
    issues.push(issue("missing-live-price", "blocker", "No current PMB price was loaded."));
  }

  const costAgeMs = getAgeMs(input.costUpdatedAt, now);
  if (costPerOz && !Number.isFinite(costAgeMs)) {
    issues.push(issue("undated-cost", "warning", "The cost source has no verifiable update date."));
  } else if (costPerOz && costAgeMs > positiveNumber(settings.maxCostAgeDays) * DAY_MS) {
    issues.push(issue("stale-cost", "warning", `The cost is more than ${settings.maxCostAgeDays} days old.`));
  }

  const livePriceAgeMs = getAgeMs(input.livePriceUpdatedAt, now);
  if (currentPricePerOz && !Number.isFinite(livePriceAgeMs)) {
    issues.push(issue("undated-live-price", "warning", "The PMB price has not been freshness-checked."));
  } else if (currentPricePerOz && livePriceAgeMs > positiveNumber(settings.maxLivePriceAgeHours) * 60 * 60 * 1000) {
    issues.push(issue("stale-live-price", "warning", `The PMB price check is more than ${settings.maxLivePriceAgeHours} hours old.`));
  }

  const minimumMargin = finiteNumber(settings.targetMarginPercent);
  let action = "review";
  if (minimumPricePerOz && !currentPricePerOz) {
    action = "set";
  } else if (minimumPricePerOz && currentMarginPercent + 1e-9 < minimumMargin) {
    action = "increase";
  } else if (minimumPricePerOz && currentPricePerOz) {
    action = "hold";
  }

  const recommendedPricePerOz = action === "increase" || action === "set"
    ? minimumPricePerOz
    : currentPricePerOz;
  const recommendedMarginPercent = calculateGrossMarginPercent(costPerOz, recommendedPricePerOz);

  const priceChange = recommendedPricePerOz && currentPricePerOz
    ? recommendedPricePerOz - currentPricePerOz
    : 0;
  const priceChangePercent = currentPricePerOz ? (priceChange / currentPricePerOz) * 100 : 0;
  if (
    action !== "hold"
    && currentPricePerOz
    && Math.abs(priceChangePercent) > positiveNumber(settings.maxRecommendedChangePercent)
  ) {
    issues.push(issue(
      "large-change",
      "warning",
      `The suggested change is greater than ${settings.maxRecommendedChangePercent}%.`,
    ));
  }

  return {
    id: clean(input.id),
    name: clean(input.name) || "Unnamed tap",
    kind: clean(input.kind) || "tap",
    wall: clean(input.wall),
    tapPosition: positiveNumber(input.tapPosition),
    costSource: clean(input.costSource),
    costUpdatedAt: clean(input.costUpdatedAt),
    livePriceUpdatedAt: clean(input.livePriceUpdatedAt),
    costPerOz,
    currentPricePerOz,
    currentMarginPercent,
    recommendedPricePerOz,
    minimumPricePerOz,
    recommendedMarginPercent,
    priceChange,
    priceChangePercent,
    action,
    issues,
    hasBlocker: issues.some((entry) => entry.severity === "blocker"),
    needsReview: issues.length > 0,
    mode: "dry-run",
    publishEligible: false,
  };
}

function recommendationSortRank(item) {
  if (item.hasBlocker) return 0;
  if (item.action === "increase") return 1;
  if (item.needsReview) return 2;
  return 3;
}

export function buildPricingAdvisor(inputs = [], options = {}) {
  const rows = inputs
    .map((input) => evaluatePricingRecommendation(input, options))
    .sort((left, right) => (
      recommendationSortRank(left) - recommendationSortRank(right)
      || Math.abs(right.priceChangePercent) - Math.abs(left.priceChangePercent)
      || left.tapPosition - right.tapPosition
      || left.name.localeCompare(right.name)
    ));

  return {
    rows,
    summary: {
      total: rows.length,
      priceChangeCount: rows.filter((item) => item.action === "increase" && !item.hasBlocker).length,
      onTargetCount: rows.filter((item) => item.action === "hold" && !item.hasBlocker).length,
      reviewCount: rows.filter((item) => item.needsReview).length,
      blockedCount: rows.filter((item) => item.hasBlocker).length,
    },
    mode: "dry-run",
    targetMarginPercent: finiteNumber(options.targetMarginPercent || PRICING_ADVISOR_DEFAULTS.targetMarginPercent),
  };
}
