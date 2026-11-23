import { readSharedDashboardState } from "./shared-dashboard-store.mjs";
import { readSharedInventoryState } from "./inventory-shared-store.mjs";
import { isBeerTapPosition } from "../public/beer-keg-pricing.mjs";
import { getKegOrderDefaults, getKegOrderKey, KEG_VENDOR_PRODUCT_CATALOG } from "../public/keg-order-defaults.mjs";
import { buildWeeklyActionPlan, normalizeWeeklyPlanProductName } from "../public/weekly-action-plan.mjs";

export function buildSavedBeerCatalog(taps, prices = {}) {
  const mapped = [];
  for (const tap of taps.filter(isBeerTapPosition).sort((a, b) => a.tapNumber - b.tapNumber)) {
    const name = normalizeWeeklyPlanProductName(tap.name);
    const key = getKegOrderKey(name);
    const saved = prices[key];
    const supplierProduct = KEG_VENDOR_PRODUCT_CATALOG[key];
    const defaults = getKegOrderDefaults(name);
    const vendor = supplierProduct?.vendor || saved?.vendorMapping?.vendor || defaults?.vendor;
    const fallback = defaults?.vendor === vendor ? defaults : null;
    const vendorSku = supplierProduct?.vendorSku || saved?.vendorMapping?.preferredSku || fallback?.vendorSku || "";
    const unitCost = Number(supplierProduct?.currentPrice ?? saved?.kegPrice ?? fallback?.unitCost);
    if (!tap.key || !name || !vendor || !(unitCost > 0) || (vendor !== "Bonbright" && !vendorSku)) continue;
    mapped.push({
      ...tap, vendor, vendorSku, unitCost, isKegTap: true,
      vendorProductName: supplierProduct?.productName || saved?.vendorMapping?.productName || fallback?.vendorProductName || name,
      actionType: "order", orderProductName: name, orderQty: 1,
    });
  }
  // Use the order builder's product grouping and physical delivery identities.
  // These are choices at zero quantity until a manager actually adds one.
  return buildWeeklyActionPlan({ recommendations: mapped }).orders.beerKegs
    .filter(line => line.kegDestinations?.length)
    .map(({ id, name, vendor, vendorSku, vendorProductName, unitCost, tapNumbers, kegDestinations }) => ({
      id, name, vendor, vendorSku, vendorProductName, unitCost, lineType: "Beer keg",
      tapNumbers, kegDestinations: kegDestinations.map(destination => ({ ...destination, quantity: 0 })),
    }));
}

export async function withSavedBeerCatalog(recommendations, {
  readInventory = readSharedInventoryState, readDashboard = readSharedDashboardState,
} = {}) {
  const snapshot = recommendations?.weeklyPlanSnapshot;
  if (!snapshot?.generatedAt || snapshot.generatedAt !== recommendations.generatedAt
    || Array.isArray(snapshot.savedBeerCatalog)) return recommendations;
  try {
    const [inventory, dashboard] = await Promise.all([readInventory(), readDashboard()]);
    const counts = inventory.snapshots?.find(entry => entry.kegPlanSnapshot?.generatedAt === snapshot.generatedAt);
    if (!counts?.kegPlanSnapshot?.tapInputs?.length || !dashboard.initialized) return recommendations;
    const savedBeerCatalog = buildSavedBeerCatalog(counts.kegPlanSnapshot.tapInputs, dashboard.data?.pricing?.kegPriceOverrides);
    return { ...recommendations, weeklyPlanSnapshot: { ...snapshot, savedBeerCatalog } };
  } catch {
    // The original locked orders remain usable if the supplemental sources are offline.
    console.warn("Saved beer choices unavailable for the weekly order picker.");
    return recommendations;
  }
}
