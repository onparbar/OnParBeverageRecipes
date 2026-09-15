import { getCurrentWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";
import { buildUnifiedVendorOrderModel } from "../public/vendor-order-drafts.mjs";
import { normalizeSnapshotOrder } from "../public/weekly-snapshot-orders.mjs";
import { buildWeeklyOrderTracking, WeeklyOrderTrackingError } from "./weekly-order-tracking.mjs";
import { mutateSharedInventoryState } from "./inventory-shared-store.mjs";

export async function archiveWeeklyOrderPlacement(recommendations, vendorId, role) {
  const snapshot = getCurrentWeeklyPlanSnapshot(recommendations);
  const tracking = buildWeeklyOrderTracking(recommendations);
  const vendor = tracking?.vendors.find((entry) => entry.id === vendorId);
  if (!snapshot || !vendor) throw new WeeklyOrderTrackingError("WEEKLY_ORDER_SNAPSHOT_MISSING", "The weekly order changed. Reload before marking it placed.", 409);
  const model = buildUnifiedVendorOrderModel(snapshot.plan, {
    snapshot,
    orderPolicy: tracking.orderPolicy,
    manualAdjustments: tracking.adjustments,
    manualCatalog: tracking.adjustmentCatalog,
  });
  const draft = model.drafts.find((entry) => entry.vendor === vendor.vendor);
  const order = normalizeSnapshotOrder({
    ...vendor,
    vendorId: vendor.id,
    generatedAt: tracking.generatedAt,
    draftId: draft?.id,
    lines: draft?.lines,
    updatedAt: new Date().toISOString(),
  });
  if (!order) throw new WeeklyOrderTrackingError("WEEKLY_ORDER_SNAPSHOT_INVALID", "The order details could not be captured. Reload and try again.", 409);
  await mutateSharedInventoryState("save-order-snapshot", { order }, role);
  return order;
}
