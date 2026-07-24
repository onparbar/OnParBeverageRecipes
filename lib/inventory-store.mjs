import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_SNAPSHOTS = 104;
const MAX_ITEMS = 500;
const MAX_TEXT_LENGTH = 160;

let updateQueue = Promise.resolve();

function getStatePath() {
  if (process.env.INVENTORY_STATE_PATH) return process.env.INVENTORY_STATE_PATH;
  const dataDir = process.env.INVENTORY_STATE_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "inventory-state.json");
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
    updatedAt: clean(item?.updatedAt, 40) || new Date().toISOString(),
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

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const items = Array.isArray(snapshot.items)
    ? snapshot.items.slice(0, MAX_ITEMS).map(sanitizeSnapshotItem).filter(Boolean)
    : [];
  if (!items.length) return null;

  const savedAt = clean(snapshot.savedAt, 40) || new Date().toISOString();
  return {
    id: clean(snapshot.id, 100) || `inventory-${Date.now()}`,
    weekOf: clean(snapshot.weekOf, 10) || getMondayDate(savedAt),
    savedAt,
    savedByRole: clean(snapshot.savedByRole, 30) || "owner",
    unitModelVersion: Math.max(1, Math.round(finiteNumber(snapshot.unitModelVersion, 2))),
    items,
  };
}

function emptyState() {
  return {
    version: 1,
    revision: 0,
    initialized: false,
    initializedAt: "",
    current: {
      onHandOverrides: {},
      parOverrides: {},
      customItems: [],
      updatedAt: "",
      updatedByRole: "",
    },
    snapshots: [],
  };
}

function normalizeState(value) {
  const base = emptyState();
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
    return normalizeState(JSON.parse(await readFile(getStatePath(), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

async function writeInventoryState(state) {
  const statePath = getStatePath();
  await mkdir(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, statePath);
  return state;
}

function queueUpdate(update) {
  const operation = updateQueue.then(async () => {
    const current = await readInventoryState();
    const next = normalizeState(await update(current));
    next.revision = current.revision + 1;
    return writeInventoryState(next);
  });
  updateQueue = operation.catch(() => {});
  return operation;
}

function markCurrentUpdated(state, role) {
  const now = new Date().toISOString();
  state.initialized = true;
  state.initializedAt ||= now;
  state.current.updatedAt = now;
  state.current.updatedByRole = clean(role, 30) || "owner";
  return state;
}

export function hydrateInventoryState(payload = {}, role = "owner") {
  return queueUpdate((state) => {
    if (state.initialized) return state;
    state.current.onHandOverrides = sanitizeOverrideMap(payload.onHandOverrides);
    state.current.parOverrides = sanitizeOverrideMap(payload.parOverrides);
    state.current.customItems = sanitizeCustomItems(payload.customItems);
    state.snapshots = Array.isArray(payload.snapshots)
      ? payload.snapshots.map(sanitizeSnapshot).filter(Boolean).slice(0, MAX_SNAPSHOTS)
      : [];
    return markCurrentUpdated(state, role);
  });
}

export function updateInventoryField({ id, field, value }, role = "owner") {
  return queueUpdate((state) => {
    const normalizedId = cleanId(id);
    const target = field === "par" ? state.current.parOverrides : state.current.onHandOverrides;
    if (!normalizedId || !["onHand", "par"].includes(field)) {
      throw new Error("Invalid inventory field update.");
    }
    const normalizedValue = clean(value, 24);
    if (normalizedValue === "") delete target[normalizedId];
    else target[normalizedId] = normalizedValue;
    return markCurrentUpdated(state, role);
  });
}

export function upsertCustomInventoryItem(item, role = "owner") {
  return queueUpdate((state) => {
    const normalized = sanitizeCustomItem(item);
    if (!normalized) throw new Error("A valid custom inventory item is required.");
    state.current.customItems = [
      ...state.current.customItems.filter((entry) => entry.id !== normalized.id),
      normalized,
    ];
    return markCurrentUpdated(state, role);
  });
}

export function deleteCustomInventoryItemState(id, role = "owner") {
  return queueUpdate((state) => {
    const normalizedId = cleanId(id);
    if (!normalizedId) throw new Error("A valid inventory item is required.");
    state.current.customItems = state.current.customItems.filter((item) => item.id !== normalizedId);
    delete state.current.onHandOverrides[normalizedId];
    delete state.current.parOverrides[normalizedId];
    return markCurrentUpdated(state, role);
  });
}

export function saveInventorySnapshot(items, role = "owner", now = new Date()) {
  return queueUpdate((state) => {
    const savedAt = now.toISOString();
    const weekOf = getMondayDate(now);
    const snapshot = sanitizeSnapshot({
      id: `inventory-${weekOf}`,
      weekOf,
      savedAt,
      savedByRole: role,
      unitModelVersion: 2,
      items,
    });
    if (!snapshot) throw new Error("The inventory snapshot has no valid items.");
    state.snapshots = [
      snapshot,
      ...state.snapshots.filter((entry) => entry.weekOf !== weekOf),
    ].slice(0, MAX_SNAPSHOTS);
    return markCurrentUpdated(state, role);
  });
}

export function deleteInventorySnapshotState(id, role = "owner") {
  return queueUpdate((state) => {
    state.snapshots = state.snapshots.filter((snapshot) => snapshot.id !== clean(id, 100));
    return markCurrentUpdated(state, role);
  });
}

export function restoreInventorySnapshotState(id, role = "owner") {
  return queueUpdate((state) => {
    const snapshot = state.snapshots.find((entry) => entry.id === clean(id, 100));
    if (!snapshot) throw new Error("Inventory snapshot not found.");

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
    return markCurrentUpdated(state, role);
  });
}
