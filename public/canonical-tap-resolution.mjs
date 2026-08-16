const DEFAULT_RETIRED_PRODUCT_NAMES = Object.freeze([
  "breakfast stout",
  "apple pucker",
]);

const SOURCE_PRIORITY = Object.freeze({
  manager_override: 400,
  pmb_live: 300,
  pmb_snapshot: 200,
  configured_fallback: 100,
});

function cleanText(value) {
  return String(value ?? "").trim();
}

export function getCanonicalTapKey(wall, tapNumber) {
  const wallKey = cleanText(wall).toLowerCase();
  const number = Number(tapNumber);
  return wallKey && Number.isFinite(number) ? `${wallKey}-${number}` : "";
}

export function normalizeProductIdentity(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\s+[123]$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isRetiredProduct(product, retiredNames = DEFAULT_RETIRED_PRODUCT_NAMES) {
  if (!product) return false;
  if (cleanText(product.lifecycle).toLowerCase() === "retired") return true;
  if (product.retired === true || product.active === false) return true;
  const retired = new Set(retiredNames.map(normalizeProductIdentity));
  return retired.has(normalizeProductIdentity(product.name ?? product.productName));
}

function validTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function activeManagerOverride(candidate, now) {
  if (!candidate) return false;
  const expiresAt = validTimestamp(candidate.expiresAt);
  return !expiresAt || new Date(expiresAt).getTime() > now.getTime();
}

function normalizeCandidate(candidate, source, verified) {
  if (!candidate) return null;
  const productName = cleanText(candidate.productName ?? candidate.name);
  const internalProductId = cleanText(candidate.internalProductId ?? candidate.productId ?? candidate.id);
  if (!productName && !internalProductId) return null;
  return {
    ...candidate,
    source,
    verified,
    productName,
    internalProductId: internalProductId || null,
    sourceTimestamp: validTimestamp(candidate.sourceTimestamp ?? candidate.verifiedAt ?? candidate.updatedAt),
  };
}

function productKey(candidate) {
  return normalizeProductIdentity(candidate.internalProductId || candidate.productName);
}

function firstFinite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function resolveOptionalMetric(value, available = true) {
  if (!available || value === null || value === undefined || value === "") {
    return { available: false, value: null };
  }
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? { available: true, value: parsed }
    : { available: false, value: null };
}

export function resolveCanonicalTap(input, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const retiredNames = options.retiredNames ?? DEFAULT_RETIRED_PRODUCT_NAMES;
  const candidates = [
    activeManagerOverride(input.managerOverride, now)
      ? normalizeCandidate(input.managerOverride, "manager_override", true)
      : null,
    input.live?.verified === true ? normalizeCandidate(input.live, "pmb_live", true) : null,
    input.snapshot?.verified === true ? normalizeCandidate(input.snapshot, "pmb_snapshot", true) : null,
    normalizeCandidate(input.configured, "configured_fallback", false),
  ].filter(Boolean);

  candidates.sort((left, right) => SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source]);
  const selected = candidates[0] ?? null;
  const selectedRetired = isRetiredProduct(selected, retiredNames);
  const verifiedIdentities = new Map();
  for (const candidate of candidates.filter((item) => item.verified)) {
    const key = productKey(candidate);
    if (key && !verifiedIdentities.has(key)) verifiedIdentities.set(key, candidate);
  }

  const conflicts = [];
  if (verifiedIdentities.size > 1) {
    conflicts.push({
      code: "product_identity_conflict",
      message: "Verified sources disagree about the current product.",
      sources: [...verifiedIdentities.values()].map((candidate) => ({
        source: candidate.source,
        productName: candidate.productName,
        internalProductId: candidate.internalProductId,
        sourceTimestamp: candidate.sourceTimestamp,
      })),
    });
  }
  if (selectedRetired) {
    conflicts.push({
      code: "retired_product_reported_current",
      message: `${selected.productName || "Retired product"} cannot be used as a current product.`,
      sources: [{ source: selected.source, productName: selected.productName }],
    });
  }

  const operationallyVerified = Boolean(selected?.verified && !selectedRetired);
  const product = selected && !selectedRetired
    ? {
        internalProductId: selected.internalProductId,
        name: selected.productName,
        category: cleanText(selected.category) || null,
      }
    : null;
  const level = resolveOptionalMetric(
    firstFinite(input.live?.level, input.snapshot?.level, selected?.level),
    Boolean(input.live?.verified || input.snapshot?.verified),
  );
  const price = resolveOptionalMetric(
    selected?.price,
    selected?.priceStatus === "known" || selected?.priceVerified === true,
  );

  return {
    physicalTapId: cleanText(input.physicalTapId ?? input.tapId) || null,
    wall: cleanText(input.wall) || null,
    tapNumber: Number.isFinite(Number(input.tapNumber)) ? Number(input.tapNumber) : null,
    product,
    lifecycle: selectedRetired ? "retired" : product ? "active" : "needs_attention",
    level: level.value,
    price: price.value,
    priceStatus: price.available ? "known" : "unknown",
    source: selected?.source ?? "unavailable",
    sourceTimestamp: selected?.sourceTimestamp ?? null,
    confidence: operationallyVerified
      ? selected.source === "manager_override" ? "manager_override" : "verified"
      : selected ? "unverified" : "missing",
    operationallyVerified,
    blockingIssue: selectedRetired
      ? "retired_product"
      : operationallyVerified ? null : selected ? "unverified_fallback" : "missing_identity",
    conflicts,
  };
}

export function getCanonicalTapDisplayName(resolved, {
  missingLabel = "Needs current product",
} = {}) {
  return cleanText(resolved?.product?.name) || cleanText(missingLabel);
}

export function resolveCanonicalTapMap(taps, options = {}) {
  const items = [];
  const conflicts = [];
  const seen = new Set();
  for (const tap of Array.isArray(taps) ? taps : []) {
    const resolved = resolveCanonicalTap(tap, options);
    const key = resolved.physicalTapId || getCanonicalTapKey(resolved.wall, resolved.tapNumber) || "unknown";
    if (seen.has(key)) {
      conflicts.push({
        code: "duplicate_physical_tap",
        physicalTapId: resolved.physicalTapId,
        wall: resolved.wall,
        tapNumber: resolved.tapNumber,
      });
      continue;
    }
    seen.add(key);
    items.push(resolved);
    conflicts.push(...resolved.conflicts.map((conflict) => ({ ...conflict, tapKey: key })));
  }
  return { items, conflicts };
}

export { DEFAULT_RETIRED_PRODUCT_NAMES };
