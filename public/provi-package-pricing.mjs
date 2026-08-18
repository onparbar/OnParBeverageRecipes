function moneyNumber(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function getProviInventoryUnitPrice(inventory = {}, { packSize = 1, isKeg = false } = {}) {
  const directUnitPrice = moneyNumber(inventory.unit_price || inventory.price);
  if (directUnitPrice) return directUnitPrice;
  const packagePrice = moneyNumber(inventory.case_price || inventory.keg_price || inventory.pack_price);
  if (!packagePrice) return 0;
  if (isKeg) return packagePrice;
  const normalizedPackSize = Math.max(1, Math.round(moneyNumber(packSize) || 1));
  return packagePrice / normalizedPackSize;
}

