const STORAGE_CHECK_TIMEOUT_MS = 4_000;

const REQUIRED_RESOURCES = Object.freeze([
  { table: "dashboard_shared_state", id: "dashboard-config" },
  { table: "inventory_shared_state", id: "inventory-state" },
  { table: "weekly_usage_shared_state", id: "weekly-usage" },
  { table: "keg_par_agent_shared_state", id: "keg-par-agent" },
  { table: "pmb_level_snapshot", id: "current" },
  { table: "pmb_data_backup", id: "" },
  { table: "dashboard_activity_log", id: "" },
]);

function configuration(env) {
  const baseUrl = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const secret = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!baseUrl || !secret) return null;
  try {
    const url = new URL(baseUrl);
    const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const allowLocal = loopback
      && String(env.SUPABASE_ALLOW_INSECURE_LOCALHOST || "").trim().toLowerCase() === "true";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && allowLocal)) return null;
    return { baseUrl, secret };
  } catch {
    return null;
  }
}

function headers(secret) {
  return {
    Accept: "application/json",
    apikey: secret,
    ...(secret.split(".").length === 3 ? { Authorization: `Bearer ${secret}` } : {}),
  };
}

async function checkResource(config, resource, fetchImpl) {
  const url = new URL(`${config.baseUrl}/rest/v1/${resource.table}`);
  url.searchParams.set("select", "id");
  url.searchParams.set("limit", "1");
  if (resource.id) url.searchParams.set("id", `eq.${resource.id}`);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: headers(config.secret),
      cache: "no-store",
      signal: AbortSignal.timeout(STORAGE_CHECK_TIMEOUT_MS),
    });
    const body = await response.json().catch(() => null);
    return Boolean(
      response.ok
      && Array.isArray(body)
      && (!resource.id || body.some((row) => row?.id === resource.id)),
    );
  } catch {
    return false;
  }
}

export async function checkSupabaseReadiness({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const config = configuration(env);
  if (!config || typeof fetchImpl !== "function") {
    return { checked: false, reachable: false, provisioned: false, missingResourceCount: REQUIRED_RESOURCES.length };
  }

  const checks = await Promise.all(
    REQUIRED_RESOURCES.map((resource) => checkResource(config, resource, fetchImpl)),
  );
  const provisioned = checks.every(Boolean);
  return {
    checked: true,
    reachable: checks.some(Boolean),
    provisioned,
    missingResourceCount: checks.filter((ready) => !ready).length,
  };
}

export const REQUIRED_SUPABASE_RESOURCE_COUNT = REQUIRED_RESOURCES.length;
