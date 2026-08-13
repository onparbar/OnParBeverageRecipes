const DAY_MS = 24 * 60 * 60 * 1000;
const CATEGORY_ORDER = ["beer", "cocktail", "liquor"];

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNonNegativeNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function round(value, places = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** places;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function compareText(a, b) {
  const left = clean(a).toLowerCase();
  const right = clean(b).toLowerCase();
  if (left < right) return -1;
  if (left > right) return 1;
  return clean(a) < clean(b) ? -1 : clean(a) > clean(b) ? 1 : 0;
}

function uniqueSorted(values, compare = compareText) {
  return [...new Set(values)].sort(compare);
}

function parseWeekStart(label) {
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

function formatIsoDate(time) {
  if (!time) return "";
  return new Date(time).toISOString().slice(0, 10);
}

function getExpectedLatestCompletedWeekStart(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  const daysSinceMonday = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - daysSinceMonday - 7);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

function isPmbEntry(entry) {
  return clean(entry?.source).toLowerCase() === "pmb";
}

function normalizeProductName(value) {
  return clean(value).replace(/\s+[123]\s*$/, "").trim() || "Unnamed PMB product";
}

function normalizeIdentityText(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getWeeklyPlanTrendCategory(item) {
  if (item?.isLiquorShot || clean(item?.displayUnit).toLowerCase() === "oz") return "liquor";
  if (clean(item?.type).toLowerCase() === "cocktail") return "cocktail";
  return "beer";
}

function getProductIdentity(item, category) {
  const explicitIdentity = clean(item?.productIdentity);
  if (explicitIdentity) {
    return {
      key: `${category}:identity:${normalizeIdentityText(explicitIdentity)}`,
      source: "product-identity",
    };
  }

  const plu = positiveInteger(item?.plu);
  if (plu) return { key: `${category}:plu:${plu}`, source: "plu" };

  const productId = clean(item?.productId);
  if (productId) {
    return {
      key: `${category}:product-id:${normalizeIdentityText(productId)}`,
      source: "product-id",
    };
  }

  const tapNumber = positiveInteger(item?.tapNumber);
  if (tapNumber) return { key: `${category}:tap:${tapNumber}`, source: "tap" };

  const rowId = clean(item?.id);
  if (rowId) {
    return { key: `${category}:row:${normalizeIdentityText(rowId)}`, source: "row" };
  }

  const name = normalizeIdentityText(normalizeProductName(item?.name));
  const wall = normalizeIdentityText(item?.wall);
  return {
    key: `${category}:unassigned:${name || "unnamed"}:${wall || "no-wall"}`,
    source: "unassigned",
  };
}

function buildPmbHistoryMap(item, labelsByTime) {
  const entriesByTime = new Map();
  const invalidTimes = new Set();
  const history = Array.isArray(item?.history) ? item.history : [];

  history.forEach((entry) => {
    if (!isPmbEntry(entry)) return;
    const time = parseWeekStart(entry.label);
    if (!time) return;
    const label = clean(entry.label);
    const currentLabel = labelsByTime.get(time);
    if (!currentLabel || compareText(label, currentLabel) < 0) labelsByTime.set(time, label);

    const volumeOz = finiteNonNegativeNumber(entry.volumeOz);
    if (volumeOz === null) {
      invalidTimes.add(time);
      return;
    }
    const values = entriesByTime.get(time) || [];
    values.push(volumeOz);
    entriesByTime.set(time, values);
  });

  const historyMap = new Map();
  const conflictingTimes = new Set();
  entriesByTime.forEach((values, time) => {
    const uniqueValues = uniqueSorted(values, (a, b) => a - b);
    if (uniqueValues.length === 1) {
      historyMap.set(time, uniqueValues[0]);
    } else if (uniqueValues.length > 1) {
      conflictingTimes.add(time);
    }
  });
  return {
    historyMap,
    invalidTimes,
    conflictingTimes,
  };
}

function buildTapRows(items, labelsByTime) {
  return items.map((item) => {
    const category = getWeeklyPlanTrendCategory(item);
    const identity = getProductIdentity(item, category);
    const history = buildPmbHistoryMap(item, labelsByTime);
    return {
      identityKey: identity.key,
      identitySource: identity.source,
      category,
      plu: positiveInteger(item?.plu),
      name: normalizeProductName(item?.name),
      tapNumber: positiveInteger(item?.tapNumber),
      wall: clean(item?.wall),
      historyMap: history.historyMap,
      invalidTimes: history.invalidTimes,
      conflictingTimes: history.conflictingTimes,
    };
  });
}

function buildProductRows(tapRows, periodTimes) {
  const products = new Map();
  tapRows.forEach((row) => {
    const existing = products.get(row.identityKey) || {
      id: row.identityKey,
      identitySource: row.identitySource,
      category: row.category,
      plu: row.plu,
      names: [],
      tapNumbers: [],
      walls: [],
      members: [],
    };
    existing.names.push(row.name);
    if (row.tapNumber) existing.tapNumbers.push(row.tapNumber);
    if (row.wall) existing.walls.push(row.wall);
    existing.members.push(row);
    products.set(row.identityKey, existing);
  });

  return [...products.values()]
    .map((product) => {
      const valuesByTime = new Map();
      periodTimes.forEach((time) => {
        const values = product.members.map((member) => member.historyMap.get(time));
        if (values.every((value) => Number.isFinite(value))) {
          valuesByTime.set(time, values.reduce((total, value) => total + value, 0));
        }
      });

      return {
        id: product.id,
        identitySource: product.identitySource,
        category: product.category,
        plu: product.plu,
        name: uniqueSorted(product.names)[0] || "Unnamed PMB product",
        tapNumbers: uniqueSorted(product.tapNumbers, (a, b) => a - b),
        walls: uniqueSorted(product.walls),
        tapCount: product.members.length,
        valuesByTime,
      };
    })
    .sort((a, b) => compareText(a.name, b.name) || compareText(a.id, b.id));
}

function getCoverage(tapRows, time, label = "") {
  const eligibleTapCount = tapRows.length;
  const capturedTapCount = time
    ? tapRows.filter((row) => Number.isFinite(row.historyMap.get(time))).length
    : 0;
  return {
    label,
    capturedTapCount,
    missingTapCount: Math.max(0, eligibleTapCount - capturedTapCount),
    complete: Boolean(time) && eligibleTapCount > 0 && capturedTapCount === eligibleTapCount,
  };
}

function hasPmbEvidenceBefore(row, time) {
  return [row.historyMap, row.invalidTimes, row.conflictingTimes].some((collection) => (
    [...collection.keys()].some((entryTime) => entryTime < time)
  ));
}

function getMissingWeekIssue(row, time, period) {
  const periodLabel = period === "current" ? "current week" : "prior week";
  if (row.conflictingTimes.has(time)) {
    return {
      period,
      code: `conflicting-${period}-week`,
      reason: `Conflicting PMB poured-ounce values are saved for the ${periodLabel}.`,
    };
  }
  if (row.invalidTimes.has(time)) {
    return {
      period,
      code: `invalid-${period}-week`,
      reason: `The saved PMB row for the ${periodLabel} does not contain valid poured ounces.`,
    };
  }
  return {
    period,
    code: `missing-${period}-week`,
    reason: `No PMB poured-ounce data is saved for the ${periodLabel}.`,
  };
}

function compareExcludedTaps(a, b) {
  const leftTap = a.tapNumber || Number.MAX_SAFE_INTEGER;
  const rightTap = b.tapNumber || Number.MAX_SAFE_INTEGER;
  return leftTap - rightTap || compareText(a.name, b.name) || compareText(a.id, b.id);
}

function buildComparisonTapCoverage(tapRows, latestTime, previousTime) {
  const includedTapRows = [];
  const excludedTaps = [];

  tapRows.forEach((row) => {
    const hasCurrent = Number.isFinite(row.historyMap.get(latestTime));
    const hasPrevious = Number.isFinite(row.historyMap.get(previousTime));
    if (hasCurrent && hasPrevious) {
      includedTapRows.push(row);
      return;
    }

    const issues = [];
    if (!hasCurrent) issues.push(getMissingWeekIssue(row, latestTime, "current"));
    if (!hasPrevious) issues.push(getMissingWeekIssue(row, previousTime, "prior"));

    const priorIssue = issues.find((issue) => issue.period === "prior");
    const likelyNew = hasCurrent
      && priorIssue?.code === "missing-prior-week"
      && !hasPmbEvidenceBefore(row, latestTime);
    if (likelyNew) {
      priorIssue.code = "likely-new-tap";
      priorIssue.reason = "No prior-week PMB data is saved; this is likely a new tap because the current week is its first saved PMB week.";
    }

    excludedTaps.push({
      id: row.identityKey,
      name: row.name,
      category: row.category,
      tapNumber: row.tapNumber,
      wall: row.wall,
      code: likelyNew
        ? "likely-new-tap"
        : issues.length > 1
          ? "missing-both-weeks"
          : issues[0].code,
      likelyNew,
      missingWeeks: issues.map((issue) => issue.period),
      reason: issues.map((issue) => issue.reason).join(" "),
    });
  });

  return {
    includedTapRows,
    includedTapCount: includedTapRows.length,
    excludedTapCount: excludedTaps.length,
    excludedTaps: excludedTaps.sort(compareExcludedTaps),
    partial: includedTapRows.length > 0 && excludedTaps.length > 0,
  };
}

function getAllPmbEvidenceTimes(row) {
  return uniqueSorted([
    ...row.historyMap.keys(),
    ...row.invalidTimes.keys(),
    ...row.conflictingTimes.keys(),
  ], (a, b) => a - b);
}

function getSustainedWeekIssue(row, time, index, label) {
  const weekNumber = index + 1;
  if (row.conflictingTimes.has(time)) {
    return {
      weekNumber,
      label,
      startTime: time,
      code: `conflicting-sustained-week-${weekNumber}`,
      reason: `Conflicting PMB poured-ounce values are saved for ${label}.`,
    };
  }
  if (row.invalidTimes.has(time)) {
    return {
      weekNumber,
      label,
      startTime: time,
      code: `invalid-sustained-week-${weekNumber}`,
      reason: `The saved PMB row for ${label} does not contain valid poured ounces.`,
    };
  }
  return {
    weekNumber,
    label,
    startTime: time,
    code: `missing-sustained-week-${weekNumber}`,
    reason: `No PMB poured-ounce data is saved for ${label}.`,
  };
}

function buildSustainedTapCoverage(tapRows, weekTimes, labelsByTime) {
  const includedTapRows = [];
  const excludedTaps = [];
  const weekLabels = weekTimes.map((time) => labelsByTime.get(time) || formatIsoDate(time));
  const oldestRequiredTime = weekTimes[weekTimes.length - 1] || 0;

  tapRows.forEach((row) => {
    const issues = weekTimes.flatMap((time, index) => (
      Number.isFinite(row.historyMap.get(time))
        ? []
        : [getSustainedWeekIssue(row, time, index, weekLabels[index])]
    ));
    if (!issues.length) {
      includedTapRows.push(row);
      return;
    }

    const evidenceTimes = getAllPmbEvidenceTimes(row);
    const earliestEvidenceTime = evidenceTimes[0] || 0;
    const hasLatest = Number.isFinite(row.historyMap.get(weekTimes[0]));
    const likelyNew = hasLatest
      && earliestEvidenceTime > oldestRequiredTime
      && issues.every((issue) => issue.startTime < earliestEvidenceTime);
    const likelyNewReason = likelyNew
      ? `This is likely a new or newly assigned tap because its first saved PMB week is ${labelsByTime.get(earliestEvidenceTime) || formatIsoDate(earliestEvidenceTime)}, inside the required ${weekTimes.length}-week window. `
      : "";

    excludedTaps.push({
      id: row.identityKey,
      name: row.name,
      category: row.category,
      tapNumber: row.tapNumber,
      wall: row.wall,
      code: likelyNew
        ? "likely-new-tap"
        : issues.length > 1
          ? "missing-multiple-sustained-weeks"
          : issues[0].code,
      likelyNew,
      missingWeeks: issues,
      reason: `${likelyNewReason}${issues.map((issue) => issue.reason).join(" ")}`,
    });
  });

  return {
    includedTapRows,
    includedTapCount: includedTapRows.length,
    excludedTapCount: excludedTaps.length,
    excludedTaps: excludedTaps.sort(compareExcludedTaps),
    partial: includedTapRows.length > 0 && excludedTaps.length > 0,
    weekLabels,
  };
}

function formatExcludedTapForCopy(tap) {
  const reference = tap.tapNumber
    ? `Tap ${tap.tapNumber} (${tap.name})`
    : tap.name;
  return `${reference}: ${tap.reason}`;
}

function getSustainedCoverageCopy(coverage, eligibleTapCount, requiredWeekCount) {
  if (!coverage.excludedTapCount) {
    return `Sustained high volume uses all ${eligibleTapCount} active taps with valid PMB poured ounces in each of the ${requiredWeekCount} exact consecutive weeks.`;
  }
  const includedCopy = coverage.includedTapCount
    ? `Sustained high volume uses ${coverage.includedTapCount} of ${eligibleTapCount} active taps with valid PMB poured ounces in all ${requiredWeekCount} exact consecutive weeks.`
    : `No active tap has valid PMB poured ounces in all ${requiredWeekCount} exact consecutive weeks.`;
  return `${includedCopy} Excluded: ${coverage.excludedTaps.map(formatExcludedTapForCopy).join(" ")} Missing readings are not treated as zero pours.`;
}

function productSnapshot(product) {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    plu: product.plu,
    tapNumbers: product.tapNumbers,
    walls: product.walls,
  };
}

function getChangePercent(previousOz, changeOz, minimumPercentBaseOz) {
  if (previousOz === 0) {
    return { changePercent: null, percentGuard: "from-zero" };
  }
  if (previousOz < minimumPercentBaseOz) {
    return { changePercent: null, percentGuard: "small-base" };
  }
  return {
    changePercent: round((changeOz / previousOz) * 100, 1),
    percentGuard: "none",
  };
}

function compareMoverNames(a, b) {
  return compareText(a.name, b.name) || compareText(a.id, b.id);
}

function makeUnavailableSection(reason, values = {}) {
  return { available: false, reason, ...values };
}

function getComparisonUnavailableReason({
  eligibleTapCount,
  latestPeriod,
  stale,
  previousPeriod,
  includedTapCount,
}) {
  if (!eligibleTapCount || !latestPeriod) {
    return "No PMB poured-usage history is available for beverage movement insights.";
  }
  if (stale) {
    return "Pull the latest completed PMB poured-usage week before using beverage movement insights.";
  }
  if (!previousPeriod) {
    return "A PMB poured-usage report for the prior consecutive week is needed for week-over-week movement.";
  }
  if (!includedTapCount) {
    return `None of the ${eligibleTapCount} active taps has valid PMB poured ounces in both comparison weeks. Missing readings are not treated as zero pours.`;
  }
  return "At least one tap needs valid PMB poured ounces in both comparison weeks.";
}

function buildMovers(products, latestTime, previousTime, settings) {
  const rows = products.map((product) => {
    const currentOz = product.valuesByTime.get(latestTime);
    const previousOz = product.valuesByTime.get(previousTime);
    if (!Number.isFinite(currentOz) || !Number.isFinite(previousOz)) return null;
    const changeOz = round(currentOz - previousOz);
    const percent = getChangePercent(previousOz, changeOz, settings.minimumPercentBaseOz);
    return {
      ...productSnapshot(product),
      currentOz: round(currentOz),
      previousOz: round(previousOz),
      changeOz,
      ...percent,
    };
  }).filter((row) => row && Math.abs(row.changeOz) >= settings.minimumMovementOz);

  const risers = rows
    .filter((row) => row.changeOz > 0)
    .sort((a, b) => b.changeOz - a.changeOz || b.currentOz - a.currentOz || compareMoverNames(a, b))
    .slice(0, settings.limit);
  const fallers = rows
    .filter((row) => row.changeOz < 0)
    .sort((a, b) => a.changeOz - b.changeOz || b.previousOz - a.previousOz || compareMoverNames(a, b))
    .slice(0, settings.limit);

  return {
    available: true,
    reason: "",
    percentBaseOz: settings.minimumPercentBaseOz,
    risers,
    fallers,
    emptyCopy: "No meaningful week-over-week poured-usage movement was captured.",
  };
}

function buildSustained(products, weekTimes, labelsByTime, settings) {
  const items = products.map((product) => {
    const weeklyOz = weekTimes.map((time) => product.valuesByTime.get(time));
    if (weeklyOz.some((value) => !Number.isFinite(value) || value <= 0)) return null;
    const averageOz = weeklyOz.reduce((total, value) => total + value, 0) / weeklyOz.length;
    const lowestWeekOz = Math.min(...weeklyOz);
    if (!averageOz || lowestWeekOz / averageOz < settings.minimumSustainedFloorRatio) return null;
    return {
      ...productSnapshot(product),
      averageOz: round(averageOz),
      currentOz: round(weeklyOz[0]),
      lowestWeekOz: round(lowestWeekOz),
      highestWeekOz: round(Math.max(...weeklyOz)),
      consistencyFloorPercent: round((lowestWeekOz / averageOz) * 100, 1),
    };
  }).filter(Boolean)
    .sort((a, b) => b.averageOz - a.averageOz || b.lowestWeekOz - a.lowestWeekOz || compareMoverNames(a, b))
    .slice(0, settings.limit);

  return {
    available: true,
    reason: "",
    weekCount: weekTimes.length,
    weekLabels: weekTimes.map((time) => labelsByTime.get(time) || formatIsoDate(time)),
    items,
    emptyCopy: `No drink had consistent positive PMB pours across all ${weekTimes.length} weeks.`,
  };
}

function buildEmergingLow(products, latestTime, baselineTimes, settings) {
  const items = products.map((product) => {
    const currentOz = product.valuesByTime.get(latestTime);
    const baselineValues = baselineTimes.map((time) => product.valuesByTime.get(time));
    if (!Number.isFinite(currentOz) || baselineValues.some((value) => !Number.isFinite(value))) return null;
    const baselineOz = baselineValues.reduce((total, value) => total + value, 0) / baselineValues.length;
    if (baselineOz < settings.minimumEmergingBaselineOz) return null;

    const changeOz = currentOz - baselineOz;
    const isNewZero = currentOz === 0 && baselineOz > 0;
    const isMeaningfullyLow = currentOz > 0
      && changeOz <= -settings.minimumMovementOz
      && (
        currentOz <= settings.lowVolumeOz
        || currentOz / baselineOz <= settings.lowVolumeRatio
      );
    if (!isNewZero && !isMeaningfullyLow) return null;

    return {
      ...productSnapshot(product),
      status: isNewZero ? "zero" : "low",
      currentOz: round(currentOz),
      baselineOz: round(baselineOz),
      changeOz: round(changeOz),
      ...getChangePercent(baselineOz, changeOz, settings.minimumPercentBaseOz),
    };
  }).filter(Boolean)
    .sort((a, b) => (
      Number(a.status !== "zero") - Number(b.status !== "zero")
      || a.changeOz - b.changeOz
      || compareMoverNames(a, b)
    ))
    .slice(0, settings.limit);

  return {
    available: true,
    reason: "",
    baselineWeekCount: baselineTimes.length,
    items,
    emptyCopy: "No new low-or-zero poured-usage pattern needs attention.",
  };
}

function buildCategoryMix(tapRows, latestTime, previousTime, settings) {
  const trackedCategories = CATEGORY_ORDER.filter((category) => (
    tapRows.some((row) => row.category === category)
  ));
  if (trackedCategories.length < 2) {
    return makeUnavailableSection(
      "At least two beverage categories are needed before category mix movement can be shown.",
      { items: [] },
    );
  }

  const totals = trackedCategories.map((category) => ({
    category,
    currentOz: tapRows
      .filter((row) => row.category === category)
      .reduce((total, row) => total + row.historyMap.get(latestTime), 0),
    previousOz: tapRows
      .filter((row) => row.category === category)
      .reduce((total, row) => total + row.historyMap.get(previousTime), 0),
  }));
  const currentTotalOz = totals.reduce((total, row) => total + row.currentOz, 0);
  const previousTotalOz = totals.reduce((total, row) => total + row.previousOz, 0);
  if (currentTotalOz <= 0 || previousTotalOz <= 0) {
    return makeUnavailableSection(
      "Both complete PMB weeks need positive poured volume before category mix movement can be calculated.",
      { items: [] },
    );
  }

  const items = totals.map((row) => {
    const currentSharePercent = (row.currentOz / currentTotalOz) * 100;
    const previousSharePercent = (row.previousOz / previousTotalOz) * 100;
    return {
      category: row.category,
      currentOz: round(row.currentOz),
      previousOz: round(row.previousOz),
      currentSharePercent: round(currentSharePercent, 1),
      previousSharePercent: round(previousSharePercent, 1),
      sharePointChange: round(currentSharePercent - previousSharePercent, 1),
    };
  }).filter((row) => Math.abs(row.sharePointChange) >= settings.minimumMixShiftPoints)
    .sort((a, b) => (
      Math.abs(b.sharePointChange) - Math.abs(a.sharePointChange)
      || CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
    ));

  return {
    available: true,
    reason: "",
    currentTotalOz: round(currentTotalOz),
    previousTotalOz: round(previousTotalOz),
    minimumShiftPoints: settings.minimumMixShiftPoints,
    items,
    emptyCopy: "Beverage category mix stayed within the meaningful-shift threshold.",
  };
}

function normalizeSettings(options) {
  return {
    limit: Math.max(1, Math.min(10, Math.floor(Number(options.limit) || 5))),
    sustainedWeeks: Math.max(2, Math.min(6, Math.floor(Number(options.sustainedWeeks) || 3))),
    minimumPercentBaseOz: Math.max(1, Number(options.minimumPercentBaseOz) || 32),
    minimumMovementOz: Math.max(0.01, Number(options.minimumMovementOz) || 8),
    minimumSustainedFloorRatio: Math.max(0, Math.min(1, Number(options.minimumSustainedFloorRatio) || 0.25)),
    minimumEmergingBaselineOz: Math.max(0.01, Number(options.minimumEmergingBaselineOz) || 16),
    lowVolumeOz: Math.max(0.01, Number(options.lowVolumeOz) || 32),
    lowVolumeRatio: Math.max(0.01, Math.min(1, Number(options.lowVolumeRatio) || 0.5)),
    minimumMixShiftPoints: Math.max(0.1, Number(options.minimumMixShiftPoints) || 2),
  };
}

export function buildWeeklyPlanTrends(items = [], options = {}) {
  const settings = normalizeSettings(options);
  const sourceItems = Array.isArray(items)
    ? items.filter((item) => item && !item.hidden && !item.isArchivedSearchResult && item.active !== false)
    : [];
  const labelsByTime = new Map();
  const tapRows = buildTapRows(sourceItems, labelsByTime);
  const periodTimes = [...labelsByTime.keys()].sort((a, b) => b - a);
  const latestTime = periodTimes[0] || 0;
  const previousTime = latestTime ? latestTime - (7 * DAY_MS) : 0;
  const previousPeriodExists = Boolean(previousTime && labelsByTime.has(previousTime));
  const expectedLatestTime = getExpectedLatestCompletedWeekStart(options.now ?? new Date());
  const stale = Boolean(latestTime && expectedLatestTime && latestTime !== expectedLatestTime);
  const currentCoverage = getCoverage(tapRows, latestTime, labelsByTime.get(latestTime) || "");
  const previousCoverage = getCoverage(
    tapRows,
    previousPeriodExists ? previousTime : 0,
    previousPeriodExists ? labelsByTime.get(previousTime) || "" : "",
  );
  const products = buildProductRows(tapRows, periodTimes);
  const comparisonCoverage = previousPeriodExists
    ? buildComparisonTapCoverage(tapRows, latestTime, previousTime)
    : {
      includedTapRows: [],
      includedTapCount: 0,
      excludedTapCount: 0,
      excludedTaps: [],
      partial: false,
    };
  const comparisonProducts = buildProductRows(comparisonCoverage.includedTapRows, periodTimes);
  const comparisonAvailable = !stale
    && previousPeriodExists
    && comparisonCoverage.includedTapCount > 0;

  let status = "ready";
  let statusLabel = "Beverage trends ready";
  let statusCopy = "Insights use complete PMB poured-usage weeks and include corporate-event pours captured by PMB.";
  if (!tapRows.length || !latestTime) {
    status = "unavailable";
    statusLabel = "Beverage trends unavailable";
    statusCopy = "No PMB poured-usage history is available. Pull the latest completed Monday-Sunday report on the work network.";
  } else if (stale) {
    status = "stale";
    statusLabel = "Latest PMB week needed";
    statusCopy = `Saved PMB poured usage ends with ${currentCoverage.label}. Pull the latest completed Monday-Sunday report before using beverage trends.`;
  } else if (!currentCoverage.capturedTapCount) {
    status = "incomplete";
    statusLabel = "PMB coverage incomplete";
    statusCopy = `Latest PMB coverage is 0 of ${tapRows.length} active taps. Missing readings are not treated as zero pours.`;
  } else if (!previousPeriodExists) {
    status = "limited";
    statusLabel = "More PMB history needed";
    statusCopy = "A PMB poured-usage report for the prior consecutive week is needed for week-over-week insights.";
  } else if (!comparisonCoverage.includedTapCount) {
    status = "limited";
    statusLabel = "No comparable taps";
    statusCopy = `None of the ${tapRows.length} active taps has valid PMB poured ounces in both comparison weeks. Missing readings are not treated as zero pours.`;
  } else if (comparisonCoverage.partial) {
    status = "limited";
    statusLabel = "Partial PMB coverage";
    statusCopy = `Weekly movement uses ${comparisonCoverage.includedTapCount} of ${tapRows.length} active taps with valid PMB poured ounces in both weeks. Excluded: ${comparisonCoverage.excludedTaps.map(formatExcludedTapForCopy).join(" ")} Missing readings are not treated as zero pours.`;
  }

  const comparisonReason = getComparisonUnavailableReason({
    eligibleTapCount: tapRows.length,
    latestPeriod: latestTime,
    stale,
    previousPeriod: previousPeriodExists,
    includedTapCount: comparisonCoverage.includedTapCount,
  });
  const moversBase = comparisonAvailable
    ? buildMovers(comparisonProducts, latestTime, previousTime, settings)
    : makeUnavailableSection(comparisonReason, {
      percentBaseOz: settings.minimumPercentBaseOz,
      risers: [],
      fallers: [],
    });
  const movers = {
    ...moversBase,
    eligibleTapCount: tapRows.length,
    includedTapCount: comparisonCoverage.includedTapCount,
    excludedTapCount: comparisonCoverage.excludedTapCount,
    excludedTaps: comparisonCoverage.excludedTaps,
    partial: comparisonCoverage.partial,
  };

  const requiredSustainedTimes = latestTime
    ? Array.from(
      { length: settings.sustainedWeeks },
      (_, index) => latestTime - (index * 7 * DAY_MS),
    )
    : [];
  const sustainedCoverage = requiredSustainedTimes.length
    ? buildSustainedTapCoverage(tapRows, requiredSustainedTimes, labelsByTime)
    : {
      includedTapRows: [],
      includedTapCount: 0,
      excludedTapCount: 0,
      excludedTaps: [],
      partial: false,
      weekLabels: [],
    };
  const sustainedProducts = buildProductRows(sustainedCoverage.includedTapRows, periodTimes);
  const sustainedCoverageCopy = getSustainedCoverageCopy(
    sustainedCoverage,
    tapRows.length,
    settings.sustainedWeeks,
  );
  let sustainedBase;
  if (!tapRows.length || !latestTime) {
    sustainedBase = makeUnavailableSection(
      "No PMB poured-usage history is available for sustained-volume insights.",
      { weekCount: settings.sustainedWeeks, weekLabels: [], items: [] },
    );
  } else if (stale) {
    sustainedBase = makeUnavailableSection(
      "Pull the latest completed PMB poured-usage week before using sustained-volume insights.",
      { weekCount: settings.sustainedWeeks, weekLabels: sustainedCoverage.weekLabels, items: [] },
    );
  } else if (!sustainedCoverage.includedTapCount) {
    sustainedBase = makeUnavailableSection(
      sustainedCoverageCopy,
      { weekCount: settings.sustainedWeeks, weekLabels: sustainedCoverage.weekLabels, items: [] },
    );
  } else {
    sustainedBase = buildSustained(
      sustainedProducts,
      requiredSustainedTimes,
      labelsByTime,
      settings,
    );
  }
  const sustained = {
    ...sustainedBase,
    eligibleTapCount: tapRows.length,
    includedTapCount: sustainedCoverage.includedTapCount,
    excludedTapCount: sustainedCoverage.excludedTapCount,
    excludedTaps: sustainedCoverage.excludedTaps,
    partial: sustainedCoverage.partial,
    statusCopy: stale || !tapRows.length || !latestTime
      ? sustainedBase.reason
      : sustainedCoverageCopy,
  };

  if (!stale && sustainedCoverage.partial) {
    if (status === "ready") {
      status = "limited";
      statusLabel = "Partial PMB coverage";
      statusCopy = sustained.statusCopy;
    } else {
      statusCopy = `${statusCopy} ${sustained.statusCopy}`;
    }
  }

  let baselineTimes = [];
  if (comparisonAvailable) {
    baselineTimes = [previousTime];
    const secondBaselineTime = previousTime - (7 * DAY_MS);
    if (
      labelsByTime.has(secondBaselineTime)
      && getCoverage(comparisonCoverage.includedTapRows, secondBaselineTime).complete
    ) {
      baselineTimes.push(secondBaselineTime);
    }
  }
  const emergingLow = comparisonAvailable
    ? buildEmergingLow(comparisonProducts, latestTime, baselineTimes, settings)
    : makeUnavailableSection(comparisonReason, { baselineWeekCount: 0, items: [] });
  const categoryMix = comparisonAvailable
    ? buildCategoryMix(comparisonCoverage.includedTapRows, latestTime, previousTime, settings)
    : makeUnavailableSection(comparisonReason, { items: [] });

  return {
    status,
    statusLabel,
    statusCopy,
    period: {
      latestLabel: currentCoverage.label,
      latestStartTime: latestTime,
      previousLabel: previousCoverage.label,
      previousStartTime: previousPeriodExists ? previousTime : 0,
      expectedLatestStartTime: expectedLatestTime,
      expectedLatestStartDate: formatIsoDate(expectedLatestTime),
      stale,
    },
    coverage: {
      eligibleTapCount: tapRows.length,
      productCount: products.length,
      latestCapturedTapCount: currentCoverage.capturedTapCount,
      latestMissingTapCount: currentCoverage.missingTapCount,
      latestComplete: currentCoverage.complete,
      previousCapturedTapCount: previousCoverage.capturedTapCount,
      previousMissingTapCount: previousCoverage.missingTapCount,
      previousComplete: previousCoverage.complete,
      comparisonIncludedTapCount: comparisonCoverage.includedTapCount,
      comparisonExcludedTapCount: comparisonCoverage.excludedTapCount,
      comparisonPartial: comparisonCoverage.partial,
      excludedComparisonTaps: comparisonCoverage.excludedTaps,
    },
    sections: {
      movers,
      sustained,
      emergingLow,
      categoryMix,
    },
  };
}
