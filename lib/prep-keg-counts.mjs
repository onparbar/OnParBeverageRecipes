const clean = (value) => String(value ?? "").trim();
const identity = (value) => clean(value).toLowerCase().replace(/\s+[123]$/, "");
const safeKey = (value) => value && !["__proto__", "constructor", "prototype"].includes(value);

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
      const key = clean(row.key);
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
