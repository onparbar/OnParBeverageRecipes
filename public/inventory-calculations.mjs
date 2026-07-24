function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const cleaned = String(value).replace(/[$,%\s]/g, "").replace(/,/g, "");
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function normalizePackSize(value) {
  const packSize = toFiniteNumber(value);
  if (!packSize || packSize <= 0) return 1;
  return Math.max(1, Math.round(packSize));
}

export function getInventoryOnHandUnits({
  caseEquivalent,
  individualUnits,
  packSize,
  casePackaged,
}) {
  const individualCount = toFiniteNumber(individualUnits);
  if (casePackaged && individualCount !== null) return individualCount;

  const caseCount = toFiniteNumber(caseEquivalent) || 0;
  return casePackaged
    ? Math.round(caseCount * normalizePackSize(packSize))
    : caseCount;
}

export function getInventoryUnitCost(caseCost, packSize = 1) {
  const cost = toFiniteNumber(caseCost) || 0;
  const normalizedPackSize = normalizePackSize(packSize);
  return cost > 0 ? cost / normalizedPackSize : 0;
}

export function getRoundedOrderUnits(shortageUnits, packSize = 1, casePackaged = false) {
  const shortage = toFiniteNumber(shortageUnits) || 0;
  if (shortage <= 0) return 0;
  if (!casePackaged) return shortage;

  const normalizedPackSize = normalizePackSize(packSize);
  return Math.ceil(shortage / normalizedPackSize) * normalizedPackSize;
}

export function getOrderCaseCount(orderUnits, packSize = 1) {
  const units = toFiniteNumber(orderUnits) || 0;
  if (units <= 0) return 0;
  return units / normalizePackSize(packSize);
}

export function convertLegacyCaseCountToUnits(caseCount, legacyPackSize = 1) {
  const count = toFiniteNumber(caseCount) || 0;
  return Math.round(count * normalizePackSize(legacyPackSize));
}
