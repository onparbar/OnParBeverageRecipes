const TABLE_NAME = "pmb_data_backup";
const MAX_SOURCE_LENGTH = 80;

export class PmbDataBackupStoreError extends Error {
  constructor(message, code = "PMB_DATA_BACKUP_STORE_ERROR", status = 500) {
    super(message);
    this.name = "PmbDataBackupStoreError";
    this.code = code;
    this.status = status;
  }
}

function normalizeSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (!source || source.length > MAX_SOURCE_LENGTH || !/^[a-z0-9][a-z0-9-]*$/.test(source)) {
    throw new PmbDataBackupStoreError(
      "The PMB backup source is invalid.",
      "INVALID_PMB_DATA_BACKUP_SOURCE",
      422,
    );
  }
  return source;
}

function normalizeCapturedAt(value) {
  const capturedAt = value instanceof Date ? value.toISOString() : String(value || "").trim();
  if (!capturedAt || !Number.isFinite(Date.parse(capturedAt))) {
    throw new PmbDataBackupStoreError(
      "The PMB backup needs a valid capture time.",
      "INVALID_PMB_DATA_BACKUP_CAPTURE_TIME",
      422,
    );
  }
  return new Date(capturedAt).toISOString();
}

function normalizeData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PmbDataBackupStoreError(
      "The PMB backup payload is invalid.",
      "INVALID_PMB_DATA_BACKUP",
      422,
    );
  }
  return value;
}

function configuration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!baseUrl || !secret) {
    throw new PmbDataBackupStoreError(
      "Shared PMB backup storage is not configured.",
      "PMB_DATA_BACKUP_NOT_CONFIGURED",
      503,
    );
  }
  return { baseUrl, secret };
}

function requestHeaders(secret, prefer = "") {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    apikey: secret,
    ...(secret.split(".").length === 3 ? { Authorization: `Bearer ${secret}` } : {}),
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function responseBody(response) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new PmbDataBackupStoreError(
      body?.message || "Shared PMB backup storage is unavailable.",
      "PMB_DATA_BACKUP_STORAGE_UNAVAILABLE",
      503,
    );
  }
  return body;
}

export async function readLatestPmbDataBackup(
  source,
  { env = process.env, fetchImpl = globalThis.fetch } = {},
) {
  const normalizedSource = normalizeSource(source);
  const config = configuration(env);
  const url = new URL(`${config.baseUrl}/rest/v1/${TABLE_NAME}`);
  url.searchParams.set("select", "source,data,captured_at,updated_at");
  url.searchParams.set("source", `eq.${normalizedSource}`);
  url.searchParams.set("limit", "1");

  const body = await responseBody(await fetchImpl(url, {
    method: "GET",
    headers: requestHeaders(config.secret),
    cache: "no-store",
  }));
  const row = Array.isArray(body) ? body[0] : null;
  if (!row?.data) return null;

  return {
    source: normalizedSource,
    data: normalizeData(row.data),
    capturedAt: normalizeCapturedAt(row.captured_at),
    updatedAt: normalizeCapturedAt(row.updated_at || row.captured_at),
  };
}

export async function savePmbDataBackup(
  source,
  data,
  {
    capturedAt = data?.updatedAt || new Date().toISOString(),
    env = process.env,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const normalizedSource = normalizeSource(source);
  const normalizedData = normalizeData(data);
  const normalizedCapturedAt = normalizeCapturedAt(capturedAt);
  const config = configuration(env);
  const url = new URL(`${config.baseUrl}/rest/v1/${TABLE_NAME}`);
  url.searchParams.set("on_conflict", "source");

  const body = await responseBody(await fetchImpl(url, {
    method: "POST",
    headers: requestHeaders(config.secret, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify({
      source: normalizedSource,
      data: normalizedData,
      captured_at: normalizedCapturedAt,
      updated_at: new Date().toISOString(),
    }),
    cache: "no-store",
  }));
  if (!Array.isArray(body) || body.length !== 1) {
    throw new PmbDataBackupStoreError(
      "The shared PMB backup could not be saved.",
      "PMB_DATA_BACKUP_NOT_PROVISIONED",
      503,
    );
  }

  return {
    source: normalizedSource,
    data: normalizedData,
    capturedAt: normalizedCapturedAt,
  };
}
