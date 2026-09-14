import { NextResponse } from 'next/server';
import { requireDashboardRequestRole } from '../../../lib/dashboard-auth.mjs';
import { getTapConfigRows } from '../../../lib/pmb-tap-config.mjs';
import { buildVerifiedKegSlotMap } from '../../../lib/pmb-keg-safety.mjs';
import { parsePmbJson } from '../../../lib/pmb-json.mjs';
import { buildDailyReport, dailyWindows, projectDailyReport, reportDays } from '../../../lib/pmb-daily-report.mjs';
import { readDaily, readDailyRange, readAssignmentEvents, saveDaily, readMoneyUnits } from '../../../lib/pmb-daily-store.mjs';
import { requireDailyReportOrigin } from '../../../lib/pmb-daily-origin.mjs';
import { readSharedInventoryState } from '../../../lib/inventory-shared-store.mjs';
import { reconcileDailyReportAssignments } from '../../../lib/pmb-daily-assignments.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
let importing = false;
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
  let claimed = false;
  try {
    await requireDashboardRequestRole(request, { owner: true });
    requireDailyReportOrigin(request);
    const raw = await request.text();
    if (raw.length > 100000) throw Object.assign(new Error('Report request is too large.'), { status: 413 });
    const input = JSON.parse(raw);
    const windows = dailyWindows(input.day);
    if (input.costs && (!Array.isArray(input.costs) || input.costs.length > 250)) throw Object.assign(new Error('Invalid cost snapshot.'), { status: 422 });
    const costs = (input.costs || []).filter(c => Number.isFinite(Number(c.costPerOz)) && Number(c.costPerOz) > 0 && Number(c.costPerOz) < 1000);
    if (importing) throw Object.assign(new Error('A daily PMB import is already running. Try again shortly.'), { status: 429 });
    importing = true; claimed = true;
    const previous = await readDaily(input.day);
    const events = await readAssignmentEvents();
    const units = await readMoneyUnits();
    const config = { baseUrl: String(process.env.PMB_API_BASE_URL || '').trim().replace(/\/$/, ''),
      username: process.env.PMB_API_USERNAME, password: process.env.PMB_API_PASSWORD,
      clientId: Number(process.env.PMB_API_CLIENT_ID || '910423'), clientName: process.env.PMB_API_CLIENT_NAME || 'PourMyBeer API' };
    if (!config.baseUrl || !config.username || !config.password) throw new Error('PMB daily connection is not configured.');
    const deadline = AbortSignal.timeout(75000);
    async function post(path, body, token = '') {
      const response = await fetch(`${config.baseUrl}${path}`, { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body),
        signal: AbortSignal.any([deadline, request.signal, AbortSignal.timeout(18000)]) });
      if (!response.ok) throw new Error(`PMB daily read failed (${response.status}). Previous saved data was kept.`);
      const result = parsePmbJson(await response.text());
      if (!result) throw new Error('PMB returned an unreadable report.');
      return result;
    }
    const auth = await post('/api/authtoken', { username: config.username, password: config.password, id: config.clientId, name: config.clientName, type: 'json-server-control', version: 1 });
    if (!auth.authtoken) throw new Error('PMB daily authentication failed.');
    const taps = [...buildVerifiedKegSlotMap(await getTapConfigRows(config, { timeoutMs: 5000 })).values()];
    const reads = [];
    for (const range of windows) reads.push((await post('/api/transactions', { id: config.clientId, ...range }, auth.authtoken)).taptransactions);
    const report = buildDailyReport({ day: input.day, reads, taps, events, costs, previous: previous?.data });
    if (previous?.data?.coverage === 'matching-overlapping-reads' && report.coverage !== 'matching-overlapping-reads') {
      throw new Error('The new reads are less complete than the saved report. The saved report was kept.');
    }
    await saveDaily(report, previous);
    const context = report.rows.some(row => !row.tapNumber) ? await assignmentContext(events) : {};
    return NextResponse.json({ report: projectDailyReport(reconcileDailyReportAssignments(report, context), units), saved: true }, { headers });
  } catch (e) { return failure(e); }
  finally { if (claimed) importing = false; }
}
