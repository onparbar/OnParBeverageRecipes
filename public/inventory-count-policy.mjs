// Fixed operating assumptions, not physical inventory counts.
const ASSUMED_UNITS = Object.freeze({
  "sour-mix": 16,
  "sweet-and-sour": 16,
});

const KITCHEN_ITEMS = new Set(["cold-brew", "cold-brew-concentrate", "cold-brew-coffee", "vanilla", "vanilla-syrup"]);

function inventoryPolicyKeys(item) {
  const names = typeof item === "string" ? [item] : [item?.name, item?.id];
  return names.map(name => String(name ?? "").trim().toLowerCase()
    .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
}

export function isKitchenManagedInventoryItem(item) {
  return inventoryPolicyKeys(item).some(key => KITCHEN_ITEMS.has(key));
}

export function isInventoryCountExcluded(item) {
  return isKitchenManagedInventoryItem(item) || getUncountedInventoryAmount(item) !== null;
}

export function isWeeklyCountOnlyInventoryItem(item) {
  return item?.id === "non-alcoholic-beer"
    || /^non[-\s]*alcoholic beer$/i.test(String(item?.name || ""));
}

export function getUncountedInventoryAmount(item) {
  for (const key of inventoryPolicyKeys(item)) {
    if (Object.hasOwn(ASSUMED_UNITS, key)) return ASSUMED_UNITS[key];
  }
  return null;
}

export function applyInventoryCountPolicy(item) {
  if (isKitchenManagedInventoryItem(item)) return {
    ...item,
    group: "Other", kitchenManaged: true, notCounted: true, countSource: "kitchen",
    assumedOnHand: null, onHand: null, onHandDisplay: "", hasCurrentCount: false,
    par: 0, parDisplay: "", orderQuantity: 0, orderUnits: 0, orderDisplay: "0", shortageDisplay: "0",
    totalValue: 0, estimatedCost: 0, excludeFromInventoryValue: true, excludeFromOrderList: true, excludeFromOrderCost: true,
    cocktailPrepRequiredBottles: 0, cocktailPrepShortageUnits: 0, rollingReserveUnits: 0,
    rollingIngredientVersion: 0, rollingPrepWeeks: [], rollingPrepTapNumbers: [],
    orderHoldReason: "", rollingPlanReason: "Kitchen managed; excluded from beverage counts and ordering.",
  };
  const amount = getUncountedInventoryAmount(item);
  return amount === null ? item : {
    ...item,
    group: "Other",
    notCounted: true,
    countSource: "assumed",
    assumedOnHand: amount,
    onHand: amount,
    onHandDisplay: String(amount),
    hasCurrentCount: true,
  };
}
