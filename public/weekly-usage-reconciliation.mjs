import { isUsableWeeklyUsageEntry } from "./weekly-usage-evidence.mjs";

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const stable = (value) => Array.isArray(value) ? value.map(stable)
  : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const number = (value) => value === null || value === undefined || String(value).trim() === ""
  ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const ounces = (entry) => number(entry?.volumeOz) ?? number(entry?.value);
const evidenceFields = ["zeroUsageVerified", "reportComplete", "historicalAssignmentVerified", "zeroUsageEvidence", "usageUnknownReason", "hasValue"];

// Merge repeated captures of the SAME measurement without losing reviewed-zero
// evidence. Different measurements take the normal three-way conflict path.
function sameMeasurement(left, right) {
  return object(left) && object(right) && left.label === right.label
    && left.source === right.source && ounces(left) !== null
    && ounces(left) === ounces(right)
    && (number(left.volumeOz) === null) === (number(right.volumeOz) === null);
}

function mergeCapture(left, right) {
  const leftTime = Date.parse(left.priceCapturedAt) || 0;
  const rightTime = Date.parse(right.priceCapturedAt) || 0;
  const result = leftTime > rightTime ? { ...right, ...left } : { ...left, ...right };
  if (ounces(left) === 0) {
    const verified = [left, right].find((entry) => isUsableWeeklyUsageEntry(entry));
    if (verified) {
      for (const field of evidenceFields) {
        if (Object.hasOwn(verified, field)) result[field] = clone(verified[field]);
        else delete result[field];
      }
    }
  }
  return clone(result);
}

export function reconcileWeeklyUsageData(base, local, remote) {
  const conflicts = [];
  const conflictDetails = [];
  const preview = (value) => Array.isArray(value) ? { records: value.length }
    : object(value) ? { fields: Object.keys(value).slice(0, 12) } : value ?? null;
  if (![base, local, remote].every(object)) return { ok: false, data: null, conflicts: ["missing-baseline"], conflictDetails: [{ path: "missing-baseline", base: Boolean(base), local: Boolean(local), shared: Boolean(remote) }] };

  function merge(b, l, r, path, key = "") {
    if (key === "capture" && sameMeasurement(l, r)) return mergeCapture(l, r);
    if (equal(l, r)) return clone(l);
    if (equal(l, b)) return clone(r);
    if (equal(r, b)) return clone(l);
    if (key === "lastSyncAt" && [l, r].every((value) => Number.isFinite(Date.parse(value)))) {
      return Date.parse(l) > Date.parse(r) ? l : r;
    }
    // Independent syncs can archive the same former assignment at different
    // times. Keep the earliest observation, not a fabricated pour/swap date.
    // Other record fields still follow the normal conflict checks below.
    if (key === "replacedAt" && /^archivedItems\.[^.]+\.replacedAt$/.test(path)
      && [l, r].every((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))) {
      return Date.parse(l) < Date.parse(r) ? l : r;
    }
    if ([l, r].every(Array.isArray) && (b === undefined || Array.isArray(b))) {
      const history = key === "history" || key === "excludedUnverifiedHistory" || path.startsWith("historyOverrides.");
      const records = key === "activeItems" || key === "archivedItems";
      if (history || records) {
        const id = (entry) => history ? entry?.label : entry?.archiveId || entry?.id;
        const index = (rows) => {
          const map = new Map();
          for (const entry of rows || []) {
            const identity = id(entry);
            if (!identity || map.has(identity)) { conflicts.push(`${path}:ambiguous-identity`); continue; }
            map.set(identity, entry);
          }
          return map;
        };
        const bm = index(b), lm = index(l), rm = index(r);
        return [...new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])].flatMap((identity) => {
          const value = merge(bm.get(identity), lm.get(identity), rm.get(identity), `${path}.${identity}`, history ? "capture" : "item");
          return value === undefined ? [] : [value];
        });
      }
    }
    if (object(l) && object(r) && (b === undefined || object(b))) {
      const result = {};
      for (const field of new Set([...Object.keys(b || {}), ...Object.keys(l), ...Object.keys(r)])) {
        // Averages are derived from the merged history, not independently edited.
        if (key === "item" && field === "average") continue;
        const value = merge(b?.[field], l[field], r[field], path ? `${path}.${field}` : field, field);
        if (value !== undefined) result[field] = value;
      }
      if (key === "item" && Array.isArray(result.history)) {
        const values = result.history.filter(isUsableWeeklyUsageEntry).map((entry) => number(entry.value)).filter((value) => value !== null);
        result.average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
      }
      return result;
    }
    conflicts.push(path || "data");
    conflictDetails.push({ path: path || "data", base: preview(b), local: preview(l), shared: preview(r) });
    return undefined;
  }

  const data = merge(base, local, remote, "");
  // Two simultaneous assignments cannot both become the current product on a tap.
  const taps = new Set();
  for (const item of data?.activeItems || []) {
    const tap = Number(item.tapNumber);
    if (!(tap > 0)) continue;
    if (taps.has(tap)) conflicts.push(`activeItems:tap-${tap}`);
    taps.add(tap);
  }
  return { ok: conflicts.length === 0, data: conflicts.length ? null : data, conflicts, conflictDetails };
}
