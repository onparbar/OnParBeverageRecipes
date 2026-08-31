function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, number(value));
}

function normalizeIdentity(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildInventoryPosition({
  connected = 0,
  onHand = 0,
  onDeck = 0,
  cabinet = 0,
  inbound = 0,
  reserved = 0,
} = {}) {
  const position = {
    connected: nonNegative(connected),
    onHand: nonNegative(onHand),
    onDeck: nonNegative(onDeck),
    cabinet: nonNegative(cabinet),
    inbound: nonNegative(inbound),
    reserved: nonNegative(reserved),
  };
  position.physical = position.connected + position.onHand + position.onDeck + position.cabinet;
  position.projected = position.physical + position.inbound;
  position.available = Math.max(0, position.projected - position.reserved);
  return position;
}

export function buildStockGapRecommendation({
  targetStock = 0,
  position = {},
  orderMode = "ceil",
  maxOrder = Number.POSITIVE_INFINITY,
} = {}) {
  const stock = Object.hasOwn(position, "available")
    ? nonNegative(position.available)
    : buildInventoryPosition(position).available;
  const target = nonNegative(targetStock);
  const gap = Math.max(0, target - stock);
  const uncappedOrderQuantity = gap <= 0 ? 0 : orderMode === "single" ? 1 : Math.ceil(gap);
  const cap = Number.isFinite(Number(maxOrder))
    ? Math.max(0, Math.floor(Number(maxOrder)))
    : Number.POSITIVE_INFINITY;
  return {
    stock,
    targetStock: target,
    gap,
    uncappedOrderQuantity,
    orderQuantity: Math.min(uncappedOrderQuantity, cap),
    orderCapApplied: uncappedOrderQuantity > cap,
  };
}

export function buildOperationalRecommendation({
  kind = "beer",
  wall = "",
  averageUsage = 0,
  position = {},
  reserve,
  bottleSize = 0,
  maxOrder = Number.POSITIVE_INFINITY,
} = {}) {
  const normalizedKind = clean(kind).toLowerCase();
  const normalizedWall = clean(wall).toLowerCase();
  const usage = nonNegative(averageUsage);
  const reserveAmount = reserve == null
    ? normalizedKind === "liquor"
      ? 100
      : normalizedKind === "cocktail"
        ? 0.25
        : normalizedWall === "main" ? 1 : 0.5
    : nonNegative(reserve);
  const stockGap = buildStockGapRecommendation({
    targetStock: usage + reserveAmount,
    position,
    orderMode: normalizedKind === "beer" && normalizedWall === "main" ? "single" : "ceil",
    maxOrder,
  });
  if (normalizedKind !== "liquor" || stockGap.gap <= 0) {
    return { ...stockGap, kind: normalizedKind, averageUsage: usage, reserve: reserveAmount };
  }
  const ouncesPerBottle = nonNegative(bottleSize);
  const bottles = ouncesPerBottle > 0 ? Math.ceil(reserveAmount / ouncesPerBottle) : 0;
  const cap = Number.isFinite(Number(maxOrder))
    ? Math.max(0, Math.floor(Number(maxOrder)))
    : Number.POSITIVE_INFINITY;
  return {
    ...stockGap,
    kind: normalizedKind,
    averageUsage: usage,
    reserve: reserveAmount,
    bottleSize: ouncesPerBottle,
    uncappedOrderQuantity: bottles,
    orderQuantity: Math.min(bottles, cap),
    orderCapApplied: bottles > cap,
  };
}

export function classifyPmbLevelState({
  levelAvailable = true,
  levelPercent,
  stale = false,
  zeroVerified = false,
} = {}) {
  if (stale) {
    return { state: "stale", usable: false, levelPercent: null, reason: "PMB data is from an earlier sync." };
  }
  if (levelAvailable === false || levelPercent == null || clean(levelPercent) === "") {
    return { state: "missing", usable: false, levelPercent: null, reason: "PMB did not return a level for this tap." };
  }
  const level = Number(levelPercent);
  if (!Number.isFinite(level) || level < 0 || level > 100) {
    return { state: "anomalous", usable: false, levelPercent: null, reason: "PMB returned an invalid level." };
  }
  if (level === 0 && !zeroVerified) {
    return {
      state: "anomalous-zero",
      usable: false,
      levelPercent: null,
      reason: "PMB returned 0%, but the empty keg was not independently verified.",
    };
  }
  return { state: "verified", usable: true, levelPercent: level, reason: "" };
}

const WORKFLOW_LABELS = {
  pmb: ["Refresh PMB", "Load current usage, prices, and keg levels"],
  inventory: ["Count inventory", "Finish current cabinet and cooler counts"],
  plan: ["Save & lock plan", "Review the live needs and lock this week"],
  orders: ["Place orders", "Submit the approved vendor orders"],
  deliveries: ["Receive deliveries", "Verify delivered, short, and rejected items"],
  prep: ["Finish prep", "Complete cocktail batches and liquor keg fills"],
  "tap-sheets": ["Print tap sheets", "Print the current wall sheets"],
  complete: ["Week complete", "All tracked work for this plan is finished"],
};

function normalizeWorkflowStepId(value) {
  const id = clean(value).toLowerCase();
  if (/pmb|usage/.test(id)) return "pmb";
  if (/inventory|count/.test(id)) return "inventory";
  if (/lock|plan/.test(id)) return "plan";
  if (/order/.test(id)) return "orders";
  if (/deliver|receive/.test(id)) return "deliveries";
  if (/prep|cocktail|liquor/.test(id)) return "prep";
  if (/sheet|print/.test(id)) return "tap-sheets";
  return "";
}

export function deriveWeeklyWorkflowState({ planLocked = false, mondayRun = null } = {}) {
  const steps = Array.isArray(mondayRun?.steps) ? mondayRun.steps : [];
  const current = steps.find((step) => (
    step?.complete !== true
    && clean(step?.status).toLowerCase() !== "done"
  ));
  let stage = normalizeWorkflowStepId(current?.id || current?.label);
  if (!stage) stage = planLocked ? "complete" : "plan";
  const [label, detail] = WORKFLOW_LABELS[stage] || WORKFLOW_LABELS.plan;
  return {
    stage,
    label,
    detail,
    complete: stage === "complete",
    stepId: clean(current?.id),
  };
}

export function isOperationalProduct(product = {}) {
  const lifecycle = normalizeIdentity(product.lifecycle || product.status || product.state);
  const name = normalizeIdentity(product.name || product.brand || product.productName);
  if (/coming soon|placeholder|out of service/.test(lifecycle + " " + name)) return false;
  if (/retired|archived|inactive|replaced/.test(lifecycle)) return false;
  return true;
}

export function buildProductPassportRegistry(records = []) {
  const passports = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const plu = Math.max(0, Math.floor(number(record?.plu)));
    const name = clean(record?.name || record?.brand || record?.productName);
    const key = clean(record?.productId)
      || (plu ? "plu:" + plu : "name:" + normalizeIdentity(name));
    if (!key || key === "name:") return;
    const current = passports.get(key) || {
      key,
      productId: clean(record?.productId),
      name,
      plu: plu || null,
      aliases: [],
      category: clean(record?.category || record?.kind || record?.type),
      lifecycle: clean(record?.lifecycle || record?.status) || "active",
      vendorMappings: [],
      assignments: [],
      priceHistory: [],
    };
    current.name = current.name || name;
    current.plu = current.plu || plu || null;
    current.aliases = [...new Set([
      ...current.aliases,
      name,
      ...(record?.aliases || []),
    ].map(clean).filter(Boolean))];
    current.vendorMappings = [...current.vendorMappings, ...(record?.vendorMappings || [])];
    current.assignments = [...current.assignments, ...(record?.assignments || [])];
    current.priceHistory = [...current.priceHistory, ...(record?.priceHistory || [])];
    passports.set(key, current);
  });
  return passports;
}

export function appendTapAssignmentHistory(history = [], assignment = {}, changedAt = new Date().toISOString()) {
  const next = Array.isArray(history) ? history.map((entry) => ({ ...entry })) : [];
  const tapNumber = Math.max(0, Math.floor(number(assignment.tapNumber)));
  const plu = Math.max(0, Math.floor(number(assignment.plu)));
  if (!tapNumber || !plu) return next;
  const active = next.find((entry) => !entry.endedAt && number(entry.tapNumber) === tapNumber);
  if (active && number(active.plu) === plu) return next;
  if (active) active.endedAt = changedAt;
  next.push({ ...assignment, tapNumber, plu, startedAt: changedAt, endedAt: "" });
  return next;
}
