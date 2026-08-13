import { NextResponse } from "next/server";
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  matchDashboardRole,
  requireDashboardAuthConfiguration,
  signDashboardSession,
} from "../../../lib/dashboard-auth.mjs";
import {
  dashboardLoginThrottle,
  getLoginClientKey,
} from "../../../lib/login-rate-limit.mjs";

function jsonResponse(body, status = 200, headers = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

export async function POST(request) {
  try {
    requireDashboardAuthConfiguration();
  } catch (error) {
    return jsonResponse({
      error: error.message || "Dashboard authentication is not configured.",
      code: error.code || "DASHBOARD_AUTH_NOT_CONFIGURED",
    }, 500);
  }

  const clientKey = getLoginClientKey(request);
  const rateLimit = dashboardLoginThrottle.check(clientKey);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        error: "Too many incorrect login attempts. Try again later.",
        code: "LOGIN_RATE_LIMITED",
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      429,
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  let submittedPassword = "";
  try {
    const body = await request.json();
    submittedPassword = String(body?.password || "");
  } catch {
    submittedPassword = "";
  }

  const matchedRole = matchDashboardRole(submittedPassword);
  if (!matchedRole) {
    const failure = dashboardLoginThrottle.recordFailure(clientKey);
    if (!failure.allowed) {
      return jsonResponse(
        {
          error: "Too many incorrect login attempts. Try again later.",
          code: "LOGIN_RATE_LIMITED",
          retryAfterSeconds: failure.retryAfterSeconds,
        },
        429,
        { "Retry-After": String(failure.retryAfterSeconds) },
      );
    }
    return jsonResponse({ error: "Incorrect password.", code: "LOGIN_FAILED" }, 401);
  }

  dashboardLoginThrottle.reset(clientKey);
  const response = jsonResponse({ ok: true, role: matchedRole.role });
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: await signDashboardSession(matchedRole.role),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
