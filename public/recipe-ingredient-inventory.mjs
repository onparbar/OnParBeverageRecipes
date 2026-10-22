import { isInventoryCountExcluded } from "./inventory-count-policy.mjs";

const text = value => String(value ?? "").trim();
export function recipeIngredientKey(value) {
  const name = text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  if (/^bacardi(?: superior(?: traveler)?(?: rum)?)?$/.test(name)) return "bacardi superior";
  if (/^mint(?: syrup)?$/.test(name)) return "mint";
  return name;
}
export function findRecipeIngredientInventory(ingredient, items) {
  const explicitId = text(ingredient.inventoryItemId || ingredient.inventoryId || ingredient.itemId);
  if (explicitId) return items.find(item => item.id === explicitId) || null;
  const keys = [ingredient.id, ingredient.name].map(recipeIngredientKey).filter(Boolean);
  const matches = items.filter(item => [item.id, item.name, item.linkedIngredientName]
    .some(value => value && keys.includes(recipeIngredientKey(value))));
  return matches.length === 1 ? matches[0] : null;
}

// A missing entry is visible and uncounted. Never infer zero from its absence.
export function completeRecipeIngredientInventory(items = [], recipes = [], {
  productFor = () => null, normalizeName = text, onHand = {}, pars = {},
} = {}) {
  const result = items.map(item => ({ ...item }));
  for (const recipe of recipes.filter(recipe => !recipe.inactive)) {
    for (const ingredient of recipe.ingredients || []) {
      const name = normalizeName(ingredient.name);
      if (!(Number(ingredient.oz) > 0) || /^(water|ice)$/i.test(name) || isInventoryCountExcluded({ ...ingredient, name })) continue;
      if (findRecipeIngredientInventory(ingredient, result)) continue;
      const id = text(ingredient.inventoryItemId || ingredient.inventoryId || ingredient.itemId)
        || (recipeIngredientKey(name) === "mint" ? "mint" : text(ingredient.id))
        || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      // Existing ambiguous identities require review; do not create duplicates.
      if (result.some(item => item.id === id)) continue;
      const product = productFor(id, name);
      const packSize = product?.casePackaged === false ? 1 : Math.max(1, Number(product?.packSize) || 1);
      result.push({
        id, name, group: product?.vendor === "OHLQ" ? "Liquor Cabinet" : "Mixer Cabinet",
        sourceSection: "Recipe ingredients", recipeIngredient: true, allowsDecimal: false,
        onHandDisplay: Object.hasOwn(onHand, id) ? text(onHand[id]) : "",
        parDisplay: text(pars[id] ?? "0"), vendorProduct: product,
        bottleOz: Number(product?.bottleOz) || 0, packSize, casePackaged: packSize > 1,
        unitCost: Number(product?.unitPrice) || 0, baseUnitCost: Number(product?.unitPrice) || 0,
        caseCost: (Number(product?.unitPrice) || 0) * packSize,
        note: product ? "Recipe ingredient; verify the physical count." : "Recipe ingredient; confirm package size and supplier.",
      });
    }
  }
  return result;
}

// Keep Monday's inputs frozen, but include newly discovered ingredients. A
// later physical count for a formerly absent ingredient is an explicit repair.
export function includeMissingRecipeInventory(snapshotItems = [], currentItems = []) {
  const ids = new Set(snapshotItems.map(item => item.id));
  return [...snapshotItems, ...currentItems.filter(item => !ids.has(item.id))];
}

export function getIngredientPurchaseGaps(items = [], vendors = []) {
  return items.flatMap(item => {
    if (isInventoryCountExcluded(item) || item.rollingIngredientVersion !== 1 || item.id === "simple-syrup") return [];
    const needed = Math.max(0, Number(item.orderUnits) || 0);
    const pending = vendors.flatMap(vendor => vendor.ordered ? vendor.items || [] : [])
      .filter(line => line.inventoryItemId === item.id && (!line.status || line.status === "pending"))
      .reduce((sum, line) => sum + Math.max(0, Number(line.quantity) - Number(line.receivedQuantity || 0)), 0);
    const missing = Math.max(0, needed - pending);
    if (!item.orderHoldReason && !missing) return [];
    return [{ id: item.id, name: item.name, quantity: missing,
      reason: item.orderHoldReason || `Prep needs ${item.cocktailPrepRequiredBottles || 0}; reserve ${item.rollingReserveUnits || 0}; ${item.onHand} on hand; ${pending} still due.`,
      held: Boolean(item.orderHoldReason) }];
  });
}

export function getRecipeIngredientBottlePackage(ingredient) {
  const raw = text(ingredient.raw);
  const bottles = raw.match(/(\d+(?:\.\d+)?)\s*(?:\([^)]*\)\s*)?(?:bottles?|btls?)\b/i);
  const explicitCount = Number(ingredient.packageCount) || 0;
  const count = explicitCount || Number(bottles?.[1]) || 0;
  if (!(count > 0) || (!bottles && !/^bottles?$/i.test(ingredient.packageUnit || ""))) return null;
  if (Number(ingredient.packageSizeOz) > 0) return { count, bottleOz: Number(ingredient.packageSizeOz) };
  const suffix = bottles ? raw.slice(bottles.index + bottles[0].length).trim() : "";
  const packageText = suffix.startsWith("(") ? suffix.slice(1, suffix.indexOf(")")) : suffix;
  const size = packageText.match(/^\s*(\d+(?:\.\d+)?)\s*(ml|l|liters?|oz)\b/i);
  if (size) {
    const unit = size[2].toLowerCase();
    return { count, bottleOz: Number(size[1]) * (unit === "oz" ? 1 : unit === "ml" ? 0.033814 : 33.814) };
  }
  // A trailing batch total ("6 bottles (liter) 203 oz") is not a bottle size.
  return { count, bottleOz: /^liters?$/i.test(packageText.trim()) ? 33.814 : 0 };
}

export function recipeIngredientQuantityIssue(ingredient) {
  const pack = getRecipeIngredientBottlePackage(ingredient);
  if (!(pack?.bottleOz > 0) || !(Number(ingredient.oz) > 0)) return "";
  const declaredOz = pack.count * pack.bottleOz;
  return Math.abs(declaredOz - Number(ingredient.oz)) > Math.max(1.1, declaredOz * 0.02)
    ? `${ingredient.name}: recipe bottle quantities disagree with its ounce total; confirm the recipe before ordering.` : "";
}
