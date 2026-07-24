import { NextResponse } from "next/server";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "./lib/dashboard-auth.mjs";

async function getSessionRole(request) {
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  return getDashboardSessionRole(session);
}

function isPublicPath(pathname) {
  return pathname === "/login" || pathname === "/api/login";
}

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

function isEmployeeAllowedApiPath(pathname) {
  return pathname === "/api/session";
}

function getPublicUrl(request, pathname) {
  const protocol = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || request.nextUrl.host;
  return new URL(pathname, `${protocol}://${host}`);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const sessionRole = await getSessionRole(request);
  const isAuthed = Boolean(sessionRole);

  if (isPublicPath(pathname)) {
    if (isAuthed && pathname === "/login") {
      return NextResponse.redirect(getPublicUrl(request, "/"));
    }
    return NextResponse.next();
  }

  if (isAuthed) {
    if (sessionRole === "employee" && isApiPath(pathname) && !isEmployeeAllowedApiPath(pathname)) {
      return NextResponse.json({ error: "Owner login required." }, { status: 403 });
    }
    return NextResponse.next();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json({ error: "Login required." }, { status: 401 });
  }

  const loginUrl = getPublicUrl(request, "/login");
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  if (!process.env.DASHBOARD_PASSWORD) {
    loginUrl.searchParams.set("setup", "missing-password");
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
