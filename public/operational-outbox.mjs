function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function normalizeClientOrder(value) {
  const order = Number(value);
  return Number.isSafeInteger(order) && order >= 0 ? order : null;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildOperationalRecovery({
  message = "",
  conflict = false,
} = {}) {
  const source = clean(message);
  if (!source && !conflict) {
    return { kind: "none", message: "", action: "" };
  }
  if (
    conflict
    || /\brevision\b/i.test(source)
    || /\bchanged after\b/i.test(source)
    || /\bnewer saved\b/i.test(source)
    || /\bold baseline\b/i.test(source)
  ) {
    return {
      kind: "reload-latest",
      message: "Newer saved data is available. Your unsaved changes are still here.",
      action: "Reload latest and retry",
    };
  }
  if (/\bstill saving\b/i.test(source) || /\bchanges are saving\b/i.test(source)) {
    return {
      kind: "wait-retry",
      message: "Your latest changes are still saving.",
      action: "Wait a moment and retry",
    };
  }
  if (/\b(fetch failed|network|offline|ehostunreach|timed? out|connection)\b/i.test(source)) {
    return {
      kind: "connection",
      message: "The connection was interrupted. Your unsaved changes are still here.",
      action: "Retry",
    };
  }
  return {
    kind: "retry",
    message: source || "This could not be saved yet. Your unsaved changes are still here.",
    action: "Retry",
  };
}

export function createOperationalOutboxEntry({
  baseRevision,
  payload,
  id = "",
  updatedAt = new Date().toISOString(),
  clientOrder = Date.now(),
} = {}) {
  const revision = normalizeRevision(baseRevision);
  const order = normalizeClientOrder(clientOrder);
  if (revision === null || !payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return {
    version: 1,
    id: clean(id) || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    baseRevision: revision,
    payload: cloneJson(payload),
    updatedAt: clean(updatedAt),
    clientOrder: order ?? Date.now(),
    conflict: false,
    currentRevision: null,
    lastError: "",
  };
}

export function normalizeOperationalOutboxEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entry = createOperationalOutboxEntry({
    baseRevision: value.baseRevision,
    payload: value.payload,
    id: value.id,
    updatedAt: value.updatedAt,
    clientOrder: value.clientOrder,
  });
  if (!entry) return null;
  const currentRevision = normalizeRevision(value.currentRevision);
  const recovery = buildOperationalRecovery({
    message: value.lastError,
    conflict: value.conflict === true,
  });
  return {
    ...entry,
    conflict: value.conflict === true,
    currentRevision,
    lastError: recovery.message,
    recovery,
  };
}

export function canSafelyRetryOperationalOutbox(entry, currentRevision) {
  const normalized = normalizeOperationalOutboxEntry(entry);
  const revision = normalizeRevision(currentRevision);
  return Boolean(normalized && revision !== null && normalized.baseRevision === revision);
}

export function markOperationalOutboxFailure(entry, {
  message = "",
  currentRevision = null,
  conflict = false,
} = {}) {
  const normalized = normalizeOperationalOutboxEntry(entry);
  if (!normalized) return null;
  const revision = normalizeRevision(currentRevision);
  const recovery = buildOperationalRecovery({ message, conflict });
  return {
    ...normalized,
    conflict: conflict === true,
    currentRevision: revision,
    lastError: recovery.message,
    recovery,
  };
}

export function rebaseOperationalOutboxAfterOwnCommit(entry, {
  committedBaseRevision,
  nextRevision,
} = {}) {
  const normalized = normalizeOperationalOutboxEntry(entry);
  const committedBase = normalizeRevision(committedBaseRevision);
  const next = normalizeRevision(nextRevision);
  if (!normalized || committedBase === null || next === null) return normalized;
  if (normalized.baseRevision !== committedBase) return normalized;
  return {
    ...normalized,
    baseRevision: next,
    conflict: false,
    currentRevision: null,
    lastError: "",
  };
}

export function normalizeOperationalOutboxMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [clean(key), normalizeOperationalOutboxEntry(entry)])
      .filter(([key, entry]) => key && entry),
  );
}

export function normalizeOperationalOutboxList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeOperationalOutboxEntry)
    .filter(Boolean)
    .sort((left, right) => (
      left.clientOrder - right.clientOrder
      || left.updatedAt.localeCompare(right.updatedAt)
      || left.id.localeCompare(right.id)
    ));
}
