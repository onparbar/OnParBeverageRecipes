const KEY = Symbol.for("onpar.live-par.runtime");
export const LIVE_PAR_SOURCE = "live-par-recommendations";

// Separate preview storage: never publish a plan, change prices, or place orders.
export function createLiveParRefresh({ readInputs, refreshLevels, calculate, save, now = () => Date.now() }) {
  let running = false;
  let lastLevelsAt = 0;
  let signature = "";
  return async () => {
    if (running) return;
    running = true;
    try {
      const levelDue = !lastLevelsAt || now() - lastLevelsAt >= 5 * 60000;
      if (levelDue) {
        await refreshLevels();
        lastLevelsAt = now();
      }
      const before = await readInputs();
      if (!levelDue && before === signature) return;
      const result = await calculate();
      const after = await readInputs();
      if (before !== after) return; // Recalculate next tick rather than publish mixed revisions.
      await save({ status: "ready", updatedAt: new Date(now()).toISOString(),
        inputSignature: after, recommendations: result.recommendations });
      signature = after;
    } catch {
      await save({ status: "pending", updatedAt: new Date(now()).toISOString(),
        message: "Live recommendations are waiting for verified PMB readings and inventory." }).catch(() => {});
    } finally { running = false; }
  };
}

export async function startLiveParRuntime({ env = process.env } = {}) {
  if (globalThis[KEY] || env.NODE_ENV !== "production" || env.ONPAR_DEPLOYMENT_TARGET !== "on-site"
    || env.ONPAR_PMB_REPAIR_SCHEDULER !== "1" || env.NEXT_PHASE === "phase-production-build" || env.VERCEL) return;
  globalThis[KEY] = { starting: true };
  const { createBackupStore } = await import("./dashboard-backup-store.mjs");
  const { runParAgentUpdate } = await import("./par-agent.mjs");
  const { recoverPendingInventoryUpdates } = await import("./keg-par-agent-shared-store.mjs");
  const store = createBackupStore({ env });
  const tick = createLiveParRefresh({
    readInputs: async () => {
      await recoverPendingInventoryUpdates();
      const values = [];
      for (const table of ["keg_par_agent_shared_state", "inventory_shared_state", "weekly_usage_shared_state", "dashboard_shared_state"]) {
        values.push(await store.rest(table, { select: "revision", limit: 1 }));
      }
      return JSON.stringify(values);
    },
    refreshLevels: async () => {
      const route = await import("../app/api/keg-levels/route.js");
      const response = await route.GET();
      const result = await response.json();
      if (!response.ok || result.stale || result.partial || result.degraded) throw new Error("Fresh levels required");
    },
    calculate: () => runParAgentUpdate({ dryRun: true }),
    save: (data) => store.save(LIVE_PAR_SOURCE, data),
  });
  const initial = setTimeout(tick, 20000);
  const interval = setInterval(tick, 30000);
  initial.unref?.(); interval.unref?.();
  globalThis[KEY] = { initial, interval };
}
