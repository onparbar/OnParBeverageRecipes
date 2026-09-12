// Upgrade legacy weekly count receipts without changing inventory quantities.
// Once upgraded, an empty receipt map must stay empty after a deliberate clear.
export function recoverLegacyInventoryCountReceipts(state = {}) {
  const current = state.current || {};
  const existing = current.countedItemsAt || {};
  if (current.countEvidenceVersion >= 1 || Object.keys(existing).length
    || !current.countedAt || !Number.isFinite(Date.parse(current.countedAt))) return existing;

  const receipt = (Array.isArray(state.snapshots) ? state.snapshots : [])
    .filter((snapshot) => snapshot.captureMetadata?.sourceFreshness?.inventory === "current"
      && Number.isFinite(Date.parse(snapshot.savedAt))
      && snapshot.captureMetadata?.capturedAt === snapshot.savedAt
      && Array.isArray(snapshot.items))
    .sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt))[0];
  if (!receipt) return existing;

  return Object.fromEntries(receipt.items.filter((item) => {
    const quantity = item.onHandDisplay;
    return item.id && quantity != null && String(quantity).trim() !== ""
      && Number.isFinite(Number(quantity)) && Number(quantity) >= 0;
  }).map((item) => [item.id, receipt.savedAt]));
}
