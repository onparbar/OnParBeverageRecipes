import { isPricingPlaceholder } from "./pricing-placeholders.mjs";

const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const nameKey = value => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");

// Prices omit Coming Soon rows. Carry the independently verified assignments
// with each price read so an older keg snapshot cannot turn an empty tap into
// a missing sell price. Incomplete/old assignment evidence is not an exemption.
export function getTapPricingCoverage({
  assignments = [], priceItems = [], expectedTapNumbers = [], updatedAt = "", now = new Date(),
} = {}) {
  const capturedAt = Date.parse(updatedAt);
  const age = new Date(now).getTime() - capturedAt;
  if (!Number.isFinite(age) || age < -60_000 || age > 24 * 60 * 60_000) return null;
  const expected = new Set(expectedTapNumbers.map(Number));
  if (!expected.size || expected.size !== expectedTapNumbers.length
    || [...expected].some(tap => !positiveInteger(tap))
    || !Array.isArray(assignments) || assignments.length !== expected.size) return null;
  const taps = new Set();
  const slots = new Set();
  for (const row of assignments) {
    const tap = Number(row?.tapNumber);
    const slot = `${Number(row?.deviceId)}:${Number(row?.lineNum)}`;
    if (!expected.has(tap) || taps.has(tap) || slots.has(slot)
      || !positiveInteger(row?.plu) || !positiveInteger(row?.deviceId) || !positiveInteger(row?.lineNum)
      || !nameKey(row?.product)) return null;
    taps.add(tap);
    slots.add(slot);
  }
  const active = assignments.filter(row => !isPricingPlaceholder(row.product));
  const prices = Array.isArray(priceItems) ? priceItems : [];
  const missingAssignments = active.filter(row => {
    const matches = prices.filter(price => Number(price?.tapPosition) === Number(row.tapNumber));
    if (matches.length !== 1) return true;
    const price = matches[0];
    return price.isCurrentTap !== true || price.tapMatchSource !== "pmb-tap-config"
      || Number(price.plu) !== Number(row.plu)
      || Number(price.deviceId) !== Number(row.deviceId) || Number(price.lineNum) !== Number(row.lineNum)
      || nameKey(price.name) !== nameKey(row.product)
      || !Number.isFinite(Number(price.chargePerOz)) || Number(price.chargePerOz) <= 0;
  });
  return {
    assignments,
    expectedCount: active.length,
    capturedCount: active.length - missingAssignments.length,
    placeholderTapNumbers: assignments.filter(row => isPricingPlaceholder(row.product)).map(row => Number(row.tapNumber)),
    missingAssignments,
  };
}
