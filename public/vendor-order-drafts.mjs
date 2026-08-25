import { groupWeeklyPlanOrdersByVendor } from "./weekly-action-plan.mjs";

const CONFIGURED_VENDORS = new Set(["Bonbright", "Heidelberg", "Proof", "OHLQ"]);
const VENDOR_ORDER_IDENTITY_FALLBACKS = new Map([
  ["ohlq|jack-daniel-s", { vendorSku: "0066D", productName: "Jack Daniel's Old No. 7 1.75L", unitCost: 47 }],
  ["ohlq|jack-daniel-s-whiskey", { vendorSku: "0066D", productName: "Jack Daniel's Old No. 7 1.75L", unitCost: 47 }],
  ["ohlq|jack-daniel-s-fire", { vendorSku: "4982D", productName: "Jack Daniel's Tennessee Fire 1.75L", unitCost: 47 }],
  ["ohlq|woodford-reserve", { vendorSku: "9674D", productName: "Woodford Reserve Bourbon 1.75L", unitCost: 66.74 }],
  ["ohlq|woodford-reserve-bourbon", { vendorSku: "9674D", productName: "Woodford Reserve Bourbon 1.75L", unitCost: 66.74 }],
]);
const RETIRED_PRODUCT_PATTERN = /\b(?:breakfast stout|apple pucker)\b/i;

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

const PROOF_PREP_REQUIREMENTS = new Set(["required", "not-required", "unknown"]);

export function normalizeVendorOrderPolicy(policy = {}) {
  const requirement = clean(policy?.proofPrepRequirement).toLowerCase();
  const proofMinimum = numberOrNull(policy?.proofMinimum);
  const proofMinimumCandidates = (Array.isArray(policy?.proofMinimumCandidates)
    ? policy.proofMinimumCandidates
    : [])
    .slice(0, 100)
    .map((item) => ({
      id: clean(item?.id).slice(0, 160),
      name: clean(item?.name).slice(0, 240),
      vendor: "Proof",
      vendorSku: clean(item?.vendorSku).slice(0, 120),
      vendorProductName: clean(item?.vendorProductName || item?.name).slice(0, 240),
      casePackaged: true,
      shelfStable: true,
      packSize: Math.max(1, Math.floor(numberOrNull(item?.packSize) || 1)),
      projectedPrepUseUnits: Math.max(0, Math.ceil(numberOrNull(item?.projectedPrepUseUnits) || 0)),
      projectedPrepUseOz: Math.max(0, numberOrNull(item?.projectedPrepUseOz) || 0),
      onHandUnits: Math.max(0, numberOrNull(item?.onHandUnits) || 0),
      parUnits: Math.max(0, numberOrNull(item?.parUnits) || 0),
      replacementNeedUnits: Math.max(0, Math.ceil(numberOrNull(item?.replacementNeedUnits) || 0)),
      unitCost: Math.max(0, numberOrNull(item?.unitCost) || 0),
    }))
    .filter((item) => item.id && item.name && item.vendorSku && item.unitCost > 0);
  const cocktailIngredientMinimumOrders = (Array.isArray(policy?.cocktailIngredientMinimumOrders)
    ? policy.cocktailIngredientMinimumOrders
    : [])
    .slice(0, 100)
    .map((item) => {
      const packSize = Math.max(1, Math.floor(numberOrNull(item?.packSize) || 1));
      const requestedQuantity = Math.max(0, Math.ceil(numberOrNull(item?.quantity) || 0));
      const quantity = item?.casePackaged && requestedQuantity > 0
        ? Math.ceil(requestedQuantity / packSize) * packSize
        : requestedQuantity;
      const unitCost = numberOrNull(item?.unitCost);
      return {
        id: clean(item?.id).slice(0, 160),
        name: clean(item?.name).slice(0, 240),
        vendor: normalizeVendor(item?.vendor),
        vendorSku: clean(item?.vendorSku).slice(0, 120),
        vendorProductName: clean(item?.vendorProductName || item?.name).slice(0, 240),
        orderCategory: "liquor",
        lineType: "Liquor bottle",
        quantity,
        casePackaged: Boolean(item?.casePackaged),
        packSize,
        unitCost,
        estimatedCost: unitCost === null ? null : quantity * unitCost,
        hasKnownPrice: item?.hasKnownPrice === true || (unitCost !== null && unitCost > 0),
        excludeFromOrderCost: Boolean(item?.excludeFromOrderCost),
        onHand: Math.max(0, numberOrNull(item?.onHand) || 0),
        par: Math.max(0, numberOrNull(item?.par) || 0),
        reason: clean(item?.reason).slice(0, 500) || "Required for this week's cocktail prep.",
      };
    })
    .filter((item) => item.id && item.name && item.vendor && item.quantity > 0);
  return {
    version: 2,
    proofMinimum: proofMinimum !== null && proofMinimum >= 0 ? proofMinimum : 350,
    proofPrepRequirement: PROOF_PREP_REQUIREMENTS.has(requirement) ? requirement : "unknown",
    proofMinimumCandidates,
    cocktailIngredientMinimumOrders,
  };
}

function applyCocktailIngredientMinimumOrders(plan = {}, minimumOrders = []) {
  if (!minimumOrders.length) return plan;
  const orders = { ...(plan?.orders || {}) };
  ORDER_COLLECTIONS.forEach((collection) => {
    orders[collection] = Array.isArray(orders[collection])
      ? orders[collection].map((item) => ({ ...item }))
      : [];
  });

  minimumOrders.forEach((minimum) => {
    const collection = "liquor";
    const existingIndex = orders[collection].findIndex((item) => (
      (clean(minimum.id) && clean(item.id || item.internalId) === clean(minimum.id))
      || (clean(minimum.vendorSku) && clean(item.vendorSku || item.preferredSku) === clean(minimum.vendorSku))
      || clean(item.vendorProductName || item.productName || item.name).toLowerCase()
        === clean(minimum.vendorProductName || minimum.name).toLowerCase()
    ));
    const existing = existingIndex >= 0 ? orders[collection][existingIndex] : null;
    const quantity = Math.max(Number(existing?.quantity) || 0, Number(minimum.quantity) || 0);
    const casePackaged = Boolean(existing?.casePackaged ?? minimum.casePackaged);
    const packSize = Math.max(1, Number(existing?.packSize ?? minimum.packSize) || 1);
    const unitCost = numberOrNull(existing?.unitCost ?? minimum.unitCost);
    const excludeFromOrderCost = Boolean(existing?.excludeFromOrderCost ?? minimum.excludeFromOrderCost);
    const reasons = unique([
      ...(Array.isArray(existing?.reasons) ? existing.reasons : []),
      minimum.reason,
    ].map(clean));
    const line = {
      ...minimum,
      ...(existing || {}),
      id: clean(existing?.id || existing?.internalId || minimum.id),
      internalId: clean(existing?.internalId || existing?.id || minimum.id),
      name: clean(existing?.name || minimum.name),
      vendor: normalizeVendor(existing?.vendor || minimum.vendor),
      vendorSku: clean(existing?.vendorSku || existing?.preferredSku || minimum.vendorSku),
      vendorProductName: clean(existing?.vendorProductName || existing?.productName || minimum.vendorProductName || minimum.name),
      lineType: "Liquor bottle",
      orderCategory: collection,
      quantity,
      casePackaged,
      packSize,
      caseCount: casePackaged ? Math.ceil(quantity / packSize) : 0,
      unitCost,
      estimatedCost: excludeFromOrderCost ? 0 : unitCost === null ? null : quantity * unitCost,
      hasKnownPrice: excludeFromOrderCost || (unitCost !== null && unitCost > 0),
      excludeFromOrderCost,
      reasons,
    };
    if (existingIndex >= 0) orders[collection][existingIndex] = line;
    else orders[collection].push(line);
  });

  return { ...plan, orders };
}

export function buildUnifiedVendorOrderModel(plan, options = {}) {
  const { snapshot = null, orderPolicy = null, ...draftOptions } = options;
  const policy = normalizeVendorOrderPolicy(orderPolicy || snapshot?.orderPolicy);
  const ingredientSafePlan = applyCocktailIngredientMinimumOrders(
    plan,
    policy.cocktailIngredientMinimumOrders,
  );
  return buildVendorOrderDrafts(ingredientSafePlan, {
    ...draftOptions,
    generatedAt: clean(draftOptions.generatedAt || snapshot?.generatedAt),
    sourceDate: clean(draftOptions.sourceDate || snapshot?.publishedAt),
    proofMinimum: policy.proofMinimum,
    proofPrepRequirement: policy.proofPrepRequirement,
    proofMinimumCandidates: policy.proofMinimumCandidates,
  });
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

export function resolveVendorOrderIdentity(item = {}, explicitVendor = "") {
  const vendor = normalizeVendor(explicitVendor || item.vendor);
  const names = unique([
    item.vendorProductName,
    item.productName,
    item.orderProductName,
    item.name,
  ].map(clean));
  const fallback = names
    .map((name) => VENDOR_ORDER_IDENTITY_FALLBACKS.get(`${vendor.toLowerCase()}|${slug(name)}`))
    .find(Boolean) || {};
  return {
    vendor,
    vendorSku: clean(item.vendorSku || item.preferredSku || fallback.vendorSku),
    productName: clean(item.vendorProductName || item.productName || fallback.productName || item.orderProductName || item.name),
    unitCost: numberOrNull(item.unitCost ?? fallback.unitCost),
  };
}

function issue(code, message) {
  return { code, message };
}

const ORDER_COLLECTIONS = ["beerKegs", "liquorTapBottles", "liquor", "mixers", "supplies"];

function getOrderCollection(item = {}) {
  const configured = clean(item.orderCategory);
  if (ORDER_COLLECTIONS.includes(configured)) return configured;
  if (item.lineType === "Beer keg") return "beerKegs";
  if (item.lineType === "Liquor tap bottle") return "liquorTapBottles";
  if (/supply/i.test(clean(item.lineType))) return "supplies";
  if (/liquor|spirit|bottle/i.test(clean(item.lineType))) return "liquor";
  return "mixers";
}

function applyManualOrderAdjustments(plan = {}, catalog = [], adjustments = []) {
  const orders = { ...(plan?.orders || {}) };
  ORDER_COLLECTIONS.forEach((collection) => {
    orders[collection] = Array.isArray(orders[collection]) ? orders[collection].map((item) => ({ ...item })) : [];
  });
  const catalogById = new Map((Array.isArray(catalog) ? catalog : []).map((item) => [clean(item.catalogId), item]));

  (Array.isArray(adjustments) ? adjustments : []).forEach((adjustment) => {
    const source = catalogById.get(clean(adjustment.catalogId));
    const quantity = Number(adjustment.quantity);
    const reason = clean(adjustment.reason);
    if (!source || !Number.isInteger(quantity) || quantity < 0 || !reason) return;
    const vendor = normalizeVendor(source.vendor);
    const internalId = clean(source.internalId || source.id);
    const vendorSku = clean(source.vendorSku || source.preferredSku);
    const productName = clean(source.vendorProductName || source.productName || source.name);
    const collection = getOrderCollection(source);
    let existingCollection = "";
    let existingIndex = -1;
    ORDER_COLLECTIONS.some((name) => {
      const index = orders[name].findIndex((item) => (
        normalizeVendor(item.vendor) === vendor
        && (
          (internalId && clean(item.id || item.internalId) === internalId)
          || (vendorSku && clean(item.vendorSku || item.preferredSku) === vendorSku)
          || clean(item.vendorProductName || item.productName || item.name).toLowerCase() === productName.toLowerCase()
        )
      ));
      if (index < 0) return false;
      existingCollection = name;
      existingIndex = index;
      return true;
    });
    const existing = existingIndex >= 0 ? orders[existingCollection][existingIndex] : null;
    if (quantity === 0) {
      if (existingIndex >= 0) orders[existingCollection].splice(existingIndex, 1);
      return;
    }
    const casePackaged = Boolean(source.casePackaged ?? existing?.casePackaged);
    const packSize = Math.max(1, Number(source.packSize ?? existing?.packSize) || 1);
    const requestedUnits = casePackaged ? quantity * packSize : quantity;
    const excludeFromOrderCost = Boolean(source.excludeFromOrderCost ?? existing?.excludeFromOrderCost);
    const unitCost = excludeFromOrderCost ? 0 : numberOrNull(source.unitCost ?? existing?.unitCost);
    const originalQuantity = existing
      ? casePackaged ? Number(existing.caseCount) || 0 : Number(existing.quantity) || 0
      : Number(source.currentPlanQuantity) || 0;
    const unitLabel = casePackaged ? "cases" : source.lineType === "Beer keg" ? "kegs" : source.lineType === "Liquor tap bottle" ? "bottles" : "units";
    const adjusted = {
      ...source,
      ...(existing || {}),
      id: internalId,
      internalId,
      name: clean(source.name || existing?.name || productName),
      vendor,
      vendorSku,
      vendorProductName: productName,
      lineType: clean(source.lineType || existing?.lineType),
      orderCategory: collection,
      quantity: requestedUnits,
      casePackaged,
      packSize,
      caseCount: casePackaged ? quantity : null,
      unitCost,
      estimatedCost: excludeFromOrderCost ? 0 : unitCost === null ? null : requestedUnits * unitCost,
      hasKnownPrice: excludeFromOrderCost || (unitCost !== null && unitCost > 0),
      excludeFromOrderCost,
      reasons: [
        `Manager adjustment: ${reason}.`,
        `Weekly Plan quantity: ${originalQuantity} ${unitLabel}.`,
      ],
      manualAdjustment: true,
      manualAdjustmentReason: reason,
      manualAdjustmentActor: clean(adjustment.adjustedBy),
    };
    if (existingIndex >= 0) orders[existingCollection][existingIndex] = adjusted;
    else orders[collection].push(adjusted);
  });

  return { ...plan, orders };
}

export function createVendorOrderDraftId(generatedAt, vendor, items = []) {
  const identity = items
    .map((item) => `${clean(item.id || item.internalId)}:${clean(item.name)}:${Number(item.quantity ?? item.requestedUnits) || 0}`)
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
  const resolvedIdentity = resolveVendorOrderIdentity(item, vendor);
  const excludeFromOrderCost = Boolean(item.excludeFromOrderCost);
  const unitCost = excludeFromOrderCost ? 0 : resolvedIdentity.unitCost;
  const extendedCost = excludeFromOrderCost ? 0 : numberOrNull(item.estimatedCost)
    ?? (unitCost !== null && quantity > 0 ? unitCost * quantity : null);
  const internalId = clean(item.id || item.internalId);
  const vendorSku = resolvedIdentity.vendorSku;
  const productName = resolvedIdentity.productName;
  const blockers = [];
  const warnings = [];

  if (!internalId) blockers.push(issue("INTERNAL_ID_REQUIRED", "Internal product identity is missing."));
  if (vendor !== "Bonbright" && !vendorSku) blockers.push(issue("VENDOR_SKU_REQUIRED", "Vendor SKU is missing."));
  if (!productName) blockers.push(issue("PRODUCT_NAME_REQUIRED", "Vendor product name is missing."));
  if (RETIRED_PRODUCT_PATTERN.test(`${productName} ${item.name || ""}`)) {
    blockers.push(issue("RETIRED_PRODUCT", "Retired products cannot be included in an order draft."));
  }
  if (!sourceDate) blockers.push(issue("SOURCE_DATE_REQUIRED", "The locked source-data date is missing."));
  if (!Number.isInteger(quantity) || quantity <= 0) blockers.push(issue("ORDER_QUANTITY_INVALID", "Order quantity must be a positive whole number."));
  if (casePackaged && (!Number.isInteger(caseCount) || caseCount <= 0 || quantity !== caseCount * packSize)) {
    blockers.push(issue("CASE_ROUNDING_REQUIRED", "Case-packaged quantity does not match the saved case count and pack size."));
  }
  if (!excludeFromOrderCost && (unitCost === null || unitCost <= 0 || extendedCost === null || extendedCost <= 0)) {
    blockers.push(issue("PRICE_REQUIRED", "A current unit and extended price are required."));
  }
  if (item.manualAdjustment) warnings.push(issue("MANUAL_ORDER_ADJUSTMENT", "Manager-adjusted quantity; review the saved reason before approval."));
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
    casePackaged,
    requestedUnits: quantity,
    requestedCases: caseCount,
    packSize,
    unitCost,
    extendedCost,
    excludeFromOrderCost,
    reason: getLineReason(item),
    manualAdjustment: Boolean(item.manualAdjustment),
    manualAdjustmentReason: clean(item.manualAdjustmentReason),
    manualAdjustmentActor: clean(item.manualAdjustmentActor),
    tapNumbers: Array.isArray(item.tapNumbers) ? item.tapNumbers : [],
    sourceDate: clean(sourceDate),
    substitutionsAllowed: false,
    blockers,
    warnings,
    confidence: blockers.length ? "blocked" : warnings.length ? "review" : "ready",
  };
}

function selectProofMinimumTopUps(candidates = [], subtotal = 0, minimum = 350, existingLines = []) {
  const gapCents = Math.max(0, Math.ceil((minimum - subtotal) * 100));
  if (!gapCents) return [];
  const eligible = candidates.map((item) => {
    const packSize = Math.max(1, Number(item.packSize) || 1);
    const unitCost = numberOrNull(item.unitCost);
    const replacementNeedUnits = Math.floor(Number(item.replacementNeedUnits ?? item.projectedPrepUseUnits) || 0);
    const identity = clean(item.id || item.internalId).toLowerCase();
    const alreadyOrderedUnits = existingLines
      .filter((line) => line.internalId.toLowerCase() === identity)
      .reduce((total, line) => total + (Number(line.requestedUnits) || 0), 0);
    const additionalNeedUnits = Math.max(0, replacementNeedUnits - alreadyOrderedUnits);
    return {
      ...item,
      packSize,
      unitCost,
      maxCases: Math.ceil(additionalNeedUnits / packSize),
      caseCostCents: unitCost === null ? 0 : Math.round(unitCost * packSize * 100),
    };
  }).filter((item) => (
    normalizeVendor(item.vendor) === "Proof"
    && item.shelfStable === true
    && item.casePackaged === true
    && clean(item.id || item.internalId)
    && clean(item.vendorSku || item.preferredSku)
    && item.maxCases > 0
    && item.caseCostCents > 0
  )).sort((a, b) => clean(a.name).localeCompare(clean(b.name)));

  let combinations = new Map([[0, new Map()]]);
  eligible.forEach((item) => {
    const identity = clean(item.id || item.internalId);
    for (let count = 0; count < item.maxCases; count += 1) {
      const next = new Map(combinations);
      combinations.forEach((selection, costCents) => {
        const nextCost = costCents + item.caseCostCents;
        const nextSelection = new Map(selection);
        nextSelection.set(identity, (nextSelection.get(identity) || 0) + 1);
        if (!next.has(nextCost)) next.set(nextCost, nextSelection);
      });
      combinations = next;
    }
  });
  const selectedCost = [...combinations.keys()].filter((cost) => cost >= gapCents).sort((a, b) => a - b)[0];
  if (selectedCost === undefined) return [];
  const selected = combinations.get(selectedCost);
  return eligible.filter((item) => selected.has(clean(item.id || item.internalId))).map((item) => {
    const caseCount = selected.get(clean(item.id || item.internalId));
    const quantity = caseCount * item.packSize;
    return {
      ...item,
      quantity,
      caseCount,
      estimatedCost: quantity * item.unitCost,
      hasKnownPrice: true,
      reason: "Minimum top-up; replaces projected cocktail prep usage.",
    };
  });
}

function applyProofMinimumTopUps(lines, candidates, subtotal, minimum, sourceDate) {
  const additions = selectProofMinimumTopUps(candidates, subtotal, minimum, lines);
  additions.forEach((item) => {
    const identity = clean(item.id || item.internalId).toLowerCase();
    const existing = lines.find((line) => line.internalId.toLowerCase() === identity);
    if (existing) {
      existing.requestedUnits += item.quantity;
      existing.requestedCases = (existing.requestedCases || 0) + item.caseCount;
      existing.extendedCost += item.estimatedCost;
      existing.reason = `${existing.reason} Minimum top-up replaces projected cocktail prep usage.`;
      return;
    }
    lines.push(buildDraftLine(item, "Proof", sourceDate));
  });
  return additions;
}

export function buildVendorOrderDrafts(plan = {}, {
  generatedAt = "",
  sourceDate = "",
  freshness = { status: "ready" },
  deliveryLocations = {},
  budgetLimit = null,
  proofMinimum = 350,
  proofMinimumCandidates = [],
  proofPrepRequirement = "unknown",
  manualAdjustments = [],
  manualCatalog = [],
  now = new Date(),
  confirmationRecipient = "samantha@onparbar.com",
} = {}) {
  const schedule = getVendorOrderScheduleStatus(now);
  const normalizedBudget = numberOrNull(budgetLimit);
  const duplicateKeys = new Map();
  const adjustedPlan = applyManualOrderAdjustments(plan, manualCatalog, manualAdjustments);
  const groups = groupWeeklyPlanOrdersByVendor(adjustedPlan).map((group) => {
    const vendor = normalizeVendor(group.vendor);
    const lines = group.items.map((item) => buildDraftLine(item, vendor, sourceDate));
    lines.forEach((line) => {
      const key = `${vendor.toLowerCase()}|${line.internalId.toLowerCase() || line.productName.toLowerCase()}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
    });
    return { group, vendor, lines };
  });
  const deferredOrders = [];
  const activeGroups = groups.filter(({ vendor, lines }) => {
    if (vendor !== "Proof" || proofPrepRequirement !== "not-required") return true;
    const estimatedTotal = lines.reduce((total, line) => total + (numberOrNull(line.extendedCost) || 0), 0);
    const hasUnresolvedLine = lines.some((line) => line.blockers.length > 0);
    if (estimatedTotal >= proofMinimum || hasUnresolvedLine) return true;
    deferredOrders.push({
      vendor,
      lineCount: lines.length,
      estimatedTotal,
      reason: `Below $${proofMinimum}; inventory covers this week's cocktail prep.`,
    });
    return false;
  });

  const drafts = activeGroups.map(({ group, vendor, lines }) => {
    lines.forEach((line) => {
      const key = `${vendor.toLowerCase()}|${line.internalId.toLowerCase() || line.productName.toLowerCase()}`;
      if ((duplicateKeys.get(key) || 0) > 1) {
        line.blockers.push(issue("DUPLICATE_ORDER_LINE", "This product appears more than once for the same vendor."));
        line.confidence = "blocked";
      }
    });
    const preTopUpSubtotal = lines.reduce((total, line) => total + (numberOrNull(line.extendedCost) || 0), 0);
    const proofTopUps = vendor === "Proof"
      ? applyProofMinimumTopUps(lines, proofMinimumCandidates, preTopUpSubtotal, proofMinimum, sourceDate)
      : [];
    const estimatedTotal = lines.reduce((total, line) => total + (numberOrNull(line.extendedCost) || 0), 0);
    const deliveryLocation = clean(deliveryLocations[vendor] || deliveryLocations[group.vendor]);
    const blockers = [...schedule.blockers];
    const warnings = [...schedule.warnings];
    if (!CONFIGURED_VENDORS.has(vendor)) blockers.push(issue("VENDOR_NOT_CONFIGURED", `${vendor || "Vendor"} is not configured for draft ordering.`));
    if (!clean(generatedAt)) blockers.push(issue("LOCKED_PLAN_REQUIRED", "A locked Monday Weekly Plan is required."));
    if (["blocked", "stale"].includes(clean(freshness?.status).toLowerCase())) blockers.push(issue("SOURCE_DATA_NOT_READY", "Weekly Plan source data is blocked or stale."));
    lines.forEach((line) => blockers.push(...line.blockers));
    const proofFee = vendor === "Proof" && estimatedTotal < proofMinimum
      ? { threshold: proofMinimum, amount: null, configured: false }
      : null;
    if (proofFee) warnings.push(issue("PROOF_DELIVERY_FEE", `Proof subtotal is below $${proofMinimum}; no shelf-stable projected prep replacement can safely close the gap. The delivery-fee amount is not configured.`));
    if (proofTopUps.length) warnings.push(issue("PROOF_MINIMUM_TOP_UP", `${proofTopUps.length} shelf-stable Proof product${proofTopUps.length === 1 ? " was" : "s were"} added to replace projected cocktail prep usage and meet the $${proofMinimum} minimum.`));
    lines.forEach((line) => warnings.push(...line.warnings));
    return {
      id: createVendorOrderDraftId(generatedAt, vendor, lines),
      generatedAt: clean(generatedAt),
      sourceDate: clean(sourceDate),
      vendor,
      deliveryLocation,
      confirmationRecipient: clean(confirmationRecipient),
      lineCount: lines.length,
      estimatedTotal,
      hasCompletePricing: group.hasCompletePricing !== false && lines.every((line) => (
        line.excludeFromOrderCost || (line.unitCost > 0 && line.extendedCost > 0)
      )),
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
      proofFee,
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
    deferredOrders,
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
