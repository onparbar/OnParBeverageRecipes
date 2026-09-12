import { sendFullPmbConfigUpdate } from "./pmb-full-config-update.mjs";
import { startPmbMorningRepairScheduler } from "./pmb-morning-repair.mjs";

const READ_TIMEOUT_MS = 120_000;

export function isPmbMorningRepairRuntimeEnabled(env = process.env) {
  return env.NEXT_RUNTIME === "nodejs"
    && env.NODE_ENV === "production"
    && env.ONPAR_DEPLOYMENT_TARGET === "on-site"
    && env.NEXT_PHASE !== "phase-production-build"
    && env.ONPAR_PMB_REPAIR_SCHEDULER === "1"
    && String(env.PMB_MORNING_REPAIR_ENABLED || "").trim().toLowerCase() !== "false"
    && !env.VERCEL;
}

async function readPmbRoute(loadRoute, label) {
  let timeout;
  try {
    const read = async () => {
      const route = await loadRoute();
      const response = await route.GET();
      const payload = await response.json();
      if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
        return { ok: false, error: `${label} refresh unavailable.` };
      }
      // Preserve stale/partial flags: an HTTP 200 backed by older data does
      // not prove that today's repair restored the tap readings.
      return payload;
    };
    return await Promise.race([
      read(),
      new Promise((resolve) => {
        timeout = setTimeout(() => resolve({
          ok: false,
          timedOut: true,
          error: `${label} refresh timed out.`,
        }), READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return { ok: false, error: `${label} refresh unavailable.` };
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshPmbMorningRepairData() {
  // These existing server handlers read PMB and save dashboard snapshots;
  // they never issue a tap configuration update. Calling them internally
  // requires no new external endpoint or dashboard authentication bypass.
  const [levels, pricing] = await Promise.all([
    readPmbRoute(() => import("../app/api/keg-levels/route.js"), "Keg levels"),
    readPmbRoute(() => import("../app/api/tap-pricing/route.js"), "Tap pricing"),
  ]);
  return { levels, pricing };
}

export function startPmbMorningRepairRuntime({ env = process.env } = {}) {
  if (!isPmbMorningRepairRuntimeEnabled(env)) return null;
  return startPmbMorningRepairScheduler({
    env,
    repair: ({ beforeWrite }) => sendFullPmbConfigUpdate({ env, beforeWrite }),
    refresh: refreshPmbMorningRepairData,
  });
}
