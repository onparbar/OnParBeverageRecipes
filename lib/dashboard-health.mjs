import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDashboardAuthStatus } from "./dashboard-auth.mjs";
import { getDashboardBuildInfo } from "./dashboard-build-info.mjs";
import { checkSupabaseReadiness } from "./supabase-readiness.mjs";

const HEALTH_TIMEOUT_MS = 2_500;
const MAX_STATUS_FILE_BYTES = 64 * 1024;
const PAR_AGENT_STALE_AFTER_MS = 8 * 24 * 60 * 60 * 1000;

function clean(value, maxLength = 120) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function configured(...values) {
  return values.every((value) => Boolean(clean(value)));
}

function safeTimestamp(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function getParAgentStatusPath(env) {
  const explicit = clean(env.PAR_AGENT_STATUS_PATH, 500);
  return explicit || path.join(process.cwd(), "logs", "par-agent-status.json");
}

async function readParAgentStatus(env, now) {
  const statusPath = getParAgentStatusPath(env);
  try {
    const details = await stat(statusPath);
    if (!details.isFile() || details.size > MAX_STATUS_FILE_BYTES) return { available: false };
    const parsed = JSON.parse(await readFile(statusPath, "utf8"));
    const status = parsed?.status === "ok" ? "ok" : parsed?.status === "error" ? "error" : "unknown";
    const checkedAt = safeTimestamp(parsed?.checkedAt);
    const ageMs = checkedAt ? Math.max(0, now.getTime() - new Date(checkedAt).getTime()) : null;
    return {
      available: true,
      status,
      checkedAt,
      generatedAt: safeTimestamp(parsed?.generatedAt),
      stale: ageMs == null || ageMs > PAR_AGENT_STALE_AFTER_MS,
      ageSeconds: ageMs == null ? null : Math.floor(ageMs / 1000),
    };
  } catch {
    return { available: false };
  }
}

async function hasProviSession(env) {
  try {
    const sessionPath = clean(env.PROVI_SESSION_STATE_PATH, 500) || path.join(
      os.homedir(),
      ".FoodOrderAgent",
      "provi",
      "provi_session_state.json",
    );
    const details = await stat(sessionPath);
    return details.isFile() && details.size > 0;
  } catch {
    return false;
  }
}

function safeHttpUrl(value) {
  try {
    const url = new URL(clean(value, 1_000));
    return ["http:", "https:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

async function checkReachability(rawUrl, fetchImpl) {
  const url = safeHttpUrl(rawUrl);
  if (!url || typeof fetchImpl !== "function") {
    return { checked: false, reachable: false };
  }

  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      method: "HEAD",
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    return {
      checked: true,
      reachable: true,
      httpStatus: Number(response.status) || 0,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (error) {
    return {
      checked: true,
      reachable: false,
      reason: error?.name === "TimeoutError" ? "timeout" : "unreachable",
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }
}

export async function buildDashboardHealth({
  env = process.env,
  fetchImpl = globalThis.fetch,
  deep = false,
  storage = false,
  now = new Date(),
} = {}) {
  const candidateCheckedAt = now instanceof Date ? now : new Date(now);
  const checkedAt = Number.isNaN(candidateCheckedAt.getTime()) ? new Date() : candidateCheckedAt;
  const auth = getDashboardAuthStatus(env);
  const [proviSessionConfigured, parAgentStatus] = await Promise.all([
    hasProviSession(env),
    readParAgentStatus(env, checkedAt),
  ]);
  const configuration = {
    authentication: {
      configured: auth.ready,
      employeeRoleEnabled: auth.employeeEnabled,
      issues: [...auth.issues],
    },
    supabase: {
      configured: configured(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY),
    },
    pmb: {
      configured: configured(
        env.PMB_API_BASE_URL,
        env.PMB_API_USERNAME,
        env.PMB_API_PASSWORD,
        env.PMB_API_CLIENT_ID,
      ),
    },
    untappd: {
      configured: configured(env.UNTAPPD_BUSINESS_EMAIL, env.UNTAPPD_BUSINESS_API_TOKEN),
    },
    provi: {
      configured: proviSessionConfigured
        || configured(env.PROVI_COOKIE_HEADER, env.PROVI_RETAILER_CONTEXT),
    },
  };
  const lastKnown = {
    parAgent: parAgentStatus,
  };
  let reachability = {
    supabase: { checked: false },
    pmb: { checked: false },
    untappd: { checked: false },
    provi: { checked: false },
  };
  const checkStorage = storage || deep;
  let sharedStorage = { checked: false };
  if (checkStorage) {
    sharedStorage = await checkSupabaseReadiness({ env, fetchImpl });
  }
  if (deep) {
    const [pmb, untappd, provi] = await Promise.all([
      checkReachability(env.PMB_API_BASE_URL, fetchImpl),
      checkReachability(configuration.untappd.configured ? "https://business.untappd.com" : "", fetchImpl),
      checkReachability(configuration.provi.configured ? "https://app.provi.com" : "", fetchImpl),
    ]);
    reachability = { supabase: sharedStorage, pmb, untappd, provi };
  } else if (checkStorage) {
    reachability = { ...reachability, supabase: sharedStorage };
  }
  const degradedByReachability = deep && Object.values(reachability)
    .some((entry) => entry.checked && !entry.reachable);
  const degradedByParAgent = lastKnown.parAgent.available
    && (lastKnown.parAgent.status === "error" || lastKnown.parAgent.stale);
  const degraded = degradedByReachability || degradedByParAgent;
  const requiredConfigurationIssues = [
    ...(!configuration.authentication.configured ? ["authentication"] : []),
    ...(!configuration.supabase.configured ? ["supabase"] : []),
    ...(!configuration.pmb.configured ? ["pmb"] : []),
  ];
  const storageNotReady = checkStorage && !sharedStorage.provisioned;
  const ready = requiredConfigurationIssues.length === 0 && !storageNotReady;

  return {
    ok: ready,
    status: ready ? (degraded ? "degraded" : "ok") : "misconfigured",
    checkedAt: checkedAt.toISOString(),
    build: getDashboardBuildInfo(env),
    readiness: {
      configured: ready,
      missing: [
        ...requiredConfigurationIssues,
        ...(storageNotReady ? ["supabase-resources"] : []),
      ],
    },
    configuration,
    reachability,
    lastKnown,
  };
}
