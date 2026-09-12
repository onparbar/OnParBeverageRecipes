export async function register() {
  // The PM2 launch helper supplies the scheduler switch only to the running
  // on-site service. Builds, previews, and local development remain passive.
  if (
    process.env.NEXT_RUNTIME === "nodejs"
    && process.env.NODE_ENV === "production"
    && process.env.ONPAR_DEPLOYMENT_TARGET === "on-site"
    && process.env.NEXT_PHASE !== "phase-production-build"
    && process.env.ONPAR_PMB_REPAIR_SCHEDULER === "1"
    && String(process.env.PMB_MORNING_REPAIR_ENABLED || "").trim().toLowerCase() !== "false"
    && !process.env.VERCEL
  ) {
    const { startPmbMorningRepairRuntime } = await import("./lib/pmb-morning-repair-runtime.mjs");
    startPmbMorningRepairRuntime();
  }
}
