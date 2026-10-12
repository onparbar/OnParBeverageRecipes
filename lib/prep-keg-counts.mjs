const clean = (value) => String(value ?? "").trim();
const identity = (value) => clean(value).toLowerCase().replace(/\s+[123]$/, "");
const safeKey = (value) => value && !["__proto__", "constructor", "prototype"].includes(value);

function inventoryKeyForPrep(row, state, recommendations, delta) {
  if (!row.prepAdditionId) return clean(row.key);
  // Old completions credited the checklist ID. Reopening one must reverse
  // that original credit, rather than subtracting a real cooler keg.
  if (delta < 0 && Number(state.onHandOverrides?.[row.key]) > 0) return clean(row.key);
  const prefix = `${clean(row.wall).toLowerCase()}-${Number(row.tapNumber)}-`;
  const valid = key => safeKey(key) && key.startsWith(prefix);
  if (row.inventoryKey) {
    if (valid(clean(row.inventoryKey))) return clean(row.inventoryKey);
    throw Object.assign(new Error("The prepared keg's cooler destination needs review."), { status: 409 });
  }
  // Existing added rows predate inventoryKey. Recover only a unique physical
  // tap destination; the prep-addition ID is never a cooler inventory key.
  const candidates = new Set([
    ...Object.keys(state.onHandOverrides || {}),
    ...Object.keys(state.onDeckOverrides || {}),
    ...(recommendations.items || []).filter(item => !item.prepAdditionId
      && Number(item.tapNumber) === Number(row.tapNumber)
      && clean(item.wall) === clean(row.wall)).map(item => clean(item.key)),
  ].filter(valid));
  if (Number(row.tapNumber) > 0 && candidates.size === 1) return [...candidates][0];
  throw Object.assign(new Error("The prepared keg's cooler destination could not be identified. Review its tap assignment before checking it off."), { status: 409 });
}

export function applyPrepKegCounts(state, recommendations, changes) {
  const next = { ...state, onHandOverrides: { ...state.onHandOverrides },
    onDeckOverrides: structuredClone(state.onDeckOverrides || {}),
    recommendations: structuredClone(recommendations) };
  const ledger = { ...(state.recommendations?.prepKegContributions || {}) };
  for (const { target, update } of changes) {
    if (!target || target.kind === "liquor-refill") continue;
    const quantity = update.completed ? Number(target.quantity) : 0;
    const priorQuantity = Number(ledger[target.id]?.quantity ?? (target.completed ? target.quantity : 0));
    const delta = quantity - priorQuantity;
    if (!delta) continue;
    const rows = (recommendations.items || []).filter((item) => item.actionType === "make"
      && item.isKegTap && !item.isLiquorTap
      && (target.prepAdditionId ? item.prepAdditionId === target.prepAdditionId
        : !item.prepAdditionId && target.tapNumbers?.includes(Number(item.tapNumber))));
    const weight = rows.reduce((total, row) => total + Number(row.orderQty || 0), 0);
    if (!rows.length || !(weight > 0) || !Number.isFinite(delta)) {
      throw Object.assign(new Error("The prepared keg's cooler destination could not be identified."), { status: 409 });
    }
    for (const row of rows) {
      const key = inventoryKeyForPrep(row, next, recommendations, delta);
      if (!safeKey(key)) throw Object.assign(new Error("Invalid prepared keg destination."), { status: 409 });
      const deck = next.onDeckOverrides[key];
      const deckTarget = Boolean(row.onDeckProduct);
      const transferred = deckTarget && Object.values(state.coolerEstimateState?.slots || {}).some((slot) =>
        slot.key === key && slot.onDeckTransfer && identity(slot.name) === identity(target.name));
      if (deckTarget && !transferred && (!deck || identity(deck.name) !== identity(target.name))) {
        throw Object.assign(new Error("The cocktail's On Deck destination changed. Review before saving prep."), { status: 409 });
      }
      const raw = deckTarget && !transferred ? deck.onHand : next.onHandOverrides[key];
      const current = raw == null || raw === "" ? 0 : Number(raw);
      const adjusted = current + delta * Number(row.orderQty || 0) / weight;
      if (!Number.isFinite(adjusted) || adjusted < 0) {
        throw Object.assign(new Error("Review the cooler count before reversing prep for a keg already used."), { status: 409 });
      }
      const value = String(Math.round(adjusted * 1000) / 1000);
      if (deckTarget && !transferred) next.onDeckOverrides[key] = { ...deck, onHand: value };
      else next.onHandOverrides[key] = value;
    }
    ledger[target.id] = { quantity, generatedAt: recommendations.generatedAt };
  }
  next.recommendations.prepKegContributions = ledger;
  return next;
}
