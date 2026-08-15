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
    await requireDashboardRequestRole(request);
    const state = await readParAgentState();
    const recommendations = getCurrentRecommendations(state);
    if (!state.initialized || !recommendations) return jsonResponse(unavailablePlan(state));
    return jsonResponse({ available: true, message: "", ...buildStaffPrepPlan(recommendations) });
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
    const updatedRecommendations = applyStaffPrepPlanUpdate(
      recommendations,
      await getBody(request),
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
    return jsonResponse({
      available: true,
      message: "Preparation checklist saved.",
      ...buildStaffPrepPlan(saved.recommendations),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
