const FIELDS = ["onHandOverrides", "parOverrides", "onDeckOverrides", "settings"];
const HISTORY_LIMIT = 1000;

export function applyKegInputEdits(data, edits, { now, fallbackAt, role }) {
  if (!Array.isArray(edits) || edits.length > 1000) throw new Error("Provide at most 1000 keg input edits.");
  const next = structuredClone(data);
  const metadata = next.inputEditState || { startedAt: fallbackAt, clocks: {}, history: [] };
  metadata.clocks ||= {};
  metadata.history ||= [];
  for (const edit of edits) {
    const time = Date.parse(edit?.editedAt);
    if (!FIELDS.includes(edit?.field) || typeof edit.key !== "string" || !edit.key || edit.key.length > 300
      || ["__proto__", "constructor", "prototype"].includes(edit.key)
      || (edit.field === "settings" && edit.key !== "maxOrderPerTap")
      || typeof edit.id !== "string" || !edit.id || edit.id.length > 200
      || !Number.isFinite(time) || time > Date.parse(now) + 300000
      || typeof edit.removed !== "boolean") throw new Error("Invalid keg input edit.");
    if (!edit.removed && ["onHandOverrides", "parOverrides", "settings"].includes(edit.field)
      && (!Number.isFinite(Number(edit.value)) || Number(edit.value) < 0)) throw new Error("Keg quantities must be nonnegative numbers.");
    const key = JSON.stringify([edit.field, edit.key]);
    const previousClock = metadata.clocks[key];
    if (previousClock?.id === edit.id || metadata.history.some((event) => event.id === edit.id)) continue;
    const previousTime = Date.parse(previousClock?.editedAt || metadata.startedAt || fallbackAt);
    const wins = time > previousTime || (time === previousTime && edit.id > (previousClock?.id || ""));
    const previous = Object.hasOwn(next[edit.field], edit.key) ? next[edit.field][edit.key] : null;
    metadata.history.push({ ...edit, previous, outcome: wins ? "applied" : "superseded", recordedAt: now, role });
    if (!wins) continue;
    if (edit.removed) delete next[edit.field][edit.key];
    else next[edit.field][edit.key] = structuredClone(edit.value);
    metadata.clocks[key] = { id: edit.id, editedAt: new Date(time).toISOString() };
  }
  metadata.history = metadata.history.slice(-HISTORY_LIMIT);
  next.inputEditState = metadata;
  return next;
}

export function preserveKegInputEditHistory(current, next, { now, fallbackAt, role, revision }) {
  const edits = [];
  for (const field of FIELDS) {
    for (const key of new Set([...Object.keys(current[field] || {}), ...Object.keys(next[field] || {})])) {
      if (field === "settings" && key !== "maxOrderPerTap") continue;
      if (JSON.stringify(current[field]?.[key]) === JSON.stringify(next[field]?.[key])) continue;
      edits.push({ id: `server:${revision}:${edits.length}`, field, key, editedAt: now, removed: !Object.hasOwn(next[field] || {}, key), value: next[field]?.[key] ?? null });
    }
  }
  // Trusted server updates (including weekly resets) establish new edit clocks.
  const recorded = applyKegInputEdits(current, edits, { now, fallbackAt, role });
  return { ...next, inputEditState: recorded.inputEditState };
}
