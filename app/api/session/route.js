import { NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardSessionIdentity,
} from "../../../lib/dashboard-auth.mjs";

export async function GET(request) {
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  const identity = await getDashboardSessionIdentity(session);

  if (!identity) {
    return NextResponse.json(
      { error: "Login required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      role: identity.role,
      access: identity.role === "owner" ? "admin" : "staff",
      name: identity.name,
      user: identity,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
