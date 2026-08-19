const LITER_TO_OZ = 33.814;
const ML_TO_OZ = 0.033814;
const DAY_MS = 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function finiteNumber(value) {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019']/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|milliliters?|l|liters?|litres?|oz|ounces?)\b/g, " ")
    .replace(/\b(?:bottle|bottles|case|cases|individual|individuals)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parsePackageOunces(item) {
  const explicit = finiteNumber(item?.packageSizeOz ?? item?.bottleOz ?? item?.unitSizeOz);
  if (explicit && explicit > 0) return explicit;
  const source = clean(`${item?.name || ""} ${item?.note || ""}`).toLowerCase();
  const ml = source.match(/\b(\d+(?:\.\d+)?)\s*ml\b/);
  if (ml) return Number(ml[1]) * ML_TO_OZ;
  const liters = source.match(/\b(\d+(?:\.\d+)?)\s*(?:l|liter|liters|litre|litres)\b/);
  if (liters) return Number(liters[1]) * LITER_TO_OZ;
  const ounces = source.match(/\b(\d+(?:\.\d+)?)\s*(?:oz|ounce|ounces)\b/);
  return ounces ? Number(ounces[1]) : null;
}

function getSnapshotTime(snapshot) {
  const value = snapshot?.savedAt || snapshot?.date || snapshot?.createdAt;
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
}

function makeIssue(item, type, severity, title, detail, previousValue, currentValue) {
  return {
    id: [type, clean(item?.id), previousValue ?? "none", currentValue ?? "none"].join(":"),
    itemId: clean(item?.id),
    itemName: clean(item?.name) || "Inventory item",
    type,
    severity,
    title,
    detail,
    previousValue,
    currentValue,
  };
}

function buildReceiptMap(receipts) {
  const map = new Map();
  (Array.isArray(receipts) ? receipts : []).forEach((receipt) => {
    if (!receipt || receipt.status === "pending") return;
    const key = normalizeName(receipt.name);
    const quantity = finiteNumber(receipt.receivedQuantity);
    if (!key || quantity == null) return;
    const existing = map.get(key) || { quantity: 0, units: [], complete: true };
    existing.quantity += quantity;
    existing.units.push(clean(receipt.unit));
    map.set(key, existing);
  });
  return map;
}

function buildUsageMap(usageItems) {
  const map = new Map();
  (Array.isArray(usageItems) ? usageItems : []).forEach((usage) => {
    const key = normalizeName(usage?.name);
    const ounces = finiteNumber(usage?.ounces);
    if (!key || ounces == null || ounces < 0 || usage?.verified !== true) return;
    if (map.has(key)) {
      map.set(key, null);
      return;
    }
    map.set(key, { ounces, label: clean(usage?.label) });
  });
  return map;
}

function getReceivedIndividualUnits(item, receipt) {
  if (!receipt) return null;
  const packSize = Math.max(1, finiteNumber(item?.packSize) || 1);
  const caseUnits = receipt.units.every((unit) => /^cases?$/i.test(unit));
  return receipt.quantity * (caseUnits ? packSize : 1);
}

function getPriorItemMap(snapshot) {
  return new Map((Array.isArray(snapshot?.items) ? snapshot.items : [])
    .filter(Boolean)
    .map((item) => [clean(item.id) || normalizeName(item.name), item]));
}

export function buildInventoryRealityCheck({
  currentItems = [],
  previousSnapshot = null,
  receipts = [],
  usageItems = [],
  now = new Date(),
} = {}) {
  const issues = [];
  const previousTime = getSnapshotTime(previousSnapshot);
  const ageDays = previousTime == null ? null : Math.max(0, (new Date(now).getTime() - previousTime) / DAY_MS);
  const previousUsable = Boolean(previousSnapshot) && ageDays != null && ageDays <= 15;
  const previousItems = previousUsable ? getPriorItemMap(previousSnapshot) : new Map();
  const receiptMap = buildReceiptMap(receipts);
  const usageMap = buildUsageMap(usageItems);

  (Array.isArray(currentItems) ? currentItems : []).forEach((item) => {
    const currentDisplay = clean(item?.onHandDisplay);
    const current = finiteNumber(currentDisplay);
    if (!currentDisplay || current == null || current < 0) {
      issues.push(makeIssue(
        item,
        "missing-count",
        "block",
        "Current count required",
        "Enter a current on-hand quantity before saving the snapshot.",
        null,
        current,
      ));
      return;
    }
    if (!previousUsable) return;

    const prior = previousItems.get(clean(item.id)) || previousItems.get(normalizeName(item.name));
    const previous = finiteNumber(prior?.onHandDisplay ?? prior?.onHand);
    if (previous == null || previous < 0) return;
    const key = normalizeName(item.name);
    const receipt = receiptMap.get(key);
    const receivedUnits = getReceivedIndividualUnits(item, receipt);
    const packageOunces = parsePackageOunces(item);
    const usage = usageMap.get(key);
    const usageUnits = usage && packageOunces ? usage.ounces / packageOunces : null;
    const packSize = Math.max(1, finiteNumber(item?.packSize) || 1);

    if (item?.casePackaged && packSize > 1 && current > 0 && previous >= packSize) {
      const converted = current * packSize;
      if (Math.abs(converted - previous) <= 0.01) {
        issues.push(makeIssue(
          item,
          "case-unit",
          "review",
          "Possible case count",
          `Counted ${current}, but inventory is stored as individual units in packs of ${packSize}.`,
          previous,
          current,
        ));
        return;
      }
    }

    const knownAvailable = previous + (receivedUnits ?? 0);
    if (current > previous) {
      if (receivedUnits != null && current > knownAvailable + 0.01) {
        issues.push(makeIssue(
          item,
          "increase-over-receipts",
          "review",
          "Increase exceeds reviewed receipts",
          `Count rose from ${previous} to ${current}; reviewed receipts explain ${receivedUnits} additional unit${receivedUnits === 1 ? "" : "s"}.`,
          previous,
          current,
        ));
      } else if (receivedUnits == null) {
        issues.push(makeIssue(
          item,
          "increase-unverified",
          "review",
          "Inventory increased",
          `Count rose from ${previous} to ${current}. Confirm a delivery, transfer, or correction explains the increase.`,
          previous,
          current,
        ));
      }
      return;
    }

    if (usageUnits != null && usageUnits >= 0.75) {
      const expected = Math.max(0, knownAvailable - usageUnits);
      const tolerance = Math.max(1, usageUnits * 0.35);
      const lower = Math.max(0, expected - tolerance);
      const upper = expected + tolerance;
      if (current < lower || current > upper) {
        issues.push(makeIssue(
          item,
          "usage-range",
          "review",
          "Count differs from recorded pours",
          `Counted ${current}; the prior count, reviewed receipts, and ${Math.round(usage.ounces)} poured oz suggest roughly ${Math.floor(lower)}-${Math.ceil(upper)} units.`,
          previous,
          current,
        ));
      }
      return;
    }

    const unexplainedDrop = knownAvailable - current;
    const materialDrop = unexplainedDrop >= Math.max(3, Math.ceil(knownAvailable * 0.5));
    const materialValue = unexplainedDrop * Math.max(0, finiteNumber(item?.unitCost) || 0) >= 20;
    if (materialDrop && (materialValue || item?.casePackaged === true)) {
      issues.push(makeIssue(
        item,
        "large-drop",
        "review",
        "Large change from last count",
        `Count moved from ${previous}${receivedUnits ? ` plus ${receivedUnits} received` : ""} to ${current}. Review the quantity before saving.`,
        previous,
        current,
      ));
    }
  });

  const blockers = issues.filter((issue) => issue.severity === "block");
  const reviews = issues.filter((issue) => issue.severity === "review");
  return {
    status: blockers.length ? "blocked" : reviews.length ? "review" : "ready",
    sourceStatus: previousUsable ? "current" : previousSnapshot ? "stale" : "unavailable",
    sourceMessage: previousUsable
      ? "Compared with the prior shared snapshot."
      : previousSnapshot
        ? "The prior snapshot is too old for change comparisons; required counts are still checked."
        : "No prior snapshot is available; required counts are still checked.",
    issues,
    blockers,
    reviews,
  };
}
