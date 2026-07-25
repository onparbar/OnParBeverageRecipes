import { NextResponse } from "next/server";
import {
  deleteCustomInventoryItemState,
  deleteInventorySnapshotState,
  hydrateInventoryState,
  readInventoryState,
  reorderInventoryItems,
  restoreInventorySnapshotState,
  saveInventorySnapshot,
  updateInventoryField,
  upsertCustomInventoryItem,
} from "../../../lib/inventory-store.mjs";
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
    error.status = role ? 403 : 401;
    throw error;
  }
  return role;
}

function errorResponse(error) {
  return NextResponse.json(
    { error: error.message || "Could not access shared inventory." },
    { status: error.status || 400 },
  );
}

export async function GET(request) {
  try {
    await requireOwner(request);
    return NextResponse.json(await readInventoryState());
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
      case "hydrate":
        state = await hydrateInventoryState(body, role);
        break;
      case "update-field":
        state = await updateInventoryField(body, role);
        break;
      case "upsert-custom":
        state = await upsertCustomInventoryItem(body.item, role);
        break;
      case "delete-custom":
        state = await deleteCustomInventoryItemState(body.id, role);
        break;
      case "reorder-items":
        state = await reorderInventoryItems(body.itemOrder, role);
        break;
      case "save-snapshot":
        state = await saveInventorySnapshot(body.items, role, new Date(), body.summary);
        break;
      case "delete-snapshot":
        state = await deleteInventorySnapshotState(body.id, role);
        break;
      case "restore-snapshot":
        state = await restoreInventorySnapshotState(body.id, role);
        break;
      default:
        return NextResponse.json({ error: "Unknown inventory action." }, { status: 400 });
    }

    return NextResponse.json(state);
  } catch (error) {
    return errorResponse(error);
  }
}
