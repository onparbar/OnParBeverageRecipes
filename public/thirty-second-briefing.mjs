function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function addUnique(lines, line) {
  if (!line?.text) return;
  if (lines.some((entry) => entry.text === line.text)) return;
  lines.push(line);
}

export function buildThirtySecondBriefing({ overview = {}, plan = {}, mondayRun = {} } = {}) {
  const lines = [];
  const alerts = Array.isArray(overview.alerts) ? overview.alerts : [];
  const criticalAlerts = alerts.filter((item) => item?.severity === "critical");
  const warningAlerts = alerts.filter((item) => item?.severity === "warning");
  const informationalAlerts = alerts.filter((item) => !["critical", "warning"].includes(item?.severity));
  const nextStep = mondayRun.complete ? null : mondayRun.nextStep;

  if (criticalAlerts.length) {
    const alert = criticalAlerts[0];
    addUnique(lines, {
      tone: "critical",
      text: clean(alert.title),
      detail: clean(alert.message),
      target: clean(alert.action?.target),
    });
  } else if (nextStep) {
    addUnique(lines, {
      tone: "next",
      text: `Next: ${clean(nextStep.label)}`,
      detail: clean(nextStep.status),
      target: clean(nextStep.target),
    });
  }

  if (overview.planNumbersAvailable) {
    const orderLines = number(plan?.summary?.orderLineCount);
    const cocktailBatches = number(plan?.summary?.cocktailBatchTotal);
    if (orderLines || cocktailBatches) {
      addUnique(lines, {
        tone: "plan",
        text: `${orderLines} order line${orderLines === 1 ? "" : "s"} · ${cocktailBatches} cocktail batch${cocktailBatches === 1 ? "" : "es"}`,
        detail: "Current locked Weekly Plan",
        target: "weekly-plan",
      });
    }
  }

  const remainingAlerts = [...criticalAlerts.slice(1), ...warningAlerts, ...informationalAlerts];
  remainingAlerts.forEach((alert) => addUnique(lines, {
    tone: alert.severity || "warning",
    text: clean(alert.title),
    detail: clean(alert.message),
    target: clean(alert.action?.target),
  }));

  if (!lines.length) {
    addUnique(lines, {
      tone: "ready",
      text: "Nothing needs attention right now",
      detail: clean(overview.statusLabel),
      target: "dashboard",
    });
  }

  const visibleLines = lines.slice(0, 6);
  return {
    lines: visibleLines,
    voiceText: visibleLines.map((item) => [item.text, item.detail].filter(Boolean).join(". ")).join(". "),
  };
}
