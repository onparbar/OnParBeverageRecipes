import { createSharedInventoryStore } from "./inventory-shared-store.mjs";
import { reconcileDailyReportAssignments } from "./pmb-daily-assignments.mjs";
import { reportDays, dayMillis } from "./pmb-daily-report.mjs";
import { pmbLocalMidnight } from "./pmb-first-pour-report.mjs";

// Read the complete timeline. A partial event list cannot establish continuity.
export async function readWeeklySnapshotAssignmentEvidence({
  env = process.env, fetchImpl = globalThis.fetch,
} = {}) {
  const inventory = await createSharedInventoryStore({ env, fetchImpl }).read();
  if (!inventory.initialized || !Array.isArray(inventory.snapshots)) return null;
  const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.SUPABASE_URL || !secret) return null;
  const headers = { apikey: secret };
  if (secret.split(".").length === 3) headers.Authorization = `Bearer ${secret}`;
  const events = [];
  for (let offset = 0; offset < 10000; offset += 1000) {
    const url = new URL("/rest/v1/pmb_tap_product_events", env.SUPABASE_URL);
    url.searchParams.set("select", "slot_key,occurred_at,product");
    url.searchParams.set("order", "id");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("offset", String(offset));
    const response = await fetchImpl(url, { headers, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Historical PMB assignments are unavailable.");
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("Historical PMB assignments are incomplete.");
    events.push(...rows);
    if (rows.length < 1000) return { events, snapshots: inventory.snapshots };
  }
  throw new Error("Historical PMB assignments exceed the supported complete-read limit.");
}

export function findWeeklySnapshotAssignment(item, report, evidence, observedThrough) {
  if (!evidence || !Number.isInteger(Number(item?.tapNumber)) || !(Number(item.tapNumber) > 0)) return null;
  let days;
  let endTime;
  try {
    days = reportDays(report.startDate, report.endDate);
    endTime = Date.parse(pmbLocalMidnight(dayMillis(report.endDate) + 86400000));
  } catch {
    return null;
  }
  if (days.length !== 7 || !(Date.parse(observedThrough) >= endTime)) return null;
  const sources = new Map();
  for (const day of days) {
    // Deliberately do not supply today's tap number as historical evidence.
    const candidate = reconcileDailyReportAssignments({ day, rows: [{
      product: item.name, plu: item.plu, tapNumber: null,
    }] }, evidence).rows[0];
    if (Number(candidate.tapNumber) !== Number(item.tapNumber)
      || !candidate.assignmentResolution?.sources?.length) return null;
    for (const source of candidate.assignmentResolution.sources) {
      sources.set(JSON.stringify(source), source);
    }
  }
  return {
    method: "whole-week-historical-assignment",
    startDate: report.startDate,
    endDate: report.endDate,
    sources: [...sources.values()].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)),
  };
}
