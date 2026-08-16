import { NextResponse } from "next/server";
import { readDashboardActivity, recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "../../../lib/dashboard-auth.mjs";

export const runtime = "nodejs";

export async function GET(request) {
  try {
    const role = await getDashboardSessionRole(request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);
    if (role !== "owner") {
      return NextResponse.json({ error: role ? "Owner login required." : "Login required." }, { status: role ? 403 : 401 });
    }
    return NextResponse.json(await readDashboardActivity(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not load shared change history." }, { status: 503 });
  }
}

export async function POST(request) {
  try {
    const role = await getDashboardSessionRole(request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);
    if (role !== "owner") {
      return NextResponse.json({ error: role ? "Owner login required." : "Login required." }, { status: role ? 403 : 401 });
    }
    const body = await request.json().catch(() => ({}));
    const event = String(body.event || "");
    const allowed = {
      monday_snapshot_attempt: ["started Monday snapshot", "Monday Inventory Snapshot capture started."],
      monday_snapshot_failed: ["Monday snapshot preflight blocked", `Monday Inventory Snapshot was not changed. ${String(body.code || "SOURCE_NOT_READY").replace(/[^A-Z0-9_-]/gi, "").slice(0, 60)}.`],
    }[event];
    if (!allowed) return NextResponse.json({ error: "Unsupported activity event." }, { status: 400 });
    await recordDashboardActivity({ area: "Inventory", action: allowed[0], role, summary: allowed[1] });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Could not record activity." }, { status: 503 });
  }
}
