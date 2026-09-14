import {
  readSharedWeeklyUsageState,
  replaceSharedWeeklyUsageState,
} from "./weekly-usage-shared-store.mjs";
import { readPmbLevelSnapshot } from "./pmb-level-snapshot-store.mjs";
import { getCocktailAwareKegFullOunces } from "../public/cocktail-recipe-yields.mjs";
import { isUsableWeeklyUsageEntry } from "../public/weekly-usage-evidence.mjs";

const DAY = 86_400_000;
const nameKey = (value) => String(value || "").normalize("NFKC")
  .toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ").trim();
const finite = (value) => value !== null && value !== undefined && value !== ""
  && Number.isFinite(Number(value));
const dateKey = (time) => new Date(time).toISOString().slice(0, 10);
const shortDate = (time) => {
  const date = new Date(time);
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}/${String(date.getUTCFullYear()).slice(-2)}`;
};

// Reporting follows the venue's Monday 7am rollover, not the server's UTC day.
export function getRecoverableUsageWeek(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", hourCycle: "h23",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  const day = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const weekday = new Date(day).getUTCDay();
  let monday = day - ((weekday + 6) % 7) * DAY;
  if (weekday === 1 && Number(parts.hour) < 7) monday -= 7 * DAY;
  const start = monday - 7 * DAY;
  const end = monday - DAY;
  return { startDate: dateKey(start), endDate: dateKey(end), label: `${shortDate(start)} - ${shortDate(end)}` };
}

function sameIdentity(item, row) {
  return Number(item?.tapNumber) === Number(row?.tapNumber)
    && Number(item?.plu) > 0 && Number(item.plu) === Number(row?.plu)
    && nameKey(item.name) === nameKey(row.name);
}

function needsRecovery(state, week) {
  return state?.initialized === true && (state.data?.activeItems || []).some((item) => (
    !item.hidden && Number(item.tapNumber) > 0
    && !(item.history || []).some((entry) => entry.label === week.label)
    && !(state.data.historyOverrides?.[item.id] || []).some((entry) => entry.label === week.label)
  ));
}

function historyTime(label) {
  const match = String(label || "").match(/^(\d+)\/(\d+)\/(\d+)/);
  if (!match) return 0;
  const year = Number(match[3]);
  return Date.UTC(year < 100 ? 2000 + year : year, Number(match[1]) - 1, Number(match[2]));
}

function mergeEntry(history, incoming) {
  const existing = history.find((entry) => entry.label === incoming.label);
  // Completed, reviewed history is not a target of automatic recovery.
  if (existing && (isUsableWeeklyUsageEntry(existing) || existing.zeroUsageVerified
    || String(existing.source || "").toUpperCase() !== "PMB")) return history;
  return [...history.filter((entry) => entry.label !== incoming.label), incoming]
    .sort((a, b) => historyTime(b.label) - historyTime(a.label));
}

function convertEntry(item, row, report, snapshot) {
  if (!finite(row.volumeOz) || Number(row.volumeOz) < 0) {
    throw new Error("PMB recovery received invalid poured ounces. No history was saved.");
  }
  const volumeOz = Number(row.volumeOz);
  const levels = (snapshot?.items || []).filter((level) => sameIdentity(item, level));
  const fullOz = getCocktailAwareKegFullOunces(
    levels.length === 1 ? levels[0] : null,
    { name: item.name },
    Number(item.kegOz || item.batchOz) || 0,
  );
  const ounces = item.displayUnit === "oz" || item.isLiquorShot === true;
  const conversionAvailable = ounces || fullOz > 0;
  const hasValue = conversionAvailable && isUsableWeeklyUsageEntry({ ...row, value: volumeOz });
  return {
    ...row,
    label: report.label,
    source: "PMB",
    value: conversionAvailable ? Number((ounces ? volumeOz : volumeOz / fullOz).toFixed(2)) : null,
    volumeOz,
    hasValue,
    usageUnknownReason: !conversionAvailable
      ? "Poured ounces were saved, but this product's keg size is unavailable."
      : String(row.usageUnknownReason || (hasValue ? "" : "Zero usage has not been verified.")),
    reportStartDate: report.startDate,
    reportEndDate: report.endDate,
    recoveredAt: report.updatedAt,
  };
}

export function mergeRecoveredWeeklyReport(data, report, snapshot = null) {
  if (!Array.isArray(report?.items) || !report.items.length || !report.label
    || !report.startDate || !report.endDate) {
    throw new Error("PMB recovery did not return a complete report. Existing history was preserved.");
  }
  const next = structuredClone(data);
  next.activeItems ||= [];
  next.archivedItems ||= [];
  next.historyOverrides ||= {};
  const used = new Set();
  const records = [...next.activeItems, ...next.archivedItems];
  for (const item of records) {
    const candidates = report.items.map((row, index) => ({ row, index }))
      .filter(({ row }) => sameIdentity(item, row));
    if (candidates.length > 1) {
      throw new Error(`PMB recovery returned duplicate product rows for tap ${item.tapNumber}. No history was saved.`);
    }
    if (!candidates.length) continue;
    const { row, index } = candidates[0];
    if (used.has(index)) {
      throw new Error(`Saved history has duplicate identities for tap ${item.tapNumber}. No history was saved.`);
    }
    used.add(index);
    const existing = new Map((item.history || []).map((entry) => [entry.label, entry]));
    const overridden = Object.hasOwn(next.historyOverrides, item.id);
    if (overridden) {
      for (const entry of next.historyOverrides[item.id]) existing.set(entry.label, entry);
    }
    item.history = mergeEntry([...existing.values()], convertEntry(item, row, report, snapshot));
    const values = item.history.filter(isUsableWeeklyUsageEntry)
      .filter((entry) => finite(entry.value)).map((entry) => Number(entry.value));
    item.average = values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
    if (overridden) next.historyOverrides[item.id] = structuredClone(item.history);
  }
  // Unmatched former products stay separate. Never assign their pours to the
  // replacement on the same tap, and never discard their report evidence.
  report.items.forEach((row, index) => {
    if (used.has(index)) return;
    const id = `pmb-report-${Number(row.tapNumber) || "unassigned"}-${row.plu}-${nameKey(row.name).replace(/[^a-z0-9]+/g, "-")}`;
    const existing = next.archivedItems.find((item) => item.archiveId === id);
    const item = existing || {
      id, archiveId: id, name: row.name, plu: row.plu,
      tapNumber: row.tapNumber || null, wall: row.wall || "", type: row.type || "",
      hidden: true, reportOnly: true, displayUnit: "oz", isLiquorShot: false,
      history: [], average: 0,
    };
    item.history = mergeEntry(item.history, convertEntry(item, row, report, snapshot));
    if (!existing) next.archivedItems.push(item);
  });
  next.lastSyncAt = report.updatedAt;
  return next;
}

export function createWeeklyUsageRecovery({
  readState = readSharedWeeklyUsageState,
  replaceState = replaceSharedWeeklyUsageState,
  readSnapshot = readPmbLevelSnapshot,
  now = () => new Date(),
} = {}) {
  let inFlight = null;
  let attemptedWeek = "";
  let nextAttemptAt = 0;
  return async function recover(initialState, loadReport) {
    const week = getRecoverableUsageWeek(now());
    if (!needsRecovery(initialState, week)) return initialState;
    if (inFlight) {
      try {
        await inFlight;
        return await readState();
      } catch (error) {
        const current = await readState();
        return { ...current, recovery: { status: "pending", week: week.label,
          message: error.message || "The latest PMB week could not be recovered." } };
      }
    }
    if (attemptedWeek === week.startDate && now().getTime() < nextAttemptAt) return initialState;
    attemptedWeek = week.startDate;
    nextAttemptAt = now().getTime() + 5 * 60_000;
    inFlight = (async () => {
      const payload = await loadReport(week);
      const report = (payload.reports || [payload]).find((entry) => entry.startDate === week.startDate);
      if (!report || report.label !== week.label || report.endDate !== week.endDate) {
        throw new Error("PMB returned a different week. Existing usage history was preserved.");
      }
      const completed = { ...report, updatedAt: payload.updatedAt || now().toISOString() };
      const snapshot = await readSnapshot().catch(() => null);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await readState();
        if (!needsRecovery(current, week)) return current;
        const data = mergeRecoveredWeeklyReport(current.data, completed, snapshot);
        try {
          return await replaceState({ expectedRevision: current.revision, data }, "owner");
        } catch (error) {
          if (error.status !== 409 || attempt === 2) throw error;
          // Reload and reapply the report, not a stale full-state replacement.
        }
      }
      return readState();
    })();
    try {
      return await inFlight;
    } catch (error) {
      // A report outage must not make already-saved history unavailable.
      const current = await readState();
      return { ...current, recovery: { status: "pending", week: week.label,
        message: error.message || "The latest PMB week could not be recovered." } };
    } finally {
      inFlight = null;
    }
  };
}

export const recoverWeeklyUsageState = createWeeklyUsageRecovery();
