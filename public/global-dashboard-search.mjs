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

export function normalizeDashboardQuestion(value) {
  return normalizeGlobalSearchText(value)
    .replace(/\bpbrs?\b/g, "pabst blue ribbon")
    .replace(/\b(?:customers? favorites?|guest favorites?|most popular|best sellers?|bestselling)\b/g, "highest poured volume")
    .replace(/\b(?:slowest selling|least popular)\b/g, "lowest poured volume")
    .replace(/\b(?:makes?|making|earns?|earning|generates?|generating) (?:us )?(?:the )?most profit\b/g, "highest profit")
    .replace(/\b(?:over|during|across) (?:the )?(?:(?:last|past) )?(one|1|four|4|six|6|eight|8|twelve|12) weeks?\b/g, "last $1 weeks")
    .replace(/\b(?:pabst blue ribbon|titos) s\b/g, (match) => match.slice(0, -2));
}

export function getConversationalItemQuery(value) {
  return normalizeDashboardQuestion(value)
    .replace(/^(?:(?:can|could|would) you )?(?:please )?(?:find|show|open|look up|tell me about)(?: me)?\s+/, "")
    .replace(/^(?:the|a|an)\s+/, "")
    .replace(/\s+(?:recipe|please)$/, "");
}

export function describeDashboardDataSearch(search) {
  const results = search?.results || [];
  if (!results.length || !search.intent) return "";
  const first = results[0];
  const format = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  const currency = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
  if (search.intent.aggregation === "total" && metricIsVolume(search.intent.metric) && Number.isFinite(search.aggregateValue)) {
    return `${format(search.aggregateValue)} oz poured across ${search.total} matching tap/product records. ${first.periodLabel}.${search.partialCoverage ? " This is a recorded subtotal: some requested weeks have missing or unverified usage, which was not counted as zero." : ""}`;
  }
  const metric = search.intent.metric;
  const measure = metric === "margin" ? `${format(first.value)}% estimated gross margin`
    : metric === "profit" ? `${currency(first.value)} estimated gross profit`
      : metric === "dollars" ? `${currency(first.value)} estimated sales` : `${format(first.value)} oz poured`;
  const leader = search.intent.sort === "desc" ? " has the highest matching value"
    : search.intent.sort === "asc" ? " has the lowest matching value" : "";
  const scope = [first.name, first.wall, first.tapNumber ? `Tap ${first.tapNumber}` : ""].filter(Boolean).join(" / ");
  let text = `${scope}${leader}: ${measure}. Period: ${first.periodLabel}.`;
  if (metric === "profit" && Number.isFinite(first.ounces) && Number.isFinite(first.profitPerOz)) {
    text += ` Calculation: ${format(first.ounces)} oz x ${currency(first.profitPerOz)} estimated profit per oz (using unrounded values).`;
  }
  if (metric === "margin" && first.sellingPricePerOz > 0 && Number.isFinite(first.profitPerOz)) {
    text += ` Calculation: estimated profit per oz divided by selling price per oz x 100.`;
  }
  if (["profit", "margin", "dollars"].includes(metric)) {
    text += " These are estimates using the dashboard's current pricing assumptions, not recorded sales or net profit.";
  }
  if (search.intent.period === "recent") text += " No period was specified, so I used the recent saved-week average.";
  if (results.length > 1) text += ` ${results.length} matching results are shown below.`;
  return text;
}

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
  if (!tokens.every((token) => searchTokenMatches(token, fields.combined))) return null;

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
  score -= tokens.filter((token) => !fields.combined.includes(token)).length * 160;
  return score;
}

function searchTokenMatches(token, text) {
  const words = text.split(" ");
  if (/^\d+$/.test(token)) return words.includes(token);
  if (text.includes(token)) return true;
  if (token.length < 4 || /\d/.test(token)) return false;
  const distanceLimit = token.length >= 8 ? 2 : 1;
  return words.some((word) => {
    if (Math.abs(word.length - token.length) > distanceLimit || /\d/.test(word)) return false;
    if (word.length === token.length) {
      const mismatches = [...token].flatMap((letter, index) => letter === word[index] ? [] : [index]);
      if (mismatches.length === 2 && mismatches[1] === mismatches[0] + 1
        && token[mismatches[0]] === word[mismatches[1]] && token[mismatches[1]] === word[mismatches[0]]) return true;
    }
    let previous = Array.from({ length: word.length + 1 }, (_, index) => index);
    for (let i = 1; i <= token.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= word.length; j += 1) {
        current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + Number(token[i - 1] !== word[j - 1]));
      }
      previous = current;
    }
    return previous[word.length] <= distanceLimit;
  });
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
  "total", "altogether", "overall", "combined",
  "a", "all", "an", "and", "are", "at", "bar", "by", "can", "dashboard", "did", "drink",
  "drinks", "find", "for", "from", "had", "has", "have", "in", "is", "it", "last",
  "latest", "me", "of", "on", "one", "or", "past", "please", "recent", "recently", "search", "show",
  "tap", "taps", "that", "the", "this", "to", "wall", "week", "weeks", "what",
  "which", "with", "four", "six", "eight", "twelve", "time", "history",
  "how", "much", "many", "do", "does", "we", "our", "my", "tell", "about", "average", "avg",
  "why", "explain", "could", "would", "you", "us", "getting", "get", "so", "such", "been", "being",
  "was", "were", "during", "across", "previous", "looking", "look", "at", "doing", "performing",
  "compared", "compare", "versus", "vs", "between",
]);

const DASHBOARD_QUERY_RULE_WORDS = new Set([
  "above", "archived", "beer", "beers", "below", "best", "cocktail", "cocktails", "current",
  "dollar", "dollars", "equal", "exactly", "hidden", "highest", "karaoke", "least",
  "less", "liquor", "liquors", "lowest", "main", "most", "no", "ounce", "ounces",
  "over", "patio", "pour", "poured", "pours", "recent", "revenue", "sale", "sales",
  "profit", "profits", "margin", "shot", "shots", "spirit", "spirits", "than", "top", "under", "usage", "volume", "worst",
  "bottom", "largest", "smallest", "oz", "percent", "estimated", "projected", "gross", "sellers", "selling",
  "high", "low", "profitable", "profitability",
]);

const DASHBOARD_PERIOD_WEEK_VALUES = new Map([
  ["one", 1], ["1", 1],
  ["two", 2], ["three", 3], ["five", 5], ["seven", 7],
  ["nine", 9], ["ten", 10], ["eleven", 11],
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

  const windowMatch = query.match(/\b(?:last|past|recent)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+weeks?\b/);
  if (windowMatch) {
    const weeks = DASHBOARD_PERIOD_WEEK_VALUES.get(windowMatch[1]) || Number(windowMatch[1]);
    return {
      key: ({ 1: "one-week", 4: "four-weeks", 6: "six-weeks", 8: "eight-weeks", 12: "twelve-weeks" })[weeks] || `${weeks}-weeks`,
      weeks,
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
    .filter((token) => !DASHBOARD_QUERY_STOP_WORDS.has(token))
    .filter((token) => !DASHBOARD_QUERY_RULE_WORDS.has(token));
}

export function parseDashboardDataQuery(rawQuery) {
  const query = normalizeDashboardQuestion(String(rawQuery ?? "").replace(/(\d)\.(?=\d)/g, "$1decimalpoint"))
    .replace(/(\d)decimalpoint(?=\d)/g, "$1.");
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
  const hasProfitMetric = /\b(?:profits?|margin|profitable|profitability)\b/.test(query);
  if ([hasDollarMetric, hasOunceMetric, hasProfitMetric].filter(Boolean).length > 1) {
    return {
      status: "needs-clarification",
      question: "Should I compare poured ounces, estimated sales dollars, or projected profit?",
      intent: null,
    };
  }

  let comparison = getDashboardQueryComparison(query);
  let metric = /\bmargin\b/.test(query) ? "margin" : hasProfitMetric ? "profit" : hasDollarMetric ? "dollars" : "ounces";
  if (/\bno\s+(?:sales?|revenue)\b/.test(query)) {
    comparison = { operator: "eq", threshold: 0 };
    metric = "dollars";
  } else if (/\bno\s+(?:pours?|ounces?|usage)\b/.test(query)) {
    comparison = { operator: "eq", threshold: 0 };
    metric = "ounces";
  }

  const periodSelection = getDashboardQueryPeriod(query);
  if (periodSelection.weeks != null && (periodSelection.weeks < 1 || periodSelection.weeks > 104)) {
    return { status: "needs-clarification", question: "Please choose between 1 and 104 saved weeks.", intent: null };
  }
  const tapMatch = query.match(/\btap\s+(\d+)\b/) || query.match(/^(\d{1,3})$/);
  const rankMatch = query.match(/\b(?:top|bottom|best|worst|highest|lowest)\s+(\d+)\b/);
  if (comparison && !hasDollarMetric && !hasOunceMetric && !hasProfitMetric) {
    return {
      status: "needs-clarification",
      question: "Should I compare that threshold in poured ounces, sales dollars, or projected profit?",
      intent: null,
    };
  }

  const wantsTop = /\b(?:best|highest|top|largest)\b|\bmost\s+(?:poured|sales|volume|ounces|profit|profitable)/.test(query);
  const wantsBottom = /\b(?:worst|lowest|least|bottom|smallest)\b/.test(query);
  const sort = wantsTop && wantsBottom ? "both" : wantsTop ? "desc" : wantsBottom ? "asc" : null;
  let nameQuery = query.replace(periodSelection.matchedText || /$^/, " ");
  if (tapMatch) nameQuery = nameQuery.replace(tapMatch[0], " ");
  if (rankMatch) nameQuery = nameQuery.replace(rankMatch[0], " ");
  if (comparison) nameQuery = nameQuery.replace(/\b\d+(?:\.\d+)?\b/g, " ");
  const nameTerms = getDashboardQueryNameTerms(nameQuery);
  if (!categories.length && !walls.length && !comparison && !sort && !nameTerms.length && !tapMatch) {
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
      weekCount: periodSelection.weeks || null,
      aggregation: !/\b(?:average|avg|per week|weekly)\b/.test(query)
        && /\b(?:how much|how many|total|altogether|overall|combined)\b/.test(query) ? "total" : "average",
      sort,
      tapNumber: tapMatch ? Number(tapMatch[1]) : null,
      rankLimit: rankMatch ? Math.max(1, Math.min(100, Number(rankMatch[1]))) : sort === "both" ? 5 : 1,
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

function metricIsVolume(metric) {
  return metric === "ounces";
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
    .filter((item) => !intent.tapNumber || Number(item.tapNumber) === intent.tapNumber)
    .filter((item) => {
      const { haystack } = getDashboardDataIdentity(item);
      return intent.nameTerms.every((term) => searchTokenMatches(term, haystack));
    })
    .map((item) => {
      const originalPeriod = item.periods?.[intent.period] || null;
      const savedPeriod = intent.aggregation === "total" && originalPeriod?.totals
        ? { ...originalPeriod, ...originalPeriod.totals, label: originalPeriod.totalLabel }
        : originalPeriod;
      const period = savedPeriod || (item.hidden && intent.comparison?.operator === "eq" && intent.comparison.threshold === 0
        ? { label: "No recorded activity", ounces: 0, dollars: 0 }
        : null);
      if (!period) return null;
      if (period[intent.metric] == null || period[intent.metric] === "") return null;
      const value = Number(period[intent.metric]);
      if (!Number.isFinite(value) || !dashboardQueryValueMatches(value, intent.comparison)) return null;
      return {
        ...item,
        value,
        ounces: period.ounces != null && Number.isFinite(Number(period.ounces)) ? Number(period.ounces) : null,
        dollars: period.dollars != null && Number.isFinite(Number(period.dollars)) ? Number(period.dollars) : null,
        periodLabel: period.label || "Selected period",
        partialCoverage: period.partialCoverage === true,
      };
    })
    .filter(Boolean);

  const compareNames = (left, right) => String(left.name || "").localeCompare(String(right.name || ""));
  const compareValues = (direction) => (left, right) => direction * (left.value - right.value) || compareNames(left, right);

  if (intent.sort === "both") {
    const groupLimit = Math.min(intent.rankLimit, safeLimit);
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
    total: matches.length,
    aggregateValue: matches.reduce((total, item) => total + item.value, 0),
    partialCoverage: matches.some((item) => item.partialCoverage),
    results: matches.slice(0, intent.sort ? Math.min(intent.rankLimit, safeLimit) : safeLimit),
  };
}
