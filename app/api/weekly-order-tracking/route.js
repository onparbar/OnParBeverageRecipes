import { NextResponse } from "next/server";
import { requireDashboardRequestIdentity, requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { readParAgentState, writeParAgentState } from "../../../lib/par-agent.mjs";
import {
  applyWeeklyOrderTrackingUpdate,
  buildWeeklyOrderTracking,
} from "../../../lib/weekly-order-tracking.mjs";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
import {
  applyInventoryContributionPlan,
  assertInventoryContributionPlan,
  planReceiptInventoryContributions,
} from "../../../lib/inventory-contributions.mjs";
import { executeInventoryBackedOperation } from "../../../lib/inventory-backed-operation.mjs";

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
    activeNotReceivedCount: 0,
    activeNotReceivedItems: [],
    criticalNotReceivedItems: [],
    waitNotReceivedItems: [],
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
    const identity = await requireDashboardRequestIdentity(request);
    const role = identity.role;
    const state = await readParAgentState();
    if (!state.initialized || !buildWeeklyOrderTracking(state?.recommendations)) {
      return jsonResponse(unavailablePlan(state), 409);
    }
    const submittedBody = await getBody(request);
    const body = {
      ...submittedBody,
      adjustedBy: identity.name,
      approvedBy: identity.name,
      createdBy: identity.name,
      handledBy: identity.name,
      orderedBy: identity.name,
    };
    const priorTracking = buildWeeklyOrderTracking(state.recommendations);
    let effectiveBody = body;
    let updatedRecommendations = applyWeeklyOrderTrackingUpdate(
      state.recommendations,
      effectiveBody,
      { role },
    );
    let inventoryPlan = null;
    let blockedItems = [];
    let receiptVendorId = "";
    if (["set-receipts", "set-selected-receipts", "set-receipt"].includes(body.action)) {
      const proposedTracking = buildWeeklyOrderTracking(updatedRecommendations);
      receiptVendorId = body.vendorId || proposedTracking?.vendors?.find((vendor) => vendor.items.some((item) => item.id === body.itemId))?.id;
      const proposedPlan = await planReceiptInventoryContributions(proposedTracking, receiptVendorId);
      if (proposedPlan.unmatched.length && ["set-receipts", "set-selected-receipts"].includes(body.action)) {
        const blockedIds = new Set(proposedPlan.unmatched.map((item) => item.id).filter(Boolean));
        const safeReceipts = (Array.isArray(body.receipts) ? body.receipts : [])
          .filter((receipt) => !blockedIds.has(String(receipt?.itemId || "")));
        if (!safeReceipts.length) assertInventoryContributionPlan(proposedPlan);
        blockedItems = proposedPlan.unmatched;
        effectiveBody = { ...body, receipts: safeReceipts };
        updatedRecommendations = applyWeeklyOrderTrackingUpdate(
          state.recommendations,
          effectiveBody,
          { role },
        );
        inventoryPlan = await planReceiptInventoryContributions(
          buildWeeklyOrderTracking(updatedRecommendations),
          receiptVendorId,
        );
      } else {
        inventoryPlan = proposedPlan;
      }
      assertInventoryContributionPlan(inventoryPlan);
    }
    const persist = async () => {
      const nextRevision = Number(state.revision) + 1;
      return writeParAgentState({
        ...state,
        recommendations: {
          ...updatedRecommendations,
          publishedStateRevision: nextRevision,
        },
      }, {
        expectedRevision: state.revision,
        role,
      });
    };
    let saved;
    let inventoryUpdate = null;
    if (inventoryPlan) {
      const trackedVendor = priorTracking?.vendors?.find((vendor) => vendor.id === receiptVendorId);
      const actor = String(body.handledBy || role).replace(/\s+/g, " ").trim().slice(0, 80);
      const result = await executeInventoryBackedOperation({
        plan: inventoryPlan,
        assertPlan: assertInventoryContributionPlan,
        persist,
        applyInventory: (plan) => applyInventoryContributionPlan(plan, role),
        recordActivity: (savedState) => recordDashboardActivity({
          area: "Orders",
          action: "received vendor delivery",
          role,
          revision: savedState.revision,
          summary: `${String(trackedVendor?.vendor || "Vendor").slice(0, 80)} delivery reviewed by ${actor} for Weekly Plan ${priorTracking.generatedAt}; ${body.action === "set-receipt" ? 1 : (effectiveBody.receipts?.length || 0)} lines updated.`,
          dedupe: true,
        }),
      });
      saved = result.saved;
      inventoryUpdate = {
        ...result.inventoryUpdate,
        ...(blockedItems.length ? {
          blockedItems,
          warning: `Review the inventory match for: ${blockedItems.map((item) => item.name).join(", ")}. Other delivery lines were saved.`,
        } : {}),
      };
    } else {
      saved = await persist();
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
      await recordDashboardActivity({
        area: "Orders",
        action,
        role,
        revision: saved.revision,
        summary: `${trackedVendor} ${action} for Weekly Plan ${priorTracking.generatedAt}; real submission remains manual.`,
        dedupe: body.action !== "set-ordered",
      });
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
