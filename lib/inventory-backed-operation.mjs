export class InventoryBackedOperationError extends Error {
  constructor(stage, cause) {
    super("The change needs one retry to finish saving.");
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
}) {
  assertPlan(plan);
  const saved = await persist();
  let inventoryUpdate;
  try {
    inventoryUpdate = await applyInventory(plan);
  } catch (error) {
    throw new InventoryBackedOperationError("inventory", error);
  }
  try {
    await recordActivity(saved, inventoryUpdate);
  } catch (error) {
    throw new InventoryBackedOperationError("activity", error);
  }
  return { saved, inventoryUpdate };
}
