function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeDistributorId(value) {
  return String(value ?? "").trim();
}

export function productLineMatchesDistributor(
  line,
  { distributorHints = [], distributorIds = [] } = {},
) {
  const normalizedHints = distributorHints.map((value) => normalize(value)).filter(Boolean);
  const normalizedIds = new Set(distributorIds.map(normalizeDistributorId).filter(Boolean));
  if (!normalizedHints.length && !normalizedIds.size) return true;

  const distributorName = normalize(
    line?.distributor_info?.distributor_name || line?.distributor?.name || "",
  );
  if (distributorName && normalizedHints.some((hint) => distributorName.includes(hint))) {
    return true;
  }

  return (line?.products || []).some((product) => (
    (product?.inventory || []).some((entry) => normalizedIds.has(normalizeDistributorId(
      entry?.distributor_id ?? entry?.distributorId,
    )))
  ));
}

export function getProductLineScore(lineNameValue, expectedNameValue, expectedIngredientNameValue) {
  const lineName = normalize(lineNameValue);
  const expectedName = normalize(expectedNameValue);
  const expectedIngredientName = normalize(expectedIngredientNameValue);
  if (!lineName || !expectedName) return 0;
  if (lineName === expectedName) return 100;
  if (lineName.includes(expectedName)) return 80;
  if (expectedName.includes(lineName)) return 70;
  if (expectedIngredientName && lineName === expectedIngredientName) return 60;
  if (expectedIngredientName && lineName.includes(expectedIngredientName)) return 50;
  return 0;
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
