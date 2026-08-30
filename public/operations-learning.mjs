const EVENT_TYPES = new Set([
  "delivery-extra",
  "delivery-rejected",
  "delivery-short",
  "order-decrease",
  "order-increase",
  "order-remove",
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

export function createOperationalLearningEvent({
  domain,
  type,
  generatedAt,
  occurredAt,
  productKey,
  productName,
  vendor = "",
  plannedQuantity = null,
  actualQuantity = null,
  reason = "",
} = {}) {
  const normalizedType = clean(type);
  const normalizedDomain = clean(domain);
  const normalizedGeneratedAt = clean(generatedAt);
  const normalizedProductKey = clean(productKey || productName).toLowerCase();
  if (!EVENT_TYPES.has(normalizedType) || !normalizedDomain || !normalizedGeneratedAt || !normalizedProductKey) {
    return null;
  }
  return {
    id: [normalizedDomain, normalizedGeneratedAt, normalizedProductKey, clean(vendor).toLowerCase()].join("|"),
    domain: normalizedDomain,
    type: normalizedType,
    generatedAt: normalizedGeneratedAt,
    occurredAt: clean(occurredAt),
    productKey: normalizedProductKey,
    productName: clean(productName) || clean(productKey),
    vendor: clean(vendor),
    plannedQuantity: finiteQuantity(plannedQuantity),
    actualQuantity: finiteQuantity(actualQuantity),
    reason: clean(reason).slice(0, 240),
  };
}

export function createOrderAdjustmentLearningEvent({
  generatedAt,
  occurredAt,
  catalogItem = {},
  quantity,
  reason,
} = {}) {
  const planned = finiteQuantity(catalogItem.currentPlanQuantity) ?? 0;
  const actual = finiteQuantity(quantity);
  if (actual === null || actual === planned) return null;
  const type = actual === 0
    ? "order-remove"
    : actual > planned ? "order-increase" : "order-decrease";
  return createOperationalLearningEvent({
    domain: "order",
    type,
    generatedAt,
    occurredAt,
    productKey: catalogItem.catalogId || catalogItem.internalId || catalogItem.name,
    productName: catalogItem.name,
    vendor: catalogItem.vendor,
    plannedQuantity: planned,
    actualQuantity: actual,
    reason,
  });
}

export function createReceiptLearningEvent({
  generatedAt,
  occurredAt,
  item = {},
  status,
  receivedQuantity,
  reason,
} = {}) {
  const normalizedStatus = clean(status);
  const type = normalizedStatus === "extra"
    ? "delivery-extra"
    : normalizedStatus === "rejected"
      ? "delivery-rejected"
      : ["partial", "not-received"].includes(normalizedStatus)
        ? "delivery-short"
        : "";
  if (!type) return null;
  return createOperationalLearningEvent({
    domain: "receipt",
    type,
    generatedAt,
    occurredAt,
    productKey: item.inventoryItemId || item.id || item.name,
    productName: item.name,
    vendor: item.vendor,
    plannedQuantity: item.quantity,
    actualQuantity: receivedQuantity,
    reason,
  });
}

export function appendOperationalLearningEvents(history = [], events = [], maxEvents = 300) {
  const normalized = [...(Array.isArray(history) ? history : []), ...(Array.isArray(events) ? events : [])]
    .filter((event) => event && EVENT_TYPES.has(clean(event.type)) && clean(event.id));
  const byId = new Map();
  normalized.forEach((event) => byId.set(clean(event.id), { ...event, id: clean(event.id) }));
  return [...byId.values()]
    .sort((left, right) => clean(left.occurredAt).localeCompare(clean(right.occurredAt)) || left.id.localeCompare(right.id))
    .slice(-Math.max(1, Number(maxEvents) || 300));
}

function suggestionCopy(type, productName, vendor) {
  if (type === "order-increase") return {
    title: "Review safety stock for " + productName,
    detail: "This item has been manually increased in multiple weekly orders.",
  };
  if (type === "order-remove" || type === "order-decrease") return {
    title: "Review the par for " + productName,
    detail: "This item has been manually reduced in multiple weekly orders.",
  };
  if (type === "delivery-extra") return {
    title: "Verify the pack or order quantity for " + productName,
    detail: "More than planned has arrived in multiple deliveries.",
  };
  return {
    title: "Watch " + (vendor || "vendor") + " fulfillment for " + productName,
    detail: "This item has been short or rejected in multiple deliveries.",
  };
}

export function buildOperationalLearningSuggestions(history = [], {
  minimumWeeks = 2,
  maxSuggestions = 4,
} = {}) {
  const groups = new Map();
  (Array.isArray(history) ? history : []).forEach((event) => {
    if (!event || !EVENT_TYPES.has(clean(event.type))) return;
    const key = [event.type, clean(event.productKey), clean(event.vendor).toLowerCase()].join("|");
    const group = groups.get(key) || { events: [], weeks: new Set() };
    group.events.push(event);
    group.weeks.add(clean(event.generatedAt));
    groups.set(key, group);
  });
  return [...groups.entries()].flatMap(([key, group]) => {
    if (group.weeks.size < minimumWeeks) return [];
    const latest = [...group.events].sort((a, b) => clean(b.occurredAt).localeCompare(clean(a.occurredAt)))[0];
    const copy = suggestionCopy(latest.type, clean(latest.productName) || "this item", clean(latest.vendor));
    return [{
      id: key,
      type: latest.type,
      title: copy.title,
      detail: copy.detail,
      evidence: "Seen in " + group.weeks.size + " weekly plans.",
      occurrenceCount: group.events.length,
      weekCount: group.weeks.size,
      latestAt: clean(latest.occurredAt),
      autoApply: false,
    }];
  }).sort((left, right) => (
    right.weekCount - left.weekCount
    || right.occurrenceCount - left.occurrenceCount
    || right.latestAt.localeCompare(left.latestAt)
    || left.title.localeCompare(right.title)
  )).slice(0, Math.max(1, Number(maxSuggestions) || 4));
}
