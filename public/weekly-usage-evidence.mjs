import { isPmbUsageEntry, getPmbWeeklyUsageRange, filterPmbWeeklyUsageHistory } from "./pmb-weekly-usage-policy.mjs";

function nonNegativeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// A stored zero or a PMB source label does not establish historical coverage.
// This is a read-time policy: retain the original record for later review.
export function isUsableWeeklyUsageEntry(entry) {
  if (!entry || entry.hasValue === false || entry.usageUnknownReason) return false;
  if (!isPmbUsageEntry(entry) || (entry.label && !getPmbWeeklyUsageRange(entry.label))) return false;
  const value = nonNegativeNumber(entry.volumeOz) ?? nonNegativeNumber(entry.value);
  if (value === null) return false;
  if (value > 0) return true;
  // zeroUsageVerified is an explicit reviewed-zero assertion, not inferred
  // from today's assignment, price capture, or the absence of transactions.
  return entry.zeroUsageVerified === true
    || (entry.reportComplete === true && entry.historicalAssignmentVerified === true);
}

export function retainPmbWeeklyUsageItems(items) {
  return (Array.isArray(items) ? items : []).filter(Boolean).map(item => {
    const history = filterPmbWeeklyUsageHistory(item.history);
    const values = history.filter(isUsableWeeklyUsageEntry).map(entry => nonNegativeNumber(entry.value)).filter(value => value !== null);
    return { ...item, history, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
  });
}

export function retainPmbWeeklyUsageOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides && typeof overrides === "object" ? overrides : {})
    .map(([id, history]) => [id, filterPmbWeeklyUsageHistory(history)]));
}
