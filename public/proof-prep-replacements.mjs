import { carryForwardPlannedProofPrep } from "./proof-planned-prep.mjs";

export const PROOF_PREP_LOOK_AHEAD_WEEKS = 52;

export function buildProofPrepOrderContext(options = {}) {
  try {
    if (!Array.isArray(options.tapInputs) || !options.tapInputs.length) {
      return buildProofPrepOrderContextFromInputs(options);
    }
    const carried = carryForwardPlannedProofPrep(options);
    const context = buildProofPrepOrderContextFromInputs(carried.options);
    return carried.unresolved && context.requirement === "not-required"
      ? { ...context, requirement: "unknown" }
      : context;
  } catch {
    // This forecast is advisory. A malformed recipe or tap observation must
    // never prevent the weekly snapshot from being saved or the plan loading.
    // Fail closed so no demand or safe minimum-order filler is invented.
    return { candidates: [], requirement: "unknown" };
  }
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+[123]$/, "")
    .replace(/\s+(?:main|karaoke|patio)(?: wall)?$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRecipe(cocktail, recipes, recipeAliases = {}) {
  const cocktailKeys = [cocktail?.recipeId, cocktail?.recipeName, cocktail?.name]
    .map(key)
    .filter(Boolean);
  if (!cocktailKeys.length) return null;
  const aliasKeys = Object.entries(recipeAliases).flatMap(([productName, recipeName]) => (
    cocktailKeys.includes(key(productName)) ? [key(recipeName)] : []
  ));
  const matchingKeys = new Set([...cocktailKeys, ...aliasKeys]);
  return recipes.find((recipe) => (
    matchingKeys.has(key(recipe?.id))
    || matchingKeys.has(key(recipe?.title || recipe?.name))
  )) || null;
}

function getProofInventoryItem(ingredient, inventoryItems) {
  const ingredientKey = key(ingredient?.inventoryId || ingredient?.name);
  if (!ingredientKey) return null;
  return inventoryItems.find((item) => {
    const vendor = clean(item?.vendor || item?.vendorProduct?.vendor || item?.vendorProduct?.syncVendor);
    if (vendor.toLowerCase() !== "proof") return false;
    return [item?.id, item?.name, item?.vendorProduct?.productName].some((value) => key(value) === ingredientKey);
  }) || null;
}

function getSavedInventoryItem(item, savedInventoryItems) {
  const itemId = clean(item?.id);
  const itemKey = key(item?.name);
  return savedInventoryItems.find((savedItem) => (
    (itemId && clean(savedItem?.id) === itemId)
    || (itemKey && key(savedItem?.name) === itemKey)
  )) || null;
}

function getSavedInventoryValue(item, displayField, valueField) {
  const displayValue = item?.[displayField];
  if (clean(displayValue) !== "") return displayValue;
  const value = item?.[valueField];
  return clean(value) === "" ? "" : value;
}

function applySavedInventoryCounts(inventoryItems = [], savedInventoryItems = []) {
  if (!savedInventoryItems.length) return inventoryItems;
  return inventoryItems.map((item) => {
    const savedItem = getSavedInventoryItem(item, savedInventoryItems);
    if (!savedItem) return item;
    return {
      ...item,
      onHandDisplay: getSavedInventoryValue(savedItem, "onHandDisplay", "onHand"),
      parDisplay: getSavedInventoryValue(savedItem, "parDisplay", "par"),
      hasCurrentCount: savedItem.hasCurrentCount ?? item.hasCurrentCount,
    };
  });
}

function getProjectedProofUsage({
  cocktails = [],
  recipes = [],
  inventoryItems = [],
  recipeAliases = {},
} = {}) {
  const projectedOzById = new Map();
  let unresolvedRecipe = false;
  (Array.isArray(cocktails) ? cocktails : []).forEach((cocktail) => {
    const batches = Math.max(0, Math.floor(number(cocktail?.quantity)));
    const recipe = batches ? getRecipe(cocktail, Array.isArray(recipes) ? recipes : [], recipeAliases) : null;
    if (batches && !recipe) unresolvedRecipe = true;
    if (!recipe) return;
    (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).forEach((ingredient) => {
      const ingredientOz = number(ingredient?.oz);
      const item = ingredientOz > 0
        ? getProofInventoryItem(ingredient, Array.isArray(inventoryItems) ? inventoryItems : [])
        : null;
      if (!item) return;
      const id = clean(item.id);
      if (!id) return;
      projectedOzById.set(id, {
        item,
        projectedOz: (projectedOzById.get(id)?.projectedOz || 0) + (ingredientOz * batches),
      });
    });
  });

  return { projectedOzById, unresolvedRecipe };
}

function buildProofPrepOrderContextFromInputs(options = {}) {
  const inventoryItems = applySavedInventoryCounts(
    Array.isArray(options.inventoryItems) ? options.inventoryItems : [],
    Array.isArray(options.savedInventoryItems) ? options.savedInventoryItems : [],
  );
  if (Array.isArray(options.tapInputs) && options.tapInputs.length) {
    return buildProofLookAheadContext({ ...options, inventoryItems });
  }
  const { projectedOzById, unresolvedRecipe } = getProjectedProofUsage({
    ...options,
    inventoryItems,
  });
  let unresolvedInventory = false;
  let prepPurchaseRequired = false;

  const candidates = [...projectedOzById.values()].flatMap(({ item, projectedOz }) => {
    const bottleOz = number(item?.bottleOz || item?.vendorProduct?.bottleOz);
    const packSize = Math.max(1, Math.floor(number(item?.packSize) || 1));
    const unitCost = number(item?.unitCost) || (number(item?.caseCost) / packSize);
    const vendorSku = clean(item?.vendorSku || item?.matchedSku || item?.vendorProduct?.preferredSku);
    const projectedPrepUseUnits = bottleOz > 0 ? Math.ceil(projectedOz / bottleOz) : 0;
    const rawOnHand = item?.onHandDisplay ?? item?.onHand;
    if (!(projectedPrepUseUnits > 0) || item.hasCurrentCount === false
      || clean(rawOnHand) === "" || !Number.isFinite(Number(rawOnHand)) || Number(rawOnHand) < 0) {
      unresolvedInventory = true;
      return [];
    }
    const onHandUnits = number(rawOnHand);
    if (onHandUnits < projectedPrepUseUnits) prepPurchaseRequired = true;
    const replacementNeedUnits = Math.max(0, Math.ceil(projectedPrepUseUnits - onHandUnits));
    if (!(replacementNeedUnits > 0)) return [];
    if (!item?.casePackaged || !vendorSku || !(unitCost > 0)
      || item.shelfStable === false || item.vendorProduct?.shelfStable === false) return [];
    return [{
      id: clean(item.id),
      name: clean(item.name),
      vendor: "Proof",
      vendorSku,
      vendorProductName: clean(item?.vendorProduct?.productName || item.name),
      casePackaged: true,
      shelfStable: true,
      packSize,
      projectedPrepUseUnits,
      projectedPrepUseOz: projectedOz,
      onHandUnits,
      parUnits: 0,
      replacementNeedUnits,
      unitCost,
    }];
  });

  return {
    candidates,
    requirement: prepPurchaseRequired
      ? "required"
      : unresolvedRecipe || unresolvedInventory ? "unknown" : "not-required",
  };
}

export function buildProofPrepReplacementCandidates(options = {}) {
  return buildProofPrepOrderContext(options).candidates;
}

// Forecast production per tap. Only ingredient demand is combined, never keg stock.
// Forecast far enough ahead to identify the next genuine shelf-stable needs.
// Proof minimum top-ups select these needs chronologically until the order
// reaches the delivery minimum; they never add unrelated filler.
function buildProofLookAheadContext(options) {
  const usage = new Map();
  const recipes = Array.isArray(options.recipes) ? options.recipes : [];
  const inventoryItems = options.inventoryItems;
  let unresolved = false;
  const seen = new Set();
  const addRecipe = (recipe, batches, week) => {
    for (const ingredient of recipe.ingredients || []) {
      const item = getProofInventoryItem(ingredient, inventoryItems);
      if (!item || !(number(ingredient.oz) > 0)) continue;
      const id = clean(item.id);
      const entry = usage.get(id) || { item, ounces: Array(PROOF_PREP_LOOK_AHEAD_WEEKS).fill(0) };
      entry.ounces[week] += number(ingredient.oz) * batches;
      usage.set(id, entry);
    }
  };
  for (const tap of options.tapInputs) {
    const tapNumber = number(tap.tapNumber);
    if (!((tapNumber >= 47 && tapNumber <= 72) || (tapNumber >= 93 && tapNumber <= 102))) continue;
    if (/coming\s*soon/i.test(clean(tap.name))) continue;
    const identity = clean(tap.key) || `${clean(tap.wall)}:${tapNumber}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const recipe = getRecipe(tap, recipes, options.recipeAliases);
    const average = Number(tap.avgWeeklyKegs);
    const stock = Number(tap.currentStockKegs);
    if (!recipe || tap.inventoryStateMissing
      || clean(tap.avgWeeklyKegs) === "" || clean(tap.currentStockKegs) === ""
      || !Number.isFinite(average) || average < 0 || !Number.isFinite(stock) || stock < 0) {
      unresolved = true;
      continue;
    }
    const cushion = clean(tap.variabilityCushionPct) === ""
      ? 0.1 : Math.min(0.5, Math.max(0, number(tap.variabilityCushionPct) / 100));
    const preThursdayShare = clean(tap.preThursdayUsageSharePct) === ""
      ? 3 / 7 : Math.min(1, Math.max(0, number(tap.preThursdayUsageSharePct) / 100));
    let remaining = Math.max(0, stock - average * preThursdayShare);
    for (let week = 0; week < PROOF_PREP_LOOK_AHEAD_WEEKS; week += 1) {
      // Every week begins with the prior week's projected closing stock. A
      // batch made in an earlier week remains available here, then expected
      // weekly usage is consumed below. This prevents the same prep action
      // from being recommended again in each future week.
      const batches = Math.max(0, Math.ceil(average * (1 + cushion) - remaining - 1e-9));
      if (batches) addRecipe(recipe, batches, week);
      remaining = Math.max(0, remaining + batches - average);
    }
  }
  // Planned batches already credit their own tap's stock. The simulation now
  // represents additional batches, so reserve the planned ingredients once.
  const locked = getProjectedProofUsage(options);
  unresolved ||= locked.unresolvedRecipe || !seen.size;
  for (const [id, entry] of locked.projectedOzById) {
    const projected = usage.get(id) || { item: entry.item, ounces: Array(PROOF_PREP_LOOK_AHEAD_WEEKS).fill(0) };
    projected.ounces[0] += entry.projectedOz;
    usage.set(id, projected);
  }
  let required = false;
  const candidates = [];
  for (const { item, ounces } of usage.values()) {
    const bottleOz = number(item.bottleOz || item.vendorProduct?.bottleOz);
    const rawOnHand = item.onHandDisplay ?? item.onHand;
    if (!(bottleOz > 0) || item.hasCurrentCount === false || clean(rawOnHand) === ""
      || !Number.isFinite(Number(rawOnHand)) || Number(rawOnHand) < 0) {
      unresolved = true;
      continue;
    }
    const onHandUnits = Number(rawOnHand);
    let cumulativeOz = 0;
    const forecastDemands = ounces.map((oz, week) => {
      cumulativeOz += oz;
      return { week, units: Math.max(0, Math.ceil(cumulativeOz / bottleOz - 1e-9)) };
    });
    if ((ounces[0] + ounces[1]) / bottleOz > onHandUnits) required = true;
    const replacementNeedUnits = Math.max(0, forecastDemands[PROOF_PREP_LOOK_AHEAD_WEEKS - 1].units - onHandUnits);
    const packSize = Math.max(1, Math.floor(number(item.packSize) || 1));
    const unitCost = number(item.unitCost) || number(item.caseCost) / packSize;
    const vendorSku = clean(item.vendorSku || item.matchedSku || item.vendorProduct?.preferredSku);
    if (!replacementNeedUnits || !item.casePackaged || !vendorSku || !(unitCost > 0)
      || item.shelfStable === false || item.vendorProduct?.shelfStable === false) continue;
    candidates.push({
      id: clean(item.id), name: clean(item.name), vendor: "Proof", vendorSku,
      vendorProductName: clean(item.vendorProduct?.productName || item.name),
      casePackaged: true, shelfStable: true, packSize, unitCost,
      onHandUnits, parUnits: 0, replacementNeedUnits,
      projectedPrepUseUnits: Math.ceil(cumulativeOz / bottleOz),
      projectedPrepUseOz: cumulativeOz, forecastDemands,
      forecastSource: `Per-tap Thursday prep forecast; ${PROOF_PREP_LOOK_AHEAD_WEEKS} weeks maximum; missing tap profiles use a 10% cushion and 3/7 pre-Thursday usage.`,
    });
  }
  // Known demand remains a valid lower bound when another tap is unresolved.
  // Keep those candidates, but never claim complete coverage of missing data.
  return { candidates, requirement: required ? "required" : unresolved ? "unknown" : "not-required" };
}
