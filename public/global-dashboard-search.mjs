export function normalizeGlobalSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019']/g, "")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const DASHBOARD_SEARCH_FIELD_CACHE = new WeakMap();
const DASHBOARD_DATA_IDENTITY_CACHE = new WeakMap();

function getSearchFields(item) {
  const extraValues = Array.isArray(item?.searchText) ? item.searchText : [item?.searchText];
  const signature = [item?.title, item?.section, item?.subtitle, ...extraValues]
    .map((value) => String(value ?? ""))
    .join("\u0000");
  const cached = item && typeof item === "object" ? DASHBOARD_SEARCH_FIELD_CACHE.get(item) : null;
  if (cached?.signature === signature) return cached.fields;

  const title = normalizeGlobalSearchText(item?.title);
  const section = normalizeGlobalSearchText(item?.section);
  const subtitle = normalizeGlobalSearchText(item?.subtitle);
  const extra = extraValues
    .map(normalizeGlobalSearchText)
    .filter(Boolean)
    .join(" ");
  const fields = {
    title,
    secondary: [section, subtitle, extra].filter(Boolean).join(" "),
    combined: [title, section, subtitle, extra].filter(Boolean).join(" "),
  };
  if (item && typeof item === "object") {
    DASHBOARD_SEARCH_FIELD_CACHE.set(item, { signature, fields });
  }
  return fields;
}

function getDashboardDataIdentity(item) {
  const signature = [item?.name, item?.tapNumber, item?.wall]
    .map((value) => String(value ?? ""))
    .join("\u0000");
  const cached = item && typeof item === "object" ? DASHBOARD_DATA_IDENTITY_CACHE.get(item) : null;
  if (cached?.signature === signature) return cached.identity;

  const identity = {
    haystack: normalizeGlobalSearchText(`${item?.name || ""} ${item?.tapNumber || ""}`),
    wall: normalizeGlobalSearchText(item?.wall),
  };
  if (item && typeof item === "object") {
    DASHBOARD_DATA_IDENTITY_CACHE.set(item, { signature, identity });
  }
  return identity;
}

function getSearchScore(item, query, tokens) {
  const fields = getSearchFields(item);
  if (!tokens.every((token) => fields.combined.includes(token))) return null;

  let score = 0;
  if (fields.title === query) score += 1_000;
  else if (fields.title.startsWith(query)) score += 800;
  else if (fields.title.includes(query)) score += 650;
  else if (fields.combined.includes(query)) score += 350;

  const titleWords = fields.title.split(" ");
  const titleTokenCount = tokens.filter((token) => fields.title.includes(token)).length;
  score += titleTokenCount * 90;
  if (titleTokenCount === tokens.length) score += 220;
  score += tokens.filter((token) => titleWords.some((word) => word.startsWith(token))).length * 30;
  score += tokens.filter((token) => fields.secondary.includes(token)).length * 12;
  if (item?.kind === "section") score += 5;
  return score;
}

export function searchDashboardItems(items, rawQuery, { limit = 12 } = {}) {
  const safeLimit = Math.max(0, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 12);
  if (!safeLimit) return [];

  const uniqueItems = [];
  const seenIds = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = String(item?.id || "").trim();
    if (!id || seenIds.has(id)) return;
    seenIds.add(id);
    uniqueItems.push(item);
  });

  const query = normalizeGlobalSearchText(rawQuery);
  if (!query) {
    return uniqueItems.filter((item) => item?.kind === "section").slice(0, safeLimit);
  }

  const tokens = query.split(" ").filter(Boolean);
  return uniqueItems
    .map((item, index) => ({ item, index, score: getSearchScore(item, query, tokens) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => (
      right.score - left.score
      || String(left.item.title || "").localeCompare(String(right.item.title || ""))
      || left.index - right.index
    ))
    .slice(0, safeLimit)
    .map((entry) => entry.item);
}

const DASHBOARD_QUERY_STOP_WORDS = new Set([
  "a", "all", "an", "and", "are", "at", "bar", "by", "can", "dashboard", "did", "drink",
  "drinks", "find", "for", "from", "had", "has", "have", "in", "is", "it", "last",
  "latest", "me", "of", "on", "one", "or", "past", "please", "recent", "recently", "search", "show",
  "tap", "taps", "that", "the", "this", "to", "wall", "week", "weeks", "what",
  "which", "with", "four", "six", "eight", "twelve", "time", "history",
]);

const DASHBOARD_QUERY_RULE_WORDS = new Set([
  "above", "archived", "beer", "beers", "below", "best", "cocktail", "cocktails", "current",
  "dollar", "dollars", "equal", "exactly", "hidden", "highest", "karaoke", "least",
  "less", "liquor", "liquors", "lowest", "main", "most", "no", "ounce", "ounces",
  "over", "patio", "pour", "poured", "pours", "recent", "revenue", "sale", "sales",
  "profit", "profits", "margin", "shot", "shots", "spirit", "spirits", "than", "top", "under", "usage", "volume", "worst",
]);

const DASHBOARD_PERIOD_WEEK_VALUES = new Map([
  ["one", 1], ["1", 1],
  ["four", 4], ["4", 4],
  ["six", 6], ["6", 6],
  ["eight", 8], ["8", 8],
  ["twelve", 12], ["12", 12],
]);

function getDashboardQueryPeriod(query) {
  if (/\b(?:this|current) week\b/.test(query)) {
    return { key: "this-week", explicit: true, matchedText: "" };
  }
  if (/\b(?:last|previous) week\b/.test(query)) {
    return { key: "last-week", explicit: true, matchedText: "" };
  }
  if (/\b(?:all history|all time)\b/.test(query)) {
    return { key: "all-time", explicit: true, matchedText: "" };
  }

  const windowMatch = query.match(/\b(?:last|past|recent)\s+(one|1|four|4|six|6|eight|8|twelve|12)\s+weeks?\b/);
  if (windowMatch) {
    const weeks = DASHBOARD_PERIOD_WEEK_VALUES.get(windowMatch[1]) || 6;
    return {
      key: weeks === 1 ? "one-week" : `${weeks === 4 ? "four" : weeks === 6 ? "six" : weeks === 8 ? "eight" : "twelve"}-weeks`,
      explicit: true,
      matchedText: windowMatch[0],
    };
  }

  return {
    key: "recent",
    explicit: /\brecent(?:ly)?\b/.test(query),
    matchedText: "",
  };
}

function findDashboardQueryMatches(query, rules) {
  return rules.filter((rule) => rule.pattern.test(query)).map((rule) => rule.value);
}

function getDashboardQueryComparison(query) {
  const rules = [
    { operator: "lte", pattern: /\b(?:at most|no more than)\s+(\d+(?:\.\d+)?)\b/ },
    { operator: "gte", pattern: /\b(?:at least|no less than)\s+(\d+(?:\.\d+)?)\b/ },
    { operator: "lt", pattern: /\b(?:under|below|less than)\s+(\d+(?:\.\d+)?)\b/ },
    { operator: "gt", pattern: /\b(?:above|over|more than)\s+(\d+(?:\.\d+)?)\b/ },
    { operator: "eq", pattern: /\b(?:equal to|equals|exactly)\s+(\d+(?:\.\d+)?)\b/ },
  ];
  for (const rule of rules) {
    const match = query.match(rule.pattern);
    if (match) return { operator: rule.operator, threshold: Number(match[1]) };
  }
  return null;
}

function getDashboardQueryNameTerms(query) {
  return query
    .split(" ")
    .filter(Boolean)
    .filter((token) => !/^\d+(?:\.\d+)?$/.test(token))
    .filter((token) => !DASHBOARD_QUERY_STOP_WORDS.has(token))
    .filter((token) => !DASHBOARD_QUERY_RULE_WORDS.has(token));
}

export function parseDashboardDataQuery(rawQuery) {
  const query = normalizeGlobalSearchText(rawQuery);
  if (!query) {
    return {
      status: "needs-clarification",
      question: "What would you like to find in the dashboard?",
      intent: null,
    };
  }

  const categories = findDashboardQueryMatches(query, [
    { value: "beer", pattern: /\bbeers?\b/ },
    { value: "cocktail", pattern: /\bcocktails?\b/ },
    { value: "liquor", pattern: /\b(?:liquors?|shots?|spirits?)\b/ },
  ]);
  if (categories.length > 1) {
    return {
      status: "needs-clarification",
      question: "Should I search beer, cocktails, or liquor?",
      intent: null,
    };
  }

  const walls = findDashboardQueryMatches(query, [
    { value: "main", pattern: /\bmain(?: bar| wall)?\b/ },
    { value: "patio", pattern: /\bpatio(?: wall)?\b/ },
    { value: "karaoke", pattern: /\bkaraoke(?: wall)?\b/ },
  ]);
  if (walls.length > 1) {
    return {
      status: "needs-clarification",
      question: "Which wall should I use: Main, Patio, or Karaoke?",
      intent: null,
    };
  }

  const hasDollarMetric = /\b(?:sales?|revenue|dollars?)\b/.test(query) || String(rawQuery ?? "").includes("$");
  const hasOunceMetric = /\b(?:ounces?|oz|pours?|poured|volume|usage)\b/.test(query);
  const hasProfitMetric = /\b(?:profits?|margin)\b/.test(query);
  if ([hasDollarMetric, hasOunceMetric, hasProfitMetric].filter(Boolean).length > 1) {
    return {
      status: "needs-clarification",
      question: "Should I compare poured ounces, estimated sales dollars, or projected profit?",
      intent: null,
    };
  }

  let comparison = getDashboardQueryComparison(query);
  let metric = hasProfitMetric ? "profit" : hasDollarMetric ? "dollars" : "ounces";
  if (/\bno\s+(?:sales?|revenue)\b/.test(query)) {
    comparison = { operator: "eq", threshold: 0 };
    metric = "dollars";
  } else if (/\bno\s+(?:pours?|ounces?|usage)\b/.test(query)) {
    comparison = { operator: "eq", threshold: 0 };
    metric = "ounces";
  }

  const periodSelection = getDashboardQueryPeriod(query);
  const comparisonQuery = periodSelection.matchedText
    ? query.replace(periodSelection.matchedText, " ")
    : query;
  const hasNumber = /\b\d+(?:\.\d+)?\b/.test(comparisonQuery);
  if (hasNumber && !comparison) {
    return {
      status: "needs-clarification",
      question: "Should that number be treated as above, below, or exactly the threshold?",
      intent: null,
    };
  }
  if (comparison && !hasDollarMetric && !hasOunceMetric && !hasProfitMetric) {
    return {
      status: "needs-clarification",
      question: "Should I compare that threshold in poured ounces, sales dollars, or projected profit?",
      intent: null,
    };
  }

  const wantsTop = /\b(?:best|highest|top|largest)\b|\bmost\s+(?:poured|sales|volume|ounces)/.test(query);
  const wantsBottom = /\b(?:worst|lowest|least|bottom|smallest)\b/.test(query);
  const sort = wantsTop && wantsBottom ? "both" : wantsTop ? "desc" : wantsBottom ? "asc" : null;
  if (sort && !periodSelection.explicit) {
    return {
      status: "needs-clarification",
      question: "Which period should I rank: last week, this week, or recent history?",
      intent: null,
    };
  }

  const nameTerms = getDashboardQueryNameTerms(query);
  if (!categories.length && !walls.length && !comparison && !sort && !nameTerms.length) {
    return {
      status: "needs-clarification",
      question: "What drink, wall, or comparison should I search for?",
      intent: null,
    };
  }

  return {
    status: "ready",
    question: "",
    intent: {
      category: categories[0] || null,
      wall: walls[0] || null,
      visibility: /\b(?:hidden|archived)\b/.test(query) ? "hidden" : "active",
      metric,
      comparison,
      period: periodSelection.key,
      sort,
      nameTerms,
    },
  };
}

function dashboardQueryValueMatches(value, comparison) {
  if (!comparison) return true;
  const difference = value - comparison.threshold;
  if (comparison.operator === "lt") return difference < 0;
  if (comparison.operator === "lte") return difference <= 0;
  if (comparison.operator === "gt") return difference > 0;
  if (comparison.operator === "gte") return difference >= 0;
  return Math.abs(difference) < 0.01;
}

export function searchDashboardData(items, rawQuery, { limit = 50 } = {}) {
  const parsed = parseDashboardDataQuery(rawQuery);
  if (parsed.status !== "ready") return { ...parsed, results: [] };

  const safeLimit = Math.max(1, Math.min(100, Math.floor(Number(limit) || 50)));
  const { intent } = parsed;
  const matches = (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .filter((item) => intent.visibility === "hidden" ? item.hidden === true : item.hidden !== true)
    .filter((item) => !intent.category || item.category === intent.category)
    .filter((item) => !intent.wall || getDashboardDataIdentity(item).wall === intent.wall)
    .filter((item) => {
      const { haystack } = getDashboardDataIdentity(item);
      return intent.nameTerms.every((term) => haystack.includes(term));
    })
    .map((item) => {
      const savedPeriod = item.periods?.[intent.period] || null;
      const period = savedPeriod || (item.hidden && intent.comparison?.operator === "eq" && intent.comparison.threshold === 0
        ? { label: "No recorded activity", ounces: 0, dollars: 0 }
        : null);
      if (!period) return null;
      const value = Number(period[intent.metric]);
      if (!Number.isFinite(value) || !dashboardQueryValueMatches(value, intent.comparison)) return null;
      return {
        ...item,
        value,
        ounces: Number.isFinite(Number(period.ounces)) ? Number(period.ounces) : null,
        dollars: Number.isFinite(Number(period.dollars)) ? Number(period.dollars) : null,
        periodLabel: period.label || "Selected period",
      };
    })
    .filter(Boolean);

  const compareNames = (left, right) => String(left.name || "").localeCompare(String(right.name || ""));
  const compareValues = (direction) => (left, right) => direction * (left.value - right.value) || compareNames(left, right);

  if (intent.sort === "both") {
    const groupLimit = Math.min(5, safeLimit);
    const top = [...matches]
      .sort(compareValues(-1))
      .slice(0, groupLimit)
      .map((item, index) => ({ ...item, rankingGroup: "top", rankingPosition: index + 1 }));
    const bottom = [...matches]
      .sort(compareValues(1))
      .slice(0, groupLimit)
      .map((item, index) => ({ ...item, rankingGroup: "bottom", rankingPosition: index + 1 }));
    return {
      ...parsed,
      results: [...top, ...bottom],
      groups: { top, bottom },
    };
  }

  matches.sort(intent.sort === "desc"
    ? compareValues(-1)
    : intent.sort === "asc"
      ? compareValues(1)
      : compareNames);

  return {
    ...parsed,
    results: matches.slice(0, intent.sort ? 1 : safeLimit),
  };
}
