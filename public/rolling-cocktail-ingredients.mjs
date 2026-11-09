import { findRecipeIngredientInventory, recipeIngredientQuantityIssue, getRecipeIngredientBottlePackage, getRecipeIngredientInventoryUnits } from "./recipe-ingredient-inventory.mjs";
import { findPlanningCocktailRecipe } from "./planning-cocktail-recipe.mjs";
import { MINIMUM_KEG_CUSHION } from "./keg-demand-policy.mjs";
import { normalizeLiquorTapProductName } from "./weekly-action-plan.mjs";
import { applyInventoryCountPolicy, getUncountedInventoryAmount, isInventoryCountExcluded, isKitchenManagedInventoryItem } from "./inventory-count-policy.mjs";
import { getLiquorTapBottleBatch } from "./liquor-tap-order-policy.mjs";
import { isInHousePrepIngredient } from "./in-house-ingredient-prep.mjs";

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
  // PMB includes the spirit type in these tap names; cabinet names omit it.
  // Keep expressions distinct instead of stripping every spirit suffix.
  if (/^don julio blanco(?: tequila)?$/.test(normalized)) return "don julio blanco";
  if (/^crown royal peach(?: whisk(?:e)?y)?$/.test(normalized)) return "crown royal peach";
  if (/^woodford reserve(?: bourbon)?$/.test(normalized)) return "woodford reserve";
  if (/^buffalo trace(?: bourbon)?$/.test(normalized)) return "buffalo trace";
  if (/^titos(?: (?:handmade )?vodka)?$/.test(normalized)) return "titos";
  if (/^jose cuervo (?:especial )?silver(?: tequila)?$/.test(normalized)) return "jose cuervo silver";
  if (/^patron silver(?: tequila)?$/.test(normalized)) return "patron silver";
  if (/^crown (?:royal )?apple(?: whisk(?:e)?y)?$/.test(normalized)) return "crown apple";
  if (/^jack daniels(?: (?:tennessee )?whisk(?:e)?y)?$/.test(normalized)) return "jack daniels";
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

function recipeIdentity(recipe) {
  if (!recipe) return "";
  // Flavor-specific recipes can share a source title or ID. Compare the
  // resolved ingredients so an early batch cannot cover a sibling flavor.
  return JSON.stringify((recipe.ingredients || []).map(ingredient => [
    ingredient.inventoryItemId || ingredient.inventoryId || ingredient.id || ingredient.name,
    ingredient.name, ingredient.oz,
  ]));
}

function batchScale(item, recipe) {
  const yieldOz = (recipe?.ingredients || []).reduce((total, ingredient) => total + (nonnegative(ingredient.oz) || 0), 0);
  const batchSizeOz = nonnegative(item.batchSizeOz) || 0;
  if (!yieldOz || !batchSizeOz) return 1;
  const scale = batchSizeOz / yieldOz;
  // Match prep consumption: an ounce of yield-label rounding is not a
  // fractional batch requiring an extra bottle.
  return Math.abs(batchSizeOz - yieldOz) <= 1.001 && Math.abs(scale - 1) <= 0.001 ? 1 : scale;
}

// Stock stays assigned to its tap. Explicit prep is authoritative this Thursday;
// credit it once before forecasting next Thursday from the saved tap counts.
export function buildRollingCocktailIngredientOrders({
  inventoryItems = [], tapInputs = [], recipes = [], recipeAliases = {}, cocktails = null,
} = {}) {
  inventoryItems = inventoryItems.map(applyInventoryCountPolicy);
  const demand = new Map();
  const issues = [];
  const itemIssues = new Map();
  const planned = Array.isArray(cocktails);
  const taps = [];
  const seenTaps = new Map();
  for (const tap of tapInputs) {
    const n = Number(tap.tapNumber);
    if (!((n >= 47 && n <= 72) || (n >= 93 && n <= 102)) || tap.prepAdditionId || /coming\s*soon/i.test(tap.name || "")) continue;
    const identity = `${String(tap.wall || "").toLowerCase()}:${n}`;
    const previous = seenTaps.get(identity);
    if (previous) {
      if (previous.name !== tap.name || previous.currentStockKegs !== tap.currentStockKegs || previous.avgWeeklyKegs !== tap.avgWeeklyKegs) {
        issues.push(`Tap ${n}: saved stock or product assignments conflict.`);
      }
      continue;
    }
    seenTaps.set(identity, tap);
    taps.push({ tap, recipe: findPlanningCocktailRecipe(tap, recipes, recipeAliases), plannedBatches: 0 });
  }
  const addDemand = (tap, recipe, batches) => {
    const n = Number(tap.tapNumber);
    if (!batches.some(Boolean)) return;
    if (!recipe) { issues.push(`Tap ${n || (tap.tapNumbers || []).join(", ") || "unassigned"}: recipe for ${tap.name} is missing.`); return; }
    const scale = batchScale(tap, recipe);
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
      const entry = demand.get(item.id) || { units: [0, 0], taps: new Set() };
      const units = getRecipeIngredientInventoryUnits(ingredient, unitOz) * scale;
      const wholeBottles = (getRecipeIngredientBottlePackage(ingredient)?.count || 0) > 0;
      batches.forEach((count, week) => {
        // Syrup is made in house for the scheduled prep, not purchased ahead.
        if (week === 0 || !isInHousePrepIngredient(item)) {
          const required = units * count;
          entry.units[week] += wholeBottles ? Math.ceil(required - 1e-9) : required;
        }
      });
      (tap.tapNumbers || [n]).map(Number).filter(number => Number.isFinite(number) && number > 0).forEach(number => entry.taps.add(number));
      demand.set(item.id, entry);
    }
  };
  if (planned) {
    const seen = new Set();
    for (const cocktail of cocktails) {
      if (/coming\s*soon/i.test(cocktail.name || "")) continue;
      const identity = cocktail.prepAdditionId || cocktail.key || `${cocktail.name}:${cocktail.tapNumbers || cocktail.tapNumber || ""}:${cocktail.wall || cocktail.walls || ""}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const quantity = Math.max(0, Number(cocktail.quantity ?? cocktail.orderQty) || 0);
      if (!quantity) continue;
      const recipe = findPlanningCocktailRecipe(cocktail, recipes, recipeAliases);
      addDemand(cocktail, recipe, [quantity, 0]);
      if (!taps.length || !recipe) continue;
      const numbers = [...new Set((cocktail.tapNumbers || [cocktail.tapNumber]).map(Number).filter(number => number > 0))];
      const walls = (cocktail.walls || [cocktail.wall]).map(value => String(value || "").toLowerCase()).filter(Boolean);
      const keys = [cocktail.inventoryKey, cocktail.key, ...(cocktail.internalIds || [])].filter(Boolean);
      const keyed = taps.filter(entry => keys.includes(entry.tap.key));
      const candidates = (keyed.length ? keyed : taps).filter(entry => (
        (!numbers.length || numbers.includes(Number(entry.tap.tapNumber)))
        && (!walls.length || walls.includes(String(entry.tap.wall || "").toLowerCase()))
        && recipeIdentity(entry.recipe) === recipeIdentity(recipe)
      ));
      if (candidates.length === 1 && numbers.length <= 1) {
        const target = candidates[0];
        target.plannedBatches += quantity * batchScale(cocktail, recipe) / batchScale(target.tap, target.recipe);
      }
      else if (candidates.length > 1 || numbers.length) issues.push(`${cocktail.name}: saved tap assignment for planned prep is missing or ambiguous.`);
      // A standalone batch with no matching active tap still needs ingredients,
      // but cannot reduce the forecast for a different tap or recipe.
    }
  }
  for (const { tap, recipe, plannedBatches } of taps) {
    const stock = nonnegative(tap.currentStockKegs);
    const average = nonnegative(tap.avgWeeklyKegs);
    if (stock === null || average === null || tap.inventoryStateMissing) {
      issues.push(`Tap ${tap.tapNumber}: saved stock or weekly usage is missing.`);
      continue;
    }
    const share = Math.min(100, nonnegative(tap.preThursdayUsageSharePct) ?? (300 / 7)) / 100;
    let remaining = Math.max(0, stock - average * share);
    const current = planned ? plannedBatches : Math.max(0, Math.ceil(average + MINIMUM_KEG_CUSHION - remaining - 1e-9));
    remaining = Math.max(0, remaining + current - average);
    const next = Math.max(0, Math.ceil(average + MINIMUM_KEG_CUSHION - remaining - 1e-9));
    addDemand(tap, recipe, [planned ? 0 : current, next]);
  }
  if (!planned && !taps.length) issues.push("Saved cocktail tap stock and usage are required for the two-Thursday ingredient plan.");
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
      cocktailPrepThisWeekBottles: Math.max(0, Math.ceil((entry?.units[0] || 0) - 1e-6)),
      cocktailPrepNextWeekBottles: Math.max(0, Math.ceil((entry?.units[1] || 0) - 1e-6)),
      par: prep + reserve, orderUnits: quantity,
      estimatedCost: item.excludeFromOrderCost ? 0 : quantity * (Number(item.unitCost) || 0),
      orderHoldReason: hold || item.orderHoldReason || "",
      rollingPlanReason: `${isInHousePrepIngredient(item) ? "This Thursday prep needs" : "This Thursday and next Thursday prep need"} ${prep} units; reserve ${reserve}; ${onHand ?? "unknown"} on hand. Order ${quantity}${item.casePackaged ? ` units in packs of ${pack}` : " units"}.`,
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
    const matches = inventoryItems.filter((item) => item.rollingIngredientVersion === 1
      && /liquor/i.test(item.group || "") && !item.orderHoldReason
      && [item.id, item.name, item.linkedIngredientName].some((name) => name && key(name) === identity));
    const item = matches.length === 1 ? matches[0] : null;
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
      refillBottleQty: nonnegative(r.refillBottleQty) ?? requested,
      actionType: requested > used ? "order" : "none", cabinetUsedQty: used,
      cabinetReservedForCocktails: reserved, cabinetInventoryId: item.id,
      reason: `${r.reason || ""} ${used} cabinet bottles cover the refill after reserving this Thursday and next Thursday's prep and the small reserve.`.trim(),
    };
  });
}
