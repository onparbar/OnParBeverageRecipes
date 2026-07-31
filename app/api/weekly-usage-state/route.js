import { NextResponse } from "next/server";
import {
  initializeSharedWeeklyUsageState,
  readSharedWeeklyUsageState,
  replaceSharedWeeklyUsageState,
} from "../../../lib/weekly-usage-shared-store.mjs";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "../../../lib/dashboard-auth.mjs";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";

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

async function requireOwner(request) {
  const session = request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value;
  const role = await getDashboardSessionRole(session);
  if (role !== "owner") {
    const error = new Error(role ? "Owner login required." : "Login required.");
    error.code = role ? "OWNER_REQUIRED" : "LOGIN_REQUIRED";
    error.status = role ? 403 : 401;
    throw error;
  }
  return role;
}

function errorResponse(error) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  return jsonResponse({
    error: error?.message || "Could not access shared Weekly Usage.",
    code: error?.code || "WEEKLY_USAGE_STATE_ERROR",
    ...details,
  }, error?.status || 500);
}

export async function GET(request) {
  try {
    await requireOwner(request);
    return jsonResponse(await readSharedWeeklyUsageState());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const role = await requireOwner(request);
    const body = await getBody(request);
    let state;

    switch (String(body.action || "")) {
      case "initialize":
        state = await initializeSharedWeeklyUsageState(
          { expectedRevision: body.expectedRevision, data: body.data },
          role,
        );
        break;
      case "replace":
        state = await replaceSharedWeeklyUsageState(
          { expectedRevision: body.expectedRevision, data: body.data },
          role,
        );
        break;
      default:
        return jsonResponse(
          { error: "Unknown Weekly Usage action.", code: "UNKNOWN_WEEKLY_USAGE_ACTION" },
          400,
        );
    }

    recordDashboardActivity({
      area: "Weekly Usage",
      action: String(body.action || "updated"),
      role,
      revision: state.revision,
      summary: String(body.action || "") === "initialize" ? "Imported the initial shared Weekly Usage reports." : "Updated shared Weekly Usage reports.",
    }).catch(() => {});

    return jsonResponse(state);
  } catch (error) {
    return errorResponse(error);
  }
}
