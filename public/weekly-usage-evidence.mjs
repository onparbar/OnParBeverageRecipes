import { getWeeklyUsageSource, getPmbWeeklyUsageRange } from "./pmb-weekly-usage-policy.mjs";

function nonNegativeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// A stored zero or a PMB source label does not establish historical coverage.
// This is a read-time policy: retain the original record for later review.
export function isUsableWeeklyUsageEntry(entry) {
  if (!entry || entry.hasValue === false || entry.usageUnknownReason) return false;
  const source = getWeeklyUsageSource(entry);
  if (!source || (entry.label && !getPmbWeeklyUsageRange(entry.label))) return false;
  const value = nonNegativeNumber(entry.volumeOz) ?? nonNegativeNumber(entry.value);
  if (value === null) return false;
  if (value > 0) return true;
  if (source === "CSV") return entry.hasValue === true;
  // zeroUsageVerified is an explicit reviewed-zero assertion, not inferred
  // from today's assignment, price capture, or the absence of transactions.
  return entry.zeroUsageVerified === true
    || (entry.reportComplete === true && entry.historicalAssignmentVerified === true);
}

export function selectWeeklyUsageHistory(history) {
  const weeks = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const range = getPmbWeeklyUsageRange(entry?.label);
    const source = getWeeklyUsageSource(entry);
    if (!range || !source) continue;
    const group = weeks.get(range.startTime) || [];
    const shortDate = time => {
      const d = new Date(time);
      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(-2)}`;
    };
    group.push({ ...entry, source, label: `${shortDate(range.startTime)} - ${shortDate(range.endTime)}` });
    weeks.set(range.startTime, group);
  }
  return [...weeks.entries()].sort(([a], [b]) => b - a).flatMap(([, entries]) => {
    const pmb = entries.filter(e => e.source === "PMB");
    const csv = entries.filter(e => e.source === "CSV");
    const selected = pmb.some(isUsableWeeklyUsageEntry) ? pmb.filter(isUsableWeeklyUsageEntry)
      : csv.some(isUsableWeeklyUsageEntry) ? csv.filter(isUsableWeeklyUsageEntry)
      : pmb.length ? pmb : csv;
    // Keep disagreements available to the existing conflict checks, but never
    // count identical copies from shared state and the CSV bootstrap twice.
    return [...new Map(selected.map(e => [JSON.stringify(e), e])).values()];
  });
}

export function retainWeeklyUsageItems(items) {
  return (Array.isArray(items) ? items : []).filter(Boolean).map(item => {
    const history = selectWeeklyUsageHistory(item.history);
    const values = history.filter(isUsableWeeklyUsageEntry).map(entry => nonNegativeNumber(entry.value)).filter(value => value !== null);
    return { ...item, history, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0 };
  });
}

export function retainWeeklyUsageOverrides(overrides) {
  return Object.fromEntries(Object.entries(overrides && typeof overrides === "object" ? overrides : {})
    .map(([id, history]) => [id, selectWeeklyUsageHistory(history)]));
}

// Known spelling/label variants in the saved spreadsheets. Keep actual product
// differences (for example Garage Beer versus Garage Beer Lime) distinct.
export function getWeeklyUsageCsvIdentity(item) {
  const name = String(item?.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[’']/g, "").replace(/\b\d+(?:\.\d+)?\s*(?:ml|l|liter|litre)\b/g, " ")
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\bvanilla\b/g, "vanilia")
    .replace(/\bmiller light\b/g, "miller lite")
    .replace(/\bcrown (apple|peach)\b/g, "crown royal $1")
    .replace(/\bjameson irish\b/g, "jameson")
    .replace(/\bpatron silver\b/g, "patron")
    .replace(/\bstella artois\b/g, "stella")
    .replace(/\bdortmunder gold lager\b/g, "dortmunder gold")
    .replace(/\bginny from the block\b/g, "gin and juice")
    .replace(/\bbombay sapphire\b/g, "bombay")
    .replace(/\bjack and lemonade jack daniels\b/g, "jack and lemonade")
    .replace(/\bcaptain quencher 1 captain morgan\b/g, "captain quencher captain morgan")
    .replace(/\s+[123]$/, "");
  return `${Number(item?.tapNumber)}:${name}`;
}

export function mergeWeeklyUsageCsvFallbackData(data, fallbackItems = []) {
  const next = structuredClone(data);
  next.activeItems ||= [];
  next.archivedItems ||= [];
  next.historyOverrides ||= {};
  const key = getWeeklyUsageCsvIdentity;
  for (const fallback of fallbackItems) {
    const history = selectWeeklyUsageHistory(fallback.history).filter(e => e.source === 'CSV');
    if (!history.length) continue;
    const matches = [...next.activeItems, ...next.archivedItems].filter(item => key(item) === key(fallback));
    if (matches.length > 1) continue; // Ambiguous saved identity requires review.
    if (!matches.length) {
      next.archivedItems.push({ ...structuredClone(fallback), hidden: true,
        archiveId: fallback.archiveId || fallback.id, history });
      continue;
    }
    const item = matches[0];
    const existing = next.historyOverrides[item.id] || item.history || [];
    const answeredWeeks = new Set(selectWeeklyUsageHistory(existing).filter(isUsableWeeklyUsageEntry).map(entry => entry.label));
    item.history = selectWeeklyUsageHistory([...existing, ...history.filter(entry => !answeredWeeks.has(entry.label))]);
    if (Object.hasOwn(next.historyOverrides, item.id)) next.historyOverrides[item.id] = structuredClone(item.history);
  }
  next.activeItems = retainWeeklyUsageItems(next.activeItems);
  next.archivedItems = retainWeeklyUsageItems(next.archivedItems);
  next.historyOverrides = retainWeeklyUsageOverrides(next.historyOverrides);
  return next;
}
