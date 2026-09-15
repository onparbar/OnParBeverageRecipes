const isCountTask = (message) => /inventory (?:items?|counts?).*(?:old baseline|current (?:saved )?count|not current)|\d+.*inventory.*(?:old baseline|current saved count)/i.test(String(message || ""));
const compact = (message) => String(message || "")
  .replace(/(\d+\/\d+ active taps have saved usage\.)\s*Missing:[\s\S]*/i,
    "$1 The latest completed PMB week needs to be synced.");

// Presentation only: the original readiness object still blocks unsafe orders.
export function prepareBriefingInputs(alerts = [], readiness = {}) {
  const countAlert = alerts.find((alert) => alert.id === "inventory-counts-missing");
  const reasons = ["blockers", "staleReasons", "reviewReasons"];
  const nextReadiness = { ...readiness };
  const countReasons = reasons.flatMap((key) => readiness[key] || []).filter(isCountTask);
  for (const key of reasons) {
    nextReadiness[key] = (readiness[key] || [])
      .filter((message) => !isCountTask(message))
      .filter((message) => !(readiness.needsRecalculation === true
        && key === "reviewReasons" && /inventory ordering rules.*review/i.test(message)))
      .map(compact);
  }
  const remainingReasons = reasons.flatMap((key) => nextReadiness[key]);
  const nextAlerts = alerts.flatMap((alert) => {
    if (alert.id === "inventory-counts-missing") return [];
    const isPlanAlert = String(alert.id || "").startsWith("weekly-plan");
    if (isPlanAlert && countReasons.length) {
      if (!remainingReasons.length) return [];
      return [{ ...alert, message: remainingReasons.join(" "), details: remainingReasons }];
    }
    return [{ ...alert, message: compact(alert.message),
      ...(Array.isArray(alert.details) ? { details: alert.details.map(compact) } : {}) }];
  });
  // Routine counting is already represented by the incomplete Weekly Plan.
  // Keep the actual ordering safeguard, but do not repeat it as a briefing alert.
  if ((countAlert || countReasons.length) && !remainingReasons.length
    && readiness.status === "blocked") {
    nextReadiness.status = "ready";
  }
  return { alerts: nextAlerts, readiness: nextReadiness };
}
