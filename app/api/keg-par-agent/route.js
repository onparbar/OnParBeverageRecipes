import { NextResponse } from "next/server";
import { readParAgentState, runParAgentUpdate, syncParAgentState } from "../../../lib/par-agent.mjs";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "../../../lib/dashboard-auth.mjs";

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
  const role = await getDashboardSessionRole(request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value);
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
    error: error?.message || "Could not update par agent state.",
    code: error?.code || "KEG_PAR_AGENT_ERROR",
    ...details,
  }, error?.status || 500);
}

export async function GET(request) {
  try {
    await requireOwner(request);
    const state = await readParAgentState();
    return jsonResponse(state);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const role = await requireOwner(request);
    const body = await getBody(request);
    const action = String(body.action || "sync-state");
    const patch = {
      onHandOverrides: body.onHandOverrides,
      parOverrides: body.parOverrides,
      onDeckOverrides: body.onDeckOverrides,
      settings: body.settings,
    };

    if (action === "run") {
      const state = await runParAgentUpdate({
        dryRun: Boolean(body.dryRun),
        patch,
        expectedRevision: body.expectedRevision,
        role,
      });
      return jsonResponse(state);
    }

    const state = await syncParAgentState(patch, {
      expectedRevision: body.expectedRevision,
      role,
      initialize: action === "initialize",
    });
    return jsonResponse(state);
  } catch (error) {
    return errorResponse(error);
  }
}
