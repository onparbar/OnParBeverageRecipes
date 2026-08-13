import { NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "../../../lib/dashboard-auth.mjs";

export async function GET(request) {
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  const role = await getDashboardSessionRole(session);

  if (!role) {
    return NextResponse.json(
      { error: "Login required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
