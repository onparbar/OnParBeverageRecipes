function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function stableOrderRecordId(prefix, values) {
  return `${prefix}:${encodeURIComponent(values.map((value) => clean(value).toLowerCase()).join("|"))}`;
}

export function weeklyOrderItemId(vendor, item) {
  const identity = clean(item.internalId || item.vendorSku || item.preferredSku);
  return stableOrderRecordId("order", [vendor, identity ? "product" : item.lineType, identity || item.name]);
}

export function legacyWeeklyOrderItemId(vendor, item) {
  return stableOrderRecordId("order", [vendor, item.lineType, item.name]);
}
