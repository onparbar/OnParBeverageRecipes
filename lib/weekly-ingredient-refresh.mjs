import { findCatalogItem, readPrepRecipes } from "./inventory-contributions.mjs";
import { readSharedInventoryState } from "./inventory-shared-store.mjs";
import { refreshWeeklyIngredientOrders } from "../public/weekly-ingredient-orders.mjs";

const clean = value => String(value ?? "").trim();
const numeric = value => value == null || clean(value) === "" ? null
  : Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

function packageOunces(productName) {
  const match = clean(productName).match(/\b(\d+(?:\.\d+)?)\s*(ml|liters?|l|fl\.?\s*oz|oz)\b/i);
  if (!match) return 0;
  const unit = match[2].toLowerCase();
  return Number(match[1]) * (unit === "ml" ? 0.033814 : unit.startsWith("l") ? 33.814 : 1);
}

// Published purchase plans use their original count baseline. Live counts may
// already include deliveries or ingredient deductions from completed prep.
export function buildWeeklyIngredientInventory({ snapshot, savedCounts, inventory }) {
  const catalog = snapshot.orderCatalog || [];
  const custom = inventory?.current?.customItems || [];
  const rows = [...(savedCounts?.items || [])];
  const ids = new Set(rows.map(item => item.id));
  for (const item of [...custom, ...catalog]) {
    if (!item.id || ids.has(item.id)) continue;
    ids.add(item.id);
    rows.push({ ...item, onHandDisplay: inventory?.current?.onHandOverrides?.[item.id] ?? "" });
  }
  return rows.map(item => {
    const product = catalog.find(entry => entry.id === item.id) || {};
    const current = custom.find(entry => entry.id === item.id) || {};
    const vendorProduct = current.vendorProduct || item.vendorProduct || {};
    const vendorProductName = product.vendorProductName || vendorProduct.productName || item.name;
    const onHand = numeric(item.onHandDisplay ?? item.onHand);
    const unitCost = numeric(product.unitCost ?? item.unitCost ?? vendorProduct.unitPrice);
    const group = item.group || product.group || current.group
      || (product.orderCategory === "liquor" ? "Liquor Cabinet" : product.orderCategory === "mixers" ? "Mixer Cabinet" : "Other");
    const bottleOz = numeric(product.bottleOz) || numeric(item.bottleOz)
      || numeric(vendorProduct.bottleOz) || packageOunces(vendorProductName)
      || (item.id === "simple-syrup" ? 128 : 0);
    return {
      ...current, ...item, ...product, group, bottleOz, onHand,
      onHandDisplay: onHand === null ? "" : String(onHand),
      hasCurrentCount: onHand !== null,
      vendor: product.vendor || vendorProduct.vendor || vendorProduct.syncVendor || "",
      vendorSku: product.vendorSku || vendorProduct.preferredSku || "",
      vendorProductName,
      vendorProduct,
      unitCost,
      hasKnownPrice: Boolean(product.excludeFromOrderCost) || (unitCost !== null && unitCost > 0),
      packSize: Math.max(1, Number(product.packSize || item.packSize || vendorProduct.packSize) || 1),
      casePackaged: product.casePackaged ?? item.casePackaged ?? vendorProduct.casePackaged ?? false,
      par: numeric(item.parDisplay ?? item.par) || 0,
      orderUnits: numeric(item.orderDisplay ?? item.orderUnits) || 0,
    };
  });
}

export function refreshIngredientPurchases(context, recommendations) {
  const { savedCounts, inventory } = context;
  const snapshot = recommendations.weeklyPlanSnapshot;
  const tapInputs = savedCounts?.kegPlanSnapshot?.tapInputs;
  if (!Array.isArray(tapInputs) || !tapInputs.length) {
    const error = new Error("The saved tap counts and usage are missing. Save a verified weekly plan before refreshing ingredient orders.");
    error.status = 409;
    error.code = "INGREDIENT_FORECAST_INPUTS_MISSING";
    throw error;
  }
  const inventoryItems = buildWeeklyIngredientInventory({ snapshot, savedCounts, inventory });
  const recipes = context.recipes.map(recipe => ({
    ...recipe,
    ingredients: (recipe.ingredients || []).map(ingredient => {
      const name = clean(ingredient.name).replace(/^(?:\d+(?:\.\d+)?\s*)?gallons?\s+/i, "");
      const explicitId = ingredient.inventoryItemId || ingredient.inventoryId || ingredient.itemId;
      const item = explicitId ? inventoryItems.find(entry => entry.id === explicitId)
        : findCatalogItem(inventoryItems, { name, raw: ingredient.raw });
      return { ...ingredient, name, ...(item ? { inventoryItemId: item.id } : {}) };
    }),
  }));
  return refreshWeeklyIngredientOrders({ recommendations, inventoryItems, tapInputs, recipes });
}

export async function refreshSavedIngredientPurchases(recommendations) {
  const [inventory, recipes] = await Promise.all([readSharedInventoryState(), readPrepRecipes({ requireShared: true })]);
  const savedCounts = inventory.snapshots.find(entry => entry.kegPlanSnapshot?.generatedAt === recommendations.generatedAt);
  return refreshIngredientPurchases({ inventory, savedCounts, recipes: recipes.filter(recipe => !recipe.inactive) }, recommendations);
}
