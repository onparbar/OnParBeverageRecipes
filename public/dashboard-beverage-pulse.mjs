import {
  getWeeklyUsageEntryPouredOz,
  getWeeklyUsagePerformanceCategory,
} from "./weekly-usage-performance.mjs";

const CATEGORY_ORDER = Object.freeze(["cocktail", "beer", "liquor"]);
const CATEGORY_LABELS = Object.freeze({
  cocktail: "Cocktails",
  beer: "Beer",
  liquor: "Liquor",
});
const LEADERBOARD_METRICS = new Set(["oz", "sales"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
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
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    ? time
    : 0;
}

function resolveWall(item) {
  const tapNumber = Number(item?.tapNumber);
  if (tapNumber >= 1 && tapNumber <= 20) return "patio";
  if (tapNumber >= 21 && tapNumber <= 72) return "main";
  if (tapNumber >= 73 && tapNumber <= 102) return "karaoke";
  const wall = clean(item?.wall).toLowerCase();
  return wall === "main bar" ? "main" : wall;
}

function resolveCategory(item) {
  const tapNumber = Number(item?.tapNumber);
  if ((tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92)) return "liquor";
  if ((tapNumber >= 47 && tapNumber <= 72) || (tapNumber >= 93 && tapNumber <= 102)) return "cocktail";
  if ((tapNumber >= 21 && tapNumber <= 46) || (tapNumber >= 73 && tapNumber <= 82)) return "beer";
  return getWeeklyUsagePerformanceCategory(item);
}

function isInSelectedWall(category, itemWall, selectedWall) {
  if (selectedWall === "all") return true;
  if (category !== "liquor") return itemWall === selectedWall;
  if (selectedWall === "karaoke" || selectedWall === "patio") {
    return itemWall === selectedWall;
  }
  return itemWall === "patio" || itemWall === "karaoke";
}

function normalizeProductName(value) {
  return clean(value).replace(/\s+[123]\s*$/, "").trim() || "Unnamed PMB product";
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

function resolveSellingPricePerOz(resolver, item, context) {
  let result;
  try {
    result = resolver(item, context);
  } catch {
    return null;
  }
  const objectResult = result && typeof result === "object" ? result : null;
  return finiteNonNegativeNumber(
    objectResult
      ? objectResult.sellingPricePerOz ?? objectResult.pricePerOz
      : result,
  );
}

function allocateWholePercentages(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return values.map(() => 0);
  const raw = values.map((value) => (value / total) * 100);
  const whole = raw.map(Math.floor);
  let pointsLeft = 100 - whole.reduce((sum, value) => sum + value, 0);
  const byRemainder = raw
    .map((value, index) => ({ index, remainder: value - whole[index] }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  byRemainder.forEach(({ index }) => {
    if (pointsLeft <= 0) return;
    whole[index] += 1;
    pointsLeft -= 1;
  });
  return whole;
}

/**
 * Builds the three last-week Dashboard leaderboards. All categories follow a
 * selected wall that has liquor taps. Main combines venue liquor because it
 * has no liquor wall of its own.
 */
export function buildLastWeekPourLeaders(
  items = [],
  {
    wall = "main",
    period = 1,
    metric = "oz",
    getFullOunces = () => 0,
    getSellingPricePerOz = () => null,
    limit = 3,
  } = {},
) {
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const normalizedWall = clean(wall).toLowerCase() || "main";
  const normalizedMetric = LEADERBOARD_METRICS.has(clean(metric).toLowerCase())
    ? clean(metric).toLowerCase()
    : "oz";
  const normalizedLimit = Math.max(1, Math.min(10, Math.floor(Number(limit) || 3)));
  const labelsByTime = new Map();

  sourceItems.forEach((item) => {
    (Array.isArray(item?.history) ? item.history : []).forEach((entry) => {
      const time = getWeekStartTime(entry?.label);
      if (!time || getWeeklyUsageEntryPouredOz(item, entry, getFullOunces) === null) return;
      if (!labelsByTime.has(time)) labelsByTime.set(time, clean(entry.label));
    });
  });

  const selectedWeekTimes = [...labelsByTime.keys()]
    .sort((left, right) => right - left)
    .slice(0, Math.max(1, Math.floor(Number(period) || 1)));
  const selectedWeekTimeSet = new Set(selectedWeekTimes);
  const latestTime = selectedWeekTimes[0] || 0;
  const latestWeekLabel = labelsByTime.get(latestTime) || "";
  const earliestWeekLabel = labelsByTime.get(selectedWeekTimes[selectedWeekTimes.length - 1]) || latestWeekLabel;
  const earliestWeekStart = clean(earliestWeekLabel).split(/\s+-\s+/)[0] || earliestWeekLabel;
  const latestWeekParts = clean(latestWeekLabel).split(/\s+-\s+/);
  const latestWeekEnd = latestWeekParts[latestWeekParts.length - 1] || latestWeekLabel;
  const weekLabel = selectedWeekTimes.length > 1
    ? `${earliestWeekStart} - ${latestWeekEnd}`
    : latestWeekLabel;
  const products = new Map();
  const coverage = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, {
    capturedTapCount: 0,
    pricedTapCount: 0,
  }]));

  sourceItems.forEach((item) => {
    const category = resolveCategory(item);
    const itemWall = resolveWall(item);
    const inScope = isInSelectedWall(category, itemWall, normalizedWall);
    if (!CATEGORY_ORDER.includes(category) || !inScope) return;

    const pouredValuesByWeek = new Map();
    (Array.isArray(item?.history) ? item.history : []).forEach((entry) => {
      const time = getWeekStartTime(entry?.label);
      if (!selectedWeekTimeSet.has(time)) return;
      const value = getWeeklyUsageEntryPouredOz(item, entry, getFullOunces);
      if (value === null) return;
      const values = pouredValuesByWeek.get(time) || [];
      values.push(value);
      pouredValuesByWeek.set(time, values);
    });
    const pouredOz = [...pouredValuesByWeek.values()].reduce((total, values) => {
      const distinctValues = [...new Set(values)];
      return distinctValues.length === 1 && distinctValues[0] > 0
        ? total + distinctValues[0]
        : total;
    }, 0);
    if (!(pouredOz > 0)) return;

    coverage[category].capturedTapCount += 1;
    const sellingPricePerOz = resolveSellingPricePerOz(getSellingPricePerOz, item, {
      category,
      pouredOz,
      weekLabel: latestWeekLabel,
      weekStartTime: latestTime,
    });
    if (sellingPricePerOz > 0) coverage[category].pricedTapCount += 1;
    if (normalizedMetric === "sales" && !(sellingPricePerOz > 0)) return;

    const name = normalizeProductName(item?.name);
    const key = `${category}:${normalizeProductKey(name)}`;
    const existing = products.get(key) || {
      id: key,
      name,
      category,
      pouredOz: 0,
      projectedSales: 0,
      kegEquivalent: 0,
      tapCount: 0,
      walls: [],
    };
    existing.pouredOz += pouredOz;
    existing.projectedSales += sellingPricePerOz > 0 ? pouredOz * sellingPricePerOz : 0;
    const fullOunces = Number(getFullOunces(item));
    if ((category === "beer" || category === "cocktail") && fullOunces > 0) {
      existing.kegEquivalent += pouredOz / fullOunces;
    }
    existing.tapCount += 1;
    if (itemWall && !existing.walls.includes(itemWall)) existing.walls.push(itemWall);
    products.set(key, existing);
  });

  const sections = Object.fromEntries(CATEGORY_ORDER.map((category) => {
    const rows = [...products.values()]
      .filter((row) => row.category === category)
      .map((row) => ({
        ...row,
        pouredOz: round(row.pouredOz),
        projectedSales: round(row.projectedSales),
        kegEquivalent: round(row.kegEquivalent),
        value: round(normalizedMetric === "sales" ? row.projectedSales : row.pouredOz),
      }))
      .sort((left, right) => right.value - left.value || left.name.localeCompare(right.name))
      .slice(0, normalizedLimit);
    return [category, {
      rows,
      ...coverage[category],
      unpricedTapCount: Math.max(0, coverage[category].capturedTapCount - coverage[category].pricedTapCount),
    }];
  }));

  return {
    metric: normalizedMetric,
    wall: normalizedWall,
    weekLabel,
    weekStartTime: latestTime,
    periodWeeks: selectedWeekTimes.length,
    sections,
  };
}

/**
 * Estimates the latest saved weekly sales from PMB poured ounces and the
 * caller's saved or current selling price per ounce. All categories follow a selected
 * wall that has liquor taps. Main combines venue liquor because it has no
 * liquor wall of its own. The caller may mark a historical fallback as estimated.
 */
export function buildLastWeekProjectedSalesMix(
  items = [],
  {
    wall = "main",
    period = 1,
    getFullOunces = () => 0,
    getSellingPricePerOz = () => null,
  } = {},
) {
  const sourceItems = Array.isArray(items) ? items.filter(Boolean) : [];
  const labelsByTime = new Map();
  sourceItems.forEach((item) => {
    (Array.isArray(item?.history) ? item.history : []).forEach((entry) => {
      const time = getWeekStartTime(entry?.label);
      if (!time || getWeeklyUsageEntryPouredOz(item, entry, getFullOunces) === null) return;
      if (!labelsByTime.has(time)) labelsByTime.set(time, clean(entry.label));
    });
  });
  const selectedWeekTimes = [...labelsByTime.keys()]
    .sort((left, right) => right - left)
    .slice(0, Math.max(1, Math.floor(Number(period) || 1)));
  const selectedWeekTimeSet = new Set(selectedWeekTimes);
  const latestTime = selectedWeekTimes[0] || 0;
  const latestWeekLabel = labelsByTime.get(latestTime) || "";
  const earliestWeekLabel = labelsByTime.get(selectedWeekTimes[selectedWeekTimes.length - 1]) || latestWeekLabel;
  const earliestWeekStart = clean(earliestWeekLabel).split(/\s+-\s+/)[0] || earliestWeekLabel;
  const latestWeekParts = clean(latestWeekLabel).split(/\s+-\s+/);
  const latestWeekEnd = latestWeekParts[latestWeekParts.length - 1] || latestWeekLabel;
  const weekLabel = selectedWeekTimes.length > 1
    ? `${earliestWeekStart} - ${latestWeekEnd}`
    : latestWeekLabel;
  const categorySales = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));
  const wallOrder = ["main", "karaoke", "patio"];
  const wallLabels = {
    main: "Main wall",
    karaoke: "Karaoke wall",
    patio: "Patio wall",
  };
  const wallSales = Object.fromEntries(wallOrder.map((wallKey) => [wallKey, 0]));
  const selectedWall = clean(wall).toLowerCase();
  let capturedTapCount = 0;
  let pricedTapCount = 0;
  let estimatedTapCount = 0;

  sourceItems.forEach((item) => {
      const category = resolveCategory(item);
      const itemWall = resolveWall(item);
      const inSelectedWall = isInSelectedWall(category, itemWall, selectedWall);
      const entries = (Array.isArray(item?.history) ? item.history : [])
        .filter((entry) => selectedWeekTimeSet.has(getWeekStartTime(entry?.label)));
      const pouredValuesByWeek = new Map();
      entries.forEach((entry) => {
        const time = getWeekStartTime(entry?.label);
        const value = getWeeklyUsageEntryPouredOz(item, entry, getFullOunces);
        if (value === null) return;
        const values = pouredValuesByWeek.get(time) || [];
        values.push(value);
        pouredValuesByWeek.set(time, values);
      });
      const pouredOz = [...pouredValuesByWeek.values()].reduce((total, values) => {
        const distinctValues = [...new Set(values)];
        return distinctValues.length === 1 && distinctValues[0] > 0
          ? total + distinctValues[0]
          : total;
      }, 0);
      if (!(pouredOz > 0)) return;

      if (!CATEGORY_ORDER.includes(category)) return;
      const priceContext = {
        category,
        pouredOz,
        weekLabel: latestWeekLabel,
        weekStartTime: latestTime,
        entry: entries[0] || null,
      };
      const sellingPricePerOz = resolveSellingPricePerOz(getSellingPricePerOz, item, priceContext);
      if (wallOrder.includes(itemWall) && sellingPricePerOz > 0) {
        wallSales[itemWall] += pouredOz * sellingPricePerOz;
      }
      if (!inSelectedWall) return;
      capturedTapCount += 1;
      if (!(sellingPricePerOz > 0)) return;
      pricedTapCount += 1;
      if (priceContext.estimated === true) estimatedTapCount += 1;
      categorySales[category] += pouredOz * sellingPricePerOz;
    });

  const projectedSales = round(CATEGORY_ORDER.reduce((total, category) => total + categorySales[category], 0));
  const percentages = allocateWholePercentages(CATEGORY_ORDER.map((category) => categorySales[category]));
  const categories = CATEGORY_ORDER.map((category, index) => ({
    category,
    label: CATEGORY_LABELS[category],
    projectedSales: round(categorySales[category]),
    sharePercent: percentages[index],
  }));
  const wallPercentages = allocateWholePercentages(wallOrder.map((wallKey) => wallSales[wallKey]));
  const walls = wallOrder.map((wallKey, index) => ({
    wall: wallKey,
    label: wallLabels[wallKey],
    projectedSales: round(wallSales[wallKey]),
    sharePercent: wallPercentages[index],
  }));

  return {
    available: projectedSales > 0,
    wall: clean(wall).toLowerCase(),
    weekLabel,
    weekStartTime: latestTime,
    periodWeeks: selectedWeekTimes.length,
    projectedSales,
    capturedTapCount,
    pricedTapCount,
    estimatedTapCount,
    unpricedTapCount: Math.max(0, capturedTapCount - pricedTapCount),
    categories,
    walls,
  };
}
