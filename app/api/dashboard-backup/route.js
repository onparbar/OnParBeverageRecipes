import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { createBackupStore } from "../../../lib/dashboard-backup-store.mjs";
import { BACKUP_STATUS_SOURCE } from "../../../lib/dashboard-backup.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const KINDS = new Set(["product-catalog", "dashboard-config", "inventory", "weekly-plan", "weekly-usage", "tap-assignments", "activity", "pmb-reports", "keg-levels", "source-data", "tap-observation", "daily-report"]);
export async function GET(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const store = createBackupStore();
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind");
    if (kind) {
      if (!KINDS.has(kind)) return NextResponse.json({ error: "Unknown history category." }, { status: 400, headers });
      const query = { select: "source,data,captured_at", source: `like.history-${kind}-*`, order: "captured_at.desc,source", limit: 100 };
      if (params.get("before")) {
        const before = new Date(params.get("before"));
        if (!Number.isFinite(before.getTime())) return NextResponse.json({ error: "Use a valid history date." }, { status: 400, headers });
        query.captured_at = `lte.${before.toISOString()}`;
      }
      if (params.get("identity")) query["data->>identity"] = `eq.${params.get("identity")}`;
      return NextResponse.json({ history: await store.rest("pmb_data_backup", query), timeZone: "America/New_York" }, { headers });
    }
    const saved = await store.read(BACKUP_STATUS_SOURCE);
    if (!saved) return NextResponse.json({ status: "not-started", lastSuccessfulAt: null }, { headers });
    const { heads, dailyAttempts, ...status } = saved.data;
    return NextResponse.json({ ...status, archivedStreams: Object.keys(heads || {}).length,
      stale: Date.now() - Date.parse(status.finishedAt) > 45 * 60000,
      recentDailyAttempts: Object.entries(dailyAttempts || {}).sort((a,b) => b[0].localeCompare(a[0])).slice(0,7).map(([day, details]) => ({ day, ...details })) }, { headers });
  } catch (error) { return NextResponse.json({ error: error.message || "Backup status unavailable." }, { status: error.status || 503, headers }); }
}
