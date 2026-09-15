import { NextResponse } from 'next/server';
import { requireDashboardRequestRole } from '../../../lib/dashboard-auth.mjs';
import { parseReportHistoryRequest, readPmbReportHistory } from '../../../lib/pmb-report-history.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
let running = false;

export async function GET(request) {
  let claimed = false;
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const input = parseReportHistoryRequest(new URL(request.url).searchParams);
    if (running) return NextResponse.json({ error: 'A PMB report lookup is already running.' }, { status: 429, headers });
    running = true;
    claimed = true;
    const report = await readPmbReportHistory(input);
    return NextResponse.json({ ...report, source: 'PMB management read-only', capturedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    return NextResponse.json({ error: error.status === 422 ? error.message : 'The PMB report lookup is unavailable.' }, { status: error.status || 503, headers });
  } finally {
    if (claimed) running = false;
  }
}
