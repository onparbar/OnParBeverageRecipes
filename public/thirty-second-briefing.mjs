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

function getBriefingBullets(alert = {}) {
  if (/tap sheets need printing/i.test(clean(alert.title))) return [];
  return cleanList(alert.details);
}

function getBriefingDetail(alert = {}) {
  if (/taps? (?:are|is) below the 82% floor/i.test(clean(alert.title))) return "";
  return clean(alert.message);
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

function buildThirtySecondBriefingRaw({
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
    const bullets = getBriefingBullets(alert);
    addUnique(lines, {
      tone: "critical",
      text: clean(alert.title),
      detail: getBriefingDetail(alert),
      target: clean(alert.action?.target),
      reviewAction: alert.reviewAction,
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
    const bullets = getBriefingBullets(alert);
    addUnique(lines, {
      tone: alert.severity || "warning",
      text: clean(alert.title),
      detail: getBriefingDetail(alert),
      target: clean(alert.action?.target),
      reviewAction: alert.reviewAction,
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


function homeBriefingTitle(item) {
  return String(item?.text || item?.title || item?.heading || item?.label || "").trim();
}

function homeBriefingStrings(value, output = [], seen = new WeakSet()) {
  if (typeof value === "string") {
    output.push(value);
    return output;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return output;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry) => homeBriefingStrings(entry, output, seen));
  else Object.values(value).forEach((entry) => homeBriefingStrings(entry, output, seen));
  return output;
}

function homeComingSoonTime(value) {
  const raw = String(
    value?.replacementChangedAt
    || value?.replacedAt
    || value?.changedAt
    || value?.assignedAt
    || "",
  ).trim();
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "numeric",
    day: "numeric",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${dateLabel} at ${timeLabel}`;
}

function homeComingSoonOnDeck(value) {
  const candidate = [
    value?.onDeck,
    value?.onDeckName,
    value?.onDeckProductName,
    value?.onDeckProduct?.name,
    value?.replacementName,
    value?.replacementProductName,
    value?.nextProductName,
  ].find((entry) => (
    (typeof entry === "string" && entry.trim())
    || (entry && typeof entry === "object" && typeof entry.name === "string" && entry.name.trim())
  ));
  const name = clean(typeof candidate === "object" ? candidate?.name : candidate);
  return name
    .replace(/\s*\([^)]*\)\s*\d*\s*$/, "")
    .replace(/\s+\d+\s*$/, "")
    .trim();
}

function homeCollectComingSoonTaps(value, taps, seen = new WeakSet()) {
  if (typeof value === "string") {
    const match = value.match(/Tap\s+(\d+)[^\n]*Coming Soon!?/i);
    if (match && !taps.has(Number(match[1]))) {
      taps.set(Number(match[1]), { changedAt: "", onDeck: "" });
    }
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  const tapNumber = Number(value.tapNumber ?? value.tap ?? value.tapNo ?? 0);
  const productName = [
    value.newBrand,
    value.newProductName,
    value.currentProductName,
    value.currentName,
    value.productName,
    value.name,
    value.product,
    value.currentProduct?.name,
  ].find((entry) => typeof entry === "string" && entry.trim()) || "";
  if (Number.isFinite(tapNumber) && tapNumber > 0 && /coming soon/i.test(productName)) {
    const previous = taps.get(tapNumber) || {};
    taps.set(tapNumber, {
      changedAt: homeComingSoonTime(value) || previous.changedAt || "",
      onDeck: homeComingSoonOnDeck(value) || previous.onDeck || "",
    });
  }
  if (Array.isArray(value)) value.forEach((entry) => homeCollectComingSoonTaps(entry, taps, seen));
  else Object.values(value).forEach((entry) => homeCollectComingSoonTaps(entry, taps, seen));
}

function homePolishBriefingItems(items, sourceArgs) {
  const comingSoonTaps = new Map();
  sourceArgs.forEach((entry) => homeCollectComingSoonTaps(entry, comingSoonTaps));
  let coverageTemplate = null;
  let pmbAdded = false;
  let tapSheetPrintingAdded = false;
  const polished = [];

  for (const item of items || []) {
    const title = homeBriefingTitle(item);
    if (/Weekly Usage coverage is partial/i.test(title)) {
      coverageTemplate ||= item;
      homeBriefingStrings(item).forEach((entry) => homeCollectComingSoonTaps(entry, comingSoonTaps));
      continue;
    }
    if (/Live PMB keg levels are unavailable|Tap pricing is offline|PMB data unavailable/i.test(title)) {
      if (pmbAdded) continue;
      pmbAdded = true;
      polished.push({
        ...item,
        title: "PMB data unavailable",
        heading: "PMB data unavailable",
        label: "PMB data unavailable",
        description: "Click to refresh.",
        detail: "Click to refresh.",
        message: "Click to refresh.",
        body: "Click to refresh.",
        bullets: [],
        details: [],
        detailLines: [],
      });
      continue;
    }
    if (/tap sheets need printing/i.test(title)) {
      if (tapSheetPrintingAdded) continue;
      tapSheetPrintingAdded = true;
    }
    if (/taps? (?:are|is) below the 82% floor/i.test(title)) {
      polished.push({ ...item, actionLabel: "Fix" });
      continue;
    }
    polished.push(item);
  }

  const taps = [...comingSoonTaps.entries()].sort((left, right) => left[0] - right[0]);
  if (taps.length) {
    const tapLabels = taps.map(([tapNumber, status]) => (
      `Tap ${tapNumber}- set to coming soon.${status?.onDeck ? ` On Deck: ${status.onDeck}` : ""}`
    ));
    const title = taps.length === 1 ? tapLabels[0] : `${taps.length} taps set to Coming Soon`;
    polished.push({
      ...(coverageTemplate || {}),
      text: title,
      title,
      heading: title,
      label: title,
      description: "",
      detail: "",
      message: "",
      body: "",
      bullets: taps.length > 1 ? tapLabels : [],
      details: [],
      detailLines: [],
      tone: coverageTemplate?.tone || "warning",
      severity: coverageTemplate?.severity || "warning",
      level: coverageTemplate?.level || "warning",
    });
  }
  return polished;
}

export function buildThirtySecondBriefing(...args) {
  const result = buildThirtySecondBriefingRaw(...args);
  if (Array.isArray(result)) return homePolishBriefingItems(result, args);
  if (!result || typeof result !== "object") return result;
  for (const key of ["items", "lines", "alerts"]) {
    if (Array.isArray(result[key])) {
      return { ...result, [key]: homePolishBriefingItems(result[key], args) };
    }
  }
  return result;
}
