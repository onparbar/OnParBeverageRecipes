function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function isRoughlyEqual(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) < 0.2;
}

export function selectBottleCandidate(
  candidates,
  { targetBottleOz = 0, preferredSku = "", expectedSizeLabel = "" } = {},
) {
  const entries = Array.isArray(candidates) ? candidates : [];
  const normalizedPreferredSku = normalizeSku(preferredSku);

  if (normalizedPreferredSku) {
    const preferredProduct = entries.find(
      (entry) =>
        normalizeSku(entry.inventory?.sku) === normalizedPreferredSku &&
        isRoughlyEqual(entry.bottleOz, targetBottleOz),
    );
    if (preferredProduct) return preferredProduct;
  }

  const exactByOz = entries.find((entry) => isRoughlyEqual(entry.bottleOz, targetBottleOz));
  if (exactByOz) return exactByOz;

  if (expectedSizeLabel) {
    const normalizedExpectedSize = normalize(expectedSizeLabel);
    const exactBySizeLabel = entries.find((entry) => entry.sizeLabel === normalizedExpectedSize);
    if (exactBySizeLabel) return exactBySizeLabel;
  }

  if (targetBottleOz > 0) return null;
  return entries[0] || null;
}
