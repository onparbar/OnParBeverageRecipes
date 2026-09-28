import {
  DASHBOARD_SESSION_COOKIE,
  signDashboardSession,
} from "./dashboard-auth.mjs";
import { recoverWeeklyUsageState } from "./weekly-usage-recovery.mjs";
import { readSharedWeeklyUsageState } from "./weekly-usage-shared-store.mjs";

const KEY = Symbol.for("onpar.weekly.usage.recovery.runtime");
const INITIAL_DELAY_MS = 45_000;
const RECOVERY_INTERVAL_MS = 2 * 60_000;

export function isWeeklyUsageRecoveryRuntimeEnabled(env = process.env) {
  return env.NEXT_RUNTIME === "nodejs"
    && env.NODE_ENV === "production"
    && env.ONPAR_DEPLOYMENT_TARGET === "on-site"
    && env.NEXT_PHASE !== "phase-production-build"
    && env.ONPAR_PMB_REPAIR_SCHEDULER === "1"
    && String(env.ONPAR_WEEKLY_USAGE_RECOVERY_ENABLED || "").trim().toLowerCase() !== "false"
    && !env.VERCEL;
}

export async function loadPmbWeeklyUsageReport(
  week,
  { env = process.env, loadRoute = () => import("../app/api/pmb-weekly-usage/route.js") } = {},
) {
  const session = await signDashboardSession("owner", { env, maxAgeSeconds: 5 * 60 });
  const params = new URLSearchParams({ weeks: week.startDate });
  const request = {
    url: `http://localhost/api/pmb-weekly-usage?${params.toString()}`,
    cookies: {
      get(name) {
        return name === DASHBOARD_SESSION_COOKIE ? { value: session } : undefined;
      },
    },
  };
  const route = await loadRoute();
  const response = await route.GET(request);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error || "The latest PMB week could not be recovered.");
    error.code = payload?.code || "PMB_WEEKLY_USAGE_FAILED";
    error.status = response.status;
    error.details = payload;
    throw error;
  }
  return payload;
}

export function createWeeklyUsageRecoveryJob({
  readState = readSharedWeeklyUsageState,
  recover = recoverWeeklyUsageState,
  loadReport = loadPmbWeeklyUsageReport,
} = {}) {
  let inFlight = null;
  return function runWeeklyUsageRecovery() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const state = await readState();
      if (!state?.initialized) return state;
      return recover(state, loadReport);
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
}

export function startWeeklyUsageRecoveryRuntime({ env = process.env } = {}) {
  if (!isWeeklyUsageRecoveryRuntimeEnabled(env) || globalThis[KEY]) return null;
  const run = createWeeklyUsageRecoveryJob({
    loadReport: (week) => loadPmbWeeklyUsageReport(week, { env }),
  });
  const tick = () => run().catch((error) => {
    console.error("Weekly usage background recovery will retry automatically:", error.message);
  });
  const initial = setTimeout(tick, INITIAL_DELAY_MS);
  const interval = setInterval(tick, RECOVERY_INTERVAL_MS);
  initial.unref?.();
  interval.unref?.();
  globalThis[KEY] = { initial, interval };
  return globalThis[KEY];
}
