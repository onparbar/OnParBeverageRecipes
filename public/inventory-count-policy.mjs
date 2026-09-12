// Fixed operating assumptions, not physical inventory counts.
const ASSUMED_UNITS = Object.freeze({
  "sour-mix": 16,
  "sweet-and-sour": 16,
  "cold-brew": 3,
  "cold-brew-concentrate": 3,
  "cold-brew-coffee": 3,
  vanilla: 2,
  "vanilla-syrup": 2,
});

export function getUncountedInventoryAmount(item) {
  const names = typeof item === "string" ? [item] : [item?.name, item?.id];
  for (const name of names) {
    const key = String(name ?? "").trim().toLowerCase()
      .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (Object.hasOwn(ASSUMED_UNITS, key)) return ASSUMED_UNITS[key];
  }
  return null;
}

export function applyInventoryCountPolicy(item) {
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
