function normalizeId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function positiveNumber(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatQuantity(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export const PREPARED_INGREDIENT_PURCHASES = Object.freeze({
  "cold-brew-coffee": Object.freeze({
    ingredientId: "cold-brew-coffee",
    purchaseUnitOz: 32,
    purchaseUnitStorageValue: "32",
    purchaseUnitLabel: "32 oz concentrate bottle",
    priceInputLabel: "Concentrate bottle price",
    finishedYieldOzPerPurchaseUnit: 192,
    waterOzPerPurchaseUnit: 160,
  }),
  "blue-dot-juice": Object.freeze({
    ingredientId: "blue-dot-juice",
    purchaseUnitStorageValue: "1",
    purchaseUnitLabel: "Starburst box (6 packets)",
    priceInputLabel: "Starburst box price",
    finishedYieldOzPerPurchaseUnit: 128,
    waterOzPerPurchaseUnit: 128,
    packetsPerPurchaseUnit: 6,
  }),
});

export function getPreparedIngredientPurchase(value) {
  return PREPARED_INGREDIENT_PURCHASES[normalizeId(value)] || null;
}

export function getPreparedIngredientCanonicalName(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^(?:\d+(?:\.\d+)?\s+)?blue dot juice$/.test(normalized)) return "Blue Dot Juice";
  return "";
}

export function isPreparedIngredientRecipeNote({ raw = "", cost = "", ounces = "" } = {}) {
  if (String(cost || "").trim() || String(ounces || "").trim()) return false;
  return /^blue dot juice\s*\(1 gallon of water and 6 packets of blue raspberry\)$/i
    .test(String(raw || "").trim());
}

export function normalizePreparedIngredientPriceOverride(ingredientId, override = {}) {
  const config = getPreparedIngredientPurchase(ingredientId);
  if (!config || !override || typeof override !== "object") return override;

  const bottleOz = positiveNumber(override.bottleOz);
  const bottlePrice = positiveNumber(override.bottlePrice);
  let normalizedPrice = bottlePrice;

  // The previous model stored the cost of the entire diluted yield. Preserve
  // user-entered totals while converting them to the purchased package price.
  if (config.ingredientId === "cold-brew-coffee" && bottleOz >= 380 && bottlePrice) {
    normalizedPrice = bottlePrice / 2;
  }

  return {
    ...override,
    bottleOz: config.purchaseUnitStorageValue,
    bottlePrice: normalizedPrice ? String(normalizedPrice) : String(override.bottlePrice || ""),
  };
}

export function normalizePreparedIngredientPriceOverrides(source = {}) {
  return Object.fromEntries(Object.entries(source || {}).map(([id, override]) => [
    id,
    normalizePreparedIngredientPriceOverride(id, override),
  ]));
}

export function getPreparedIngredientFinishedUnitCost(ingredientId, packagePrice) {
  const config = getPreparedIngredientPurchase(ingredientId);
  const price = positiveNumber(packagePrice);
  if (!config || !price) return 0;
  return price / config.finishedYieldOzPerPurchaseUnit;
}

export function getPreparedIngredientCost(ingredientId, finishedOunces, packagePrice) {
  return positiveNumber(finishedOunces)
    * getPreparedIngredientFinishedUnitCost(ingredientId, packagePrice);
}

export function getPreparedIngredientYieldNote(ingredientId) {
  const config = getPreparedIngredientPurchase(ingredientId);
  if (!config) return "";
  const water = config.waterOzPerPurchaseUnit / 128;
  const waterLabel = water === 1 ? "1 gallon water" : `${formatQuantity(water)} gallons water`;
  return `${config.purchaseUnitLabel} makes ${formatQuantity(config.finishedYieldOzPerPurchaseUnit)} oz with ${waterLabel}`;
}

export function getPreparedIngredientRecipeAmount(ingredientId, finishedOunces) {
  const config = getPreparedIngredientPurchase(ingredientId);
  const ounces = positiveNumber(finishedOunces);
  if (!config || !ounces) return "";

  const purchaseUnits = ounces / config.finishedYieldOzPerPurchaseUnit;
  const waterGallons = (purchaseUnits * config.waterOzPerPurchaseUnit) / 128;
  const waterLabel = `${formatQuantity(waterGallons)} ${waterGallons === 1 ? "gallon" : "gallons"} water`;

  if (config.packetsPerPurchaseUnit) {
    const packets = purchaseUnits * config.packetsPerPurchaseUnit;
    return `${formatQuantity(purchaseUnits)} Starburst ${purchaseUnits === 1 ? "box" : "boxes"} (${formatQuantity(packets)} packets) + ${waterLabel}`;
  }

  return `${formatQuantity(purchaseUnits)} concentrate ${purchaseUnits === 1 ? "bottle" : "bottles"} (32 oz) + ${waterLabel}`;
}
