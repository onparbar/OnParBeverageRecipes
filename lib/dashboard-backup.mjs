import { refreshPmbProductCatalog } from "./pmb-product-catalog.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createBackupStore } from "./dashboard-backup-store.mjs";
import { businessDate, dayMillis } from "./pmb-daily-report.mjs";
import { importPmbDailyReport } from "./pmb-daily-import.mjs";
import { getTapConfigRows, getKegTappedOnRows } from "./pmb-tap-config.mjs";
import { buildVerifiedKegSlotMap } from "./pmb-keg-safety.mjs";
import { recordTapProductObservations } from "./pmb-tap-product-history.mjs";

const DAY = 86400000;
export const BACKUP_INTERVAL_MS = 15 * 60000;
export const BACKUP_STATUS_SOURCE = "dashboard-backup-status";
export const BACKUP_TABLES = Object.freeze([
  ["dashboard_shared_state", "dashboard-config", "id"],
  ["inventory_shared_state", "inventory", "id"],
  ["keg_par_agent_shared_state", "weekly-plan", "id"],
  ["weekly_usage_shared_state", "weekly-usage", "id"],
  ["pmb_tap_product_events", "tap-assignments", "id"],
  ["dashboard_activity_log", "activity", "id"],
]);
export const BACKUP_FILES = Object.freeze(["inventory-2026-06-01.csv", "weekly-usage-history-extra.csv", "keg-levels-template.csv", "weekly-usage-changeovers.csv", "new-cocktails.csv", "weekly-usage-history.csv", "cocktail-recipes.csv"]);
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const cleanName = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

export function earliestHistoryDay(values, fallback) {
  let earliest = fallback;
  function visit(value) {
    if (typeof value === "string") {
      for (const match of value.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b|\b(\d{1,2})\/(\d{1,2})\/(\d{2}|20\d{2})\b/g)) {
        const day = match[1] || `${match[4].length === 2 ? `20${match[4]}` : match[4]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
        try { dayMillis(day); if (day < earliest) earliest = day; } catch { /* Not a report date. */ }
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  }
  values.forEach(visit); return earliest;
}

export function selectDailyBackfill({ startDay, now = new Date(), savedDays = [], attempts = {}, limit = 2 }) {
  const today = dayMillis(businessDate(now)), first = dayMillis(startDay);
  const saved = new Set(savedDays); const due = day => !attempts[day]?.retryAfter || Date.parse(attempts[day].retryAfter) <= now.getTime();
  const picks = [];
  // Prioritize recent completed days, then steadily backfill the oldest gaps.
  for (let n = 1; n <= 3 && picks.length < limit; n++) {
    const day = isoDay(today - n * DAY);
    if (day >= startDay && due(day) && (!saved.has(day) || !attempts[day]?.lastSuccessAt || now - Date.parse(attempts[day].lastSuccessAt) >= DAY)) picks.push(day);
  }
  for (let ms = first; ms < today && picks.length < limit; ms += DAY) {
    const day = isoDay(ms);
    if (!saved.has(day) && due(day) && !picks.includes(day)) picks.push(day);
  }
  return picks;
}

export async function readBackupTapObservations({ env = process.env, now = new Date() } = {}) {
  const config = { baseUrl: String(env.PMB_API_BASE_URL || "").trim().replace(/\/$/, ""), username: env.PMB_API_USERNAME, password: env.PMB_API_PASSWORD };
  if (!config.baseUrl || !config.username || !config.password) throw new Error("PMB observation connection is not configured.");
  const taps = [...buildVerifiedKegSlotMap(await getTapConfigRows(config, { timeoutMs: 5000 })).values()];
  const refills = await getKegTappedOnRows(config, { timeoutMs: 5000 });
  const observations = taps.map(tap => {
    const matching = refills.filter(r => r.deviceId === tap.deviceId && r.lineNum === tap.lineNum && r.tapNumber === tap.tapNumber && cleanName(r.name) === cleanName(tap.product || tap.name));
    return { ...tap, name: tap.product || tap.name, tappedOn: matching.length === 1 ? matching[0].tappedOn : "", evidence: "PMB observed assignment and reported last refill", timeZone: "America/New_York" };
  });
  await recordTapProductObservations(observations, { env, observedAt: now.toISOString() });
  return observations;
}

export function createDashboardBackupJob({ env = process.env, now = () => new Date(), store = createBackupStore({ env, now }),
  importDay = importPmbDailyReport, readTaps = readBackupTapObservations,
  readDataFile = name => readFile(path.join(process.cwd(), "public", "data", name), "utf8"),
} = {}) {
  let running = false;
  return async function run({ includePmb = true } = {}) {
    if (running) return { skipped: true, reason: "Backup already running." };
    running = true; let lease;
    try {
      lease = await store.acquire();
      if (!lease) return { skipped: true, reason: "Another backup worker holds the lease." };
      const started = now();
      const previous = (await store.read(BACKUP_STATUS_SOURCE))?.data || {};
      let heads = previous.heads || {}; let added = 0;
      const errors = []; const datasets = {}; const attempts = { ...previous.dailyAttempts };
      const historyInputs = []; const dailyRows = [];
      const persist = async records => { const result = await store.archive(records, heads); heads = result.heads; added += result.added; };
      async function scan(table, kind, order, query = {}) {
        let count = 0;
        for (let offset = 0; offset < 100000; offset += 1000) {
          const rows = await store.rest(table, { select: "*", order, limit: 1000, offset, ...query });
          if (kind === "weekly-usage") historyInputs.push(...rows.flatMap(r => [...(r.data?.activeItems || []), ...(r.data?.archivedItems || [])].flatMap(item => item.history || [])));
          if (table === "pmb_data_backup") dailyRows.push(...rows.filter(r => /^pmb-daily-\d{4}-\d{2}-\d{2}$/.test(r.source)));
          if (rows.length) await persist([{ kind, identity: `page-${offset / 1000}`, payload: { table, rows } }]);
          count += rows.length;
          if (rows.length < 1000) { datasets[kind] = { rows: count, checkedAt: now().toISOString() }; return; }
        }
        throw new Error(`${kind} exceeds the current paging budget; the backup is incomplete.`);
      }
      for (const [table, kind, order] of BACKUP_TABLES) {
        try { await scan(table, kind, order); } catch (e) { errors.push({ area: kind, message: e.message }); }
      }
      try { await scan("pmb_data_backup", "pmb-reports", "source", { and: "(source.not.like.history-*,source.not.like.dashboard-backup-*)" }); }
      catch (e) { errors.push({ area: "pmb-reports", message: e.message }); }
      // A daily full level snapshot complements per-change tap/refill records.
      if (previous.levelSnapshotDay !== businessDate(started)) {
        try { await scan("pmb_level_snapshot", "keg-levels", "id"); }
        catch (e) { errors.push({ area: "keg-levels", message: e.message }); }
      }
      for (const filename of BACKUP_FILES) {
        try {
          const text = await readDataFile(filename);
          if (Buffer.byteLength(text, "utf8") > 10000000) throw new Error("Source file exceeds the backup size limit.");
          if (filename.startsWith("weekly-usage-history")) historyInputs.push(text);
          await persist([{ kind: "source-data", identity: filename, payload: { filename, text } }]);
        } catch (e) { errors.push({ area: filename, message: e.message }); }
      }
      let tapCount = previous.tapCount || 0;
      if (includePmb) {
        try {
          const catalog = await refreshPmbProductCatalog({ env });
          await persist([{ kind: "product-catalog", identity: "current", payload: catalog }]);
          datasets["product-catalog"] = { rows: catalog.products.length, checkedAt: now().toISOString() };
        } catch (e) { errors.push({ area: "product-catalog", message: e.message }); }
        try {
          const taps = await readTaps({ env, now: now() }); tapCount = taps.length;
          await persist(taps.map(tap => ({ kind: "tap-observation", identity: `${tap.tapNumber}:${tap.deviceId}:${tap.lineNum}`, payload: tap })));
          datasets["tap-observation"] = { rows: taps.length, checkedAt: now().toISOString() };
        } catch (e) { errors.push({ area: "tap-observation", message: e.message }); }
      }
      const yesterday = isoDay(dayMillis(businessDate(started)) - DAY);
      const startDay = env.ONPAR_DAILY_BACKFILL_START_DATE || previous.backfillStartDay || earliestHistoryDay(historyInputs, dailyRows.map(r => r.source.slice(10)).sort()[0] || yesterday);
      dayMillis(startDay);
      const verifiedDays = dailyRows.filter(r => r.data?.coverage === "matching-overlapping-reads").map(r => r.data.day);
      if (includePmb) {
        for (const day of selectDailyBackfill({ startDay, now: started, savedDays: verifiedDays, attempts })) {
          try {
            const report = await importDay({ day }, { env, now: now() });
            await persist([{ kind: "daily-report", identity: day, payload: report }]);
            const verified = report.coverage === "matching-overlapping-reads";
            attempts[day] = { attemptedAt: now().toISOString(), lastSuccessAt: now().toISOString(), coverage: report.coverage,
              retryAfter: new Date(now().getTime() + (verified ? DAY : 6 * 3600000)).toISOString() };
            if (verified && !verifiedDays.includes(day)) verifiedDays.push(day);
            if (!verified) errors.push({ area: `daily-${day}`, message: "Saved PMB data is partial or unverified; scheduled for another read." });
          } catch (e) {
            attempts[day] = { ...attempts[day], attemptedAt: now().toISOString(), retryAfter: new Date(now().getTime() + 3600000).toISOString(), error: e.message };
            errors.push({ area: `daily-${day}`, message: e.message });
          }
        }
      }
      const finishedAt = now().toISOString();
      const status = { schemaVersion: 1, status: errors.length ? "needs-attention" : "saved", startedAt: started.toISOString(), finishedAt,
        lastSuccessfulAt: errors.length ? previous.lastSuccessfulAt || null : finishedAt,
        intervalMinutes: 15, datasets, heads, addedVersions: added, tapCount,
        levelSnapshotDay: errors.some(e => e.area === "keg-levels") ? previous.levelSnapshotDay || null : businessDate(started),
        backfillStartDay: startDay, latestCompletedDay: yesterday, verifiedDailyReports: verifiedDays.length,
        remainingDailyDays: Math.max(0, Math.floor((dayMillis(yesterday) - dayMillis(startDay)) / DAY) + 1 - verifiedDays.filter(day => day >= startDay && day <= yesterday).length),
        dailyAttempts: attempts, errors, pmbReadAttempted: includePmb };
      await store.save(BACKUP_STATUS_SOURCE, status);
      return { ...status, heads: undefined, dailyAttempts: undefined };
    } finally {
      if (lease) await store.release(lease).catch(() => {});
      running = false;
    }
  };
}
