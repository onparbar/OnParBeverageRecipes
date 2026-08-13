import { NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE } from "../../../lib/dashboard-auth.mjs";

function clearSessionCookie(response) {
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

export async function POST() {
  return clearSessionCookie(NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  ));
}

export async function GET() {
  return clearSessionCookie(new NextResponse(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      Location: "/login",
    },
  }));
}
