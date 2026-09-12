// Price events live alongside the existing shared, revision-protected overrides.
export function observePackagePrice(previous = {}, next = {}, { name, kind = "ingredient", source = "manual" } = {}) {
  const priceKey = kind === "keg" ? "kegPrice" : "bottlePrice";
  const sizeKey = kind === "keg" ? "kegOz" : "bottleOz";
  const oldPrice = Number(previous[priceKey]), newPrice = Number(next[priceKey]);
  const oldSize = Number(previous[sizeKey]), newSize = Number(next[sizeKey]);
  const events = Array.isArray(previous.priceChangeAlerts) ? previous.priceChangeAlerts : [];
  const timestamp = next.updatedAt || new Date().toISOString();
  const result = { ...previous, ...next, priceSource: source, priceChangeAlerts: events };
  // A first price, invalid observation, or different package is not a price change.
  if (![oldPrice, newPrice, oldSize, newSize].every(value => Number.isFinite(value) && value > 0)
    || Math.abs(oldSize - newSize) >= 0.2) return result;
  const change = (newPrice - oldPrice) / oldPrice;
  if (Math.abs(change) <= 0.1 + 1e-10) return result;
  const id = [timestamp, oldPrice, newPrice, newSize].join(":");
  if (!events.some(event => event.id === id)) {
    result.priceChangeAlerts = [...events, { id, name, oldPrice, newPrice, packageOz: newSize,
      changePercent: change * 100, observedAt: timestamp, source, dismissedAt: "" }];
  }
  return result;
}

export function createSupplierMapping({ name, vendor, bottleOz, kind = "ingredient", orderingSku = "" }) {
  const distributors = {
    Heidelberg: ["Heidelberg"], Bonbright: ["Bonbright"],
    OHLQ: ["Ohio Liquor", "OHLQ"], Proof: ["Southern Glazer", "SGWS"],
  };
  if (!distributors[vendor] || !String(name || "").trim() || !(Number(bottleOz) > 0)) return null;
  return { vendor, syncVendor: vendor === "OHLQ" ? "OHLQ" : "Provi",
    productName: String(name).trim(), bottleOz: Number(bottleOz), packSize: 1,
    distributorHints: distributors[vendor], ...(vendor === "OHLQ" ? { distributorIds: [16114] } : {}),
    orderingSystem: { Heidelberg: "BEES", Bonbright: "Bonbright", OHLQ: "OHLQ", Proof: "Proof" }[vendor],
    orderingSku: String(orderingSku).trim(), orderingStatus: orderingSku ? "confirmed" : "needs-confirmation",
    kind, requireExactMatch: true, matchStatus: "pending", preferredSku: "" };
}
