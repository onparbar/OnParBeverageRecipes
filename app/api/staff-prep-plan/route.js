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
  return jsonResponse({
    error: error?.message || "The weekly cocktail prep checklist could not be updated.",
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
    const priorPlan = buildStaffPrepPlan(recommendations);
    const target = [...priorPlan.items, ...priorPlan.liquorRefills].find((item) => item.id === String(body.itemId || ""));
    const updatedRecommendations = applyStaffPrepPlanUpdate(
      recommendations,
      body,
    );
    const requestedActualQuantity = Number(body.actualQuantity ?? target?.quantity);
    const actualQuantityChanged = target?.kind === "liquor-refill"
      && body.completed === true
      && target.completed === true
      && requestedActualQuantity !== Number(target.actualQuantity);
    const stateChanged = target && (target.completed !== body.completed || actualQuantityChanged);
    const inventoryPlan = await planPrepInventoryContributions({
      target,
      generatedAt: recommendations.generatedAt,
      completed: body.completed,
      actualQuantity: body.actualQuantity,
    });
    const isLiquorRefill = target.kind === "liquor-refill";
    const actor = String(body.preparedBy || role).replace(/\s+/g, " ").trim().slice(0, 80);
    const quantity = isLiquorRefill
      ? Math.max(1, Number(body.actualQuantity ?? target.actualQuantity ?? target.quantity) || 1)
      : Math.max(1, Number(target.quantity) || 1);
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
        action: body.completed
          ? (isLiquorRefill ? "added liquor to keg" : "consumed cocktail ingredients")
          : (isLiquorRefill ? "reopened liquor refill" : "restored cocktail ingredients"),
        role,
        revision: savedState.revision,
        summary: `${target.displayName || target.name}: ${body.completed ? `${quantity} ${isLiquorRefill ? "bottles" : "batches"} completed` : "reopened"} by ${actor} for Weekly Plan ${recommendations.generatedAt}.`,
        dedupe: true,
      }),
    });
    return jsonResponse({
      available: true,
      message: "Preparation checklist saved.",
      inventoryUpdate,
      ...buildStaffPrepPlan(saved.recommendations),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
