import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";
import { getUncountedInventoryAmount, isWeeklyCountOnlyInventoryItem } from "./inventory-count-policy.mjs";

function hasTrackedBalance(item, countedItemsAt, now, ledger) {
  if (!ledger?.allowTrackedBalances || isWeeklyCountOnlyInventoryItem(item)) return false;
  const baselineTime = Date.parse(countedItemsAt[item.id] || "");
  const nowTime = new Date(now).getTime();
  if (!Number.isFinite(baselineTime) || baselineTime > nowTime) return false;
  const display = String(item.onHandDisplay ?? item.onHand ?? "").trim();
  if (display === "" || !Number.isFinite(Number(display)) || Number(display) < 0) return false;
  if (Number(ledger.contributionShortfalls?.[item.id]) > 0) return false;
  const movements = Object.values(ledger.inventoryContributions || {})
    .filter((entry) => entry?.itemId === item.id);
  return movements.every((entry) => entry.balanceVersion === 1);
}

export function getInventoryCountSections(items = [], countedItemsAt = {}, now = new Date(), ledger = {}) {
  const groups = new Map(["Liquor Cabinet", "Mixer Cabinet", "Other"].map((name) => [name, []]));
  for (const item of items) {
    if (!item?.id || getUncountedInventoryAmount(item) !== null) continue;
    const group = groups.has(item.group) ? item.group : "Other";
    groups.get(group).push(item);
  }
  return [...groups].filter(([, rows]) => rows.length).map(([name, rows]) => {
    const current = rows.filter((item) => isRecommendationForOperatingWeek(countedItemsAt[item.id], now));
    const tracked = rows.filter((item) => !current.includes(item) && hasTrackedBalance(item, countedItemsAt, now, ledger));
    const ready = new Set([...current, ...tracked].map((item) => item.id));
    const missing = rows.filter((item) => !ready.has(item.id));
    return { name, total: rows.length, current, tracked, missing, complete: missing.length === 0 };
  });
}
