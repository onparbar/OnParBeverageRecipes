import { normalizeLiquorTapProductName } from "./weekly-action-plan.mjs";

const RESERVES = Object.freeze({
  "tito-s": 12, "jose-cuervo-silver": 16, "crown-apple": 6,
  "svedka-blue-raspberry-vodka": 9, "lime-juice": 8, "triple-sec": 8,
});
function key(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['\u2019]/g, "").replace(/\s+[123]$/, "")
    .replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}
function nonnegative(value) {
  if (value == null || String(value).trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function managed(item) {
  return /^(Liquor|Mixer) Cabinet$/i.test(item.group || "") || ["simple-syrup", "vanilla"].includes(item.id);
}

// Stock stays assigned to its tap. Sum ingredients only after forecasting whole
// batches for each of the next two Thursday prep sessions.
export function buildRollingCocktailIngredientOrders({
  inventoryItems = [], tapInputs = [], recipes = [], recipeAliases = {},
} = {}) {
  const demand = new Map();
  const issues = [];
  const seen = new Set();
  for (const tap of tapInputs) {
    const n = Number(tap.tapNumber);
    if (!((n >= 47 && n <= 72) || (n >= 93 && n <= 102)) || /coming\s*soon/i.test(tap.name || "")) continue;
    const identity = tap.key || `${tap.wall}:${n}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const stock = nonnegative(tap.currentStockKegs);
    const average = nonnegative(tap.avgWeeklyKegs);
    if (stock === null || average === null || tap.inventoryStateMissing) {
      issues.push(`Tap ${n}: saved stock or weekly usage is missing.`);
      continue;
    }
    const cushion = Math.min(50, nonnegative(tap.variabilityCushionPct) ?? 10) / 100;
    const share = Math.min(100, nonnegative(tap.preThursdayUsageSharePct) ?? (300 / 7)) / 100;
    let remaining = Math.max(0, stock - average * share);
    const batches = [];
    for (let week = 0; week < 2; week += 1) {
      batches[week] = Math.max(0, Math.ceil(average * (1 + cushion) - remaining - 1e-9));
      remaining = Math.max(0, remaining + batches[week] - average);
    }
    if (!batches.some(Boolean)) continue;
    const names = [tap.name, tap.recipeName, tap.recipeId].map(key).filter(Boolean);
    for (const [name, title] of Object.entries(recipeAliases)) {
      if (names.includes(key(name))) names.push(key(title));
    }
    const recipe = recipes.find((r) => [r.id, r.title, r.name, r.sourceTitle].some((name) => name && names.includes(key(name))));
    if (!recipe) { issues.push(`Tap ${n}: recipe for ${tap.name} is missing.`); continue; }
    for (const ingredient of recipe.ingredients || []) {
      const ounces = nonnegative(ingredient.oz);
      if (!(ounces > 0)) continue;
      const names = [ingredient.inventoryId, ingredient.id, ingredient.name].map(key).filter(Boolean);
      const item = inventoryItems.find((item) => [item.id, item.name, item.linkedIngredientName].some((name) => name && names.includes(key(name))));
      // Kitchen-managed ingredients are outside beverage vendor purchasing.
      if (!item || !managed(item)) continue;
      const unitOz = nonnegative(item.bottleOz);
      if (!(unitOz > 0)) { issues.push(`${item.name}: inventory package size is missing.`); continue; }
      const entry = demand.get(item.id) || { units: [0, 0], taps: new Set() };
      batches.forEach((count, week) => { entry.units[week] += ounces * count / unitOz; });
      entry.taps.add(n);
      demand.set(item.id, entry);
    }
  }
  if (!seen.size) issues.push("Saved cocktail tap stock and usage are required for the two-Thursday ingredient plan.");
  return inventoryItems.map((item) => {
    if (!managed(item)) return item;
    const onHand = item.hasCurrentCount === false ? null : nonnegative(item.onHand);
    const entry = demand.get(item.id);
    const prep = Math.max(0, Math.ceil((entry?.units.reduce((a, b) => a + b, 0) || 0) - 1e-6));
    const reserve = RESERVES[item.id] || 0;
    const hold = issues.length ? issues.join(" ") : onHand === null ? `${item.name}: count is missing.` : "";
    const shortage = hold ? 0 : Math.max(0, Math.ceil(prep + reserve - onHand));
    const pack = Math.max(1, Number(item.packSize) || 1);
    const quantity = item.casePackaged ? Math.ceil(shortage / pack) * pack : shortage;
    return {
      ...item, rollingIngredientVersion: 1, rollingReserveUnits: reserve,
      cocktailPrepRequiredBottles: prep, cocktailPrepShortageUnits: shortage,
      par: prep + reserve, orderUnits: quantity,
      estimatedCost: item.excludeFromOrderCost ? 0 : quantity * (Number(item.unitCost) || 0),
      orderHoldReason: hold || item.orderHoldReason || "",
      rollingPlanReason: `Two Thursday prep sessions need ${prep} units; reserve ${reserve}; ${onHand ?? "unknown"} on hand. Order ${quantity}${item.casePackaged ? ` units in packs of ${pack}` : " units"}.`,
      rollingPrepWeeks: entry?.units || [0, 0], rollingPrepTapNumbers: [...(entry?.taps || [])],
    };
  });
}

// Reserve cabinet stock once for prep, then allocate the remainder to refills.
export function netRollingLiquorTapRecommendations(recommendations = [], inventoryItems = []) {
  const available = new Map();
  return recommendations.map((r) => {
    if (!r.isLiquorTap || r.actionType !== "order") return r;
    const identity = key(normalizeLiquorTapProductName(r.orderProductName || r.name));
    const item = inventoryItems.find((item) => item.rollingIngredientVersion === 1
      && /liquor/i.test(item.group || "") && !item.orderHoldReason
      && [item.id, item.name, item.linkedIngredientName].some((name) => name && key(name) === identity));
    if (!item || nonnegative(item.onHand) === null || item.hasCurrentCount === false) return r;
    const reserved = Number(item.cocktailPrepRequiredBottles || 0) + Number(item.rollingReserveUnits || 0);
    const remaining = available.has(item.id) ? available.get(item.id) : Math.max(0, Math.floor(Number(item.onHand) - reserved));
    const requested = Math.max(0, Number(r.orderQty) || 0);
    const used = Math.min(requested, remaining);
    available.set(item.id, remaining - used);
    return {
      ...r, orderQty: requested - used, suggestedBottleOrderQty: requested - used,
      actionType: requested > used ? "order" : "none", cabinetUsedQty: used,
      cabinetReservedForCocktails: reserved, cabinetInventoryId: item.id,
      reason: `${r.reason || ""} ${used} cabinet bottles cover the refill after reserving two Thursday sessions and the small reserve.`.trim(),
    };
  });
}
