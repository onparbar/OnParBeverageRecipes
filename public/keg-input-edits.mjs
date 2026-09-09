import { getKegLevelInputPayload } from "./keg-level-state.mjs";

export function buildKegInputEdits(before, after, { editedAt, idPrefix, pending = [] }) {
  const base = getKegLevelInputPayload(before);
  const next = getKegLevelInputPayload(after);
  const edits = new Map(pending.map((edit) => [JSON.stringify([edit.field, edit.key]), edit]));
  let sequence = 0;
  for (const field of Object.keys(base)) {
    for (const key of new Set([...Object.keys(base[field]), ...Object.keys(next[field])])) {
      if (JSON.stringify(base[field][key]) === JSON.stringify(next[field][key])) continue;
      edits.set(JSON.stringify([field, key]), {
        id: `${idPrefix}:${sequence++}`, field, key, editedAt,
        removed: !Object.hasOwn(next[field], key),
        value: next[field][key] ?? null,
      });
    }
  }
  return [...edits.values()];
}

export function overlayKegInputEdits(state, edits) {
  const data = getKegLevelInputPayload(state);
  for (const edit of edits) {
    if (!Object.hasOwn(data, edit.field) || ["__proto__", "constructor", "prototype"].includes(edit.key)) continue;
    if (edit.removed) delete data[edit.field][edit.key];
    else data[edit.field][edit.key] = edit.value;
  }
  return data;
}
