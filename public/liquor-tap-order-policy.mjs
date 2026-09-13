// Fixed refill batches for liquor taps, not supplier case sizes. Tolerance
// accepts the rounded ounce values used by the ingredient pricing catalog.
export function getLiquorTapBottleBatch(bottleOz) {
  const ounces = Number(bottleOz);
  if (!Number.isFinite(ounces) || ounces <= 0) return 0;
  return [
    { oz: 59.1745, bottles: 2 },
    { oz: 33.814, bottles: 3 },
    { oz: 25.3605, bottles: 5 },
  ].find(size => Math.abs(size.oz - ounces) <= 0.05)?.bottles || 0;
}
