function normalizeValue(value) {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizeValue(entry)]));
  }
  return String(value ?? "").trim();
}

function normalizeMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, entry]) => [String(key), normalizeValue(entry)])
    .filter(([key, entry]) => key && entry !== "")
    .sort(([left], [right]) => left.localeCompare(right)));
}

export function getKegLevelInputPayload(value = {}) {
  return {
    onHandOverrides: normalizeMap(value.onHandOverrides),
    parOverrides: normalizeMap(value.parOverrides),
    onDeckOverrides: normalizeMap(value.onDeckOverrides),
    settings: normalizeMap(value.settings),
  };
}

export function haveKegLevelInputsChanged(current = {}, candidate = {}) {
  return JSON.stringify(getKegLevelInputPayload(current)) !== JSON.stringify(getKegLevelInputPayload(candidate));
}
