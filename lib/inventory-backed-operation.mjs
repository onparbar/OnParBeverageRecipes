import { setTimeout as delay } from "node:timers/promises";

export class InventoryBackedOperationError extends Error {
  constructor(stage, cause) {
    super("The checklist was saved. Its inventory update is queued for automatic recovery; do not enter a second delivery.");
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
      if (attempt === 2 || [400, 401, 403, 404, 422].includes(error.status)) throw new InventoryBackedOperationError("inventory", error);
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
