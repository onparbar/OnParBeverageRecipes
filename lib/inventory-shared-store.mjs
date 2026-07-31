import {
  InventoryStateError,
  applyInventoryStateAction,
  createEmptyInventoryState,
  normalizeInventoryState,
} from "./inventory-store.mjs";

const TABLE = "inventory_shared_state";
const STATE_ID = "inventory-state";
const MAX_STATE_BYTES = 2_000_000;
const MAX_WRITE_ATTEMPTS = 4;

function inventoryError(code, message, status = 500, details = {}) {
  return new InventoryStateError(code, message, status, details);
}

function normalizeRevision(value, { initialization = false } = {}) {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw inventoryError(
      "INVALID_INVENTORY_STATE_REVISION",
      "expectedRevision must be a non-negative integer.",
      400,
    );
  }
  if (initialization && revision !== 0) {
    throw inventoryError(
      "INVALID_INVENTORY_STATE_REVISION",
      "Shared inventory initialization requires expectedRevision 0.",
      400,
    );
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
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw inventoryError(
      "INVENTORY_STATE_INVALID_RESPONSE",
      "Shared inventory storage returned an invalid response.",
      503,
    );
  }

  const revision = Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw inventoryError(
      "INVENTORY_STATE_INVALID_RESPONSE",
      "Shared inventory storage returned an invalid revision.",
      503,
    );
  }

  const initialized = row.initialized === true;
  const state = normalizeInventoryState({
    ...(row.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {}),
    revision,
    initialized,
    initializedAt: row.initialized_at,
  });
  state.initializedAt = normalizeTimestamp(row.initialized_at);
  state.current.updatedAt = normalizeTimestamp(row.updated_at);
  state.current.updatedByRole = normalizeRole(row.updated_by_role);
  return state;
}

function getConfiguration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(
    env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
  ).trim();

  if (!baseUrl || !secret) {
    throw inventoryError(
      "INVENTORY_STATE_UNAVAILABLE",
      "Shared inventory storage is not configured.",
      503,
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw inventoryError(
      "INVENTORY_STATE_UNAVAILABLE",
      "Shared inventory storage is not configured correctly.",
      503,
    );
  }

  const isLoopback = ["localhost", "127.0.0.1", "::1"].includes(parsedUrl.hostname);
  const allowInsecureLoopback = (
    String(env.SUPABASE_ALLOW_INSECURE_LOCALHOST || "").trim().toLowerCase() === "true"
    && isLoopback
  );
  if (parsedUrl.protocol !== "https:" && !(parsedUrl.protocol === "http:" && allowInsecureLoopback)) {
    throw inventoryError(
      "INVENTORY_STATE_UNAVAILABLE",
      "Shared inventory storage is not configured correctly.",
      503,
    );
  }

  return { baseUrl, secret };
}

function getHeaders(secret, method) {
  const headers = {
    Accept: "application/json",
    apikey: secret,
  };
  if (secret.split(".").length === 3) {
    headers.Authorization = `Bearer ${secret}`;
  }
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers.Prefer = "return=representation";
  }
  return headers;
}

function getRequestUrl(configuration, filters = {}) {
  const requestUrl = new URL(
    `${configuration.baseUrl}/rest/v1/${encodeURIComponent(TABLE)}`,
  );
  requestUrl.searchParams.set(
    "select",
    "id,revision,initialized,data,initialized_at,updated_at,updated_by_role",
  );
  requestUrl.searchParams.set("id", `eq.${STATE_ID}`);
  Object.entries(filters).forEach(([key, value]) => {
    requestUrl.searchParams.set(key, `eq.${value}`);
  });
  return requestUrl;
}

function providerFailureStatus(responseStatus, body) {
  const providerCode = String(body?.code || "");
  if (
    [400, 401, 403, 404].includes(responseStatus)
    || ["42P01", "42501", "PGRST205"].includes(providerCode)
  ) {
    return 503;
  }
  return 502;
}

async function parseProviderResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // Invalid provider responses are reported as unavailable below.
  }

  if (!response.ok) {
    throw inventoryError(
      "INVENTORY_STATE_UNAVAILABLE",
      "Shared inventory storage is unavailable.",
      providerFailureStatus(response.status, body),
    );
  }
  if (!Array.isArray(body)) {
    throw inventoryError(
      "INVENTORY_STATE_INVALID_RESPONSE",
      "Shared inventory storage returned an invalid response.",
      503,
    );
  }
  return body;
}

function getStoredData(state) {
  const data = {
    current: state.current,
    snapshots: state.snapshots,
  };
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
    throw inventoryError(
      "INVENTORY_STATE_TOO_LARGE",
      `Shared inventory cannot exceed ${MAX_STATE_BYTES} bytes.`,
      413,
    );
  }
  return data;
}

export function createSharedInventoryStore({
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date(),
} = {}) {
  async function request(method, filters = {}, body) {
    const configuration = getConfiguration(env);
    if (typeof fetchImpl !== "function") {
      throw inventoryError(
        "INVENTORY_STATE_UNAVAILABLE",
        "Shared inventory storage is unavailable.",
        503,
      );
    }

    let response;
    try {
      response = await fetchImpl(getRequestUrl(configuration, filters), {
        method,
        headers: getHeaders(configuration.secret, method),
        cache: "no-store",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw inventoryError(
        "INVENTORY_STATE_UNAVAILABLE",
        "Shared inventory storage is unavailable.",
        503,
      );
    }
    return parseProviderResponse(response);
  }

  async function read() {
    const rows = await request("GET");
    const row = rows.find((entry) => entry?.id === STATE_ID);
    if (!row) {
      throw inventoryError(
        "INVENTORY_STATE_ROW_MISSING",
        "Shared inventory storage has not been provisioned.",
        503,
      );
    }
    return normalizeRow(row);
  }

  async function explainCasMiss(expectedRevision, expectedInitialized) {
    const current = await read();
    if (expectedInitialized === false && current.initialized) {
      throw inventoryError(
        "INVENTORY_STATE_ALREADY_INITIALIZED",
        "Shared inventory has already been initialized.",
        409,
        { currentRevision: current.revision },
      );
    }
    if (expectedInitialized === true && !current.initialized) {
      throw inventoryError(
        "INVENTORY_STATE_NOT_INITIALIZED",
        "Shared inventory must be imported from the service computer before it can be updated.",
        409,
        { currentRevision: current.revision },
      );
    }
    throw inventoryError(
      "INVENTORY_STATE_REVISION_CONFLICT",
      "Shared inventory changed in another session.",
      409,
      { expectedRevision, currentRevision: current.revision },
    );
  }

  async function compareAndSwap(expectedRevision, expectedInitialized, changes) {
    const rows = await request(
      "PATCH",
      { revision: expectedRevision, initialized: expectedInitialized },
      changes,
    );
    const row = rows.find((entry) => entry?.id === STATE_ID);
    if (!row) return explainCasMiss(expectedRevision, expectedInitialized);
    return normalizeRow(row);
  }

  async function initialize({ expectedRevision, data = {} }, role = "owner") {
    const revision = normalizeRevision(expectedRevision, { initialization: true });
    const current = await read();
    if (current.initialized) {
      throw inventoryError(
        "INVENTORY_STATE_ALREADY_INITIALIZED",
        "Shared inventory has already been initialized.",
        409,
        { currentRevision: current.revision },
      );
    }
    if (current.revision !== revision) {
      throw inventoryError(
        "INVENTORY_STATE_REVISION_CONFLICT",
        "Shared inventory changed before initialization. Reload and review it again.",
        409,
        { expectedRevision: revision, currentRevision: current.revision },
      );
    }

    const timestamp = now();
    const next = applyInventoryStateAction(current, "initialize", data, role, timestamp);
    return compareAndSwap(revision, false, {
      revision: revision + 1,
      initialized: true,
      data: getStoredData(next),
      initialized_at: timestamp.toISOString(),
      updated_at: timestamp.toISOString(),
      updated_by_role: normalizeRole(role) || "owner",
    });
  }

  async function mutate(action, payload = {}, role = "owner") {
    let lastConflict = null;
    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const current = await read();
      const timestamp = now();
      const next = applyInventoryStateAction(current, action, payload, role, timestamp);
      try {
        return await compareAndSwap(current.revision, true, {
          revision: current.revision + 1,
          data: getStoredData(next),
          updated_at: timestamp.toISOString(),
          updated_by_role: normalizeRole(role) || "owner",
        });
      } catch (error) {
        if (error?.code !== "INVENTORY_STATE_REVISION_CONFLICT") throw error;
        lastConflict = error;
      }
    }
    throw lastConflict || inventoryError(
      "INVENTORY_STATE_REVISION_CONFLICT",
      "Shared inventory is busy. Please try the change again.",
      409,
    );
  }

  return Object.freeze({ read, initialize, mutate });
}

export function readSharedInventoryState() {
  return createSharedInventoryStore().read();
}

export function initializeSharedInventoryState(payload, role = "owner") {
  return createSharedInventoryStore().initialize(payload, role);
}

export function mutateSharedInventoryState(action, payload, role = "owner") {
  return createSharedInventoryStore().mutate(action, payload, role);
}

export { createEmptyInventoryState };
