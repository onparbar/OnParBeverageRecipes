export function normalizeKegOnHandDraft(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return "";
  if (!/^\d+$/.test(cleaned)) return String(fallback ?? "");
  return cleaned.replace(/^0+(?=\d)/, "");
}

export function normalizeKegOnHandOuncesDraft(value, fallback = "") {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return "";
  if (!/^\d+(?:\.\d{0,2})?$/.test(cleaned)) return String(fallback ?? "");
  const [whole, decimal] = cleaned.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  return decimal === undefined ? normalizedWhole : `${normalizedWhole}.${decimal}`;
}

export function getKegOnHandEditorValue(value) {
  const normalized = normalizeKegOnHandDraft(value);
  return normalized === "0" ? "" : normalized;
}

export function getKegOnHandOuncesEditorValue(value) {
  const normalized = normalizeKegOnHandOuncesDraft(value);
  return normalized === "0" ? "" : normalized;
}

export function getAdjacentKegOnHandIndex(currentIndex, itemCount, direction) {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || itemCount <= 0) return -1;
  const offset = direction === "up" ? -1 : direction === "down" ? 1 : 0;
  if (!offset) return currentIndex;
  return Math.max(0, Math.min(itemCount - 1, currentIndex + offset));
}

export function createClearedKegOnHandOverrides(items, getKey) {
  return Object.fromEntries(
    (Array.isArray(items) ? items : [])
      .map((item) => [getKey(item), "0"])
      .filter(([key]) => Boolean(key)),
  );
}
