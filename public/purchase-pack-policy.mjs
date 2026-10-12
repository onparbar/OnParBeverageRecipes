function isBuffaloTrace(item = {}) {
  return [item.id, item.internalId, item.name, item.productName, item.vendorProductName].some(value => (
    /^buffalo trace(?:$| bourbon\b| kentucky\b| \d)/i.test(String(value || "").replace(/[-_]+/g, " ").trim())
  )) || (String(item.vendor || "").toUpperCase() === "OHLQ" && String(item.vendorSku || item.preferredSku || "").toUpperCase() === "1499L");
}

// Supplier quantities are independent of the number of bottles poured into a tap.
export function applyPurchasePackPolicy(item = {}) {
  if (!isBuffaloTrace(item)) return item;
  const originalQuantity = Math.max(0, Number(item.quantity) || 0);
  const quantity = originalQuantity > 0 ? Math.ceil(originalQuantity / 12) * 12 : 0;
  const unitCost = Number(item.unitCost) > 0 ? Number(item.unitCost)
    : originalQuantity > 0 ? Math.max(0, Number(item.estimatedCost) || 0) / originalQuantity : 0;
  return {
    ...item,
    quantity,
    casePackaged: true,
    packSize: 12,
    caseCount: quantity / 12,
    minimumOrderUnits: 12,
    unitCost,
    estimatedCost: item.excludeFromOrderCost ? 0 : Math.round(quantity * unitCost * 100) / 100,
  };
}
