const TABLE = "weekly_usage_shared_state";
const STATE_ID = "weekly-usage";
const MAX_STATE_BYTES = 4_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const DATA_FIELDS = Object.freeze({
  activeItems: "array",
  archivedItems: "array",
  currentOverrides: "object",
  historyOverrides: "object",
  lastSyncAt: "string",
});

function getRequestTimeoutMs(env) {
  const configured = Number(env.SUPABASE_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(25, Math.min(30_000, Math.round(configured)));
}

export class WeeklyUsageStateError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = "WeeklyUsageStateError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function stateError(code, message, status = 500, details = {}) {
  return new WeeklyUsageStateError(code, message, status, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value, label) {
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw stateError("INVALID_WEEKLY_USAGE_STATE", `${label} must contain valid JSON data.`, 400);
  }
  if (serialized === undefined) {
    throw stateError("INVALID_WEEKLY_USAGE_STATE", `${label} must contain valid JSON data.`, 400);
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
    throw stateError(
      "WEEKLY_USAGE_STATE_TOO_LARGE",
      `Shared Weekly Usage cannot exceed ${MAX_STATE_BYTES} bytes.`,
      413,
    );
  }
  return JSON.parse(serialized);
}

export function createEmptyWeeklyUsageData() {
  return {
    activeItems: [],
    archivedItems: [],
    currentOverrides: {},
    historyOverrides: {},
    lastSyncAt: "",
  };
}

function normalizeData(value, { requireEveryField = false } = {}) {
  if (!isPlainObject(value)) {
    throw stateError("INVALID_WEEKLY_USAGE_STATE", "Shared Weekly Usage data must be an object.", 400);
  }
  const unknown = Object.keys(value).filter((key) => !Object.hasOwn(DATA_FIELDS, key));
  if (unknown.length) {
    throw stateError(
      "INVALID_WEEKLY_USAGE_STATE",
      `Shared Weekly Usage data contains unknown fields: ${unknown.join(", ")}.`,
      400,
    );
  }

  const result = createEmptyWeeklyUsageData();
  for (const [field, shape] of Object.entries(DATA_FIELDS)) {
    if (requireEveryField && !Object.hasOwn(value, field)) {
      throw stateError("INVALID_WEEKLY_USAGE_STATE", `Shared Weekly Usage data.${field} is required.`, 400);
    }
    if (!Object.hasOwn(value, field)) continue;
    const fieldValue = value[field];
    const valid = (
      (shape === "array" && Array.isArray(fieldValue))
      || (shape === "object" && isPlainObject(fieldValue))
      || (shape === "string" && typeof fieldValue === "string")
    );
    if (!valid) {
      throw stateError("INVALID_WEEKLY_USAGE_STATE", `Shared Weekly Usage data.${field} is invalid.`, 400);
    }
    result[field] = cloneJson(fieldValue, `Shared Weekly Usage data.${field}`);
  }
  return cloneJson(result, "Shared Weekly Usage data");
}

function normalizeRevision(value, { initialization = false } = {}) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw stateError("INVALID_WEEKLY_USAGE_REVISION", "expectedRevision must be a non-negative integer.", 400);
  }
  if (initialization && revision !== 0) {
    throw stateError("INVALID_WEEKLY_USAGE_REVISION", "Weekly Usage initialization requires expectedRevision 0.", 400);
  }
  return revision;
}

function normalizeTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function normalizeRole(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 30);
}

function normalizeRow(row) {
  if (!isPlainObject(row)) {
    throw stateError("WEEKLY_USAGE_STATE_INVALID_RESPONSE", "Shared Weekly Usage returned an invalid response.", 503);
  }
  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw stateError("WEEKLY_USAGE_STATE_INVALID_RESPONSE", "Shared Weekly Usage returned an invalid revision.", 503);
  }
  const initialized = row.initialized === true;
  let data;
  try {
    data = normalizeData(row.data || {}, { requireEveryField: initialized });
  } catch (error) {
    if (error instanceof WeeklyUsageStateError) {
      throw stateError("WEEKLY_USAGE_STATE_INVALID_RESPONSE", "Shared Weekly Usage contains invalid data.", 503);
    }
    throw error;
  }
  return {
    version: 1,
    id: STATE_ID,
    revision,
    initialized,
    initializedAt: normalizeTimestamp(row.initialized_at),
    updatedAt: normalizeTimestamp(row.updated_at),
    updatedByRole: normalizeRole(row.updated_by_role),
    data,
  };
}

function getConfiguration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!baseUrl || !secret) {
    throw stateError("WEEKLY_USAGE_STATE_UNAVAILABLE", "Shared Weekly Usage storage is not configured.", 503);
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw stateError("WEEKLY_USAGE_STATE_UNAVAILABLE", "Shared Weekly Usage storage is not configured correctly.", 503);
  }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  const allowInsecureLoopback = String(env.SUPABASE_ALLOW_INSECURE_LOCALHOST || "").trim().toLowerCase() === "true" && loopback;
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && allowInsecureLoopback)) {
    throw stateError("WEEKLY_USAGE_STATE_UNAVAILABLE", "Shared Weekly Usage storage is not configured correctly.", 503);
  }
  return { baseUrl, secret };
}

function getHeaders(secret, method) {
  const headers = { Accept: "application/json", apikey: secret };
  if (secret.split(".").length === 3) headers.Authorization = `Bearer ${secret}`;
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=representation";
  }
  return headers;
}

function getRequestUrl(configuration, filters = {}) {
  const url = new URL(`${configuration.baseUrl}/rest/v1/${TABLE}`);
  url.searchParams.set("select", "id,revision,initialized,data,initialized_at,updated_at,updated_by_role");
  url.searchParams.set("id", `eq.${STATE_ID}`);
  Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, `eq.${value}`));
  return url;
}

function providerFailureStatus(status, body) {
  const code = String(body?.code || "");
  return [400, 401, 403, 404].includes(status) || ["42P01", "42501", "PGRST205"].includes(code)
    ? 503
    : 502;
}

async function parseProviderResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // The unavailable error below is safer than treating malformed data as state.
  }
  if (!response.ok) {
    throw stateError(
      "WEEKLY_USAGE_STATE_UNAVAILABLE",
      "Shared Weekly Usage storage is unavailable.",
      providerFailureStatus(response.status, body),
    );
  }
  if (!Array.isArray(body)) {
    throw stateError("WEEKLY_USAGE_STATE_INVALID_RESPONSE", "Shared Weekly Usage returned an invalid response.", 503);
  }
  return body;
}

export function createSharedWeeklyUsageStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  async function request(method, filters = {}, body) {
    const configuration = getConfiguration(env);
    if (typeof fetchImpl !== "function") {
      throw stateError("WEEKLY_USAGE_STATE_UNAVAILABLE", "Shared Weekly Usage storage is unavailable.", 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs(env));
    try {
      const response = await fetchImpl(getRequestUrl(configuration, filters), {
        method,
        headers: getHeaders(configuration.secret, method),
        cache: "no-store",
        signal: controller.signal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return await parseProviderResponse(response);
    } catch (error) {
      if (error instanceof WeeklyUsageStateError) throw error;
      throw stateError("WEEKLY_USAGE_STATE_UNAVAILABLE", "Shared Weekly Usage storage is unavailable.", 503);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function read() {
    const rows = await request("GET");
    const row = rows.find((entry) => entry?.id === STATE_ID);
    if (!row) {
      throw stateError("WEEKLY_USAGE_STATE_ROW_MISSING", "Shared Weekly Usage storage has not been provisioned.", 503);
    }
    return normalizeRow(row);
  }

  async function explainCasMiss(expectedRevision, expectedInitialized) {
    const current = await read();
    if (expectedInitialized === false && current.initialized) {
      throw stateError("WEEKLY_USAGE_STATE_ALREADY_INITIALIZED", "Shared Weekly Usage has already been initialized.", 409, { currentRevision: current.revision });
    }
    if (expectedInitialized === true && !current.initialized) {
      throw stateError("WEEKLY_USAGE_STATE_NOT_INITIALIZED", "Shared Weekly Usage must be imported from the service computer before it can be updated.", 409, { currentRevision: current.revision });
    }
    throw stateError("WEEKLY_USAGE_STATE_REVISION_CONFLICT", "Shared Weekly Usage changed in another session. Reload before saving again.", 409, { expectedRevision, currentRevision: current.revision });
  }

  async function compareAndSwap(expectedRevision, expectedInitialized, changes) {
    const rows = await request("PATCH", { revision: expectedRevision, initialized: expectedInitialized }, changes);
    const row = rows.find((entry) => entry?.id === STATE_ID);
    if (!row) return explainCasMiss(expectedRevision, expectedInitialized);
    return normalizeRow(row);
  }

  async function initialize({ expectedRevision, data }, role = "owner") {
    const revision = normalizeRevision(expectedRevision, { initialization: true });
    const current = await read();
    if (current.initialized) {
      throw stateError("WEEKLY_USAGE_STATE_ALREADY_INITIALIZED", "Shared Weekly Usage has already been initialized.", 409, { currentRevision: current.revision });
    }
    if (current.revision !== revision) {
      throw stateError("WEEKLY_USAGE_STATE_REVISION_CONFLICT", "Shared Weekly Usage changed before initialization. Reload and review it again.", 409, { expectedRevision: revision, currentRevision: current.revision });
    }
    const normalizedData = normalizeData(data, { requireEveryField: true });
    const timestamp = now().toISOString();
    return compareAndSwap(revision, false, {
      revision: revision + 1,
      initialized: true,
      data: normalizedData,
      initialized_at: timestamp,
      updated_at: timestamp,
      updated_by_role: normalizeRole(role) || "owner",
    });
  }

  async function replace({ expectedRevision, data }, role = "owner") {
    const revision = normalizeRevision(expectedRevision);
    const current = await read();
    if (!current.initialized) {
      throw stateError("WEEKLY_USAGE_STATE_NOT_INITIALIZED", "Shared Weekly Usage must be imported from the service computer before it can be updated.", 409, { currentRevision: current.revision });
    }
    if (current.revision !== revision) {
      throw stateError("WEEKLY_USAGE_STATE_REVISION_CONFLICT", "Shared Weekly Usage changed in another session. Reload before saving again.", 409, { expectedRevision: revision, currentRevision: current.revision });
    }
    const normalizedData = normalizeData(data, { requireEveryField: true });
    return compareAndSwap(revision, true, {
      revision: revision + 1,
      data: normalizedData,
      updated_at: now().toISOString(),
      updated_by_role: normalizeRole(role) || "owner",
    });
  }

  return Object.freeze({ read, initialize, replace });
}

export function readSharedWeeklyUsageState() {
  return createSharedWeeklyUsageStore().read();
}

export function initializeSharedWeeklyUsageState(payload, role = "owner") {
  return createSharedWeeklyUsageStore().initialize(payload, role);
}

export function replaceSharedWeeklyUsageState(payload, role = "owner") {
  return createSharedWeeklyUsageStore().replace(payload, role);
}
