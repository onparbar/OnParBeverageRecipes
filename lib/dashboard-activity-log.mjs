const TABLE = "dashboard_activity_log";
const MAX_SUMMARY_LENGTH = 240;

function clean(value, maxLength = MAX_SUMMARY_LENGTH) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function getConfiguration(env = process.env) {
  const baseUrl = clean(env.SUPABASE_URL, 500).replace(/\/+$/, "");
  const secret = clean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY, 2000);
  if (!baseUrl || !secret) throw new Error("Shared activity storage is not configured.");
  const url = new URL(baseUrl);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback && String(env.SUPABASE_ALLOW_INSECURE_LOCALHOST || "").toLowerCase() === "true")) {
    throw new Error("Shared activity storage is not configured correctly.");
  }
  return { baseUrl, secret };
}

function headers(secret, { write = false } = {}) {
  const result = { Accept: "application/json", apikey: secret };
  if (secret.split(".").length === 3) result.Authorization = `Bearer ${secret}`;
  if (write) {
    result["Content-Type"] = "application/json";
    result.Prefer = "return=minimal";
  }
  return result;
}

function getTableUrl(config) {
  return new URL(`${config.baseUrl}/rest/v1/${TABLE}`);
}

export async function recordDashboardActivity({ area, action, role = "owner", revision = 0, summary }, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getConfiguration(env);
  const response = await fetchImpl(getTableUrl(config), {
    method: "POST",
    headers: headers(config.secret, { write: true }),
    cache: "no-store",
    body: JSON.stringify({
      area: clean(area, 48) || "Dashboard",
      action: clean(action, 48) || "updated",
      role: clean(role, 30) || "owner",
      revision: Number.isSafeInteger(Number(revision)) ? Number(revision) : 0,
      summary: clean(summary),
    }),
  });
  if (!response.ok) throw new Error("Shared activity storage is unavailable.");
}

export async function readDashboardActivity({ limit = 25 } = {}, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const config = getConfiguration(env);
  const url = getTableUrl(config);
  url.searchParams.set("select", "id,occurred_at,area,action,role,revision,summary");
  url.searchParams.set("order", "occurred_at.desc");
  url.searchParams.set("limit", String(Math.max(1, Math.min(100, Number(limit) || 25))));
  const response = await fetchImpl(url, { headers: headers(config.secret), cache: "no-store" });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) throw new Error("Shared activity storage is unavailable.");
  return rows.map((row) => ({
    id: Number(row.id) || 0,
    occurredAt: clean(row.occurred_at, 40),
    area: clean(row.area, 48),
    action: clean(row.action, 48),
    role: clean(row.role, 30),
    revision: Number(row.revision) || 0,
    summary: clean(row.summary),
  }));
}
