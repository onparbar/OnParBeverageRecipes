import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { readSharedWeeklyUsageState } from "../../../lib/weekly-usage-shared-store.mjs";
import { recoverWeeklyUsageState } from "../../../lib/weekly-usage-recovery.mjs";
import { loadPmbWeeklyUsageReport } from "../../../lib/weekly-usage-recovery-runtime.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The same revision-checked recovery runs on the service computer's scheduler.
// The browser triggers it but never receives a raw report to publish back.
export async function POST(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const current = await readSharedWeeklyUsageState();
    const state = await recoverWeeklyUsageState(current, loadPmbWeeklyUsageReport);
    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Weekly Usage refresh failed." }, {
      status: error.status || 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
