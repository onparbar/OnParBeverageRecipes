export function kegDestination(item = {}, { cocktail = false } = {}) {
  const taps = (Array.isArray(item.tapNumbers) ? item.tapNumbers : [item.tapNumber])
    .map(Number).filter((tap) => Number.isInteger(tap) && tap > 0);
  const isKeg = cocktail || /keg|beer|cocktail/i.test(`${item.unit || ""} ${item.lineType || ""}`);
  if (!isKeg) return "";
  const assigned = [...new Set(taps)].sort((left, right) => left - right);
  const orderedQuantity = Number(item.quantity);
  if (item.quantity != null && Number.isFinite(orderedQuantity) && orderedQuantity >= 0) {
    if (orderedQuantity === 0) return "";
    // Never imply one ordered keg can be allocated to multiple taps.
    if (assigned.length > orderedQuantity) return "Tap assignment needed";
  }
  if (assigned.length) return `Tap${assigned.length > 1 ? "s" : ""} ${assigned.join(", ")}`;
  return "Tap not assigned";
}
