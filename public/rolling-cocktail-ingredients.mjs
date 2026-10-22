import { findRecipeIngredientInventory, recipeIngredientQuantityIssue, getRecipeIngredientBottlePackage } from "./recipe-ingredient-inventory.mjs";
import { findPlanningCocktailRecipe } from "./planning-cocktail-recipe.mjs";
import { MINIMUM_KEG_CUSHION } from "./keg-demand-policy.mjs";
import { normalizeLiquorTapProductName } from "./weekly-action-plan.mjs";
import { applyInventoryCountPolicy, getUncountedInventoryAmount, isInventoryCountExcluded, isKitchenManagedInventoryItem } from "./inventory-count-policy.mjs";
import { getLiquorTapBottleBatch } from "./liquor-tap-order-policy.mjs";

const RESERVES = Object.freeze({
  "tito-s": 12, "jose-cuervo-silver": 16, "crown-apple": 6,
  "svedka-blue-raspberry-vodka": 9, "lime-juice": 8, "triple-sec": 8,
});

export function getRollingCocktailReserves() {
  return { ...RESERVES };
}
function key(value) {
  const normalized = String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/['\u2019]/g, "").replace(/\s+[123]$/, "")
    .replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  return /^bacardi(?: superior(?: traveler)?(?: rum)?)?$/.test(normalized) ? "bacardi superior" : normalized;
}
function nonnegative(value) {
  if (value == null || String(value).trim() === "") return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function managed(item) {
  if (isKitchenManagedInventoryItem(item) || item.countSource === "soda-machine") return false;
  return /^(Liquor|Mixer) Cabinet$/i.test(item.group || "") || ["simple-syrup", "vanilla"].includes(item.id)
    || getUncountedInventoryAmount(item) !== null;
}

function ingredientUnits(ingredient, unitOz) {
  const ounces = nonnegative(ingredient.oz) || 0;
  const pack = getRecipeIngredientBottlePackage(ingredient);
  if (pack?.bottleOz > 0) return Math.abs(pack.bottleOz - unitOz) <= 0.05 ? pack.count : pack.count * pack.bottleOz / unitOz;
  if (pack?.count > 0 && Math.abs(ounces / pack.count - unitOz) <= 0.05) return pack.count;
  return ounces / unitOz;
}

// Stock stays assigned to its tap. Sum ingredients only after forecasting whole
// batches for the current Thursday prep session. Future weeks are recalculated
// from the next saved inventory count instead of being bought ahead.
export function buildRollingCocktailIngredientOrders({
  inventoryItems = [], tapInputs = [], recipes = [], recipeAliases = {}, cocktails = null,
} = {}) {
  inventoryItems = inventoryItems.map(applyInventoryCountPolicy);
  const demand = new Map();
  const issues = [];
  const itemIssues = new Map();
  const seen = new Set();
  const planned = Array.isArray(cocktails);
  const inputs = planned ? cocktails : tapInputs;
  for (const tap of inputs) {
    const n = Number(tap.tapNumber);
    if ((!planned && !((n >= 47 && n <= 72) || (n >= 93 && n <= 102))) || /coming\s*soon/i.test(tap.name || "")) continue;
    const identity = tap.prepAdditionId || tap.key || (planned ? `${tap.name}:${tap.tapNumbers || n}` : `${tap.wall}:${n}`);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const stock = nonnegative(tap.currentStockKegs);
    const average = nonnegative(tap.avgWeeklyKegs);
    if (!planned && (stock === null || average === null || tap.inventoryStateMissing)) {
      issues.push(`Tap ${n}: saved stock or weekly usage is missing.`);
      continue;
    }
    const cushion = MINIMUM_KEG_CUSHION;
    const share = Math.min(100, nonnegative(tap.preThursdayUsageSharePct) ?? (300 / 7)) / 100;
    let remaining = Math.max(0, stock - average * share);
    const batches = [];
    for (let week = 0; week < 1; week += 1) {
      batches[week] = Math.max(0, Math.ceil(average + cushion - remaining - 1e-9));
      remaining = Math.max(0, remaining + batches[week] - average);
    }
    if (planned) batches[0] = Math.max(0, Number(tap.quantity ?? tap.orderQty) || 0);
    if (!batches.some(Boolean)) continue;
    const recipe = findPlanningCocktailRecipe(tap, recipes, recipeAliases);
    if (!recipe) { issues.push(`Tap ${n}: recipe for ${tap.name} is missing.`); continue; }
    for (const ingredient of recipe.ingredients || []) {
      const ounces = nonnegative(ingredient.oz);
      if (!(ounces > 0)) continue;
      // Water, kitchen and soda-machine ingredients have explicit policies.
      if (/^(water|ice)$/i.test(ingredient.name || "") || isInventoryCountExcluded(ingredient)) continue;
      const item = findRecipeIngredientInventory(ingredient, inventoryItems);
      if (!item) { issues.push(`${ingredient.name}: add or link its inventory item for ${recipe.title}.`); continue; }
      if (!managed(item)) { issues.push(`${item.name}: confirm its inventory ordering policy.`); continue; }
      const unitOz = nonnegative(item.bottleOz);
      if (!(unitOz > 0)) { itemIssues.set(item.id, `${item.name}: inventory package size is missing.`); continue; }
      const quantityIssue = recipeIngredientQuantityIssue(ingredient);
      if (quantityIssue) { itemIssues.set(item.id, quantityIssue); continue; }
      const entry = demand.get(item.id) || { units: [0], taps: new Set() };
      const units = ingredientUnits(ingredient, unitOz);
      batches.forEach((count, week) => { entry.units[week] += units * count; });
      (tap.tapNumbers || [n]).filter(Number.isFinite).forEach(number => entry.taps.add(number));
      demand.set(item.id, entry);
    }
  }
  if (!planned && !seen.size) issues.push("Saved cocktail tap stock and usage are required for the current Thursday ingredient plan.");
  return inventoryItems.map((item) => {
    if (!managed(item)) return item;
    const onHand = item.hasCurrentCount === false ? null : nonnegative(item.onHand);
    const entry = demand.get(item.id);
    const prep = Math.max(0, Math.ceil((entry?.units.reduce((a, b) => a + b, 0) || 0) - 1e-6));
    const reserve = RESERVES[item.id] || 0;
    const hold = issues.length ? issues.join(" ") : itemIssues.get(item.id) || (onHand === null ? `${item.name}: count is missing.` : "");
    const shortage = hold ? 0 : Math.max(0, Math.ceil(prep + reserve - onHand));
    const pack = Math.max(1, Number(item.packSize) || 1);
    const quantity = item.casePackaged ? Math.ceil(shortage / pack) * pack : shortage;
    return {
      ...item, rollingIngredientVersion: 1, rollingReserveUnits: reserve,
      cocktailPrepRequiredBottles: prep, cocktailPrepShortageUnits: shortage,
      par: prep + reserve, orderUnits: quantity,
      estimatedCost: item.excludeFromOrderCost ? 0 : quantity * (Number(item.unitCost) || 0),
      orderHoldReason: hold || item.orderHoldReason || "",
      rollingPlanReason: `This Thursday prep needs ${prep} units; reserve ${reserve}; ${onHand ?? "unknown"} on hand. Order ${quantity}${item.casePackaged ? ` units in packs of ${pack}` : " units"}.`,
      rollingPrepWeeks: entry?.units || [0], rollingPrepTapNumbers: [...(entry?.taps || [])],
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
    const batch = getLiquorTapBottleBatch(r.bottleOz);
    const shortage = requested - used;
    const orderQty = shortage > 0 && batch ? Math.ceil(shortage / batch) * batch : shortage;
    available.set(item.id, remaining - used);
    return {
      ...r, orderQty, suggestedBottleOrderQty: orderQty,
      actionType: requested > used ? "order" : "none", cabinetUsedQty: used,
      cabinetReservedForCocktails: reserved, cabinetInventoryId: item.id,
      reason: `${r.reason || ""} ${used} cabinet bottles cover the refill after reserving this Thursday's prep and the small reserve.`.trim(),
    };
  });
}
