import { NextResponse } from 'next/server';
import { requireDashboardRequestRole } from '../../../lib/dashboard-auth.mjs';
import { projectDailyReport, reportDays } from '../../../lib/pmb-daily-report.mjs';
import { readDailyRange, readAssignmentEvents, readMoneyUnits } from '../../../lib/pmb-daily-store.mjs';
import { requireDailyReportOrigin } from '../../../lib/pmb-daily-origin.mjs';
import { readSharedInventoryState } from '../../../lib/inventory-shared-store.mjs';
import { reconcileDailyReportAssignments } from '../../../lib/pmb-daily-assignments.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
import { importPmbDailyReport } from '../../../lib/pmb-daily-import.mjs';
function failure(error) { return NextResponse.json({ error: error.message || 'Daily reporting is unavailable.' }, { status: error.status || 503, headers }); }
async function assignmentContext(events) {
  // Optional historical evidence must not make already-saved sales reports unavailable.
  const context = { events: events || [], snapshots: [] };
  if (!events) {
    try { context.events = await readAssignmentEvents(); }
    catch { /* Keep unresolved rows unresolved when the history store is unavailable. */ }
  }
  try {
    const inventory = await readSharedInventoryState();
    if (inventory.initialized) context.snapshots = inventory.snapshots;
  } catch { /* The original PMB report remains readable without inventory snapshots. */ }
  return context;
}
export async function GET(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const p = new URL(request.url).searchParams;
    const days = reportDays(p.get('startDate'), p.get('endDate'));
    const records = await readDailyRange(days[0], days.at(-1));
    const units = await readMoneyUnits();
    const unresolved = records.some(r => r.data?.rows?.some(row => !row.tapNumber));
    const context = unresolved ? await assignmentContext() : {};
    const reports = records.map(r => projectDailyReport(reconcileDailyReportAssignments(r.data, context), units));
    return NextResponse.json({ reports, missingDays: days.filter(day => !reports.some(r => r.day === day)), timeZone: 'America/New_York' }, { headers });
  } catch (e) { return failure(e); }
}
export async function POST(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    requireDailyReportOrigin(request);
    const raw = await request.text();
    if (raw.length > 100000) throw Object.assign(new Error('Report request is too large.'), { status: 413 });
    const input = JSON.parse(raw);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Object.assign(new Error('Invalid report request.'), { status: 400 });
    const report = await importPmbDailyReport(input, { signal: request.signal });
    const units = await readMoneyUnits();
    const context = report.rows.some(row => !row.tapNumber) ? await assignmentContext() : {};
    return NextResponse.json({ report: projectDailyReport(reconcileDailyReportAssignments(report, context), units), saved: true }, { headers });
  } catch (e) { return failure(e); }
}
