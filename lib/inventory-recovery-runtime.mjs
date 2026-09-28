import { recoverPendingInventoryUpdates } from "./keg-par-agent-shared-store.mjs";

const KEY = Symbol.for("onpar.inventory.recovery.runtime");

export function createInventoryRecoveryJob({
  recover = recoverPendingInventoryUpdates,
  now = () => Date.now(),
  idleIntervalMs = 10 * 60_000,
} = {}) {
  let running = null;
  let nextIdleCheckAt = 0;
  return function runInventoryRecovery() {
    if (running) return running;
    if (now() < nextIdleCheckAt) return Promise.resolve({ skipped: true, pending: false });
    running = Promise.resolve(recover()).then((result) => {
      if (result?.pending === false) nextIdleCheckAt = now() + idleIntervalMs;
      return result;
    }).finally(() => { running = null; });
    return running;
  };
}

export function startInventoryRecoveryRuntime({ env = process.env } = {}) {
  if (globalThis[KEY] || env.NODE_ENV !== "production" || env.ONPAR_DEPLOYMENT_TARGET !== "on-site"
    || env.ONPAR_PMB_REPAIR_SCHEDULER !== "1" || env.NEXT_PHASE === "phase-production-build" || env.VERCEL) return;
  const run = createInventoryRecoveryJob();
  const tick = async () => {
    try { await run(); }
    catch { console.error("Pending inventory recovery will retry automatically."); }
  };
  const initial = setTimeout(tick, 15000);
  const interval = setInterval(tick, 60000);
  initial.unref?.();
  interval.unref?.();
  globalThis[KEY] = { initial, interval };
}
