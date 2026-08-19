function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9.%\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function finiteOunces(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function getPercentChange(text) {
  if (/\b(?:double|twice)\b/.test(text)) return 100;
  if (/\bhalf\b/.test(text)) return -50;

  const percent = Number(text.match(/\b(\d+(?:\.\d+)?)\s*%/)?.[1]);
  if (!Number.isFinite(percent)) return null;
  if (/\b(?:lower|less|decrease|decreased|down|drop|decline|slower)\b/.test(text)) return -percent;
  if (/\b(?:higher|more|increase|increased|up|grow|growth|busier)\b/.test(text)) return percent;
  return null;
}

function getWall(text) {
  return ["main", "patio", "karaoke"].find((wall) => new RegExp(`\\b${wall}\\b`).test(text)) || "all";
}

function getCategory(text) {
  if (/\b(?:cocktail|cocktails|mixed drink|mixed drinks)\b/.test(text)) return "cocktail";
  if (/\b(?:beer|beers)\b/.test(text)) return "beer";
  if (/\b(?:liquor|liquors|spirit|spirits|shot|shots)\b/.test(text)) return "liquor";
  return "all";
}

function getPeriod(text) {
  if (/\blast week\b/.test(text)) return "last-week";
  if (/\bthis week\b/.test(text)) return "this-week";
  return "recent";
}

export function parseWhatIfScenario(query) {
  const text = normalize(query);
  if (!text) {
    return { status: "needs-clarification", question: "What change should I preview?" };
  }
  if (/\b(?:sales|revenue|dollars?|profit)\b/.test(text)) {
    return {
      status: "needs-clarification",
      question: "Should I model poured volume instead? Wristband events make sales unreliable.",
    };
  }
  const percentChange = getPercentChange(text);
  if (percentChange === null) {
    return { status: "needs-clarification", question: "What percentage increase or decrease should I preview?" };
  }
  if (percentChange <= -100 || percentChange > 300) {
    return { status: "needs-clarification", question: "Choose a change between a 99% decrease and a 300% increase." };
  }
  return {
    status: "ready",
    intent: {
      percentChange,
      multiplier: 1 + (percentChange / 100),
      wall: getWall(text),
      category: getCategory(text),
      period: getPeriod(text),
    },
  };
}

export function buildWhatIfPlan(items = [], query = "") {
  const parsed = parseWhatIfScenario(query);
  if (parsed.status !== "ready") return parsed;

  const { intent } = parsed;
  const eligible = (Array.isArray(items) ? items : []).filter((item) => (
    (intent.wall === "all" || normalize(item?.wall) === intent.wall)
    && (intent.category === "all" || normalize(item?.category) === intent.category)
    && item?.hidden !== true
  ));
  const rows = [];
  let unavailableCount = 0;

  eligible.forEach((item) => {
    const period = item?.periods?.[intent.period];
    const baselineOz = finiteOunces(period?.ounces);
    if (baselineOz === null) {
      unavailableCount += 1;
      return;
    }
    const projectedOz = baselineOz * intent.multiplier;
    rows.push({
      id: clean(item.id),
      name: clean(item.name) || "Unnamed product",
      wall: clean(item.wall),
      category: clean(item.category),
      tapNumber: Number(item.tapNumber) || null,
      periodLabel: clean(period?.label),
      baselineOz,
      projectedOz,
      changeOz: projectedOz - baselineOz,
    });
  });

  if (!rows.length) {
    return {
      status: "no-data",
      intent,
      message: eligible.length
        ? "No verified poured-volume history is available for that scenario."
        : "No active products match that scenario.",
    };
  }

  rows.sort((left, right) => Math.abs(right.changeOz) - Math.abs(left.changeOz)
    || right.projectedOz - left.projectedOz
    || left.name.localeCompare(right.name));
  const baselineOz = rows.reduce((total, item) => total + item.baselineOz, 0);
  const projectedOz = rows.reduce((total, item) => total + item.projectedOz, 0);

  return {
    status: "ready",
    intent,
    rows,
    baselineOz,
    projectedOz,
    changeOz: projectedOz - baselineOz,
    unavailableCount,
    periodLabel: rows[0]?.periodLabel || "Saved usage",
    previewOnly: true,
  };
}
