function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function cleanList(values) {
  return Array.isArray(values) ? values.map(clean).filter(Boolean) : [];
}

function addUnique(lines, line) {
  if (!line?.text) return;
  if (lines.some((entry) => entry.text === line.text)) return;
  lines.push(line);
}

function isPastThursday(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) return false;
  const day = date.getDay();
  return day === 0 || day >= 5;
}

function buildOutstandingWorkBullets(staffPrepPlan = {}, orders = {}, now = new Date()) {
  const cocktailItems = Array.isArray(staffPrepPlan?.items)
    ? staffPrepPlan.items.filter((item) => item && typeof item === "object")
    : [];
  const liquorRefills = Array.isArray(staffPrepPlan?.liquorRefills)
    ? staffPrepPlan.liquorRefills.filter((item) => item && typeof item === "object")
    : [];
  const cocktailCount = cocktailItems.reduce((total, item) => (
    item.completed
      ? total
      : total + Math.max(1, Math.ceil(number(item.quantity)))
  ), 0);
  const liquorRefillCount = liquorRefills.filter((item) => !item.completed).length;
  const bullets = [];

  if (cocktailCount > 0) {
    bullets.push(`${cocktailCount} ${cocktailCount === 1 ? "cocktail" : "cocktails"} left to be made`);
  }
  if (liquorRefillCount > 0) {
    bullets.push(`${liquorRefillCount} liquor ${liquorRefillCount === 1 ? "refill" : "refills"} left to complete`);
  }

  const verifiedStatuses = new Set(["received", "partial", "not-received", "rejected", "extra"]);
  const bonbrightUnverified = isPastThursday(now)
    && (Array.isArray(orders?.vendors) ? orders.vendors : []).some((vendor) => {
      if (!vendor || typeof vendor !== "object" || !/bonbright/i.test(clean(vendor.vendor))) return false;
      if (vendor.ordered !== true) return false;
      const items = Array.isArray(vendor.items) ? vendor.items : [];
      return items.length > 0 && items.some((item) => (
        !verifiedStatuses.has(clean(item?.status).toLowerCase())
      ));
    });
  if (bonbrightUnverified) bullets.push("Expected Bonbright delivery not verified");

  return cleanList(bullets);
}

export function buildThirtySecondBriefing({
  overview = {},
  mondayRun = {},
  staffPrepPlan = {},
  orders = {},
  now = new Date(),
} = {}) {
  const lines = [];
  const alerts = Array.isArray(overview.alerts) ? overview.alerts : [];
  const criticalAlerts = alerts.filter((item) => item?.severity === "critical");
  const warningAlerts = alerts.filter((item) => item?.severity === "warning");
  const informationalAlerts = alerts.filter((item) => !["critical", "warning"].includes(item?.severity));
  const nextStep = mondayRun.complete ? null : mondayRun.nextStep;

  if (criticalAlerts.length) {
    const alert = criticalAlerts[0];
    const bullets = cleanList(alert.details);
    addUnique(lines, {
      tone: "critical",
      text: clean(alert.title),
      detail: clean(alert.message),
      target: clean(alert.action?.target),
      ...(bullets.length ? { bullets } : {}),
    });
  } else if (nextStep) {
    addUnique(lines, {
      tone: "next",
      text: `Next: ${clean(nextStep.label)}`,
      detail: clean(nextStep.status),
      target: clean(nextStep.target),
    });
  }

  const outstandingWork = buildOutstandingWorkBullets(staffPrepPlan, orders, now);
  if (outstandingWork.length > 0) {
    addUnique(lines, {
      tone: "plan",
      text: "What is left this week",
      bullets: outstandingWork,
      target: "weekly-plan",
    });
  }

  const remainingAlerts = [...criticalAlerts.slice(1), ...warningAlerts, ...informationalAlerts];
  remainingAlerts.forEach((alert) => {
    const bullets = cleanList(alert.details);
    addUnique(lines, {
      tone: alert.severity || "warning",
      text: clean(alert.title),
      detail: clean(alert.message),
      target: clean(alert.action?.target),
      ...(bullets.length ? { bullets } : {}),
    });
  });

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
    voiceText: visibleLines
      .map((item) => [item.text, item.detail, ...cleanList(item.bullets)].filter(Boolean).join(". "))
      .join(". "),
  };
}
