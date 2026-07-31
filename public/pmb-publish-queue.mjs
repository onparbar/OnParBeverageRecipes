const QUEUE_STATUSES = new Set(["ready", "failed", "published"]);
const PRODUCT_KINDS = new Set(["beer", "liquor"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeKind(value) {
  const kind = clean(value).toLowerCase();
  return PRODUCT_KINDS.has(kind) ? kind : "";
}

function normalizeStatus(value) {
  const status = clean(value).toLowerCase();
  return QUEUE_STATUSES.has(status) ? status : "ready";
}

function createQueueId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `pmb-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePublishedProduct(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const plu = Number(value.plu);
  const name = clean(value.name);
  if ((!Number.isFinite(plu) || plu <= 0) && !name) return null;
  return {
    ...(Number.isFinite(plu) && plu > 0 ? { plu } : {}),
    ...(name ? { name } : {}),
  };
}

export function normalizePmbPublishQueueItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!value.payload || typeof value.payload !== "object" || Array.isArray(value.payload)) return null;

  const kind = normalizeKind(value.kind || value.payload.productKind);
  const name = clean(value.name || value.payload.name);
  const id = clean(value.id);
  if (!id || !kind || !name) return null;

  const status = normalizeStatus(value.status);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt) || createdAt;
  const publishedAt = status === "published" ? normalizeTimestamp(value.publishedAt) : "";
  const attempts = Math.max(0, Math.floor(Number(value.attempts) || 0));
  const payload = cloneJson({
    ...value.payload,
    productKind: kind,
    name,
  });

  return {
    id,
    kind,
    name,
    status,
    payload,
    createdAt,
    updatedAt,
    attempts,
    lastAttemptAt: normalizeTimestamp(value.lastAttemptAt),
    lastError: status === "failed" ? clean(value.lastError).slice(0, 500) : "",
    publishedAt,
    publishedProduct: status === "published"
      ? normalizePublishedProduct(value.publishedProduct)
      : null,
  };
}

export function normalizePmbPublishQueue(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value
    .map(normalizePmbPublishQueueItem)
    .filter((item) => {
      if (!item || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

export function enqueuePmbPublishItem(queue, payload, {
  id = createQueueId(),
  now = new Date().toISOString(),
} = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("A PMB product payload is required.");
  }

  const kind = normalizeKind(payload.productKind);
  const name = clean(payload.name);
  if (!kind || !name) {
    throw new Error("A beer or liquor product with a name is required.");
  }

  const timestamp = normalizeTimestamp(now);
  if (!timestamp) throw new Error("A valid queue timestamp is required.");

  const normalizedQueue = normalizePmbPublishQueue(queue);
  const identity = `${kind}:${name.toLowerCase()}`;
  const existingIndex = normalizedQueue.findIndex((item) => (
    item.status !== "published"
    && `${item.kind}:${item.name.toLowerCase()}` === identity
  ));
  const existing = existingIndex >= 0 ? normalizedQueue[existingIndex] : null;
  const item = normalizePmbPublishQueueItem({
    id: existing?.id || id,
    kind,
    name,
    status: "ready",
    payload: cloneJson({ ...payload, productKind: kind, name }),
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp,
    attempts: existing?.attempts || 0,
    lastAttemptAt: existing?.lastAttemptAt || "",
    lastError: "",
    publishedAt: "",
    publishedProduct: null,
  });

  if (!item) throw new Error("The PMB queue item could not be created.");
  if (existingIndex >= 0) {
    normalizedQueue[existingIndex] = item;
  } else {
    normalizedQueue.push(item);
  }
  return { queue: normalizedQueue, item, replaced: existingIndex >= 0 };
}

export function markPmbPublishFailed(queue, id, error, {
  now = new Date().toISOString(),
} = {}) {
  const timestamp = normalizeTimestamp(now);
  const targetId = clean(id);
  return normalizePmbPublishQueue(queue).map((item) => (
    item.id === targetId
      ? normalizePmbPublishQueueItem({
          ...item,
          status: "failed",
          updatedAt: timestamp,
          attempts: item.attempts + 1,
          lastAttemptAt: timestamp,
          lastError: clean(error || "Pour My Beer publish failed."),
          publishedAt: "",
          publishedProduct: null,
        })
      : item
  ));
}

export function markPmbPublished(queue, id, product, {
  now = new Date().toISOString(),
} = {}) {
  const timestamp = normalizeTimestamp(now);
  const targetId = clean(id);
  return normalizePmbPublishQueue(queue).map((item) => (
    item.id === targetId
      ? normalizePmbPublishQueueItem({
          ...item,
          status: "published",
          updatedAt: timestamp,
          attempts: item.attempts + 1,
          lastAttemptAt: timestamp,
          lastError: "",
          publishedAt: timestamp,
          publishedProduct: product,
        })
      : item
  ));
}

export function removePmbPublishItem(queue, id) {
  const targetId = clean(id);
  return normalizePmbPublishQueue(queue).filter((item) => item.id !== targetId);
}

export function getPmbPublishQueueCounts(queue) {
  return normalizePmbPublishQueue(queue).reduce(
    (counts, item) => {
      counts.total += 1;
      counts[item.status] += 1;
      return counts;
    },
    { total: 0, ready: 0, failed: 0, published: 0 },
  );
}
