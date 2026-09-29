const DELIVERY_STATUSES = new Set(["pending", "received", "partial", "not-received", "rejected", "extra"]);

function clean(value, length = 180) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, length);
}

function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function timestamp(value) {
  const result = clean(value, 40);
  return Number.isFinite(Date.parse(result)) ? result : "";
}

function normalizeDeliveryItem(value = {}) {
  const id = clean(value.id, 300);
  const name = clean(value.name);
  if (!id || !name) return null;
  const status = DELIVERY_STATUSES.has(clean(value.status).toLowerCase())
    ? clean(value.status).toLowerCase()
    : "pending";
  const handledBy = status === "pending" ? "" : clean(value.handledBy, 80);
  return {
    id,
    name,
    quantity: amount(value.quantity),
    receivedQuantity: handledBy ? amount(value.receivedQuantity) : 0,
    unit: clean(value.unit, 40),
    status: handledBy ? status : "pending",
    handledBy,
    updatedAt: handledBy ? timestamp(value.updatedAt) : "",
    reason: handledBy ? clean(value.reason, 120) : "",
  };
}

function normalizeDelivery(value = {}) {
  const id = clean(value.id, 300);
  const vendor = clean(value.vendor, 80);
  if (!id || !vendor) return null;
  const items = (Array.isArray(value.items) ? value.items : [])
    .slice(0, 500)
    .map(normalizeDeliveryItem)
    .filter(Boolean);
  if (!items.length) return null;
  return {
    id,
    vendor,
    items,
    note: clean(value.deliveryNote || value.note, 1200),
    noteBy: clean(value.deliveryNoteBy || value.noteBy, 80),
    noteAt: timestamp(value.deliveryNoteAt || value.noteAt),
  };
}

function normalizeCocktail(value = {}) {
  const id = clean(value.id, 300);
  const name = clean(value.name);
  if (!id || !name) return null;
  const completed = value.completed === true && Boolean(clean(value.preparedBy, 80));
  return {
    id,
    name,
    displayName: clean(value.displayName || value.name),
    quantity: amount(value.quantity),
    batchSizeOz: amount(value.batchSizeOz),
    tapNumbers: (Array.isArray(value.tapNumbers) ? value.tapNumbers : [])
      .map(Number).filter((number) => Number.isInteger(number) && number > 0).slice(0, 160),
    walls: (Array.isArray(value.walls) ? value.walls : [])
      .map((wall) => clean(wall, 40)).filter(Boolean).slice(0, 20),
    completed,
    preparedBy: completed ? clean(value.preparedBy, 80) : "",
    completedAt: completed ? timestamp(value.completedAt) : "",
    updatedAt: completed ? timestamp(value.updatedAt || value.completedAt) : "",
  };
}

function normalizeLiquorRefill(value = {}) {
  const base = normalizeCocktail(value);
  if (!base) return null;
  return {
    ...base,
    actualQuantity: base.completed
      ? Math.max(1, Math.round(amount(value.actualQuantity) || amount(value.quantity) || 1))
      : Math.max(1, Math.round(amount(value.quantity) || 1)),
  };
}

export function normalizeWeeklySnapshotCompletion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const generatedAt = timestamp(value.generatedAt);
  if (!generatedAt) return null;
  return {
    generatedAt,
    deliveries: (Array.isArray(value.deliveries) ? value.deliveries : [])
      .slice(0, 30).map(normalizeDelivery).filter(Boolean),
    cocktails: (Array.isArray(value.cocktails) ? value.cocktails : [])
      .slice(0, 300).map(normalizeCocktail).filter(Boolean),
    liquorRefills: (Array.isArray(value.liquorRefills) ? value.liquorRefills : [])
      .slice(0, 300).map(normalizeLiquorRefill).filter(Boolean),
    updatedAt: timestamp(value.updatedAt),
  };
}

export function buildWeeklySnapshotCompletion({ generatedAt, tracking, prep, updatedAt = new Date().toISOString() } = {}) {
  return normalizeWeeklySnapshotCompletion({
    generatedAt,
    deliveries: Array.isArray(tracking?.vendors) ? tracking.vendors : [],
    cocktails: Array.isArray(prep?.items) ? prep.items : [],
    liquorRefills: Array.isArray(prep?.liquorRefills) ? prep.liquorRefills : [],
    updatedAt,
  });
}

export function summarizeWeeklySnapshotCompletion(value) {
  const completion = normalizeWeeklySnapshotCompletion(value);
  const deliveryItems = completion?.deliveries.flatMap((vendor) => vendor.items) || [];
  const cocktails = completion?.cocktails || [];
  const liquorRefills = completion?.liquorRefills || [];
  return {
    deliveryChecked: deliveryItems.filter((item) => item.status !== "pending").length,
    deliveryTotal: deliveryItems.length,
    deliveryExceptions: deliveryItems.filter((item) => !["pending", "received", "extra"].includes(item.status)).length,
    cocktailCompleted: cocktails.filter((item) => item.completed).length,
    cocktailTotal: cocktails.length,
    liquorRefillCompleted: liquorRefills.filter((item) => item.completed).length,
    liquorRefillTotal: liquorRefills.length,
  };
}
