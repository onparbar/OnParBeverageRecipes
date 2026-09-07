import { mergeOperationalRecord } from "./operational-outbox.mjs";

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

export function reconcileKegLevelInputs(base, local, remote) {
  if (!base || typeof base !== "object") return { ok: false, data: null, conflicts: ["missing-baseline"] };
  const before = getKegLevelInputPayload(base);
  const ours = getKegLevelInputPayload(local);
  const theirs = getKegLevelInputPayload(remote);
  const data = {};
  const conflicts = [];
  for (const field of Object.keys(before)) {
    const result = mergeOperationalRecord(before[field], ours[field], theirs[field]);
    if (result.ok) data[field] = result.data;
    else conflicts.push(...result.conflicts.map((key) => `${field}.${key}`));
  }
  return { ok: conflicts.length === 0, data: conflicts.length ? null : data, conflicts };
}
