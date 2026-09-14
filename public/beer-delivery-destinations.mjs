const clean = (value) => String(value ?? "").trim();
const productName = (value) => clean(value).toLowerCase().replace(/\s+[123]$/, "");

export function beerDeliveryDestination(item = {}) {
  const key = clean(item.key || item.id);
  const wall = clean(item.wall).toLowerCase();
  const cooler = wall.includes("karaoke") ? "Karaoke cooler" : wall.includes("main") ? "Main cooler" : "";
  const quantity = Number(item.orderQty);
  if (!key || !cooler || !Number.isInteger(quantity) || quantity <= 0) return null;
  const onDeck = item.onDeckProduct && productName(item.orderProductName) === productName(item.onDeckProduct.name);
  const field = onDeck ? "onDeckOverrides" : "onHandOverrides";
  return {
    id: `${field}:${key}`, key, field, cooler,
    tapNumber: Number(item.tapNumber), quantity,
    product: clean(onDeck ? item.onDeckProduct.name : item.name),
  };
}

// Recover destinations for older locked plans without changing order identities,
// quantities, or supplier product names. Never guess from a product name alone.
export function withBeerDeliveryDestinations(line, recommendations = []) {
  if (Array.isArray(line.kegDestinations) && line.kegDestinations.length) return line;
  const keys = new Set(clean(line.id || line.internalId).split(",").filter(Boolean));
  const taps = new Set((line.tapNumbers || []).map(Number));
  const destinations = recommendations.filter((item) => item.isKegTap && item.actionType === "order"
    && keys.has(clean(item.key || item.id || item.internalId)) && taps.has(Number(item.tapNumber)))
    .map(beerDeliveryDestination).filter(Boolean);
  return { ...line, kegDestinations: destinations };
}

export function beerDeliveryLabel(item = {}) {
  return (item.kegDestinations || []).map((destination) =>
    `${destination.cooler}: ${destination.quantity} keg${destination.quantity === 1 ? "" : "s"} (tap ${destination.tapNumber})`).join("; ");
}

export function resolveBeerReceiptAllocations(item, total, submitted) {
  const destinations = item.kegDestinations || [];
  const fail = () => {
    const error = new Error(`Choose the received keg quantities for each cooler for ${item.name}.`);
    error.code = "BEER_DELIVERY_ALLOCATION_REQUIRED";
    error.status = 409;
    throw error;
  };
  if (!Number.isInteger(total) || total < 0 || total > 9999) return fail();
  if (!destinations.length) return total === 0 ? [] : fail();
  if (new Set(destinations.map((item) => item.id)).size !== destinations.length) return fail();
  if (submitted !== undefined) {
    if (!Array.isArray(submitted) || submitted.length !== destinations.length) return fail();
    const byId = new Map(submitted.map((entry) => [entry?.destinationId, entry?.quantity]));
    if (byId.size !== destinations.length) return fail();
    const allocations = destinations.map((destination) => ({ destinationId: destination.id, quantity: byId.get(destination.id) }));
    if (allocations.some((entry) => !Number.isInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > 9999)
      || allocations.reduce((sum, entry) => sum + entry.quantity, 0) !== total) return fail();
    return allocations;
  }
  if (total === 0) return destinations.map((destination) => ({ destinationId: destination.id, quantity: 0 }));
  if (destinations.length === 1) return [{ destinationId: destinations[0].id, quantity: total }];
  if (destinations.reduce((sum, destination) => sum + destination.quantity, 0) !== total) return fail();
  return destinations.map((destination) => ({ destinationId: destination.id, quantity: destination.quantity }));
}
