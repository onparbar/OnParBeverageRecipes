const PERFORMANCE_CATEGORIES = new Set(["all", "beer", "cocktail", "liquor"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function getLabelStartTime(label) {
  const match = clean(label).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return 0;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function isPmbUsageEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const source = clean(entry.source).toLowerCase();
  if (source) return source === "pmb";
  return Object.prototype.hasOwnProperty.call(entry, "volumeOz");
}

function getPmbHistory(item) {
  return Array.isArray(item?.history)
    ? item.history.filter((entry) => isPmbUsageEntry(entry) && getLabelStartTime(entry.label))
    : [];
}

export function getWeeklyUsagePerformanceCategory(item) {
  if (item?.isLiquorShot || clean(item?.displayUnit).toLowerCase() === "oz") return "liquor";
  if (clean(item?.type).toLowerCase() === "cocktail") return "cocktail";
  return "beer";
}

export function getWeeklyUsageEntryPouredOz(item, entry, getFullOunces = () => 0) {
  const exactPouredOz = finiteNonNegativeNumber(entry?.volumeOz);
  if (exactPouredOz !== null) return exactPouredOz;

  const source = clean(entry?.source).toLowerCase();
  if (/gotab|sales/.test(source)) return null;
  const displayedValue = finiteNonNegativeNumber(entry?.value);
  if (displayedValue === null) return null;
  if (clean(item?.displayUnit).toLowerCase() === "oz") return displayedValue;

  const fullOunces = finiteNonNegativeNumber(getFullOunces(item));
  return fullOunces && fullOunces > 0 ? displayedValue * fullOunces : null;
}

function comparePerformanceRowsByName(a, b) {
  return Number(a.tapNumbers?.[0] || a.tapNumber || 0) - Number(b.tapNumbers?.[0] || b.tapNumber || 0)
    || clean(a.name).localeCompare(clean(b.name));
}

function rankRows(rows, direction, limit) {
  return [...rows]
    .sort((a, b) => direction * (a.currentOz - b.currentOz) || comparePerformanceRowsByName(a, b))
    .slice(0, limit);
}

function getPerformanceProductName(item) {
  return (clean(item?.name).replace(/\s+[123]\s*$/, "").trim() || "Unnamed PMB product");
}

function getPerformanceProductKey(item) {
  return getPerformanceProductName(item)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function aggregateProductRows(rows) {
  const products = new Map();
  rows.forEach((row) => {
    const key = row.productKey || row.id;
    const existing = products.get(key) || {
      id: row.id,
      productKey: key,
      name: row.productName,
      category: row.category,
      tapNumbers: [],
      walls: [],
      tapCount: 0,
      currentCapturedCount: 0,
      previousCapturedCount: 0,
      currentOz: 0,
      previousOz: 0,
    };
    existing.tapCount += 1;
    if (row.tapNumber && !existing.tapNumbers.includes(row.tapNumber)) existing.tapNumbers.push(row.tapNumber);
    if (row.wall && !existing.walls.includes(row.wall)) existing.walls.push(row.wall);
    if (row.currentOz !== null) {
      existing.currentOz += row.currentOz;
      existing.currentCapturedCount += 1;
    }
    if (row.previousOz !== null) {
      existing.previousOz += row.previousOz;
      existing.previousCapturedCount += 1;
    }
    products.set(key, existing);
  });

  return [...products.values()].map((product) => {
    product.tapNumbers.sort((a, b) => a - b);
    const hasCurrent = product.currentCapturedCount > 0;
    const hasPrevious = product.previousCapturedCount > 0;
    const hasCompleteComparison = product.currentCapturedCount === product.tapCount
      && product.previousCapturedCount === product.tapCount;
    return {
      ...product,
      currentOz: hasCurrent ? product.currentOz : null,
      previousOz: hasPrevious ? product.previousOz : null,
      trendOz: hasCompleteComparison ? product.currentOz - product.previousOz : null,
      trendPercent: hasCompleteComparison && product.previousOz > 0
        ? ((product.currentOz - product.previousOz) / product.previousOz) * 100
        : null,
    };
  });
}

function getMissingComparisonReason(row, { currentPeriod, previousPeriod }) {
  if (row.currentOz === null) {
    return currentPeriod && row.currentEntryFound
      ? "The current week PMB entry did not include usable poured ounces."
      : currentPeriod
        ? "No current week PMB row was saved for this tap."
      : "The current PMB week is not saved.";
  }
  if (!previousPeriod) return "The prior consecutive PMB week is not saved.";
  if (row.previousEntryFound) {
    return "The prior week PMB entry did not include usable poured ounces.";
  }
  return row.hasOlderPmbUsage
    ? "Prior week PMB usage is missing even though older PMB history exists."
    : "No prior week or older PMB usage is saved; this may be a new or newly assigned tap.";
}

export function buildWeeklyUsagePerformance(
  items = [],
  {
    category = "all",
    getFullOunces = () => 0,
    limit = 10,
  } = {},
) {
  const normalizedCategory = PERFORMANCE_CATEGORIES.has(category) ? category : "all";
  const normalizedLimit = Math.max(1, Math.min(25, Math.floor(Number(limit) || 10)));
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const labelsByTime = new Map();

  sourceItems.forEach((item) => {
    getPmbHistory(item).forEach((entry) => {
      const time = getLabelStartTime(entry.label);
      if (!labelsByTime.has(time)) labelsByTime.set(time, clean(entry.label));
    });
  });

  const periods = [...labelsByTime.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([startTime, label]) => ({ startTime, label }));
  const latestPeriod = periods[0] || null;
  const expectedPreviousStartTime = latestPeriod ? latestPeriod.startTime - WEEK_MS : 0;
  const previousPeriod = periods.find((period) => period.startTime === expectedPreviousStartTime) || null;
  const eligibleItems = sourceItems.filter((item) => (
    normalizedCategory === "all" || getWeeklyUsagePerformanceCategory(item) === normalizedCategory
  ));

  const tapRows = eligibleItems.map((item) => {
    const pmbHistory = getPmbHistory(item);
    const currentEntry = latestPeriod
      ? pmbHistory.find((entry) => getLabelStartTime(entry.label) === latestPeriod.startTime)
      : null;
    const previousEntry = previousPeriod
      ? pmbHistory.find((entry) => getLabelStartTime(entry.label) === previousPeriod.startTime)
      : null;
    const currentOz = getWeeklyUsageEntryPouredOz(item, currentEntry, getFullOunces);
    const previousOz = getWeeklyUsageEntryPouredOz(item, previousEntry, getFullOunces);
    const hasOlderPmbUsage = Boolean(previousPeriod) && pmbHistory.some((entry) => (
      getLabelStartTime(entry.label) < previousPeriod.startTime
      && getWeeklyUsageEntryPouredOz(item, entry, getFullOunces) !== null
    ));

    return {
      id: clean(item.id) || `${Number(item.tapNumber) || 0}-${clean(item.name)}`,
      name: clean(item.name) || "Unnamed PMB product",
      productName: getPerformanceProductName(item),
      productKey: getPerformanceProductKey(item),
      tapNumber: Number(item.tapNumber) || null,
      wall: clean(item.wall),
      category: getWeeklyUsagePerformanceCategory(item),
      currentOz,
      previousOz,
      currentEntryFound: Boolean(currentEntry),
      previousEntryFound: Boolean(previousEntry),
      hasOlderPmbUsage,
      trendOz: currentOz !== null && previousOz !== null ? currentOz - previousOz : null,
      trendPercent: currentOz !== null && previousOz !== null && previousOz > 0
        ? ((currentOz - previousOz) / previousOz) * 100
        : null,
    };
  });

  const rows = aggregateProductRows(tapRows);

  const currentTapRows = tapRows.filter((row) => row.currentOz !== null);
  const previousTapRows = tapRows.filter((row) => row.previousOz !== null);
  const comparableTapRows = tapRows.filter((row) => row.currentOz !== null && row.previousOz !== null);
  const currentRows = rows.filter((row) => row.currentOz !== null);
  const currentComplete = eligibleItems.length > 0 && currentTapRows.length === eligibleItems.length;
  const previousComplete = Boolean(previousPeriod)
    && eligibleItems.length > 0
    && previousTapRows.length === eligibleItems.length;
  const trendComplete = currentComplete && previousComplete;
  const totalCurrentOz = currentTapRows.reduce((total, row) => total + row.currentOz, 0);
  const totalPreviousOz = previousTapRows.reduce((total, row) => total + row.previousOz, 0);
  const comparableCurrentOz = comparableTapRows.reduce((total, row) => total + row.currentOz, 0);
  const comparablePreviousOz = comparableTapRows.reduce((total, row) => total + row.previousOz, 0);
  const excludedComparisonTaps = tapRows
    .filter((row) => row.currentOz === null || row.previousOz === null)
    .map((row) => ({
      tapNumber: row.tapNumber,
      name: row.name,
      wall: row.wall,
      missingCurrent: row.currentOz === null,
      missingPrevious: row.previousOz === null,
      likelyNewTap: row.currentOz !== null
        && row.previousOz === null
        && Boolean(previousPeriod)
        && !row.previousEntryFound
        && !row.hasOlderPmbUsage,
      reason: getMissingComparisonReason(row, { currentPeriod: latestPeriod, previousPeriod }),
    }))
    .sort(comparePerformanceRowsByName);
  const hasComparableTrend = Boolean(previousPeriod) && comparableTapRows.length > 0;
  const comparableTrendOz = hasComparableTrend ? comparableCurrentOz - comparablePreviousOz : null;

  return {
    category: normalizedCategory,
    latestLabel: latestPeriod?.label || "",
    latestStartTime: latestPeriod?.startTime || 0,
    previousLabel: previousPeriod?.label || "",
    previousStartTime: previousPeriod?.startTime || 0,
    eligibleCount: eligibleItems.length,
    productCount: rows.length,
    capturedCount: currentTapRows.length,
    previousCapturedCount: previousTapRows.length,
    comparableCount: comparableTapRows.length,
    excludedComparisonTaps,
    currentComplete,
    previousComplete,
    trendComplete,
    totalCurrentOz,
    totalPreviousOz,
    totalTrendOz: comparableTrendOz,
    totalTrendPercent: hasComparableTrend && comparablePreviousOz > 0
      ? (comparableTrendOz / comparablePreviousOz) * 100
      : null,
    top: rankRows(currentRows, -1, normalizedLimit),
    bottom: currentComplete ? rankRows(currentRows, 1, normalizedLimit) : [],
    bottomSuppressed: Boolean(latestPeriod) && !currentComplete,
  };
}
