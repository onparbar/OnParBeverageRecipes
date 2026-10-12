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

const wallCompletedAt = { main: "", karaoke: "" };

export function hasCompletedCoolerWallCount(wall, now = new Date()) {
  if (!Object.hasOwn(wallCompletedAt, wall)) return false;
  try { wallCompletedAt[wall] = globalThis.localStorage?.getItem(`${KEY}-${wall}`) || wallCompletedAt[wall]; } catch { /* Optional navigation state. */ }
  return hasCompletedCoolerCount(now)
    || Boolean(wallCompletedAt[wall] && isRecommendationForOperatingWeek(wallCompletedAt[wall], now));
}

export function completeCoolerWallCount(wall, now = new Date()) {
  if (!Object.hasOwn(wallCompletedAt, wall)) return;
  wallCompletedAt[wall] = now.toISOString();
  try { globalThis.localStorage?.setItem(`${KEY}-${wall}`, wallCompletedAt[wall]); } catch { /* Counts themselves are saved on the server. */ }
}
