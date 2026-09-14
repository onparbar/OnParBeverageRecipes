import { sendFullPmbConfigUpdate } from "./pmb-full-config-update.mjs";
import { activateQueuedPmbProducts } from "./pmb-product-activation.mjs";
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
    repair: async ({ beforeWrite }) => {
      const startedAt = Date.now();
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      }).formatToParts(new Date(startedAt)).map(({ type, value }) => [type, value]));
      const scheduled = parts.minute === "00" && (parts.hour === "10" || (parts.weekday === "Mon" && parts.hour === "07"));
      const windowEnd = Math.floor(startedAt / 60_000) * 60_000 + 60_000;
      const guardActivation = () => {
        const current = Date.now();
        if (!scheduled || current < startedAt || current >= windowEnd
          || !isPmbMorningRepairRuntimeEnabled(env) || env.PMB_MORNING_REPAIR_ENABLED === "false") {
          throw Object.assign(new Error("The safe morning PMB activation window closed. Repair was not sent."), { code: "PMB_REPAIR_WINDOW_CLOSED" });
        }
      };
      const productActivation = await activateQueuedPmbProducts({ env, beforeWrite: guardActivation });
      const result = await sendFullPmbConfigUpdate({ env, beforeWrite });
      return { ...result, productActivation };
    },
    refresh: refreshPmbMorningRepairData,
  });
}
