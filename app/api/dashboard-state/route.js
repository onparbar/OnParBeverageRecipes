import { NextResponse } from "next/server";
import {
  initializeSharedDashboardState,
  patchSharedDashboardState,
  projectSharedDashboardStateForRole,
  readSharedDashboardState,
} from "../../../lib/shared-dashboard-store.mjs";
import {
  DASHBOARD_SESSION_COOKIE,
  getDashboardSessionRole,
} from "../../../lib/dashboard-auth.mjs";

export const runtime = "nodejs";

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function requireDashboardRole(request, { write = false } = {}) {
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  const role = await getDashboardSessionRole(session);
  if (!role) {
    const error = new Error("Login required.");
    error.code = "LOGIN_REQUIRED";
    error.status = 401;
    throw error;
  }
  if (write && role !== "owner") {
    const error = new Error("Owner login required.");
    error.code = "OWNER_REQUIRED";
    error.status = 403;
    throw error;
  }
  return role;
}

function errorResponse(error) {
  const details = error?.details && typeof error.details === "object"
    ? error.details
    : {};
  return jsonResponse(
    {
      error: error?.message || "Could not access shared dashboard state.",
      code: error?.code || "SHARED_STATE_ERROR",
      ...details,
    },
    error?.status || 500,
  );
}

export async function GET(request) {
  try {
    const role = await requireDashboardRole(request);
    const state = await readSharedDashboardState();
    return jsonResponse(projectSharedDashboardStateForRole(state, role));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request) {
  try {
    const role = await requireDashboardRole(request, { write: true });
    const body = await getBody(request);
    const state = await patchSharedDashboardState(
      { expectedRevision: body.expectedRevision, patch: body.patch },
      role,
    );
    return jsonResponse(state);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const role = await requireDashboardRole(request, { write: true });
    const body = await getBody(request);
    let state;

    switch (String(body.action || "")) {
      case "initialize":
        state = await initializeSharedDashboardState(
          { expectedRevision: body.expectedRevision, data: body.data },
          role,
        );
        break;
      case "patch":
        state = await patchSharedDashboardState(
          { expectedRevision: body.expectedRevision, patch: body.patch },
          role,
        );
        break;
      default:
        return jsonResponse(
          { error: "Unknown shared dashboard action.", code: "UNKNOWN_SHARED_STATE_ACTION" },
          400,
        );
    }

    return jsonResponse(state);
  } catch (error) {
    return errorResponse(error);
  }
}
