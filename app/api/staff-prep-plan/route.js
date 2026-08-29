import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { readParAgentState, writeParAgentState } from "../../../lib/par-agent.mjs";
import {
  isRecommendationForOperatingWeek,
} from "../../../public/weekly-action-plan.mjs";
import {
  applyStaffPrepPlanUpdate,
  buildStaffPrepPlan,
} from "../../../lib/staff-prep-plan.mjs";
import {
  applyInventoryContributionPlan,
  assertInventoryContributionPlan,
  planPrepInventoryContributions,
} from "../../../lib/inventory-contributions.mjs";
import { executeInventoryBackedOperation } from "../../../lib/inventory-backed-operation.mjs";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";

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

function getCurrentRecommendations(state) {
  const recommendations = state?.recommendations;
  if (!recommendations?.generatedAt) return null;
  if (!isRecommendationForOperatingWeek(recommendations.generatedAt, new Date())) return null;
  return recommendations;
}

function unavailablePlan(state) {
  const generatedAt = String(state?.recommendations?.generatedAt || "");
  return {
    available: false,
    generatedAt,
    items: [],
    completedCount: 0,
    totalCount: 0,
    message: generatedAt
      ? "The weekly cocktail prep plan needs to be refreshed by a manager."
      : "A manager has not published this week's cocktail prep plan yet.",
  };
}

function errorResponse(error) {
  const inventoryMappingNeedsReview = error?.code === "INVENTORY_IDENTITY_REVIEW_REQUIRED";
  return jsonResponse({
    error: inventoryMappingNeedsReview
      ? "This cocktail could not be checked off right now. Its inventory setup needs manager review."
      : error?.message || "The weekly cocktail prep checklist could not be updated.",
    code: error?.code || "STAFF_PREP_PLAN_ERROR",
  }, error?.status || 500);
}

export async function GET(request) {
  try {
    const role = await requireDashboardRequestRole(request);
    const state = await readParAgentState();
    const rehearsal = role === "owner"
      && new URL(request.url).searchParams.get("rehearsal") === "1";
    const recommendations = rehearsal && state?.recommendations
      ? { ...state.recommendations, prepChecklist: {} }
      : getCurrentRecommendations(state);
    if (!state.initialized || !recommendations) return jsonResponse(unavailablePlan(state));
    return jsonResponse({
      available: true,
      message: "",
      rehearsal,
      ...buildStaffPrepPlan(recommendations),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request) {
  try {
    const role = await requireDashboardRequestRole(request);
    const state = await readParAgentState();
    const recommendations = getCurrentRecommendations(state);
    if (!state.initialized || !recommendations) {
      return jsonResponse(unavailablePlan(state), 409);
    }
    const body = await getBody(request);
    const rawUpdates = Array.isArray(body.updates) ? body.updates : [body];
    if (rawUpdates.length < 1 || rawUpdates.length > 100) {
      return jsonResponse({ error: "Choose between 1 and 100 checklist items to save." }, 400);
    }
    const sharedPreparedBy = String(body.preparedBy || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const updatesByItem = new Map();
    rawUpdates.forEach((update) => {
      if (!update || typeof update !== "object") return;
      const itemId = String(update.itemId || "");
      updatesByItem.set(itemId, {
        ...update,
        itemId,
        generatedAt: String(body.generatedAt || update.generatedAt || ""),
        preparedBy: String(update.preparedBy || sharedPreparedBy).replace(/\s+/g, " ").trim().slice(0, 80),
      });
    });
    const updates = [...updatesByItem.values()];
    if (!updates.length) return jsonResponse({ error: "Choose at least one checklist item to save." }, 400);

    let updatedRecommendations = recommendations;
    const inventoryPlans = [];
    const changes = [];
    for (const update of updates) {
      const currentPlan = buildStaffPrepPlan(updatedRecommendations);
      const target = [...currentPlan.items, ...currentPlan.liquorRefills]
        .find((item) => item.id === update.itemId);
      const nextRecommendations = applyStaffPrepPlanUpdate(updatedRecommendations, update);
      const requestedActualQuantity = Number(update.actualQuantity ?? target?.quantity);
      const actualQuantityChanged = target?.kind === "liquor-refill"
        && update.completed === true
        && target.completed === true
        && requestedActualQuantity !== Number(target.actualQuantity);
      const stateChanged = Boolean(target)
        && (target.completed !== update.completed || actualQuantityChanged);
      inventoryPlans.push(await planPrepInventoryContributions({
        target,
        generatedAt: recommendations.generatedAt,
        completed: update.completed,
        actualQuantity: update.actualQuantity,
      }));
      changes.push({ target, update, stateChanged });
      updatedRecommendations = nextRecommendations;
    }

    const inventoryPlan = {
      sources: inventoryPlans.flatMap((plan) => Array.isArray(plan?.sources) ? plan.sources : []),
      unmatched: inventoryPlans.flatMap((plan) => Array.isArray(plan?.unmatched) ? plan.unmatched : []),
    };
    const stateChanged = changes.some((change) => change.stateChanged);
    const actor = sharedPreparedBy || String(updates[0]?.preparedBy || role).replace(/\s+/g, " ").trim().slice(0, 80);
    const completedChanges = changes.filter((change) => change.stateChanged && change.update.completed).length;
    const reopenedChanges = changes.filter((change) => change.stateChanged && !change.update.completed).length;
    const { saved, inventoryUpdate } = await executeInventoryBackedOperation({
      plan: inventoryPlan,
      assertPlan: assertInventoryContributionPlan,
      persist: async () => {
        if (!stateChanged) return state;
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
      },
      applyInventory: (plan) => applyInventoryContributionPlan(plan, role),
      recordActivity: (savedState) => recordDashboardActivity({
        area: "Inventory",
        action: "updated staff prep checklist",
        role,
        revision: savedState.revision,
        summary: `${completedChanges} completed and ${reopenedChanges} reopened by ${actor} for Weekly Plan ${recommendations.generatedAt}.`,
        dedupe: true,
      }),
    });
    return jsonResponse({
      available: true,
      message: `${updates.length} checklist item${updates.length === 1 ? "" : "s"} saved.`,
      inventoryUpdate,
      ...buildStaffPrepPlan(saved.recommendations),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
