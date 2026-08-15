const SNAPSHOT_ID = "current";
const TABLE_NAME = "pmb_level_snapshot";
const MAX_ITEMS = 250;

export class PmbLevelSnapshotStoreError extends Error {
  constructor(message, code = "PMB_LEVEL_SNAPSHOT_STORE_ERROR", status = 500) {
    super(message);
    this.name = "PmbLevelSnapshotStoreError";
    this.code = code;
    this.status = status;
  }
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new PmbLevelSnapshotStoreError(
      `The PMB snapshot has an invalid ${label}.`,
      "INVALID_PMB_LEVEL_SNAPSHOT",
      422,
    );
  }
  return number;
}

export function normalizePmbLevelSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PmbLevelSnapshotStoreError("The PMB snapshot is invalid.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
  }
  const updatedAt = String(value.updatedAt || "").trim();
  if (!updatedAt || !Number.isFinite(Date.parse(updatedAt))) {
    throw new PmbLevelSnapshotStoreError("The PMB snapshot needs a valid capture time.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
  }
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_ITEMS) {
    throw new PmbLevelSnapshotStoreError("The PMB snapshot needs a complete item list.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
  }

  const seenTaps = new Set();
  const items = value.items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new PmbLevelSnapshotStoreError("The PMB snapshot contains an invalid item.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
    }
    const tapNumber = positiveInteger(item.tapNumber, "tap number");
    if (seenTaps.has(tapNumber)) {
      throw new PmbLevelSnapshotStoreError("The PMB snapshot contains duplicate taps.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
    }
    seenTaps.add(tapNumber);
    if (item.fillLevelPercent === null || item.fillLevelPercent === undefined || item.fillLevelPercent === "") {
      throw new PmbLevelSnapshotStoreError("The PMB snapshot contains a missing keg level.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
    }
    const fillLevelPercent = Number(item.fillLevelPercent);
    if (!Number.isFinite(fillLevelPercent) || fillLevelPercent < 0 || fillLevelPercent > 100) {
      throw new PmbLevelSnapshotStoreError("The PMB snapshot contains an invalid keg level.", "INVALID_PMB_LEVEL_SNAPSHOT", 422);
    }
    return {
      slotKey: String(item.slotKey || "").trim(),
      plu: positiveInteger(item.plu, "PLU"),
      name: String(item.name || "").trim(),
      fillLevelPercent,
      deviceId: positiveInteger(item.deviceId, "device ID"),
      lineNum: positiveInteger(item.lineNum, "line number"),
      tapNumber,
      tapProduct: String(item.tapProduct || "").trim(),
      volumeUnit: String(item.volumeUnit || ""),
      volumeUnitDp: finiteOrNull(item.volumeUnitDp) ?? 0,
      rawPercent: finiteOrNull(item.rawPercent),
      rawKegSize: finiteOrNull(item.rawKegSize),
      rawKegSizeDp: finiteOrNull(item.rawKegSizeDp),
    };
  });

  const deviceLevels = {};
  items.forEach((item) => {
    const key = String(item.deviceId);
    if (!deviceLevels[key]) deviceLevels[key] = [];
    deviceLevels[key].push({
      lineNum: item.lineNum,
      fillLevelPercent: item.fillLevelPercent,
      rawPercent: item.rawPercent,
      rawKegSize: item.rawKegSize,
      rawKegSizeDp: item.rawKegSizeDp,
    });
  });
  Object.values(deviceLevels).forEach((levels) => levels.sort((a, b) => a.lineNum - b.lineNum));

  return { updatedAt: new Date(updatedAt).toISOString(), items, deviceLevels };
}

function configuration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!baseUrl || !secret) {
    throw new PmbLevelSnapshotStoreError("Shared PMB snapshot storage is not configured.", "PMB_LEVEL_SNAPSHOT_NOT_CONFIGURED", 503);
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
    throw new PmbLevelSnapshotStoreError(
      body?.message || "Shared PMB snapshot storage is unavailable.",
      "PMB_LEVEL_SNAPSHOT_STORAGE_UNAVAILABLE",
      503,
    );
  }
  return body;
}

export async function readPmbLevelSnapshot({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = configuration(env);
  const url = new URL(`${config.baseUrl}/rest/v1/${TABLE_NAME}`);
  url.searchParams.set("select", "data");
  url.searchParams.set("id", `eq.${SNAPSHOT_ID}`);
  url.searchParams.set("limit", "1");
  const body = await responseBody(await fetchImpl(url, {
    method: "GET",
    headers: requestHeaders(config.secret),
    cache: "no-store",
  }));
  if (!Array.isArray(body) || !body[0]?.data) return null;
  return normalizePmbLevelSnapshot(body[0].data);
}

export async function savePmbLevelSnapshot(snapshot, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const data = normalizePmbLevelSnapshot(snapshot);
  const config = configuration(env);
  const url = new URL(`${config.baseUrl}/rest/v1/${TABLE_NAME}`);
  url.searchParams.set("id", `eq.${SNAPSHOT_ID}`);
  const body = await responseBody(await fetchImpl(url, {
    method: "PATCH",
    headers: requestHeaders(config.secret, "return=representation"),
    body: JSON.stringify({ data, updated_at: data.updatedAt }),
    cache: "no-store",
  }));
  if (!Array.isArray(body) || body.length !== 1) {
    throw new PmbLevelSnapshotStoreError("The shared PMB snapshot row is missing.", "PMB_LEVEL_SNAPSHOT_NOT_PROVISIONED", 503);
  }
  return data;
}
