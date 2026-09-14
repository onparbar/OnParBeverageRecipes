import { resolveBeerReceiptAllocations } from "../public/beer-delivery-destinations.mjs";

const name = (value) => String(value || "").trim().toLowerCase().replace(/\s+[123]$/, "");
function fail(message) {
  const error = new Error(message);
  error.code = "BEER_DELIVERY_COUNT_REVIEW_REQUIRED";
  error.status = 409;
  throw error;
}

// The receipt, contribution ledger, and keg counts are persisted in one existing
// Keg Levels compare-and-swap write. Retries apply only an unapplied difference.
export function applyBeerReceiptCounts(state, recommendations, prior, proposed, payload) {
  const next = {
    ...state,
    onHandOverrides: { ...state.onHandOverrides },
    onDeckOverrides: structuredClone(state.onDeckOverrides || {}),
    recommendations: structuredClone(recommendations),
  };
  const ledger = { ...(recommendations.beerDeliveryReceipts || {}) };
  const oldLines = new Map((prior.vendors || []).flatMap((vendor) => vendor.items).map((line) => [line.id, line]));
  const newLines = new Map((proposed.vendors || []).flatMap((vendor) => vendor.items).map((line) => [line.id, line]));
  const updates = payload.action === "set-receipt" ? [payload] : payload.receipts || [];
  for (const update of updates) {
    const line = newLines.get(update.itemId);
    if (line?.lineType !== "Beer keg") continue;
    const saved = ledger[line.id];
    const allocations = resolveBeerReceiptAllocations(line, line.receivedQuantity, update.kegAllocations);
    // Existing receipts predate this feature. Do not add old deliveries again
    // when another line is reviewed; only changes to their totals affect stock.
    const previous = saved?.allocations || resolveBeerReceiptAllocations(
      oldLines.get(line.id) || line, oldLines.get(line.id)?.receivedQuantity || 0,
      oldLines.get(line.id)?.kegAllocations?.length ? oldLines.get(line.id).kegAllocations : undefined,
    );
    const priorById = new Map(previous.map((entry) => [entry.destinationId, entry.quantity]));
    for (const allocation of allocations) {
      const delta = allocation.quantity - (priorById.get(allocation.destinationId) || 0);
      if (!delta) continue;
      const destination = line.kegDestinations.find((entry) => entry.id === allocation.destinationId);
      if (!destination?.key || !["onHandOverrides", "onDeckOverrides"].includes(destination.field)
        || ["__proto__", "constructor", "prototype"].includes(destination.key)) fail("Review the delivery's saved cooler assignment.");
      const onDeck = destination.field === "onDeckOverrides";
      const deck = next.onDeckOverrides[destination.key];
      const transferred = onDeck && Object.values(state.coolerEstimateState?.slots || {}).some((slot) =>
        slot.key === destination.key && slot.onDeckTransfer?.key === destination.key
        && name(slot.name) === name(destination.product) && name(slot.onDeckTransfer.product) === name(destination.product));
      if (onDeck && !transferred && (!deck || typeof deck !== "object" || name(deck.name || deck.productName) !== name(destination.product))) {
        fail(`${line.name}'s On Deck assignment changed. Review its destination before receiving it.`);
      }
      const raw = onDeck && !transferred ? deck.onHand : next.onHandOverrides[destination.key];
      const current = raw == null || raw === "" ? 0 : Number(raw);
      if (!Number.isFinite(current) || current < 0 || current + delta < 0) {
        fail(`Review ${line.name}'s ${destination.cooler} count before correcting this receipt.`);
      }
      if (onDeck && !transferred) next.onDeckOverrides[destination.key] = { ...deck, onHand: String(current + delta) };
      else next.onHandOverrides[destination.key] = String(current + delta);
    }
    ledger[line.id] = { allocations, generatedAt: proposed.generatedAt };
    const receipt = next.recommendations.weeklyOrderTracking?.receipts?.[line.id];
    if (receipt) receipt.kegAllocations = allocations;
  }
  next.recommendations.beerDeliveryReceipts = ledger;
  return next;
}
