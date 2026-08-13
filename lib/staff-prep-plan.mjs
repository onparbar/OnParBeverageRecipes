import {
  buildWeeklyActionPlan,
  normalizeWeeklyPlanProductName,
} from "../public/weekly-action-plan.mjs";

const MAX_PREPARER_LENGTH = 80;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function itemId(name) {
  return `cocktail:${encodeURIComponent(normalizeWeeklyPlanProductName(name).toLowerCase())}`;
}

export class StaffPrepPlanError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "StaffPrepPlanError";
    this.code = code;
    this.status = status;
  }
}

export function buildStaffPrepPlan(recommendations = {}) {
  const generatedAt = clean(recommendations?.generatedAt);
  const checklist = isPlainRecord(recommendations?.prepChecklist)
    ? recommendations.prepChecklist
    : {};
  const plan = buildWeeklyActionPlan({
    recommendations: Array.isArray(recommendations?.items) ? recommendations.items : [],
  });
  const items = plan.prep.cocktails.map((item) => {
    const id = itemId(item.name);
    const saved = isPlainRecord(checklist[id]) ? checklist[id] : {};
    const completed = saved.completed === true && Boolean(clean(saved.preparedBy));
    return {
      id,
      name: clean(item.name),
      quantity: Number(item.quantity) || 0,
      tapNumbers: Array.isArray(item.tapNumbers) ? item.tapNumbers : [],
      walls: Array.isArray(item.walls) ? item.walls.map(clean).filter(Boolean) : [],
      completed,
      preparedBy: completed ? clean(saved.preparedBy).slice(0, MAX_PREPARER_LENGTH) : "",
      completedAt: completed ? clean(saved.completedAt) : "",
      updatedAt: completed ? clean(saved.updatedAt || saved.completedAt) : "",
    };
  });
  return {
    generatedAt,
    items,
    completedCount: items.filter((item) => item.completed).length,
    totalCount: items.length,
  };
}

export function applyStaffPrepPlanUpdate(
  recommendations,
  payload = {},
  { now = () => new Date() } = {},
) {
  if (!isPlainRecord(recommendations) || !clean(recommendations.generatedAt)) {
    throw new StaffPrepPlanError(
      "STAFF_PREP_PLAN_MISSING",
      "The current weekly cocktail prep plan is not available.",
      409,
    );
  }
  if (clean(payload.generatedAt) !== clean(recommendations.generatedAt)) {
    throw new StaffPrepPlanError(
      "STAFF_PREP_PLAN_CHANGED",
      "The weekly plan changed. Reload the checklist before saving.",
      409,
    );
  }
  if (typeof payload.completed !== "boolean") {
    throw new StaffPrepPlanError(
      "STAFF_PREP_COMPLETION_REQUIRED",
      "Choose whether the cocktail is prepared.",
    );
  }

  const currentPlan = buildStaffPrepPlan(recommendations);
  const target = currentPlan.items.find((item) => item.id === clean(payload.itemId));
  if (!target) {
    throw new StaffPrepPlanError(
      "STAFF_PREP_ITEM_NOT_FOUND",
      "That cocktail is not on the current weekly prep plan.",
      409,
    );
  }

  const preparedBy = clean(payload.preparedBy).slice(0, MAX_PREPARER_LENGTH);
  if (payload.completed && !preparedBy) {
    throw new StaffPrepPlanError(
      "STAFF_PREPARER_REQUIRED",
      "Enter who prepared the cocktail before checking it off.",
    );
  }

  const timestamp = now().toISOString();
  const prepChecklist = isPlainRecord(recommendations.prepChecklist)
    ? { ...recommendations.prepChecklist }
    : {};
  if (payload.completed) {
    const existing = isPlainRecord(prepChecklist[target.id]) ? prepChecklist[target.id] : {};
    prepChecklist[target.id] = {
      completed: true,
      preparedBy,
      completedAt: clean(existing.completedAt) || timestamp,
      updatedAt: timestamp,
    };
  } else {
    delete prepChecklist[target.id];
  }

  return { ...recommendations, prepChecklist };
}
