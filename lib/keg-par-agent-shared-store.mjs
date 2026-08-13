const TABLE = "keg_par_agent_shared_state";
const STATE_ID = "keg-par-agent";
const MAX_STATE_BYTES = 2_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const OBJECT_FIELDS = ["onHandOverrides", "parOverrides", "onDeckOverrides", "settings"];

function getRequestTimeoutMs(env) {
  const configured = Number(env.SUPABASE_REQUEST_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.max(25, Math.min(30_000, Math.round(configured)));
}

export class KegParAgentStateError extends Error {
  constructor(code, message, status = 500, details = {}) {
    super(message);
    this.name = "KegParAgentStateError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 500, details = {}) {
  return new KegParAgentStateError(code, message, status, details);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone(value, label = "Shared Keg Levels data") {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw fail("INVALID_KEG_STATE", `${label} must contain valid JSON data.`, 400); }
  if (serialized === undefined) throw fail("INVALID_KEG_STATE", `${label} must contain valid JSON data.`, 400);
  if (Buffer.byteLength(serialized, "utf8") > MAX_STATE_BYTES) {
    throw fail("KEG_STATE_TOO_LARGE", `Shared Keg Levels cannot exceed ${MAX_STATE_BYTES} bytes.`, 413);
  }
  return JSON.parse(serialized);
}

export function createEmptyKegParAgentData() {
  return { onHandOverrides: {}, parOverrides: {}, onDeckOverrides: {}, settings: {}, recommendations: null };
}

function normalizeData(value, { requireEveryField = false } = {}) {
  if (!isObject(value)) throw fail("INVALID_KEG_STATE", "Shared Keg Levels data must be an object.", 400);
  const allowed = new Set([...OBJECT_FIELDS, "recommendations"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw fail("INVALID_KEG_STATE", `Shared Keg Levels contains unknown fields: ${unknown.join(", ")}.`, 400);
  const data = createEmptyKegParAgentData();
  for (const field of OBJECT_FIELDS) {
    if (requireEveryField && !Object.hasOwn(value, field)) throw fail("INVALID_KEG_STATE", `Shared Keg Levels data.${field} is required.`, 400);
    if (Object.hasOwn(value, field)) {
      if (!isObject(value[field])) throw fail("INVALID_KEG_STATE", `Shared Keg Levels data.${field} must be an object.`, 400);
      data[field] = clone(value[field], `Shared Keg Levels data.${field}`);
    }
  }
  if (requireEveryField && !Object.hasOwn(value, "recommendations")) throw fail("INVALID_KEG_STATE", "Shared Keg Levels data.recommendations is required.", 400);
  if (Object.hasOwn(value, "recommendations")) data.recommendations = value.recommendations === null ? null : clone(value.recommendations, "Shared Keg Levels data.recommendations");
  return clone(data);
}

function normalizeRow(row) {
  if (!isObject(row) || !Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 0) {
    throw fail("KEG_STATE_INVALID_RESPONSE", "Shared Keg Levels returned an invalid response.", 503);
  }
  const initialized = row.initialized === true;
  let data;
  try { data = normalizeData(row.data || {}, { requireEveryField: initialized }); }
  catch { throw fail("KEG_STATE_INVALID_RESPONSE", "Shared Keg Levels contains invalid data.", 503); }
  const stamp = (value) => {
    const date = new Date(value || "");
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  };
  return { version: 1, id: STATE_ID, revision: Number(row.revision), initialized, initializedAt: stamp(row.initialized_at), updatedAt: stamp(row.updated_at), updatedByRole: String(row.updated_by_role || "").trim().slice(0, 30), data };
}

function configuration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!baseUrl || !secret) throw fail("KEG_STATE_UNAVAILABLE", "Shared Keg Levels storage is not configured.", 503);
  let url;
  try { url = new URL(baseUrl); } catch { throw fail("KEG_STATE_UNAVAILABLE", "Shared Keg Levels storage is not configured correctly.", 503); }
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && String(env.SUPABASE_ALLOW_INSECURE_LOCALHOST || "").toLowerCase() === "true")) {
    throw fail("KEG_STATE_UNAVAILABLE", "Shared Keg Levels storage is not configured correctly.", 503);
  }
  return { baseUrl, secret };
}

function headers(secret, method) {
  const result = { Accept: "application/json", apikey: secret };
  if (secret.split(".").length === 3) result.Authorization = `Bearer ${secret}`;
  if (method !== "GET") { result["Content-Type"] = "application/json"; result.Prefer = "return=representation"; }
  return result;
}

export function createSharedKegParAgentStore({ env = process.env, fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  async function request(method, filters = {}, body) {
    const config = configuration(env);
    if (typeof fetchImpl !== "function") throw fail("KEG_STATE_UNAVAILABLE", "Shared Keg Levels storage is unavailable.", 503);
    const url = new URL(`${config.baseUrl}/rest/v1/${TABLE}`);
    url.searchParams.set("select", "id,revision,initialized,data,initialized_at,updated_at,updated_by_role");
    url.searchParams.set("id", `eq.${STATE_ID}`);
    Object.entries(filters).forEach(([key, value]) => url.searchParams.set(key, `eq.${value}`));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getRequestTimeoutMs(env));
    try {
      const response = await fetchImpl(url, { method, headers: headers(config.secret, method), cache: "no-store", signal: controller.signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      let result = null;
      try { result = await response.json(); } catch { /* handled below */ }
      if (!response.ok || !Array.isArray(result)) throw fail("KEG_STATE_UNAVAILABLE", "Shared Keg Levels storage is unavailable.", [400, 401, 403, 404].includes(response.status) ? 503 : 502);
      return result;
    } catch (error) {
      if (error instanceof KegParAgentStateError) throw error;
      throw fail("KEG_STATE_UNAVAILABLE", "Shared Keg Levels storage is unavailable.", 503);
    } finally {
      clearTimeout(timeout);
    }
  }
  async function read() {
    const row = (await request("GET")).find((entry) => entry?.id === STATE_ID);
    if (!row) throw fail("KEG_STATE_ROW_MISSING", "Shared Keg Levels storage has not been provisioned.", 503);
    return normalizeRow(row);
  }
  async function cas(revision, initialized, changes) {
    const row = (await request("PATCH", { revision, initialized }, changes)).find((entry) => entry?.id === STATE_ID);
    if (row) return normalizeRow(row);
    const current = await read();
    if (!initialized && current.initialized) throw fail("KEG_STATE_ALREADY_INITIALIZED", "Shared Keg Levels has already been initialized.", 409, { currentRevision: current.revision });
    if (initialized && !current.initialized) throw fail("KEG_STATE_NOT_INITIALIZED", "Shared Keg Levels must be imported from the service computer before it can be updated.", 409, { currentRevision: current.revision });
    throw fail("KEG_STATE_REVISION_CONFLICT", "Shared Keg Levels changed in another session. Reload before saving again.", 409, { currentRevision: current.revision });
  }
  async function save({ expectedRevision, data, initialize = false }, role = "owner") {
    const revision = Number(expectedRevision);
    if (!Number.isSafeInteger(revision) || revision < 0 || (initialize && revision !== 0)) throw fail("INVALID_KEG_REVISION", "expectedRevision must be a valid revision.", 400);
    const current = await read();
    if (initialize ? current.initialized : !current.initialized) throw fail(initialize ? "KEG_STATE_ALREADY_INITIALIZED" : "KEG_STATE_NOT_INITIALIZED", initialize ? "Shared Keg Levels has already been initialized." : "Shared Keg Levels must be imported from the service computer before it can be updated.", 409, { currentRevision: current.revision });
    if (current.revision !== revision) throw fail("KEG_STATE_REVISION_CONFLICT", "Shared Keg Levels changed in another session. Reload before saving again.", 409, { currentRevision: current.revision });
    const timestamp = now().toISOString();
    return cas(revision, initialize ? false : true, { revision: revision + 1, ...(initialize ? { initialized: true, initialized_at: timestamp } : {}), data: normalizeData(data, { requireEveryField: true }), updated_at: timestamp, updated_by_role: String(role || "owner").trim().slice(0, 30) || "owner" });
  }
  return Object.freeze({ read, initialize: (payload, role) => save({ ...payload, initialize: true }, role), replace: (payload, role) => save(payload, role) });
}

export const readSharedKegParAgentState = () => createSharedKegParAgentStore().read();
export const initializeSharedKegParAgentState = (payload, role) => createSharedKegParAgentStore().initialize(payload, role);
export const replaceSharedKegParAgentState = (payload, role) => createSharedKegParAgentStore().replace(payload, role);
