const text = (value, length = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
const amount = (value) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));

export function normalizeSnapshotOrder(value) {
  if (!value || !text(value.vendorId, 300) || !text(value.vendor) || !Number.isFinite(Date.parse(value.generatedAt))) return null;
  const lines = (Array.isArray(value.lines) ? value.lines : []).slice(0, 500).map((line) => ({
    internalId: text(line.internalId, 300),
    name: text(line.productName || line.name),
    vendorSku: text(line.vendorSku, 80),
    requestedUnits: amount(line.requestedUnits),
    requestedCases: amount(line.requestedCases),
    packSize: text(line.packSize, 80),
    unitCost: amount(line.unitCost),
    extendedCost: amount(line.extendedCost),
    tapNumbers: (Array.isArray(line.tapNumbers) ? line.tapNumbers : []).filter((number) => Number.isInteger(number) && number > 0).slice(0, 160),
    kegDestinations: (Array.isArray(line.kegDestinations) ? line.kegDestinations : []).slice(0, 160).map((destination) => typeof destination === "string" ? text(destination) : {
      wall: text(destination?.wall, 40),
      cooler: text(destination?.cooler, 80),
      tapNumber: amount(destination?.tapNumber),
      quantity: amount(destination?.quantity),
    }),
  })).filter((line) => line.name);
  if (!lines.length) return null;
  const ordered = value.ordered === true;
  const orderedBy = text(value.orderedBy, 80);
  const orderedAt = text(value.orderedAt, 40);
  if (ordered && (!orderedBy || !Number.isFinite(Date.parse(orderedAt)))) return null;
  return {
    vendorId: text(value.vendorId, 300),
    vendor: text(value.vendor, 80),
    generatedAt: text(value.generatedAt, 40),
    draftId: text(value.draftId, 300),
    ordered,
    orderedBy: ordered ? orderedBy : "",
    orderedAt: ordered ? orderedAt : "",
    updatedAt: text(value.updatedAt, 40),
    estimatedTotal: amount(value.estimatedTotal),
    lines,
  };
}
