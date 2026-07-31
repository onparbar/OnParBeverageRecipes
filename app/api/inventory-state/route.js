import { NextResponse } from "next/server";
import {
  initializeSharedInventoryState,
  mutateSharedInventoryState,
  readSharedInventoryState,
} from "../../../lib/inventory-shared-store.mjs";
import { DASHBOARD_SESSION_COOKIE, getDashboardSessionRole } from "../../../lib/dashboard-auth.mjs";

export const runtime = "nodejs";

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
  const details = error?.details && typeof error.details === "object"
    ? error.details
    : {};
  return NextResponse.json(
    {
      error: error.message || "Could not access shared inventory.",
      code: error.code || "INVENTORY_STATE_ERROR",
      ...details,
    },
    {
      status: error.status || 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

export async function GET(request) {
  try {
    await requireOwner(request);
    return NextResponse.json(await readSharedInventoryState(), {
      headers: { "Cache-Control": "no-store" },
    });
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
        state = await initializeSharedInventoryState(
          { expectedRevision: body.expectedRevision, data: body.data },
          role,
        );
        break;
      case "update-field":
      case "upsert-custom":
      case "delete-custom":
      case "reorder-items":
      case "save-snapshot":
      case "delete-snapshot":
      case "restore-snapshot":
        state = await mutateSharedInventoryState(String(body.action), body, role);
        break;
      default:
        return NextResponse.json(
          { error: "Unknown inventory action.", code: "UNKNOWN_INVENTORY_ACTION" },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
    }

    return NextResponse.json(state, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
