export function classifyShotPriceReadback(snapshot, row, requestedCents, startedAt) {
  const capturedAt = Date.parse(snapshot?.updatedAt || "");
  if (snapshot?.stale || snapshot?.degraded || snapshot?.error
    || !Number.isFinite(capturedAt) || capturedAt < startedAt
    || capturedAt > Date.now() + 60_000) return { state: "unknown" };

  const matches = (Array.isArray(snapshot.items) ? snapshot.items : []).filter((item) => (
    String(item.plu) === String(row.plu)
    && Number(item.tapPosition) === Number(row.tapNumber)
  ));
  if (matches.length !== 1 || row.portions.length !== 2 || requestedCents.length !== 2) {
    return { state: "unknown" };
  }
  const livePortions = matches[0].portions || [];
  if (livePortions.length !== 2) return { state: "unknown" };
  const amounts = [];
  for (const expected of row.portions) {
    const found = livePortions.filter((portion) => (
      String(portion.itemId) === String(expected.itemId)
      && String(portion.name).trim().toLowerCase() === String(expected.name).trim().toLowerCase()
      && Number(portion.quantityOz) === Number(expected.quantityOz)
    ));
    if (found.length !== 1 || !Number.isFinite(Number(found[0].price)) || Number(found[0].price) <= 0) {
      return { state: "unknown" };
    }
    amounts.push(Math.round(Number(found[0].price) * 100));
  }
  const requested = amounts.every((amount, index) => amount === requestedCents[index]);
  const unchanged = amounts.every((amount, index) => amount === Math.round(Number(row.portions[index].price) * 100));
  return { state: requested ? "saved" : unchanged ? "unchanged" : "partial", amounts };
}
