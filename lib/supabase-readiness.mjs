const STORAGE_CHECK_ATTEMPT_MS = 10_000;
const STORAGE_CHECK_BUDGET_MS = 18_000;
const RETRYABLE_FAILURES = new Set(["timeout", "connection", "upstream"]);

const REQUIRED_RESOURCES = Object.freeze([
  { table: "dashboard_shared_state", id: "dashboard-config" },
  { table: "inventory_shared_state", id: "inventory-state" },
  { table: "weekly_usage_shared_state", id: "weekly-usage" },
  { table: "keg_par_agent_shared_state", id: "keg-par-agent" },
  { table: "pmb_level_snapshot", id: "current" },
  { table: "pmb_data_backup", id: "", column: "source" },
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

async function checkResource(config, resource, fetchImpl, signal) {
  const url = new URL(`${config.baseUrl}/rest/v1/${resource.table}`);
  url.searchParams.set("select", resource.column || "id");
  url.searchParams.set("limit", "1");
  if (resource.id) url.searchParams.set("id", `eq.${resource.id}`);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: headers(config.secret),
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 401 || response.status === 403) return "authorization";
      if (response.status === 404) return "missing-resource";
      if (response.status === 429 || response.status >= 500) return "upstream";
      return "http-error";
    }
    const body = await response.json();
    if (!Array.isArray(body)) return "invalid-response";
    return !resource.id || body.some((row) => row?.id === resource.id) ? null : "missing-resource";
  } catch (error) {
    if (signal.aborted || error?.name === "TimeoutError") return "timeout";
    return error instanceof SyntaxError ? "invalid-response" : "connection";
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

  const deadline = AbortSignal.timeout(STORAGE_CHECK_BUDGET_MS);
  const checks = await Promise.all(REQUIRED_RESOURCES.map(async (resource) => {
    const firstAttempt = AbortSignal.any([deadline, AbortSignal.timeout(STORAGE_CHECK_ATTEMPT_MS)]);
    const failure = await checkResource(config, resource, fetchImpl, firstAttempt);
    if (!RETRYABLE_FAILURES.has(failure) || deadline.aborted) return failure;
    return checkResource(config, resource, fetchImpl, deadline);
  }));
  const failures = checks.filter(Boolean);
  const failureCounts = {};
  for (const failure of failures) failureCounts[failure] = (failureCounts[failure] ?? 0) + 1;
  return {
    checked: true,
    reachable: failures.length < checks.length,
    provisioned: failures.length === 0,
    missingResourceCount: failures.length,
    failureCounts,
  };
}

export const REQUIRED_SUPABASE_RESOURCE_COUNT = REQUIRED_RESOURCES.length;
