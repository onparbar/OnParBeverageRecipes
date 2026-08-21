import {
  getWeeklyUsageEntryPouredOz,
  getWeeklyUsagePerformanceCategory,
} from "./weekly-usage-performance.mjs";

const RANKING_CATEGORIES = new Set(["all", "beer", "cocktail", "liquor"]);
const RANKING_METRICS = new Set(["volume", "profit"]);
const RANKING_WALLS = new Set(["all", "patio", "main", "karaoke"]);

export const WEEKLY_USAGE_SELLER_RANKING_DATA_BOUNDARY = Object.freeze({
  source: "PMB + saved keg history",
  metric: "poured ounces",
  legacySalesIncluded: false,
  crossWallAggregation: false,
  requiresVerifiedWallAndCategory: true,
  allTimeLabel: "All saved usage weeks",
  allTimeDescription: "Exact PMB ounces are preferred; older keg history is converted using the product's full keg size.",
});

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNonNegativeNumber(value) {
  const parsed = finiteNumber(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function clampInteger(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareText(leftValue, rightValue) {
  const left = clean(leftValue);
  const right = clean(rightValue);
  const insensitive = left.localeCompare(right, "en", { sensitivity: "base" });
  return insensitive || left.localeCompare(right, "en") || 0;
}

function normalizeProductName(value) {
  return clean(value).replace(/\s+[123]\s*$/, "").trim();
}

function normalizeProductKey(value) {
  return normalizeProductName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeWall(value) {
  const wall = clean(value).toLowerCase();
  if (wall === "main bar") return "main";
  return RANKING_WALLS.has(wall) ? wall : "";
}

function resolveRankingWall(item) {
  const tapNumber = positiveInteger(item?.tapNumber);
  if (tapNumber >= 1 && tapNumber <= 20) return "patio";
  if (tapNumber >= 21 && tapNumber <= 72) return "main";
  if (tapNumber >= 73 && tapNumber <= 102) return "karaoke";

  const explicitWall = normalizeWall(item?.wall);
  if (explicitWall && explicitWall !== "all") return explicitWall;

  const wallNumber = clean(item?.name).match(/\s+([123])\s*$/)?.[1];
  if (wallNumber === "1") return "main";
  if (wallNumber === "2") return "karaoke";
  if (wallNumber === "3") return "patio";
  return "";
}

function resolveRankingCategory(item) {
  const tapNumber = positiveInteger(item?.tapNumber);
  if ((tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92)) return "liquor";
  if ((tapNumber >= 47 && tapNumber <= 72) || (tapNumber >= 93 && tapNumber <= 102)) return "cocktail";
  if ((tapNumber >= 21 && tapNumber <= 46) || (tapNumber >= 73 && tapNumber <= 82)) return "beer";

  const type = clean(item?.type).toLowerCase();
  if (item?.isLiquorShot || clean(item?.displayUnit).toLowerCase() === "oz" || type === "shots") {
    return "liquor";
  }
  if (type === "cocktail") return "cocktail";
  return type ? getWeeklyUsagePerformanceCategory(item) : "";
}

function getWallLabel(wall) {
  if (wall === "patio") return "Patio";
  if (wall === "main") return "Main";
  if (wall === "karaoke") return "Karaoke";
  return "";
}

function getWeekStartTime(label) {
  const match = clean(label).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return 0;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const time = Date.UTC(year, month - 1, day);
  const parsed = new Date(time);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return 0;
  return time;
}

function getMemberKey(item, index) {
  const tapNumber = positiveInteger(item?.tapNumber);
  if (tapNumber) return `tap:${tapNumber}`;
  const id = normalizeProductKey(item?.id);
  return id ? `row:${id}` : `input:${index}`;
}

function getUnavailableItemKey(item, index) {
  const category = resolveRankingCategory(item) || "unverified";
  const productKey = normalizeProductKey(item?.name) || "unnamed";
  return `${category}:${productKey}:${getMemberKey(item, index)}`;
}

function isPmbUsageEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const source = clean(entry.source).toLowerCase();
  if (source) return source === "pmb";
  return Object.prototype.hasOwnProperty.call(entry, "volumeOz");
}

function getDistinctSample(samples) {
  if (!samples.length) return null;
  const first = samples[0];
  return samples.every((sample) => (
    sample.pouredOz === first.pouredOz && sample.value === first.value
  )) ? first : null;
}

function addUnavailableReason(quality, reason) {
  const normalizedReason = clean(reason) || "Verified price and cost per ounce are unavailable.";
  quality.unavailableProfitReasons.set(
    normalizedReason,
    (quality.unavailableProfitReasons.get(normalizedReason) || 0) + 1,
  );
}

function resolveGrossProfitPerOz(getGrossProfitPerOz, item, context) {
  let result;
  try {
    result = getGrossProfitPerOz(item, context);
  } catch {
    return {
      rate: null,
      reason: "Verified gross profit per ounce could not be resolved.",
    };
  }

  const objectResult = result && typeof result === "object" ? result : null;
  return {
    rate: finiteNumber(objectResult ? objectResult.grossProfitPerOz : result),
    reason: clean(objectResult?.reason),
  };
}

function getItemHistoryByWeek(
  item,
  itemIndex,
  { getFullOunces, getGrossProfitPerOz, metric },
  quality,
) {
  const samplesByTime = new Map();
  const unavailableTimes = new Set();
  const history = Array.isArray(item?.history) ? item.history : [];

  history.forEach((entry) => {
    const time = getWeekStartTime(entry?.label);
    if (!time) {
      quality.ignoredEntryCount += 1;
      return;
    }

    const pouredOz = getWeeklyUsageEntryPouredOz(item, entry, getFullOunces);
    if (!Number.isFinite(pouredOz) || pouredOz < 0) {
      quality.ignoredEntryCount += 1;
      return;
    }
    if (finiteNonNegativeNumber(entry?.volumeOz) !== null) quality.exactVolumeSampleCount += 1;
    else quality.estimatedVolumeSampleCount += 1;

    const label = clean(entry.label);
    const savedLabel = quality.labelsByTime.get(time);
    if (!savedLabel || compareText(label, savedLabel) < 0) quality.labelsByTime.set(time, label);

    let value = pouredOz;
    if (metric === "profit") {
      const resolvedRate = resolveGrossProfitPerOz(getGrossProfitPerOz, item, {
        entry,
        weekStartTime: time,
        weekLabel: label,
      });
      if (resolvedRate.rate === null) {
        quality.unavailableProfitSampleCount += 1;
        quality.unavailableProfitItems.add(getUnavailableItemKey(item, itemIndex));
        addUnavailableReason(quality, resolvedRate.reason);
        unavailableTimes.add(time);
        return;
      }
      value = pouredOz * resolvedRate.rate;
    }

    const samples = samplesByTime.get(time) || [];
    samples.push({ pouredOz, value });
    samplesByTime.set(time, samples);
  });

  const result = new Map();
  samplesByTime.forEach((samples, time) => {
    const sample = getDistinctSample(samples);
    if (!sample) {
      quality.conflictingSampleCount += 1;
      unavailableTimes.add(time);
      return;
    }
    result.set(time, sample);
  });
  return { samplesByTime: result, unavailableTimes };
}

function buildProducts(items, options, quality) {
  const products = new Map();

  items.forEach((item, index) => {
    const productName = normalizeProductName(item?.name);
    const productKey = normalizeProductKey(productName);
    if (!productKey) {
      quality.ignoredItemCount += 1;
      return;
    }

    const category = resolveRankingCategory(item);
    const wallKey = resolveRankingWall(item);
    const id = `${category}:${wallKey}:${productKey}`;
    const product = products.get(id) || {
      id,
      name: productName,
      category,
      wall: wallKey,
      bottomEligible: false,
      tapNumbers: new Set(),
      walls: new Set(),
      membersByKey: new Map(),
      unavailableTimes: new Set(),
    };
    if (options.isBottomEligible(item)) product.bottomEligible = true;
    if (compareText(productName, product.name) < 0) product.name = productName;

    const tapNumber = positiveInteger(item?.tapNumber);
    const wall = getWallLabel(wallKey);
    if (tapNumber) product.tapNumbers.add(tapNumber);
    if (wall) product.walls.add(wall);

    const memberKey = getMemberKey(item, index);
    const memberSamples = product.membersByKey.get(memberKey) || new Map();
    const itemHistory = getItemHistoryByWeek(item, index, options, quality);
    itemHistory.samplesByTime.forEach((sample, time) => {
      const samples = memberSamples.get(time) || [];
      samples.push(sample);
      memberSamples.set(time, samples);
    });
    itemHistory.unavailableTimes.forEach((time) => product.unavailableTimes.add(time));
    product.membersByKey.set(memberKey, memberSamples);
    products.set(id, product);
  });

  return [...products.values()].map((product) => {
    const productValuesByTime = new Map();
    product.membersByKey.forEach((memberSamples) => {
      memberSamples.forEach((samples, time) => {
        const sample = getDistinctSample(samples);
        if (!sample) {
          quality.conflictingSampleCount += 1;
          product.unavailableTimes.add(time);
          return;
        }
        const current = productValuesByTime.get(time) || { pouredOz: 0, value: 0 };
        productValuesByTime.set(time, {
          pouredOz: current.pouredOz + sample.pouredOz,
          value: current.value + sample.value,
        });
      });
    });
    product.unavailableTimes.forEach((time) => productValuesByTime.delete(time));

    return {
      id: product.id,
      name: product.name,
      category: product.category,
      wall: product.wall,
      bottomEligible: product.bottomEligible,
      tapNumbers: [...product.tapNumbers].sort((a, b) => a - b),
      walls: [...product.walls].sort(compareText),
      valuesByTime: productValuesByTime,
      unavailableTimes: new Set(product.unavailableTimes),
    };
  });
}

function collectRecordedPeriodLabels(items, getFullOunces) {
  const labelsByTime = new Map();
  items.forEach((item) => {
    const history = Array.isArray(item?.history) ? item.history : [];
    history.forEach((entry) => {
      const time = getWeekStartTime(entry?.label);
      const pouredOz = getWeeklyUsageEntryPouredOz(item, entry, getFullOunces);
      if (!time || !Number.isFinite(pouredOz) || pouredOz < 0) return;
      const label = clean(entry.label);
      const savedLabel = labelsByTime.get(time);
      if (!savedLabel || compareText(label, savedLabel) < 0) labelsByTime.set(time, label);
    });
  });
  return labelsByTime;
}

function compareRankingRows(left, right, direction) {
  return direction * (left.averageWeeklyValue - right.averageWeeklyValue)
    || right.sampleWeekCount - left.sampleWeekCount
    || compareText(left.name, right.name)
    || compareText(left.id, right.id);
}

function buildWeeklyTrendSeries(product, periods, metric) {
  const orderedPeriods = [...periods].sort((left, right) => left.startTime - right.startTime);
  const points = orderedPeriods.map((period) => {
    const sample = product.valuesByTime.get(period.startTime);
    if (sample) {
      const value = round(sample.value);
      const pouredOz = round(sample.pouredOz);
      return {
        weekLabel: period.label,
        weekStartTime: period.startTime,
        status: "recorded",
        value,
        pouredOz,
        volumeOz: pouredOz,
        grossProfit: metric === "profit" ? value : null,
      };
    }

    return {
      weekLabel: period.label,
      weekStartTime: period.startTime,
      status: product.unavailableTimes.has(period.startTime) ? "unavailable" : "missing",
      value: null,
      pouredOz: null,
      volumeOz: null,
      grossProfit: null,
    };
  });
  const recordedWeekCount = points.filter((point) => point.status === "recorded").length;
  const missingWeekCount = points.filter((point) => point.status === "missing").length;
  const unavailableWeekCount = points.filter((point) => point.status === "unavailable").length;
  const gapWeekCount = missingWeekCount + unavailableWeekCount;

  return {
    seriesId: product.id,
    metric,
    unit: metric === "profit" ? "USD" : "oz",
    order: "oldest-to-newest",
    wall: product.wall,
    wallLabel: getWallLabel(product.wall),
    tapNumbers: product.tapNumbers,
    status: gapWeekCount ? "gapped" : "complete",
    canRenderSparkline: recordedWeekCount >= 2,
    recordedWeekCount,
    gapWeekCount,
    missingWeekCount,
    unavailableWeekCount,
    points,
  };
}

function buildWindow(products, periods, { metric, topLimit, bottomLimit }) {
  const periodTimes = new Set(periods.map((period) => period.startTime));
  const rows = products.map((product) => {
    const samples = [...product.valuesByTime.entries()]
      .filter(([time]) => periodTimes.has(time))
      .map(([, sample]) => sample)
      .filter((sample) => (
        Number.isFinite(sample?.pouredOz)
        && sample.pouredOz >= 0
        && Number.isFinite(sample.value)
      ));
    if (!samples.length || !samples.some((sample) => sample.pouredOz > 0)) return null;

    const totalPouredOz = samples.reduce((total, sample) => total + sample.pouredOz, 0);
    const totalValue = samples.reduce((total, sample) => total + sample.value, 0);
    const row = {
      id: product.id,
      name: product.name,
      category: product.category,
      wall: product.wall,
      bottomEligible: product.bottomEligible,
      tapNumbers: product.tapNumbers,
      walls: product.walls,
      metric,
      averageWeeklyValue: round(totalValue / samples.length),
      totalValue: round(totalValue),
      averageWeeklyPouredOz: round(totalPouredOz / samples.length),
      totalPouredOz: round(totalPouredOz),
      sampleWeekCount: samples.length,
      positiveWeekCount: samples.filter((sample) => sample.pouredOz > 0).length,
      windowWeekCount: periods.length,
      weeklyTrend: buildWeeklyTrendSeries(product, periods, metric),
    };
    if (metric === "profit") {
      row.averageWeeklyGrossProfit = row.averageWeeklyValue;
      row.totalGrossProfit = row.totalValue;
    } else {
      row.averageWeeklyOz = row.averageWeeklyValue;
      row.totalOz = row.totalValue;
    }
    return row;
  }).filter(Boolean);

  return {
    weekCount: periods.length,
    weekLabels: periods.map((period) => period.label),
    weekStartTimes: periods.map((period) => period.startTime),
    eligibleCount: rows.length,
    top: [...rows].sort((a, b) => compareRankingRows(a, b, -1)).slice(0, topLimit),
    bottom: rows.filter((row) => row.bottomEligible).sort((a, b) => compareRankingRows(a, b, 1)).slice(0, bottomLimit),
  };
}

function buildMetricMetadata(metric, quality) {
  if (metric === "volume") {
    return {
      key: "volume",
      label: "Poured volume",
      unit: "oz",
      averageField: "averageWeeklyOz",
      totalField: "totalOz",
      requiresExactPmbVolume: false,
      requiresVerifiedPriceAndCost: false,
      calculation: "Saved PMB poured ounces averaged across recorded product weeks.",
      historicalRatesInferred: false,
      unavailableItemCount: 0,
      unavailableSampleCount: 0,
      unavailableExactVolumeSampleCount: 0,
      exactVolumeSampleCount: quality.exactVolumeSampleCount,
      estimatedVolumeSampleCount: quality.estimatedVolumeSampleCount,
      unavailableReasons: [],
      unavailableReason: "",
    };
  }

  const unavailableReasons = [...quality.unavailableProfitReasons.entries()]
    .sort((left, right) => right[1] - left[1] || compareText(left[0], right[0]))
    .map(([reason, count]) => ({ reason, count }));
  return {
    key: "profit",
    label: "Estimated profit at today's rates",
    unit: "USD",
    averageField: "averageWeeklyGrossProfit",
    totalField: "totalGrossProfit",
    requiresExactPmbVolume: false,
    requiresVerifiedPriceAndCost: true,
    calculation: "Saved poured ounces × caller-verified gross profit per ounce, resolved per tap and week; older keg history uses keg-size conversions.",
    historicalRatesInferred: false,
    unavailableItemCount: quality.unavailableProfitItems.size,
    unavailableSampleCount: quality.unavailableProfitSampleCount,
    unavailableExactVolumeSampleCount: quality.unavailableExactVolumeSampleCount,
    exactVolumeSampleCount: quality.exactVolumeSampleCount,
    estimatedVolumeSampleCount: quality.estimatedVolumeSampleCount,
    unavailableReasons,
    unavailableReason: quality.unavailableProfitSampleCount
      ? "Some PMB usage was excluded because a verified selling price and cost per ounce were unavailable."
      : "",
  };
}

/**
 * Builds poured-usage or gross-profit rankings from saved Weekly Usage history.
 *
 * Exact PMB ounces are preferred. Older saved keg fractions are converted only
 * when the full keg size is known. Missing product weeks are not treated as zero;
 * each row reports the number of recorded weeks used in its average. Profit mode
 * requires a verified per-ounce profit rate supplied by the caller for each tap.
 * A product offered on multiple walls remains a separate ranking row per wall.
 * Pass active and archived items together when all-time should include replacements.
 */
export function buildWeeklyUsageSellerRankings(
  items = [],
  {
    category = "all",
    wall = "all",
    metric = "volume",
    getFullOunces = () => 0,
    getGrossProfitPerOz = () => null,
    isBottomEligible = () => true,
    recentWeekLimit = 6,
    topLimit = 5,
    bottomLimit = 3,
  } = {},
) {
  const normalizedCategoryValue = clean(category).toLowerCase();
  const normalizedMetricValue = clean(metric).toLowerCase();
  const normalizedWallValue = clean(wall).toLowerCase();
  const normalizedCategory = RANKING_CATEGORIES.has(normalizedCategoryValue) ? normalizedCategoryValue : "all";
  const normalizedWall = RANKING_WALLS.has(normalizedWallValue) ? normalizedWallValue : "all";
  const normalizedMetric = RANKING_METRICS.has(normalizedMetricValue) ? normalizedMetricValue : "volume";
  const normalizedRecentWeekLimit = clampInteger(recentWeekLimit, 6, 1, 52);
  const normalizedTopLimit = clampInteger(topLimit, 5, 1, 25);
  const normalizedBottomLimit = clampInteger(bottomLimit, 3, 1, 25);
  const resolveBottomEligibility = typeof isBottomEligible === "function" ? isBottomEligible : () => true;
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const identifiedSourceItems = sourceItems.filter((item) => (
    resolveRankingCategory(item) && resolveRankingWall(item)
  ));
  const selectedSourceItems = identifiedSourceItems.filter((item) => (
    (normalizedCategory === "all" || resolveRankingCategory(item) === normalizedCategory)
    && (normalizedWall === "all" || resolveRankingWall(item) === normalizedWall)
  ));
  const quality = {
    labelsByTime: collectRecordedPeriodLabels(identifiedSourceItems, getFullOunces),
    ignoredItemCount: 0,
    ignoredEntryCount: 0,
    conflictingSampleCount: 0,
    usableSampleCount: 0,
    unavailableProfitItems: new Set(),
    unavailableProfitSampleCount: 0,
    unavailableExactVolumeSampleCount: 0,
    exactVolumeSampleCount: 0,
    estimatedVolumeSampleCount: 0,
    unavailableProfitReasons: new Map(),
  };

  const products = buildProducts(selectedSourceItems, {
    getFullOunces,
    getGrossProfitPerOz,
    isBottomEligible: resolveBottomEligibility,
    metric: normalizedMetric,
  }, quality);
  const periods = [...quality.labelsByTime.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([startTime, label]) => ({ startTime, label }));
  quality.usableSampleCount = products.reduce(
    (total, product) => total + product.valuesByTime.size,
    0,
  );
  const limits = {
    metric: normalizedMetric,
    topLimit: normalizedTopLimit,
    bottomLimit: normalizedBottomLimit,
  };

  return {
    category: normalizedCategory,
    wall: normalizedWall,
    metric: normalizedMetric,
    metricMetadata: buildMetricMetadata(normalizedMetric, quality),
    available: periods.length > 0 && products.length > 0,
    dataBoundary: {
      ...WEEKLY_USAGE_SELLER_RANKING_DATA_BOUNDARY,
      recentLabel: `Latest ${normalizedRecentWeekLimit} saved usage weeks`,
    },
    recordedWeekCount: periods.length,
    recent: buildWindow(products, periods.slice(0, normalizedRecentWeekLimit), limits),
    allTime: buildWindow(products, periods, limits),
    quality: {
      sourceItemCount: sourceItems.length,
      identifiedSourceItemCount: identifiedSourceItems.length,
      unverifiedIdentityItemCount: sourceItems.length - identifiedSourceItems.length,
      selectedSourceItemCount: selectedSourceItems.length,
      productCount: products.length,
      ignoredItemCount: quality.ignoredItemCount,
      ignoredEntryCount: quality.ignoredEntryCount,
      conflictingSampleCount: quality.conflictingSampleCount,
      usableSampleCount: quality.usableSampleCount,
      unavailableProfitItemCount: quality.unavailableProfitItems.size,
      unavailableProfitSampleCount: quality.unavailableProfitSampleCount,
      unavailableExactVolumeSampleCount: quality.unavailableExactVolumeSampleCount,
      exactVolumeSampleCount: quality.exactVolumeSampleCount,
      estimatedVolumeSampleCount: quality.estimatedVolumeSampleCount,
    },
  };
}
