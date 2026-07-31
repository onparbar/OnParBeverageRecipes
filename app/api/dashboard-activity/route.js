import { NextResponse } from "next/server";
import { readDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
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
