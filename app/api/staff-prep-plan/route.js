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
import { applyPrepInventoryContributions } from "../../../lib/inventory-contributions.mjs";
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
    let inventoryUpdate = null;
    const requestedActualQuantity = Number(body.actualQuantity ?? target?.quantity);
    const actualQuantityChanged = target?.kind === "liquor-refill"
      && body.completed === true
      && target.completed === true
      && requestedActualQuantity !== Number(target.actualQuantity);
    if (target && (target.completed !== body.completed || actualQuantityChanged)) {
      try {
        inventoryUpdate = await applyPrepInventoryContributions({
          target,
          generatedAt: recommendations.generatedAt,
          completed: body.completed,
          actualQuantity: body.actualQuantity,
          role,
        });
        const isLiquorRefill = target.kind === "liquor-refill";
        recordDashboardActivity({
          area: "Inventory",
          action: body.completed
            ? (isLiquorRefill ? "added liquor to keg" : "consumed cocktail ingredients")
            : (isLiquorRefill ? "reopened liquor refill" : "restored cocktail ingredients"),
          role,
          revision: saved.revision,
          summary: `${target.displayName || target.name} inventory movement recorded from the staff prep checklist.`,
        }).catch(() => {});
      } catch (error) {
        inventoryUpdate = {
          warning: error?.message || (target.kind === "liquor-refill"
            ? "The refill was saved, but cabinet inventory needs review."
            : "The cocktail was saved, but ingredient inventory needs review."),
        };
      }
    }
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
