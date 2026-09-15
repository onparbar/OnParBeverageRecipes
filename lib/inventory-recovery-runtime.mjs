import { recoverPendingInventoryUpdates } from "./keg-par-agent-shared-store.mjs";

const KEY = Symbol.for("onpar.inventory.recovery.runtime");
export function startInventoryRecoveryRuntime({ env = process.env } = {}) {
  if (globalThis[KEY] || env.NODE_ENV !== "production" || env.ONPAR_DEPLOYMENT_TARGET !== "on-site"
    || env.ONPAR_PMB_REPAIR_SCHEDULER !== "1" || env.NEXT_PHASE === "phase-production-build" || env.VERCEL) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await recoverPendingInventoryUpdates(); }
    catch { console.error("Pending inventory recovery will retry automatically."); }
    finally { running = false; }
  };
  const initial = setTimeout(tick, 15000);
  const interval = setInterval(tick, 60000);
  initial.unref?.();
  interval.unref?.();
  globalThis[KEY] = { initial, interval };
}
