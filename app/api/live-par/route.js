import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { createBackupStore } from "../../../lib/dashboard-backup-store.mjs";
import { LIVE_PAR_SOURCE } from "../../../lib/live-par-runtime.mjs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const saved = await createBackupStore().read(LIVE_PAR_SOURCE);
    const data = saved?.data;
    const fresh = data?.status === "ready" && Date.now() - Date.parse(data.updatedAt) < 10 * 60000;
    return NextResponse.json(fresh ? data : { status: "pending", message: "Updating live recommendations." }, { headers });
  } catch (error) {
    return NextResponse.json({ status: "pending" }, { status: error.status || 503, headers });
  }
}
