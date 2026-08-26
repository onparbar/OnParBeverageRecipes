import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SNAPSHOTS = 104;
const MAX_ITEMS = 500;
const MAX_KEG_PLAN_ITEMS = 160;
const MAX_SPEECH_ALIASES = 100;
const MAX_INVENTORY_CONTRIBUTIONS = 2000;
const MAX_TEXT_LENGTH = 160;

let updateQueue = Promise.resolve();

export class InventoryStateError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "InventoryStateError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function inventoryError(code, message, status = 400, details = {}) {
  return new InventoryStateError(code, message, status, details);
}

function getStatePath() {
  if (process.env.INVENTORY_STATE_PATH) return process.env.INVENTORY_STATE_PATH;
  const dataDir = process.env.INVENTORY_STATE_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "inventory-state.json");
}

function getBackupStatePath() {
  return `${getStatePath()}.backup`;
}

function clean(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanId(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeOverrideMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_ITEMS)
      .map(([id, displayValue]) => [cleanId(id), clean(displayValue, 24)])
      .filter(([id, displayValue]) => id && displayValue !== ""),
  );
}

function sanitizeCustomItem(item) {
  const name = clean(item?.name);
  const id = cleanId(item?.id);
  if (!name || !id) return null;

  return {
    id,
    name,
    group: clean(item?.group) || "Custom Inventory",
    onHandDisplay: clean(item?.onHandDisplay, 24),
    parDisplay: clean(item?.parDisplay, 24),
    packSize: Math.max(1, Math.round(finiteNumber(item?.packSize, 1))),
    casePackaged: Boolean(item?.casePackaged),
    caseCost: Math.max(0, finiteNumber(item?.caseCost)),
    unitCost: Math.max(0, finiteNumber(item?.unitCost)),
    vendorProduct: sanitizeVendorProduct(item?.vendorProduct),
    matchedSku: clean(item?.matchedSku, 40),
    priceUpdatedAt: clean(item?.priceUpdatedAt, 40),
    updatedAt: clean(item?.updatedAt, 40) || new Date().toISOString(),
  };
}

function sanitizeVendorProduct(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const productName = clean(value.productName);
  const vendor = clean(value.vendor, 40);
  const syncVendor = clean(value.syncVendor, 40) || vendor;
  if (!productName || !syncVendor) return null;
  return {
    vendor: vendor || syncVendor,
    syncVendor,
    productName,
    bottleOz: Math.max(0, finiteNumber(value.bottleOz)),
    preferredSku: clean(value.preferredSku, 40),
  };
}

function sanitizeCustomItems(items) {
  if (!Array.isArray(items)) return [];
  const byId = new Map();
  items.slice(0, MAX_ITEMS).forEach((item) => {
    const normalized = sanitizeCustomItem(item);
    if (normalized) byId.set(normalized.id, normalized);
  });
  return [...byId.values()];
}

function sanitizeItemOrder(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.slice(0, MAX_ITEMS).map(cleanId).filter(Boolean))];
}

function sanitizeInventoryContributions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).slice(0, MAX_INVENTORY_CONTRIBUTIONS).flatMap(([key, entry]) => {
    const sourceId = clean(entry?.sourceId, 180);
    const itemId = cleanId(entry?.itemId);
    const quantity = Number(entry?.quantity);
    if (!sourceId || !itemId || !Number.isFinite(quantity) || quantity === 0) return [];
    return [[clean(key, 360) || `${sourceId}::${itemId}`, {
      sourceId,
      itemId,
      quantity: Math.round(quantity * 1000) / 1000,
      baseline: Math.max(0, finiteNumber(entry?.baseline)),
      reason: clean(entry?.reason, MAX_TEXT_LENGTH),
      updatedAt: clean(entry?.updatedAt, 40),
    }]];
  }));
}

function clearInventoryContributionsForItem(state, itemId) {
  Object.entries(state.current.inventoryContributions).forEach(([key, entry]) => {
    if (entry.itemId === itemId) delete state.current.inventoryContributions[key];
  });
}

function sanitizeSpeechAlias(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const alias = clean(value.alias, 80).toLowerCase().replace(/[^a-z0-9. ]+/g, "").replace(/\s+/g, " ").trim();
  const product = clean(value.product);
  const rawContext = clean(value.context, 20).toLowerCase();
  const context = ["inventory", "main", "patio", "karaoke"].includes(rawContext)
    ? rawContext
    : "inventory";
  if (!alias || !product) return null;
  return {
    alias,
    product,
    context,
    updatedAt: clean(value.updatedAt, 40),
    updatedByRole: clean(value.updatedByRole, 30),
  };
}

function sanitizeSpeechAliases(values) {
  if (!Array.isArray(values)) return [];
  const aliases = new Map();
  values.slice(-MAX_SPEECH_ALIASES * 2).forEach((value) => {
    const normalized = sanitizeSpeechAlias(value);
    if (normalized) aliases.set(`${normalized.context}:${normalized.alias}`, normalized);
  });
  return [...aliases.values()].slice(-MAX_SPEECH_ALIASES);
}

function sanitizeSnapshotItem(item) {
  const name = clean(item?.name);
  if (!name) return null;
  return {
    id: cleanId(item?.id),
    name,
    group: clean(item?.group) || "Other",
    onHandDisplay: clean(item?.onHandDisplay, 24),
    parDisplay: clean(item?.parDisplay, 24),
    orderDisplay: clean(item?.orderDisplay, 24),
    shortageDisplay: clean(item?.shortageDisplay, 24),
    packSize: Math.max(1, Math.round(finiteNumber(item?.packSize, 1))),
    casePackaged: Boolean(item?.casePackaged),
    unitCost: Math.max(0, finiteNumber(item?.unitCost)),
    totalValue: Math.max(0, finiteNumber(item?.totalValue)),
    note: clean(item?.note),
  };
}

function sanitizeSnapshotSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const bottleInventoryValue = Math.max(0, finiteNumber(summary.bottleInventoryValue));
  const connectedLineValue = Math.max(0, finiteNumber(summary.connectedLineValue));
  const backupKegValue = Math.max(0, finiteNumber(summary.backupKegValue));
  const currentLineValue = connectedLineValue + backupKegValue;
  return {
    bottleInventoryValue,
    connectedLineValue,
    backupKegValue,
    currentLineValue,
    totalBeverageInventoryValue: bottleInventoryValue + currentLineValue,
    pmbUpdatedAt: clean(summary.pmbUpdatedAt, 40),
    liveTapCount: Math.max(0, Math.round(finiteNumber(summary.liveTapCount))),
    tapCount: Math.max(0, Math.round(finiteNumber(summary.tapCount))),
  };
}

const RELIABLE_CAPTURE_SOURCES = Object.freeze([
  "inventory",
  "weeklyUsage",
  "pmb",
  "pricing",
  "recommendations",
]);

function getEasternDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isEasternMonday(value = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(value) === "Mon";
}

function sanitizeCaptureMetadata(value, savedAt, role, weekOf) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const capturedOutsideMonday = !isEasternMonday(new Date(savedAt));
  const sourceFreshness = Object.fromEntries(
    RELIABLE_CAPTURE_SOURCES.map((source) => [source, clean(value.sourceFreshness?.[source], 24)]),
  );
  const sourceRevisions = Object.fromEntries(
    RELIABLE_CAPTURE_SOURCES.map((source) => [source, Math.max(0, Math.round(finiteNumber(value.sourceRevisions?.[source])))]),
  );
  const sourceTimestamps = Object.fromEntries(
    RELIABLE_CAPTURE_SOURCES.map((source) => [source, clean(value.sourceTimestamps?.[source], 40)]),
  );
  return {
    operatingWeek: weekOf,
    capturedAt: savedAt,
    actorRole: clean(role, 30) || "owner",
    capturedOutsideMonday,
    outsideMondayReason: capturedOutsideMonday ? clean(value.outsideMondayReason, 240) : "",
    sourceFreshness,
    sourceRevisions,
    sourceTimestamps,
  };
}

function validateReliableCapture(payload, now) {
  if (!isEasternMonday(now) && clean(payload.captureMetadata?.outsideMondayReason, 240).length < 3) {
    throw inventoryError(
      "MONDAY_SNAPSHOT_REASON_REQUIRED",
      "A reason is required to capture the Monday Inventory Snapshot outside Monday.",
      409,
    );
  }
  const missingSources = RELIABLE_CAPTURE_SOURCES.filter((source) => (
    !["current", "verified"].includes(clean(payload.captureMetadata?.sourceFreshness?.[source], 24).toLowerCase())
  ));
  if (missingSources.length) {
    throw inventoryError(
      "MONDAY_SNAPSHOT_SOURCE_INCOMPLETE",
      "Current inventory, usage, PMB, pricing, and recommendations are required.",
      409,
      { missingSources },
    );
  }
}

function sanitizeKegPlanRecommendation(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const key = clean(item.key, 120);
  const name = clean(item.name);
  const tapNumber = Math.max(0, Math.round(finiteNumber(item.tapNumber)));
  if (!key || !name || !tapNumber) return null;
  const actionType = ["none", "order", "make"].includes(clean(item.actionType, 20))
    ? clean(item.actionType, 20)
    : "none";
  return {
    key,
    tapNumber,
    wall: clean(item.wall, 40),
    name,
    templateBrand: clean(item.templateBrand),
    type: clean(item.type, 60),
    plu: Math.max(0, Math.round(finiteNumber(item.plu))),
    isKegTap: Boolean(item.isKegTap),
    isLiquorTap: Boolean(item.isLiquorTap),
    liveFraction: Math.max(0, finiteNumber(item.liveFraction)),
    backupKegs: Math.max(0, finiteNumber(item.backupKegs)),
    currentStockKegs: Math.max(0, finiteNumber(item.currentStockKegs)),
    avgWeeklyKegs: Math.max(0, finiteNumber(item.avgWeeklyKegs)),
    currentStockOunces: Math.max(0, finiteNumber(item.currentStockOunces)),
    avgWeeklyOunces: Math.max(0, finiteNumber(item.avgWeeklyOunces)),
    targetStockKegs: Math.max(0, finiteNumber(item.targetStockKegs)),
    targetStockOunces: Math.max(0, finiteNumber(item.targetStockOunces)),
    gapKegs: finiteNumber(item.gapKegs),
    gapOunces: finiteNumber(item.gapOunces),
    rawOrderQty: Math.max(0, finiteNumber(item.rawOrderQty)),
    calculatedOrderQty: Math.max(0, finiteNumber(item.calculatedOrderQty)),
    orderQty: Math.max(0, finiteNumber(item.orderQty)),
    orderProductName: clean(item.orderProductName),
    actionType,
    priority: finiteNumber(item.priority),
    reason: clean(item.reason, 500),
    inventoryStateMissing: Boolean(item.inventoryStateMissing),
    orderCapApplied: Boolean(item.orderCapApplied),
  };
}

function sanitizeKegPlanTapInput(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const key = clean(item.key, 120);
  const tapNumber = Math.max(0, Math.round(finiteNumber(item.tapNumber)));
  if (!key || !tapNumber) return null;
  return {
    key,
    tapNumber,
    wall: clean(item.wall, 40),
    name: clean(item.name),
    liveFraction: Math.max(0, finiteNumber(item.liveFraction)),
    backupKegs: Math.max(0, finiteNumber(item.backupKegs)),
    currentStockKegs: Math.max(0, finiteNumber(item.currentStockKegs)),
    currentStockOunces: Math.max(0, finiteNumber(item.currentStockOunces)),
    avgWeeklyKegs: Math.max(0, finiteNumber(item.avgWeeklyKegs)),
    avgWeeklyOunces: Math.max(0, finiteNumber(item.avgWeeklyOunces)),
  };
}

export function sanitizeKegPlanSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const generatedAt = clean(value.generatedAt, 40);
  if (!generatedAt || Number.isNaN(new Date(generatedAt).getTime())) return null;
  const items = (Array.isArray(value.items) ? value.items : [])
    .slice(0, MAX_KEG_PLAN_ITEMS)
    .map(sanitizeKegPlanRecommendation)
    .filter(Boolean)
    .filter((item) => Math.max(item.orderQty, item.rawOrderQty, item.calculatedOrderQty) > 0);
  const tapInputs = (Array.isArray(value.tapInputs) ? value.tapInputs : [])
    .slice(0, MAX_KEG_PLAN_ITEMS)
    .map(sanitizeKegPlanTapInput)
    .filter(Boolean);
  const rawSummary = value.summary && typeof value.summary === "object" && !Array.isArray(value.summary)
    ? value.summary
    : {};
  const summary = Object.fromEntries([
    "tapCount",
    "kegTapCount",
    "orderItemCount",
    "orderTotal",
    "kegOrderCount",
    "kegOrderTotal",
    "liquorOrderCount",
    "liquorOrderTotal",
    "cocktailMakeCount",
    "cocktailMakeTotal",
    "onHandEntryCount",
    "requiredOnHandEntryCount",
    "coveredOnHandEntryCount",
    "missingOnHandCount",
  ].map((key) => [key, Math.max(0, finiteNumber(rawSummary[key]))]));
  summary.inventoryStateMissing = Boolean(rawSummary.inventoryStateMissing);
  summary.missingOnHandTaps = (Array.isArray(rawSummary.missingOnHandTaps) ? rawSummary.missingOnHandTaps : [])
    .slice(0, MAX_KEG_PLAN_ITEMS)
    .map((value) => Math.max(0, Math.round(finiteNumber(value))))
    .filter(Boolean);
  return { generatedAt, items, tapInputs, summary };
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.slice(0, MAX_ITEMS).map(sanitizeSnapshotItem).filter(Boolean)
    : [];
  if (!items.length) return null;

  const savedAt = clean(snapshot.savedAt, 40) || new Date().toISOString();
  const weekOf = clean(snapshot.weekOf, 10) || getMondayDate(savedAt);
  return {
    id: clean(snapshot.id, 100) || `inventory-${Date.now()}`,
    weekOf,
    savedAt,
    savedByRole: clean(snapshot.savedByRole, 30) || "owner",
    unitModelVersion: Math.max(1, Math.round(finiteNumber(snapshot.unitModelVersion, 2))),
    summary: sanitizeSnapshotSummary(snapshot.summary),
    kegPlanSnapshot: sanitizeKegPlanSnapshot(snapshot.kegPlanSnapshot),
    captureMetadata: sanitizeCaptureMetadata(
      snapshot.captureMetadata,
      savedAt,
      snapshot.savedByRole,
      weekOf,
    ),
    items,
  };
}

export function createEmptyInventoryState() {
  return {
    version: 1,
    revision: 0,
    initialized: false,
    initializedAt: "",
    current: {
      onHandOverrides: {},
      parOverrides: {},
      customItems: [],
      itemOrder: [],
      speechAliases: [],
      inventoryContributions: {},
      updatedAt: "",
      updatedByRole: "",
    },
    snapshots: [],
  };
}

export function normalizeInventoryState(value) {
  const base = createEmptyInventoryState();
  if (!value || typeof value !== "object") return base;
  return {
    ...base,
    version: 1,
    revision: Math.max(0, Math.round(finiteNumber(value.revision))),
    initialized: Boolean(value.initialized),
    initializedAt: clean(value.initializedAt, 40),
    current: {
      onHandOverrides: sanitizeOverrideMap(value.current?.onHandOverrides),
      parOverrides: sanitizeOverrideMap(value.current?.parOverrides),
      customItems: sanitizeCustomItems(value.current?.customItems),
      itemOrder: sanitizeItemOrder(value.current?.itemOrder),
      speechAliases: sanitizeSpeechAliases(value.current?.speechAliases),
      inventoryContributions: sanitizeInventoryContributions(value.current?.inventoryContributions),
      updatedAt: clean(value.current?.updatedAt, 40),
      updatedByRole: clean(value.current?.updatedByRole, 30),
    },
    snapshots: Array.isArray(value.snapshots)
      ? value.snapshots.map(sanitizeSnapshot).filter(Boolean).slice(0, MAX_SNAPSHOTS)
      : [],
  };
}

export function getMondayDate(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function readInventoryState() {
  try {
    return normalizeInventoryState(JSON.parse(await readFile(getStatePath(), "utf8")));
  } catch (error) {
    try {
      return normalizeInventoryState(JSON.parse(await readFile(getBackupStatePath(), "utf8")));
    } catch (backupError) {
      if (error?.code === "ENOENT" && backupError?.code === "ENOENT") return createEmptyInventoryState();
      throw error;
    }
  }
}

async function writeInventoryState(state) {
  const statePath = getStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, serialized, "utf8");
  await rename(tempPath, statePath);
  const backupPath = getBackupStatePath();
  const backupTempPath = `${backupPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(backupTempPath, serialized, "utf8");
    await rename(backupTempPath, backupPath);
  } catch {
    // The primary atomic write succeeded; backup failure must not turn a saved snapshot into an error.
  }
  return state;
}

function queueUpdate(update) {
  const operation = updateQueue.then(async () => {
    const current = await readInventoryState();
    const next = normalizeInventoryState(await update(current));
    next.revision = current.revision + 1;
    return writeInventoryState(next);
  });
  updateQueue = operation.catch(() => {});
  return operation;
}

function markCurrentUpdated(state, role, now = new Date()) {
  state.current.updatedAt = now.toISOString();
  state.current.updatedByRole = clean(role, 30) || "owner";
  return state;
}

function requireInitialized(state) {
  if (!state.initialized) {
    throw inventoryError(
      "INVENTORY_STATE_NOT_INITIALIZED",
      "Shared inventory must be imported from the service computer before it can be updated.",
      409,
      { currentRevision: state.revision },
    );
  }
}

export function applyInventoryStateAction(
  stateValue,
  action,
  payload = {},
  role = "owner",
  now = new Date(),
) {
  const state = normalizeInventoryState(stateValue);

  switch (action) {
    case "initialize": {
      if (state.initialized) {
        throw inventoryError(
          "INVENTORY_STATE_ALREADY_INITIALIZED",
          "Shared inventory has already been initialized.",
          409,
          { currentRevision: state.revision },
        );
      }
      state.current.onHandOverrides = sanitizeOverrideMap(payload.onHandOverrides);
      state.current.parOverrides = sanitizeOverrideMap(payload.parOverrides);
      state.current.customItems = sanitizeCustomItems(payload.customItems);
      state.current.itemOrder = sanitizeItemOrder(payload.itemOrder);
      state.current.speechAliases = sanitizeSpeechAliases(payload.speechAliases);
      state.current.inventoryContributions = {};
      state.snapshots = Array.isArray(payload.snapshots)
        ? payload.snapshots.map(sanitizeSnapshot).filter(Boolean).slice(0, MAX_SNAPSHOTS)
        : [];
      state.initialized = true;
      state.initializedAt = now.toISOString();
      return markCurrentUpdated(state, role, now);
    }
    case "update-field": {
      requireInitialized(state);
      const normalizedId = cleanId(payload.id);
      const field = String(payload.field || "");
      const target = field === "par" ? state.current.parOverrides : state.current.onHandOverrides;
      if (!normalizedId || !["onHand", "par"].includes(field)) {
        throw inventoryError("INVALID_INVENTORY_ACTION", "Invalid inventory field update.");
      }
      const normalizedValue = clean(payload.value, 24);
      if (normalizedValue === "") delete target[normalizedId];
      else target[normalizedId] = normalizedValue;
      if (field === "onHand") clearInventoryContributionsForItem(state, normalizedId);
      return markCurrentUpdated(state, role, now);
    }
    case "batch-update-fields": {
      requireInitialized(state);
      const changes = Array.isArray(payload.changes) ? payload.changes : [];
      if (!changes.length || changes.length > 500) {
        throw inventoryError("INVALID_INVENTORY_ACTION", "One to 500 inventory field changes are required.");
      }
      const normalizedChanges = new Map();
      changes.forEach((change) => {
        const normalizedId = cleanId(change?.id);
        const field = String(change?.field || "");
        if (!normalizedId || !["onHand", "par"].includes(field)) {
          throw inventoryError("INVALID_INVENTORY_ACTION", "Every inventory field change must identify a valid item and field.");
        }
        normalizedChanges.set(`${normalizedId}:${field}`, {
          id: normalizedId,
          field,
          value: clean(change?.value, 24),
        });
      });
      normalizedChanges.forEach((change) => {
        const target = change.field === "par" ? state.current.parOverrides : state.current.onHandOverrides;
        if (change.value === "") delete target[change.id];
        else target[change.id] = change.value;
        if (change.field === "onHand") clearInventoryContributionsForItem(state, change.id);
      });
      return markCurrentUpdated(state, role, now);
    }
    case "apply-contributions": {
      requireInitialized(state);
      const sources = Array.isArray(payload.sources) ? payload.sources : [];
      if (!sources.length || sources.length > 100) {
        throw inventoryError("INVALID_INVENTORY_ACTION", "One to 100 inventory contribution sources are required.");
      }
      sources.forEach((source) => {
        const sourceId = clean(source?.sourceId, 180);
        const reason = clean(source?.reason, MAX_TEXT_LENGTH);
        const incoming = Array.isArray(source?.contributions) ? source.contributions : [];
        if (!sourceId || incoming.length > 500) {
          throw inventoryError("INVALID_INVENTORY_ACTION", "Each inventory contribution needs a valid source and up to 500 items.");
        }
        const nextByItem = new Map();
        incoming.forEach((entry) => {
          const itemId = cleanId(entry?.id);
          const quantity = Number(entry?.quantity);
          const baseline = Number(entry?.baseline);
          if (!itemId || !Number.isFinite(quantity) || !Number.isFinite(baseline) || baseline < 0) {
            throw inventoryError("INVALID_INVENTORY_ACTION", "Every inventory contribution needs a valid item, quantity, and baseline.");
          }
          const existing = nextByItem.get(itemId) || { quantity: 0, baseline };
          existing.quantity += quantity;
          existing.baseline = baseline;
          nextByItem.set(itemId, existing);
        });
        const priorByItem = new Map();
        Object.values(state.current.inventoryContributions).forEach((entry) => {
          if (entry.sourceId === sourceId) priorByItem.set(entry.itemId, entry);
        });
        const itemIds = new Set([...priorByItem.keys(), ...nextByItem.keys()]);
        itemIds.forEach((itemId) => {
          const prior = priorByItem.get(itemId);
          const next = nextByItem.get(itemId);
          const priorQuantity = Number(prior?.quantity) || 0;
          const nextQuantity = Math.round((Number(next?.quantity) || 0) * 1000) / 1000;
          const contributionKey = `${sourceId}::${itemId}`;
          const currentValue = Object.hasOwn(state.current.onHandOverrides, itemId)
            ? Math.max(0, finiteNumber(state.current.onHandOverrides[itemId]))
            : Math.max(0, finiteNumber(next?.baseline ?? prior?.baseline));
          const adjusted = Math.max(0, Math.round((currentValue + nextQuantity - priorQuantity) * 1000) / 1000);
          state.current.onHandOverrides[itemId] = String(adjusted);
          Object.entries(state.current.inventoryContributions).forEach(([key, entry]) => {
            if (entry.sourceId === sourceId && entry.itemId === itemId) delete state.current.inventoryContributions[key];
          });
          if (nextQuantity !== 0) {
            state.current.inventoryContributions[contributionKey] = {
              sourceId,
              itemId,
              quantity: nextQuantity,
              baseline: Math.max(0, finiteNumber(next?.baseline ?? prior?.baseline)),
              reason,
              updatedAt: now.toISOString(),
            };
          }
        });
      });
      state.current.inventoryContributions = sanitizeInventoryContributions(state.current.inventoryContributions);
      return markCurrentUpdated(state, role, now);
    }
    case "upsert-custom": {
      requireInitialized(state);
      const normalized = sanitizeCustomItem(payload.item);
      if (!normalized) {
        throw inventoryError(
          "INVALID_INVENTORY_ACTION",
          "A valid custom inventory item is required.",
        );
      }
      state.current.customItems = [
        ...state.current.customItems.filter((entry) => entry.id !== normalized.id),
        normalized,
      ];
      if (normalized.onHandDisplay === "") delete state.current.onHandOverrides[normalized.id];
      else state.current.onHandOverrides[normalized.id] = normalized.onHandDisplay;
      if (normalized.parDisplay === "") delete state.current.parOverrides[normalized.id];
      else state.current.parOverrides[normalized.id] = normalized.parDisplay;
      return markCurrentUpdated(state, role, now);
    }
    case "merge-speech-aliases": {
      requireInitialized(state);
      const aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
      if (!aliases.length || aliases.length > MAX_SPEECH_ALIASES) {
        throw inventoryError("INVALID_INVENTORY_ACTION", "One to 100 learned speech matches are required.");
      }
      const normalized = aliases.map((alias) => sanitizeSpeechAlias({
        ...alias,
        updatedAt: now.toISOString(),
        updatedByRole: role,
      }));
      if (normalized.some((alias) => !alias)) {
        throw inventoryError("INVALID_INVENTORY_ACTION", "Every learned speech match must identify an alias and product.");
      }
      state.current.speechAliases = sanitizeSpeechAliases([
        ...state.current.speechAliases,
        ...normalized,
      ]);
      return markCurrentUpdated(state, role, now);
    }
    case "clear-speech-aliases":
      requireInitialized(state);
      state.current.speechAliases = [];
      return markCurrentUpdated(state, role, now);
    case "reorder-items":
      requireInitialized(state);
      state.current.itemOrder = sanitizeItemOrder(payload.itemOrder);
      return markCurrentUpdated(state, role, now);
    case "delete-custom": {
      requireInitialized(state);
      const normalizedId = cleanId(payload.id);
      if (!normalizedId) {
        throw inventoryError("INVALID_INVENTORY_ACTION", "A valid inventory item is required.");
      }
      state.current.customItems = state.current.customItems
        .filter((item) => item.id !== normalizedId);
      state.current.itemOrder = state.current.itemOrder
        .filter((itemId) => itemId !== normalizedId);
      delete state.current.onHandOverrides[normalizedId];
      delete state.current.parOverrides[normalizedId];
      clearInventoryContributionsForItem(state, normalizedId);
      return markCurrentUpdated(state, role, now);
    }
    case "save-snapshot": {
      requireInitialized(state);
      const reliableCapture = payload.reliableCapture === true;
      if (reliableCapture) validateReliableCapture(payload, now);
      const savedAt = now.toISOString();
      const weekOf = reliableCapture && isEasternMonday(now) ? getEasternDate(now) : getMondayDate(now);
      const existingSnapshot = state.snapshots.find((entry) => entry.weekOf === weekOf);
      if (reliableCapture && existingSnapshot && payload.replaceExisting !== true) return state;
      const snapshot = sanitizeSnapshot({
        id: `inventory-${weekOf}`,
        weekOf,
        savedAt,
        savedByRole: role,
        unitModelVersion: 2,
        summary: payload.summary,
        kegPlanSnapshot: payload.kegPlanSnapshot,
        captureMetadata: payload.captureMetadata,
        items: payload.items,
      });
      if (!snapshot) {
        throw inventoryError(
          "INVALID_INVENTORY_ACTION",
          "The inventory snapshot has no valid items.",
        );
      }
      if (!snapshot.summary
        || snapshot.summary.tapCount < 1
        || snapshot.summary.liveTapCount !== snapshot.summary.tapCount) {
        throw inventoryError(
          "INCOMPLETE_PMB_TAP_COVERAGE",
          "Complete PMB tap coverage is required for a Monday inventory snapshot.",
        );
      }
      state.snapshots = [
        snapshot,
        ...state.snapshots.filter((entry) => entry.weekOf !== weekOf),
      ].slice(0, MAX_SNAPSHOTS);
      state.current.onHandOverrides = {};
      state.current.inventoryContributions = {};
      return markCurrentUpdated(state, role, now);
    }
    case "delete-snapshot":
      requireInitialized(state);
      state.snapshots = state.snapshots
        .filter((snapshot) => snapshot.id !== clean(payload.id, 100));
      return markCurrentUpdated(state, role, now);
    case "restore-snapshot": {
      requireInitialized(state);
      const snapshot = state.snapshots.find((entry) => entry.id === clean(payload.id, 100));
      if (!snapshot) {
        throw inventoryError("INVENTORY_SNAPSHOT_NOT_FOUND", "Inventory snapshot not found.", 404);
      }

      const onHandOverrides = {};
      const parOverrides = {};
      snapshot.items.forEach((item) => {
        const itemId = cleanId(item.id || item.name.toLowerCase()
          .replace(/&/g, "and")
          .replace(/['’]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""));
        if (itemId && item.onHandDisplay !== "") onHandOverrides[itemId] = item.onHandDisplay;
        if (itemId && item.parDisplay !== "") parOverrides[itemId] = item.parDisplay;
      });
      state.current.onHandOverrides = onHandOverrides;
      state.current.parOverrides = parOverrides;
      state.current.inventoryContributions = {};
      return markCurrentUpdated(state, role, now);
    }
    default:
      throw inventoryError("UNKNOWN_INVENTORY_ACTION", "Unknown inventory action.");
  }
}

export function hydrateInventoryState(payload = {}, role = "owner") {
  return queueUpdate((state) => (
    state.initialized
      ? state
      : applyInventoryStateAction(state, "initialize", payload, role)
  ));
}

export function updateInventoryField(payload, role = "owner") {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "update-field", payload, role)
  ));
}

export function upsertCustomInventoryItem(item, role = "owner") {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "upsert-custom", { item }, role)
  ));
}

export function reorderInventoryItems(itemOrder, role = "owner") {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "reorder-items", { itemOrder }, role)
  ));
}

export function deleteCustomInventoryItemState(id, role = "owner") {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "delete-custom", { id }, role)
  ));
}

export function saveInventorySnapshot(items, role = "owner", now = new Date(), summary = null, kegPlanSnapshot = null, capture = {}) {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "save-snapshot", {
      items,
      summary,
      kegPlanSnapshot,
      reliableCapture: capture.reliableCapture === true,
      captureMetadata: capture.captureMetadata,
    }, role, now)
  ));
}

export function deleteInventorySnapshotState(id, role = "owner") {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "delete-snapshot", { id }, role)
  ));
}

export function restoreInventorySnapshotState(id, role = "owner") {
  return queueUpdate((state) => (
    applyInventoryStateAction(state, "restore-snapshot", { id }, role)
  ));
}
