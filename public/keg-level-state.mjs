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
  const numericMap = (input) => Object.fromEntries(Object.entries(normalizeMap(input)).map(([key, entry]) => {
    const number = typeof entry === "string" ? Number(entry) : NaN;
    return [key, Number.isFinite(number) ? String(number) : entry];
  }));
  // The server owns the counting-week marker; it is not an editable count.
  const settings = normalizeMap(value.settings);
  delete settings.kegCountWeek;
  return {
    onHandOverrides: numericMap(value.onHandOverrides),
    parOverrides: numericMap(value.parOverrides),
    onDeckOverrides: normalizeMap(value.onDeckOverrides),
    settings,
  };
}

export function haveKegLevelInputsChanged(current = {}, candidate = {}) {
  return JSON.stringify(getKegLevelInputPayload(current)) !== JSON.stringify(getKegLevelInputPayload(candidate));
}

export function reconcileKegLevelInputs(base, local, remote) {
  if (!haveKegLevelInputsChanged(local, remote)) {
    return { ok: true, data: getKegLevelInputPayload(remote), conflicts: [] };
  }
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
