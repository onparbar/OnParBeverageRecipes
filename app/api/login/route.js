import { NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, getDashboardRoles, signDashboardSession } from "../../../lib/dashboard-auth.mjs";

export async function POST(request) {
  const roles = getDashboardRoles();
  if (!roles.some((entry) => entry.role === "owner")) {
    return NextResponse.json(
      { error: "DASHBOARD_PASSWORD is not configured." },
      { status: 500 },
    );
  }

  let submittedPassword = "";
  try {
    const body = await request.json();
    submittedPassword = String(body?.password || "");
  } catch {
    submittedPassword = "";
  }

  const matchedRole = roles.find((entry) => entry.role === "owner" && submittedPassword === entry.password)
    || roles.find((entry) => entry.role === "employee" && submittedPassword === entry.password);

  if (!matchedRole) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true, role: matchedRole.role });
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: await signDashboardSession(matchedRole.role, matchedRole.password),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
