import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { readParAgentState, writeParAgentState } from "../../../lib/par-agent.mjs";
import {
  applyWeeklyOrderTrackingUpdate,
  buildWeeklyOrderTracking,
} from "../../../lib/weekly-order-tracking.mjs";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
import { applyReceiptInventoryContributions } from "../../../lib/inventory-contributions.mjs";

export const runtime = "nodejs";

function jsonResponse(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
    },
  });
}

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function unavailablePlan(state) {
  return {
    available: false,
    generatedAt: String(state?.recommendations?.generatedAt || ""),
    vendors: [],
    itemCount: 0,
    receivedCount: 0,
    notReceivedCount: 0,
    notReceivedItems: [],
    message: "A manager has not published this week's order plan yet.",
  };
}

function errorResponse(error) {
  return jsonResponse({
    error: error?.message || "The weekly order tracking could not be updated.",
    code: error?.code || "WEEKLY_ORDER_TRACKING_ERROR",
  }, error?.status || 500);
}

export async function GET(request) {
  try {
    await requireDashboardRequestRole(request);
    const state = await readParAgentState();
    const tracking = buildWeeklyOrderTracking(state?.recommendations);
    if (!state.initialized || !tracking) return jsonResponse(unavailablePlan(state));
    return jsonResponse({ available: true, message: "", stateRevision: state.revision, ...tracking });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const role = await requireDashboardRequestRole(request);
    const state = await readParAgentState();
    if (!state.initialized || !buildWeeklyOrderTracking(state?.recommendations)) {
      return jsonResponse(unavailablePlan(state), 409);
    }
    const body = await getBody(request);
    const priorTracking = buildWeeklyOrderTracking(state.recommendations);
    const updatedRecommendations = applyWeeklyOrderTrackingUpdate(
      state.recommendations,
      body,
      { role },
    );
    const nextRevision = Number(state.revision) + 1;
    const saved = await writeParAgentState({
      ...state,
      recommendations: {
        ...updatedRecommendations,
        publishedStateRevision: nextRevision,
      },
    }, {
      expectedRevision: state.revision,
      role,
    });
    const savedTracking = buildWeeklyOrderTracking(saved.recommendations);
    let inventoryUpdate = null;
    if (["set-receipts", "set-receipt"].includes(body.action)) {
      const vendorId = body.vendorId || savedTracking?.vendors?.find((vendor) => vendor.items.some((item) => item.id === body.itemId))?.id;
      try {
        inventoryUpdate = await applyReceiptInventoryContributions(savedTracking, vendorId, role);
      } catch (error) {
        inventoryUpdate = { warning: error?.message || "Delivery saved, but cabinet inventory needs review." };
      }
    }
    if (["create-draft", "approve-draft", "review-and-approve", "record-handoff", "set-ordered", "set-order-adjustment", "set-order-adjustments", "remove-order-adjustment"].includes(body.action)) {
      const trackedVendor = String(
        body.vendor
        || priorTracking?.vendors?.find((vendor) => vendor.id === body.vendorId)?.vendor
        || "Vendor",
      ).slice(0, 80);
      const action = ["approve-draft", "review-and-approve"].includes(body.action)
        ? "approved vendor draft"
        : ["set-order-adjustment", "set-order-adjustments"].includes(body.action)
          ? "adjusted vendor order"
          : body.action === "remove-order-adjustment"
            ? "removed vendor order adjustment"
        : body.action === "create-draft"
          ? "created vendor draft"
          : body.action === "record-handoff"
            ? body.event === "opened_vendor" ? "opened vendor handoff" : "copied vendor handoff"
            : body.ordered === true ? "completed vendor order" : "updated vendor order";
      recordDashboardActivity({
        area: "Orders",
        action,
        role,
        revision: saved.revision,
        summary: `${trackedVendor} assisted-order record updated; real submission remains manual.`,
      }).catch(() => {});
    }
    if (body.action === "set-receipts") {
      const trackedVendor = priorTracking?.vendors?.find((vendor) => vendor.id === body.vendorId);
      recordDashboardActivity({
        area: "Orders",
        action: "received vendor delivery",
        role,
        revision: saved.revision,
        summary: `${String(trackedVendor?.vendor || "Vendor").slice(0, 80)} delivery reviewed; ${Array.isArray(body.receipts) ? body.receipts.length : 0} lines updated.`,
      }).catch(() => {});
    }
    return jsonResponse({
      available: true,
      message: "Weekly order tracking saved.",
      stateRevision: saved.revision,
      ...buildWeeklyOrderTracking(saved.recommendations),
      inventoryUpdate,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
