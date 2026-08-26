const RETIRED_PRODUCTS = new Set(["apple pucker", "breakfast stout"]);
const PROOF_FEE_THRESHOLD = 350;
const BONBRIGHT_TIME_ZONE = "America/New_York";

export const ASSISTED_ORDER_STATUSES = Object.freeze([
  "blocked",
  "ready_for_review",
  "reviewed",
  "opened_vendor",
  "manually_completed",
  "needs_attention",
]);

const STATUS_TRANSITIONS = Object.freeze({
  blocked: new Set(["needs_attention"]),
  ready_for_review: new Set(["reviewed", "needs_attention"]),
  reviewed: new Set(["opened_vendor", "needs_attention"]),
  opened_vendor: new Set(["manually_completed", "needs_attention"]),
  manually_completed: new Set(),
  needs_attention: new Set(["ready_for_review", "reviewed"]),
});

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonicalText(value) {
  return cleanText(value).toLowerCase();
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? "").replace(/[^0-9.-]+/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value) {
  return Math.round((finiteNumber(value) || 0) * 100) / 100;
}

function addUnique(target, message) {
  const value = cleanText(message);
  if (value && !target.includes(value)) target.push(value);
}

function normalizedVendor(value) {
  const key = canonicalText(value).replace(/[^a-z0-9]+/g, "");
  if (key === "bees") return "heidelberg";
  if (["bonbright", "heidelberg", "proof", "ohlq"].includes(key)) return key;
  return key;
}

function normalizedProductName(value) {
  return cleanText(value)
    .replace(/\s*\((?:beer|cocktail|liquor)\)\s*$/i, "")
    .replace(/\s+[123]\s*$/, "")
    .trim();
}

function normalizeLine(line = {}, index = 0) {
  const requestedUnits = finiteNumber(
    line.requestedUnits ?? line.units ?? line.quantity,
  );
  const requestedCases = finiteNumber(line.requestedCases ?? line.cases);
  const quantityForCost = requestedCases || requestedUnits;
  const unitCost = finiteNumber(line.unitCost ?? line.caseCost);
  const suppliedExtendedCost = finiteNumber(line.extendedCost ?? line.lineTotal);
  const extendedCost =
    suppliedExtendedCost === null && unitCost !== null && quantityForCost !== null
      ? money(unitCost * quantityForCost)
      : money(suppliedExtendedCost);

  return {
    index,
    internalItemId: cleanText(
      line.internalItemId ?? line.itemId ?? line.productId ?? line.identity,
    ),
    name: normalizedProductName(
      line.productName ?? line.name ?? line.product ?? line.itemName,
    ),
    productName: normalizedProductName(
      line.productName ?? line.name ?? line.product ?? line.itemName,
    ),
    lineType: cleanText(line.lineType),
    vendorSku: cleanText(line.vendorSku ?? line.sku),
    requestedUnits,
    requestedCases,
    quantityLabel: cleanText(line.quantityLabel ?? line.displayQuantity),
    packSize: cleanText(line.packSize ?? line.packageSize ?? line.size),
    unitCost,
    extendedCost,
    reason: cleanText(line.reason),
    sourceDataDate: cleanText(line.sourceDataDate ?? line.sourceDate),
    inventoryKnown:
      line.inventoryKnown === true ||
      finiteNumber(line.inventoryOnHand ?? line.onHand) !== null,
    usageKnown:
      line.usageKnown === true || finiteNumber(line.weeklyUsage ?? line.usage) !== null,
    shelfStable: line.shelfStable === true,
    planJustified: line.planJustified === true,
    isTopUp: line.isTopUp === true,
    isSubstitution: line.isSubstitution === true || Boolean(line.substitutionFor),
    blockingIssue: cleanText(line.blockingIssue),
  };
}

function lineLabel(line) {
  return line.name || line.internalItemId || `Line ${line.index + 1}`;
}

function lineQuantity(line) {
  if (line.quantityLabel) return line.quantityLabel;
  if (line.requestedCases !== null) {
    return `${line.requestedCases} ${line.requestedCases === 1 ? "case" : "cases"}`;
  }
  if (line.requestedUnits !== null) {
    return `${line.requestedUnits} ${line.requestedUnits === 1 ? "unit" : "units"}`;
  }
  return "quantity unavailable";
}

function validateRequiredLineData(vendorKey, line, blockers) {
  const label = lineLabel(line);
  if (!line.internalItemId) addUnique(blockers, `${label}: internal identity is missing.`);
  if (vendorKey !== "bonbright" && !line.vendorSku) addUnique(blockers, `${label}: vendor SKU is missing.`);
  if (!line.packSize) addUnique(blockers, `${label}: pack size is missing.`);
  if (
    !Number.isFinite(line.requestedUnits) &&
    !Number.isFinite(line.requestedCases)
  ) {
    addUnique(blockers, `${label}: requested quantity is missing.`);
  }
  if (
    (line.requestedUnits !== null && line.requestedUnits <= 0) ||
    (line.requestedCases !== null && line.requestedCases <= 0)
  ) {
    addUnique(blockers, `${label}: requested quantity must be above zero.`);
  }
  if (line.unitCost === null && line.extendedCost <= 0) {
    addUnique(blockers, `${label}: verified pricing is missing.`);
  }
  if (!line.inventoryKnown && !line.usageKnown) {
    addUnique(blockers, `${label}: inventory or usage evidence is missing.`);
  }
  if (!line.reason) addUnique(blockers, `${label}: order reason is missing.`);
  if (line.blockingIssue) addUnique(blockers, `${label}: ${line.blockingIssue}`);
}

function validateProductRules(vendorKey, line, blockers) {
  const label = lineLabel(line);
  const product = canonicalText(line.name);
  const pack = canonicalText(line.packSize);

  if (RETIRED_PRODUCTS.has(product)) {
    addUnique(blockers, `${label}: retired products cannot be ordered.`);
  }
  if (line.isSubstitution) {
    addUnique(blockers, `${label}: substitutions are not allowed.`);
  }

  if (vendorKey === "proof" && line.isTopUp) {
    if (!line.shelfStable) {
      addUnique(blockers, `${label}: Proof top-ups must be shelf stable.`);
    }
    if (!line.planJustified) {
      addUnique(
        blockers,
        `${label}: Proof top-ups must be justified by the locked prep plan.`,
      );
    }
  }

  if (vendorKey !== "ohlq") return;

  if (product.includes("absolut raspberri") && /(?:^|\s)1\s*l(?:\s|$)/.test(pack)) {
    addUnique(blockers, `${label}: Absolut Raspberri 1L is unavailable.`);
  }

  if (product.includes("buffalo trace")) {
    const packCount = finiteNumber(pack.match(/\b(\d+)\s*(?:x|pack|case)/i)?.[1]);
    const impliedUnits =
      line.requestedUnits ??
      (line.requestedCases !== null && packCount !== null
        ? line.requestedCases * packCount
        : null);
    if (impliedUnits === null || impliedUnits % 12 !== 0) {
      addUnique(blockers, `${label}: Buffalo Trace must be ordered in units of 12.`);
    }
  }

  if (product.includes("don julio")) {
    const largerSize =
      /1\.75\s*l|1750\s*ml|59(?:\.2)?\s*oz|larger?\s+size/i.test(pack);
    if (!largerSize) {
      addUnique(blockers, `${label}: use the larger Don Julio size for shot-wall refills.`);
    }
  }
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

export function createAssistedOrderId({ vendor, planId, sourceDataDate, lines = [] }) {
  const vendorKey = normalizedVendor(vendor) || "unknown";
  const sourceKey = cleanText(planId || sourceDataDate || "undated")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "undated";
  const canonicalLines = lines
    .map((line, index) => normalizeLine(line, index))
    .map((line) =>
      [
        line.internalItemId,
        line.vendorSku,
        canonicalText(line.name),
        line.requestedCases,
        line.requestedUnits,
        line.packSize,
        line.extendedCost,
      ].join("|"),
    )
    .sort()
    .join("::");
  return `order-${sourceKey}-${vendorKey}-${stableHash(canonicalLines)}`;
}

export function createAssistedOrderHandoff(draft = {}, context = {}) {
  const vendor = cleanText(draft.vendor);
  const vendorKey = normalizedVendor(vendor);
  const lines = (Array.isArray(draft.lines) ? draft.lines : []).map(normalizeLine);
  const blockers = [];
  const warnings = [];
  const authoritative = context.validationMode === "authoritative";
  const sourceDataDate = cleanText(draft.sourceDataDate ?? draft.sourceDate);

  for (const issue of draft.blockers || []) addUnique(blockers, issue);
  for (const warning of draft.warnings || []) addUnique(warnings, warning);

  if (!vendorKey) addUnique(blockers, "Vendor is missing.");
  if (!lines.length) addUnique(blockers, "The order has no lines.");
  if (!authoritative && !sourceDataDate) {
    addUnique(blockers, "Source data date is missing.");
  }
  if (context.lockedPlan !== true) {
    addUnique(blockers, "A locked Weekly Plan is required.");
  }
  if (context.planBlocked === true) addUnique(blockers, "The Weekly Plan is blocked.");
  if (context.stale === true) addUnique(blockers, "Order source data is stale.");

  for (const line of lines) {
    if (!authoritative) validateRequiredLineData(vendorKey, line, blockers);
    validateProductRules(vendorKey, line, blockers);
  }

  const expectedTotal = money(
    lines.reduce((total, line) => total + line.extendedCost, 0),
  );

  if (vendorKey === "proof" && expectedTotal < PROOF_FEE_THRESHOLD) {
    addUnique(
      warnings,
      `Proof is $${money(PROOF_FEE_THRESHOLD - expectedTotal).toFixed(2)} below the $350.00 threshold. The delivery-fee amount is not configured.`,
    );
  }

  const approved = context.approved === true || draft.approved === true;
  let status = "ready_for_review";
  if (blockers.length) status = "blocked";
  else if (approved) status = "reviewed";
  else if (warnings.length) status = "needs_attention";

  return {
    id: createAssistedOrderId({
      vendor,
      planId: draft.planId,
      sourceDataDate,
      lines,
    }),
    vendor,
    vendorKey,
    sourceDataDate: sourceDataDate || null,
    lines,
    lineCount: lines.length,
    expectedTotal,
    blockers,
    warnings,
    status,
    preview: blockers.length > 0,
    actionsEnabled: status === "reviewed",
  };
}

export function createAuthoritativeAssistedOrderHandoff(
  draft = {},
  saved = {},
  { rehearsal = false } = {},
) {
  const handoff = createAssistedOrderHandoff({
    vendor: draft.vendor,
    planId: draft.generatedAt,
    sourceDataDate: draft.sourceDate,
    lines: (draft.lines || []).map((line) => ({
      internalItemId: line.internalId || line.id,
      productName: line.productName || line.name,
      lineType: line.lineType,
      vendorSku: line.vendorSku,
      requestedUnits: line.requestedUnits,
      requestedCases: line.requestedCases,
      packSize: line.packSize,
      unitCost: line.unitCost,
      extendedCost: line.extendedCost,
      reason: line.reason,
      sourceDataDate: line.sourceDate || draft.sourceDate,
      inventoryKnown: true,
      shelfStable: line.shelfStable,
      planJustified: line.planJustified,
      isTopUp: line.isTopUp,
      isSubstitution: line.substitutionsAllowed === true,
    })),
    blockers: (draft.blockers || []).map((entry) => entry.message || entry.code),
    warnings: (draft.warnings || []).map((entry) => entry.message || entry.code),
  }, {
    validationMode: "authoritative",
    lockedPlan: Boolean(draft.generatedAt),
    planBlocked: (draft.blockers || []).length > 0,
    approved: Boolean(saved.approvedAt),
  });

  const persistedStatus = ASSISTED_ORDER_STATUSES.includes(saved.status)
    ? saved.status
    : null;
  let status = handoff.status;
  if (!handoff.blockers.length) {
    if (saved.completedAt) status = "manually_completed";
    else if (saved.openedAt) status = "opened_vendor";
    else if (saved.approvedAt) status = "reviewed";
    else if (persistedStatus) status = persistedStatus;
    else if (saved.createdAt) {
      status = handoff.warnings.length ? "needs_attention" : "ready_for_review";
    }
  }

  return {
    ...handoff,
    id: cleanText(draft.id) || handoff.id,
    status,
    preview: handoff.blockers.length > 0,
    actionsEnabled: rehearsal
      ? handoff.blockers.length === 0
      : ["reviewed", "opened_vendor"].includes(status),
    rehearsal,
    proofFee: draft.proofFee || null,
  };
}

export function groupAssistedOrders(drafts = [], context = {}) {
  const orders = drafts.map((draft) =>
    createAssistedOrderHandoff(draft, {
      ...context,
      ...(context.byVendor?.[normalizedVendor(draft.vendor)] || {}),
    }),
  );
  return {
    orders,
    expectedTotal: money(
      orders.reduce((total, order) => total + order.expectedTotal, 0),
    ),
    blockedCount: orders.filter((order) => order.status === "blocked").length,
  };
}

export function formatBonbrightMessage(order) {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  const body = lines
    .map((rawLine, index) => {
      const line = rawLine?.name ? rawLine : normalizeLine(rawLine, index);
      const quantity =
        line.requestedCases ?? line.requestedUnits ?? finiteNumber(line.quantityLabel);
      return `${quantity ?? "?"} ${normalizedProductName(line.name)}`.trim();
    })
    .join("\n");

  return [
    "Heyy TJ-",
    "",
    "This week, we would like to order the following:",
    "",
    body,
    "",
    "I appreciate you!",
  ].join("\n");
}

export function formatVendorOrderList(order) {
  const heading = `${cleanText(order?.vendor) || "Vendor"} order`;
  const lines = (order?.lines || []).map((line, index) => {
    const normalized = line?.name ? line : normalizeLine(line, index);
    const sku = normalized.vendorSku ? ` | SKU ${normalized.vendorSku}` : "";
    const cost = normalized.extendedCost
      ? ` | $${normalized.extendedCost.toFixed(2)}`
      : "";
    return `${lineQuantity(normalized)} | ${normalized.name}${sku}${cost}`;
  });
  return [
    heading,
    ...lines,
    `Expected total: $${money(order?.expectedTotal).toFixed(2)}`,
  ].join("\n");
}

export function formatVendorHandoff(order) {
  return normalizedVendor(order?.vendor) === "bonbright"
    ? formatBonbrightMessage(order)
    : formatVendorOrderList(order);
}

export function getBonbrightTextWindowStatus(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BONBRIGHT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const minuteOfDay = hour * 60 + minute;
  const allowed = minuteOfDay >= 9 * 60 && minuteOfDay <= 19 * 60 + 30;
  return {
    allowed,
    label: allowed ? "Text window open" : "Send after 9:00 AM",
    timeZone: BONBRIGHT_TIME_ZONE,
  };
}

export function transitionAssistedOrder(order, nextStatus, details = {}) {
  if (!ASSISTED_ORDER_STATUSES.includes(nextStatus)) {
    throw new Error(`Unknown assisted-order status: ${nextStatus}`);
  }
  if (order.status === nextStatus) {
    return { ...order, duplicate: true };
  }
  if (!STATUS_TRANSITIONS[order.status]?.has(nextStatus)) {
    throw new Error(`Cannot move assisted order from ${order.status} to ${nextStatus}.`);
  }
  return {
    ...order,
    status: nextStatus,
    duplicate: false,
    statusActor: cleanText(details.actor) || null,
    statusTimestamp: details.timestamp || new Date().toISOString(),
    completionKey:
      nextStatus === "manually_completed" ? `${order.id}:manually_completed` : null,
  };
}

export function buildAssistedOrderActivity(order, action, details = {}) {
  const safeResponse = details.vendorResponse
    ? {
        status: cleanText(details.vendorResponse.status) || null,
        code: cleanText(details.vendorResponse.code) || null,
        requestId: cleanText(details.vendorResponse.requestId) || null,
      }
    : null;
  return {
    type: "assisted_order_handoff",
    handoffId: order.id,
    vendor: order.vendor,
    action: cleanText(action),
    status: order.status,
    actor: cleanText(details.actor) || null,
    timestamp: details.timestamp || new Date().toISOString(),
    lineCount: order.lineCount,
    expectedTotal: order.expectedTotal,
    vendorResponse: safeResponse,
  };
}
