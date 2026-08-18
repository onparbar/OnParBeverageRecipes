import { NextResponse } from "next/server";
import {
  mutateSharedInventoryState,
  readSharedInventoryState,
} from "../../../lib/inventory-shared-store.mjs";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "../../../lib/dashboard-auth.mjs";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";

export const runtime = "nodejs";

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
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

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function responseForState(state) {
  return {
    revision: state.revision,
    aliases: state.current?.speechAliases || [],
  };
}

function errorResponse(error) {
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  return jsonResponse({
    error: error?.message || "Could not access shared learned words.",
    code: error?.code || "SPEECH_ALIASES_ERROR",
    ...details,
  }, error?.status || 500);
}

export async function GET(request) {
  try {
    await requireOwner(request);
    return jsonResponse(responseForState(await readSharedInventoryState()));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const role = await requireOwner(request);
    const body = await getBody(request);
    const action = String(body.action || "");
    let state;
    if (action === "merge") {
      state = await mutateSharedInventoryState(
        "merge-speech-aliases",
        { aliases: body.aliases },
        role,
      );
    } else if (action === "clear") {
      state = await mutateSharedInventoryState("clear-speech-aliases", {}, role);
    } else {
      return jsonResponse({ error: "Unknown learned-words action.", code: "UNKNOWN_SPEECH_ALIASES_ACTION" }, 400);
    }

    recordDashboardActivity({
      area: "Inventory",
      action: action === "clear" ? "cleared-speech-aliases" : "updated-speech-aliases",
      role,
      revision: state.revision,
      summary: action === "clear" ? "Cleared shared learned words." : "Updated shared learned words.",
    }).catch(() => {});

    return jsonResponse(responseForState(state));
  } catch (error) {
    return errorResponse(error);
  }
}
