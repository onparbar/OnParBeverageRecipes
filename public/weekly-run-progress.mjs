import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";

const KEY = "onpar-weekly-cooler-count-completed";
let completedAt = "";

export function hasCompletedCoolerCount(now = new Date()) {
  try { completedAt = globalThis.localStorage?.getItem(KEY) || completedAt; } catch { /* Optional navigation state. */ }
  return Boolean(completedAt && isRecommendationForOperatingWeek(completedAt, now));
}

export function completeCoolerCount(now = new Date()) {
  completedAt = now.toISOString();
  try { globalThis.localStorage?.setItem(KEY, completedAt); } catch { /* The final snapshot is saved on the server. */ }
}
