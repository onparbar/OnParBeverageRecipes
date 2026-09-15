import { createDashboardBackupJob, BACKUP_INTERVAL_MS } from "./dashboard-backup.mjs";
const KEY = Symbol.for("onpar.dashboard.backup.runtime");
export function dashboardBackupEnabled(env = process.env) {
  return env.NODE_ENV === "production" && env.ONPAR_DEPLOYMENT_TARGET === "on-site"
    && env.ONPAR_PMB_REPAIR_SCHEDULER === "1" && env.NEXT_PHASE !== "phase-production-build" && !env.VERCEL
    && String(env.ONPAR_DASHBOARD_BACKUP_ENABLED || "").trim().toLowerCase() !== "false";
}
export function startDashboardBackupRuntime({ env = process.env } = {}) {
  if (!dashboardBackupEnabled(env) || globalThis[KEY]) return;
  const run = createDashboardBackupJob({ env });
  const tick = () => run().catch(error => console.error("Dashboard background backup failed:", error.message));
  const initial = setTimeout(tick, 30000); initial.unref?.();
  const interval = setInterval(tick, BACKUP_INTERVAL_MS); interval.unref?.();
  globalThis[KEY] = { initial, interval };
}
