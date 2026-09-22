const isCountTask = (message) => /inventory (?:items?|counts?).*(?:old baseline|current (?:saved )?count|not current)|\d+.*inventory.*(?:old baseline|current saved count)/i.test(String(message || ""));
const isRoutineWeeklyUsageGap = (message) => /(?:\d+\/\d+ active taps have saved usage|latest completed (?:monday-sunday )?usage report is not saved|complete current PMB week is not available|weekly usage coverage is partial|weekly usage (?:has not been refreshed|is not ready for trends))/i.test(String(message || ""));
const isRoutineWeeklyUsageAlert = (alert) => [
  "weekly-usage-unavailable",
  "weekly-usage-partial",
  "weekly-usage-stale",
].includes(String(alert?.id || ""))
  || isRoutineWeeklyUsageGap(alert?.title)
  || isRoutineWeeklyUsageGap(alert?.message);
const compact = (message) => String(message || "")
  .replace(/(\d+\/\d+ active taps have saved usage\.)\s*Missing:[\s\S]*/i,
    "$1 The latest completed PMB week needs to be synced.");

// Presentation only: the original readiness object still blocks unsafe orders.
export function prepareBriefingInputs(alerts = [], readiness = {}) {
  const countAlert = alerts.find((alert) => alert.id === "inventory-counts-missing");
  const reasons = ["blockers", "staleReasons", "reviewReasons"];
  const nextReadiness = { ...readiness };
  const countReasons = reasons.flatMap((key) => readiness[key] || []).filter(isCountTask);
  const usageGapReasons = reasons.flatMap((key) => readiness[key] || []).filter(isRoutineWeeklyUsageGap);
  for (const key of reasons) {
    nextReadiness[key] = (readiness[key] || [])
      .filter((message) => !isCountTask(message))
      .filter((message) => !isRoutineWeeklyUsageGap(message))
      .filter((message) => !(readiness.needsRecalculation === true
        && key === "reviewReasons" && /inventory ordering rules.*review/i.test(message)))
      .map(compact);
  }
  const remainingReasons = reasons.flatMap((key) => nextReadiness[key]);
  const nextAlerts = alerts.flatMap((alert) => {
    if (alert.id === "inventory-counts-missing") return [];
    if (isRoutineWeeklyUsageAlert(alert)) return [];
    const isPlanAlert = String(alert.id || "").startsWith("weekly-plan");
    if (isPlanAlert && (countReasons.length || usageGapReasons.length)) {
      if (!remainingReasons.length) return [];
      return [{ ...alert, message: remainingReasons.join(" "), details: remainingReasons }];
    }
    return [{ ...alert, message: compact(alert.message),
      ...(Array.isArray(alert.details) ? { details: alert.details.map(compact) } : {}) }];
  });
  // Routine counting is already represented by the incomplete Weekly Plan.
  // Keep the actual ordering safeguard, but do not repeat it as a briefing alert.
  if ((countAlert || countReasons.length || usageGapReasons.length) && !remainingReasons.length
    && ["blocked", "stale", "unknown"].includes(readiness.status)) {
    nextReadiness.status = "ready";
  }
  return { alerts: nextAlerts, readiness: nextReadiness };
}
