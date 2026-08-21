import { NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardAuthStatus,
  getDashboardSessionRole,
} from "./lib/dashboard-auth.mjs";
import { isEmployeeAllowedDashboardRequest } from "./lib/dashboard-access.mjs";

async function getSessionRole(request) {
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  return getDashboardSessionRole(session);
}

function isPublicPath(pathname) {
  return [
    "/login",
    "/api/login",
    "/api/logout",
    "/api/health",
    "/api/version",
  ].includes(pathname);
}

function isApiPath(pathname) {
  return pathname.startsWith("/api/");
}

const PUBLIC_HOSTS = new Set(["onparbev.com", "www.onparbev.com"]);

function firstForwardedValue(value) {
  return String(value || "").split(",")[0].trim().toLowerCase();
}

function getRedirectOrigin(request) {
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const requestHost = firstForwardedValue(request.headers.get("host"));
  const publicHost = [forwardedHost, requestHost, request.nextUrl.hostname]
    .map((host) => host.split(":")[0])
    .find((host) => PUBLIC_HOSTS.has(host));

  if (publicHost) return `https://${publicHost}`;
  if (request.headers.get("cf-ray")) return "https://onparbev.com";
  return request.nextUrl.origin;
}

function redirectToPublicPath(request, pathname, searchParams = new URLSearchParams()) {
  const url = new URL(pathname, getRedirectOrigin(request));
  url.search = searchParams.toString();
  return NextResponse.redirect(url, {
    headers: { "Cache-Control": "no-store" },
  });
}

function nextPrivateResponse() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const sessionRole = await getSessionRole(request);
  const isAuthed = Boolean(sessionRole);

  if (isPublicPath(pathname)) {
    if (isAuthed && pathname === "/login") {
      return redirectToPublicPath(request, "/");
    }
    return NextResponse.next();
  }

  if (isAuthed) {
    if (sessionRole === "employee") {
      if (pathname === "/") {
        return redirectToPublicPath(request, "/staff");
      }
      if (!isEmployeeAllowedDashboardRequest({ pathname, method: request.method })) {
        if (isApiPath(pathname)) {
          return NextResponse.json(
            { error: "Owner login required." },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        }
        return new NextResponse("Owner login required.", {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/plain; charset=utf-8",
          },
        });
      }
      return nextPrivateResponse();
    }
    return nextPrivateResponse();
  }

  if (isApiPath(pathname)) {
    return NextResponse.json(
      { error: "Login required." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const loginParams = new URLSearchParams();
  loginParams.set("next", `${pathname}${request.nextUrl.search}`);
  const authStatus = getDashboardAuthStatus();
  if (!authStatus.hasOwnerPassword) {
    loginParams.set("setup", "missing-password");
  } else if (!authStatus.hasSessionSecret) {
    loginParams.set("setup", "missing-session-secret");
  } else if (!authStatus.sessionSecretStrong) {
    loginParams.set("setup", "weak-session-secret");
  }
  return redirectToPublicPath(request, "/login", loginParams);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)",
  ],
};
