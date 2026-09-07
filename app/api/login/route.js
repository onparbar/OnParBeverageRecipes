import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import {
  DASHBOARD_SESSION_COOKIE,
  DASHBOARD_SESSION_MAX_AGE_SECONDS,
  matchDashboardIdentity,
  requireDashboardAuthConfiguration,
  signDashboardSession,
} from "../../../lib/dashboard-auth.mjs";
import {
  dashboardLoginThrottle,
  dashboardLoginNetworkThrottle,
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
  const rateLimit = dashboardLoginNetworkThrottle.check(clientKey);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        error: `Too many attempts from this network. Try again in ${Math.ceil(rateLimit.retryAfterSeconds / 60)} minute(s).`,
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

  // Never retain the submitted clock-in number in the throttle map.
  const attemptKey = `${clientKey}:${createHash("sha256").update(submittedPassword).digest("hex")}`;
  const individualLimit = dashboardLoginThrottle.check(attemptKey);
  if (!individualLimit.allowed) {
    return jsonResponse({
      error: `Too many attempts with this clock-in number. Try again in ${Math.ceil(individualLimit.retryAfterSeconds / 60)} minute(s).`,
      code: "LOGIN_RATE_LIMITED",
      retryAfterSeconds: individualLimit.retryAfterSeconds,
    }, 429, { "Retry-After": String(individualLimit.retryAfterSeconds) });
  }
  const identity = await matchDashboardIdentity(submittedPassword);
  if (!identity) {
    dashboardLoginNetworkThrottle.recordFailure(clientKey);
    const failure = dashboardLoginThrottle.recordFailure(attemptKey);
    if (!failure.allowed) {
      return jsonResponse(
        {
          error: `Too many attempts with this clock-in number. Try again in ${Math.ceil(failure.retryAfterSeconds / 60)} minute(s).`,
          code: "LOGIN_RATE_LIMITED",
          retryAfterSeconds: failure.retryAfterSeconds,
        },
        429,
        { "Retry-After": String(failure.retryAfterSeconds) },
      );
    }
    return jsonResponse({
      error: "Clock-in number not recognized.",
      code: "LOGIN_FAILED",
    }, 401);
  }

  dashboardLoginThrottle.reset(attemptKey);
  const response = jsonResponse({
    ok: true,
    role: identity.role,
    access: identity.role === "owner" ? "admin" : "staff",
    name: identity.name,
    user: { id: identity.id, name: identity.name, role: identity.role },
  });
  response.cookies.set({
    name: DASHBOARD_SESSION_COOKIE,
    value: await signDashboardSession(identity),
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DASHBOARD_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
