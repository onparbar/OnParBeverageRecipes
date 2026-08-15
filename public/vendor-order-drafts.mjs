import { groupWeeklyPlanOrdersByVendor } from "./weekly-action-plan.mjs";

const CONFIGURED_VENDORS = new Set(["Bonbright", "Heidelberg", "Proof", "OHLQ"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeVendor(value) {
  const vendor = clean(value);
  if (/^ohlq$/i.test(vendor)) return "OHLQ";
  return vendor;
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function hash(value) {
  let result = 2166136261;
  for (const character of String(value)) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function issue(code, message) {
  return { code, message };
}

export function createVendorOrderDraftId(generatedAt, vendor, items = []) {
  const identity = items
    .map((item) => `${clean(item.id || item.internalId)}:${clean(item.name)}:${Number(item.quantity) || 0}`)
    .sort()
    .join("|");
  return `order-draft:${slug(vendor) || "unknown"}:${hash(`${clean(generatedAt)}|${identity}`)}`;
}

export function getVendorOrderScheduleStatus(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const day = date.getDay();
  const hour = date.getHours() + (date.getMinutes() / 60);
  if (day === 1) return { status: "on-time", label: "Monday ordering window", blockers: [], warnings: [] };
  if (day === 2 && hour < 16) {
    return {
      status: "due-soon",
      label: "Due today by 4:00 PM",
      blockers: [],
      warnings: [issue("MONDAY_ORDER_RECOMMENDED", "Orders are normally prepared on Monday and are due today by 4:00 PM.")],
    };
  }
  return {
    status: "past-cutoff",
    label: "Tuesday 4:00 PM cutoff passed",
    blockers: [issue("ORDER_CUTOFF_PASSED", "The Tuesday 4:00 PM order cutoff has passed. Confirm the vendor can still accept this order.")],
    warnings: [],
  };
}

function getLineReason(item) {
  const reasons = Array.isArray(item.reasons) ? item.reasons.map(clean).filter(Boolean) : [];
  if (reasons.length) return reasons.join(" ");
  if (clean(item.reason)) return clean(item.reason);
  if (numberOrNull(item.onHand) !== null && numberOrNull(item.par) !== null) return `${item.onHand} on hand against a par of ${item.par}.`;
  return "Included in the locked Monday Weekly Plan.";
}

function buildDraftLine(item, vendor, sourceDate) {
  const quantity = Number(item.quantity) || 0;
  const casePackaged = Boolean(item.casePackaged);
  const packSize = Math.max(1, Number(item.packSize) || 1);
  const caseCount = casePackaged ? Number(item.caseCount) || 0 : null;
  const unitCost = numberOrNull(item.unitCost);
  const extendedCost = numberOrNull(item.estimatedCost);
  const internalId = clean(item.id || item.internalId);
  const vendorSku = clean(item.vendorSku || item.preferredSku);
  const productName = clean(item.vendorProductName || item.productName || item.name);
  const blockers = [];
  const warnings = [];

  if (!internalId) blockers.push(issue("INTERNAL_ID_REQUIRED", "Internal product identity is missing."));
  if (!vendorSku) blockers.push(issue("VENDOR_SKU_REQUIRED", "Vendor SKU is missing."));
  if (!productName) blockers.push(issue("PRODUCT_NAME_REQUIRED", "Vendor product name is missing."));
  if (!sourceDate) blockers.push(issue("SOURCE_DATE_REQUIRED", "The locked source-data date is missing."));
  if (!Number.isInteger(quantity) || quantity <= 0) blockers.push(issue("ORDER_QUANTITY_INVALID", "Order quantity must be a positive whole number."));
  if (casePackaged && (!Number.isInteger(caseCount) || caseCount <= 0 || quantity !== caseCount * packSize)) {
    blockers.push(issue("CASE_ROUNDING_REQUIRED", "Case-packaged quantity does not match the saved case count and pack size."));
  }
  if (item.hasKnownPrice === false || unitCost === null || unitCost <= 0 || extendedCost === null || extendedCost <= 0) {
    blockers.push(issue("PRICE_REQUIRED", "A current unit and extended price are required."));
  }
  const unusualLimit = item.lineType === "Beer keg" ? 4 : casePackaged ? 10 : 24;
  const comparisonQuantity = casePackaged ? caseCount : quantity;
  if (comparisonQuantity > unusualLimit) warnings.push(issue("UNUSUAL_QUANTITY", `Review the unusual quantity of ${comparisonQuantity}.`));

  return {
    id: internalId,
    internalId,
    name: clean(item.name),
    productName,
    vendor,
    vendorSku,
    lineType: clean(item.lineType),
    requestedUnits: quantity,
    requestedCases: caseCount,
    packSize,
    unitCost,
    extendedCost,
    reason: getLineReason(item),
    sourceDate: clean(sourceDate),
    substitutionsAllowed: false,
    blockers,
    warnings,
    confidence: blockers.length ? "blocked" : warnings.length ? "review" : "ready",
  };
}

export function buildVendorOrderDrafts(plan = {}, {
  generatedAt = "",
  sourceDate = "",
  freshness = { status: "ready" },
  deliveryLocations = {},
  budgetLimit = null,
  proofMinimum = 350,
  now = new Date(),
  confirmationRecipient = "samantha@onparbar.com",
} = {}) {
  const schedule = getVendorOrderScheduleStatus(now);
  const normalizedBudget = numberOrNull(budgetLimit);
  const duplicateKeys = new Map();
  const groups = groupWeeklyPlanOrdersByVendor(plan).map((group) => {
    const vendor = normalizeVendor(group.vendor);
    const lines = group.items.map((item) => buildDraftLine(item, vendor, sourceDate));
    lines.forEach((line) => {
      const key = `${vendor.toLowerCase()}|${line.internalId.toLowerCase() || line.productName.toLowerCase()}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
    });
    return { group, vendor, lines };
  });

  const drafts = groups.map(({ group, vendor, lines }) => {
    lines.forEach((line) => {
      const key = `${vendor.toLowerCase()}|${line.internalId.toLowerCase() || line.productName.toLowerCase()}`;
      if ((duplicateKeys.get(key) || 0) > 1) {
        line.blockers.push(issue("DUPLICATE_ORDER_LINE", "This product appears more than once for the same vendor."));
        line.confidence = "blocked";
      }
    });
    const deliveryLocation = clean(deliveryLocations[vendor] || deliveryLocations[group.vendor]);
    const blockers = [...schedule.blockers];
    const warnings = [...schedule.warnings];
    if (!CONFIGURED_VENDORS.has(vendor)) blockers.push(issue("VENDOR_NOT_CONFIGURED", `${vendor || "Vendor"} is not configured for draft ordering.`));
    if (!clean(generatedAt)) blockers.push(issue("LOCKED_PLAN_REQUIRED", "A locked Monday Weekly Plan is required."));
    if (["blocked", "stale"].includes(clean(freshness?.status).toLowerCase())) blockers.push(issue("SOURCE_DATA_NOT_READY", "Weekly Plan source data is blocked or stale."));
    lines.forEach((line) => blockers.push(...line.blockers));
    if (vendor === "Proof" && group.estimatedCost < proofMinimum) warnings.push(issue("PROOF_DELIVERY_FEE", `Proof subtotal is below $${proofMinimum}; a delivery fee may apply.`));
    lines.forEach((line) => warnings.push(...line.warnings));
    return {
      id: createVendorOrderDraftId(generatedAt, vendor, group.items),
      generatedAt: clean(generatedAt),
      sourceDate: clean(sourceDate),
      vendor,
      deliveryLocation,
      confirmationRecipient: clean(confirmationRecipient),
      lineCount: lines.length,
      estimatedTotal: Number(group.estimatedCost) || 0,
      hasCompletePricing: group.hasCompletePricing && lines.every((line) => line.unitCost > 0 && line.extendedCost > 0),
      substitutionsAllowed: false,
      lines,
      blockers: unique(blockers.map((entry) => `${entry.code}|${entry.message}`)).map((entry) => {
        const [code, ...message] = entry.split("|");
        return issue(code, message.join("|"));
      }),
      warnings: unique(warnings.map((entry) => `${entry.code}|${entry.message}`)).map((entry) => {
        const [code, ...message] = entry.split("|");
        return issue(code, message.join("|"));
      }),
    };
  });

  const weeklyTotal = drafts.reduce((total, draft) => total + draft.estimatedTotal, 0);
  if (normalizedBudget !== null && normalizedBudget >= 0 && weeklyTotal > normalizedBudget) {
    drafts.forEach((draft) => draft.blockers.push(issue("WEEKLY_BUDGET_EXCEEDED", `Known order total exceeds the configured weekly budget of $${normalizedBudget.toFixed(2)}.`)));
  }
  drafts.forEach((draft) => {
    draft.canApprove = draft.lineCount > 0 && draft.blockers.length === 0;
    draft.status = draft.canApprove ? (draft.warnings.length ? "review" : "ready") : "blocked";
  });

  return {
    generatedAt: clean(generatedAt),
    sourceDate: clean(sourceDate),
    confirmationRecipient: clean(confirmationRecipient),
    schedule,
    weeklyTotal,
    budgetLimit: normalizedBudget,
    drafts,
    canApproveAll: drafts.length > 0 && drafts.every((draft) => draft.canApprove),
  };
}

export function getDisabledVendorOrderAdapter(vendor) {
  return Object.freeze({
    vendor: normalizeVendor(vendor),
    enabled: false,
    async submit() {
      const error = new Error("Real vendor submission is disabled until an approved vendor integration is configured.");
      error.code = "VENDOR_ORDER_SUBMISSION_DISABLED";
      throw error;
    },
  });
}
