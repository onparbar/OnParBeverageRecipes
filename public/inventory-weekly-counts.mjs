import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";
import { getUncountedInventoryAmount } from "./inventory-count-policy.mjs";

export function getInventoryCountSections(items = [], countedItemsAt = {}, now = new Date()) {
  const groups = new Map(["Liquor Cabinet", "Mixer Cabinet", "Other"].map((name) => [name, []]));
  for (const item of items) {
    if (!item?.id || getUncountedInventoryAmount(item) !== null) continue;
    const group = groups.has(item.group) ? item.group : "Other";
    groups.get(group).push(item);
  }
  return [...groups].filter(([, rows]) => rows.length).map(([name, rows]) => {
    const missing = rows.filter((item) => !isRecommendationForOperatingWeek(countedItemsAt[item.id], now));
    return { name, total: rows.length, missing, complete: missing.length === 0 };
  });
}
