import { normalizeDashboardQuestion, searchDashboardItems } from "./global-dashboard-search.mjs";
import { isRecommendationForOperatingWeek } from "./weekly-action-plan.mjs";
import { getUncountedInventoryAmount } from "./inventory-count-policy.mjs";

export function answerLocalInventoryQuestion(question, items = [], countedItemsAt = {}, now = new Date()) {
  const query = normalizeDashboardQuestion(question);
  if (!/\b(?:on hand|in stock|inventory|cabinet|bottles? .*have|have .*bottles?)\b/.test(query)) return null;
  if (/\b(?:why|order|need|buy|enough|cost|price|profit|sales|usage)\b/.test(query)) return null;
  const group = query.includes("liquor cabinet") ? "Liquor Cabinet"
    : query.includes("mixer cabinet") ? "Mixer Cabinet" : null;
  const name = query.replace(/\b(?:on hand|in stock|liquor cabinet|mixer cabinet)\b/g, " ")
    .split(" ").filter((word) => word && !new Set([
      "how", "many", "much", "bottle", "bottles", "units", "of", "do", "does", "we", "i", "you", "have", "has",
      "what", "whats", "is", "are", "there", "in", "the", "our", "my", "inventory", "cabinet", "left", "currently",
      "show", "me", "tell", "please", "can", "could", "check", "count", "for", "a", "an",
    ]).has(word)).join(" ");
  const available = items.filter((item) => !group || item.group === group);
  const matches = name ? searchDashboardItems(available.map((item) => ({
    ...item, title: item.name, section: item.group,
    searchText: [item.vendorProduct?.productName, item.linkedIngredientName],
  })), name, { limit: 20 }) : group ? available.slice(0, 20) : [];
  if (!matches.length) return { text: name ? `I couldn't match that to a saved inventory item. Try its product name.`
    : "Which product or cabinet would you like the count for?", rows: [] };
  const format = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  const rows = matches.map((item) => {
    const assumed = getUncountedInventoryAmount(item);
    const value = assumed ?? Number(String(item.onHandDisplay ?? "").trim() || 0);
    const current = isRecommendationForOperatingWeek(countedItemsAt[item.id], now);
    return {
      name: item.name,
      text: assumed !== null ? `${format(value)} units assumed by the inventory policy; not a physical count.`
        : !current ? "This week's count has not been received. I won't treat an older value as current."
          : Number.isFinite(value) ? `${format(value)} units shown on hand; count received this week.`
            : "No usable saved quantity is available.",
    };
  });
  return { text: "Here is what the dashboard has saved. Inventory quantities are units, not cases.", rows };
}
