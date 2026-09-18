import { setTimeout as delay } from "node:timers/promises";

export function withInventoryReviewWarning(update = {}, reviewItems = []) {
  const names = [...new Set(reviewItems.map((item) => String(item?.name || "").trim()).filter(Boolean))];
  const reviewRequired = reviewItems.length > 0;
  const reviewWarning = reviewRequired
    ? `Checklist saved. Cabinet inventory needs manager review${names.length ? ` for: ${names.join(", ")}` : ""}.`
    : "";
  return {
    ...update,
    reviewRequired,
    reviewItems: reviewItems.map((item) => ({ id: item.id, name: item.name })),
    warning: [update?.warning, reviewWarning].filter(Boolean).join(" "),
  };
}

export class InventoryBackedOperationError extends Error {
  constructor(stage, cause) {
    super(cause?.code === "INVENTORY_RECOUNT_REQUIRED"
      ? `The checklist was saved; its inventory correction is waiting for a recount. ${cause.message}`
      : "The checklist was saved. Its inventory update is queued for automatic recovery; do not enter a second delivery.");
    this.name = "InventoryBackedOperationError";
    this.code = "INVENTORY_BACKED_OPERATION_INCOMPLETE";
    this.status = 503;
    this.details = { stage, retryable: true };
    this.cause = cause;
  }
}

export async function executeInventoryBackedOperation({
  plan,
  assertPlan,
  persist,
  applyInventory,
  recordActivity,
  wait = delay,
}) {
  assertPlan(plan);
  const saved = await persist();
  let inventoryUpdate;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      // Stable contribution IDs replace prior quantities rather than add again.
      inventoryUpdate = await applyInventory(plan);
      break;
    } catch (error) {
      if (attempt === 2 || error.code === "INVENTORY_RECOUNT_REQUIRED" || [400, 401, 403, 404, 422].includes(error.status)) throw new InventoryBackedOperationError("inventory", error);
      await wait(attempt === 0 ? 250 : 1000);
    }
  }
  let activityRecorded = true;
  try {
    await recordActivity(saved, inventoryUpdate);
  } catch {
    activityRecorded = false;
    console.error("Inventory operation saved; activity logging unavailable.");
  }
  return { saved, inventoryUpdate, activityRecorded };
}
