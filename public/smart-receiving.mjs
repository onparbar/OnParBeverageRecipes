const NUMBER_WORDS = Object.freeze({
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

const VENDOR_ALIASES = Object.freeze({
  bonbright: ["bonbright", "bon bright", "tj"],
  heidelberg: ["heidelberg", "heildelberg", "heidleberg", "bees"],
  proof: ["proof", "sg proof"],
  ohlq: ["ohlq", "oh l q", "ohio liquor"],
});

const PRODUCT_STOP_WORDS = new Set([
  "a", "all", "and", "arrived", "beer", "bottle", "bottles", "but", "came",
  "case", "cases", "delivery", "did", "didnt", "everything", "except", "full",
  "get", "got", "item", "items", "keg", "kegs", "missing", "no", "none", "of",
  "only", "order", "received", "regular", "short", "the", "unit", "units", "was",
  "were", "without",
]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019']/g, "")
    .toLowerCase()
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (word) => String(NUMBER_WORDS[word]))
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function vendorAliasKey(vendor) {
  const normalized = normalize(vendor);
  return Object.keys(VENDOR_ALIASES).find((key) => normalized.includes(key)) || normalized;
}

function getVendorMatches(query, vendors) {
  return vendors.filter((vendor) => {
    const normalizedVendor = normalize(vendor.vendor);
    const aliases = VENDOR_ALIASES[vendorAliasKey(vendor.vendor)] || [normalizedVendor];
    return [normalizedVendor, ...aliases].some((alias) => query.includes(normalize(alias)));
  });
}

function getProductAliases(item) {
  const full = normalize(item?.name);
  const withoutParenthetical = normalize(String(item?.name || "").replace(/\([^)]*\)/g, " "));
  const withoutGenericWords = withoutParenthetical
    .split(" ")
    .filter((token) => !new Set(["beer", "keg", "bottle", "case"]).has(token))
    .join(" ");
  return [...new Set([full, withoutParenthetical, withoutGenericWords].filter(Boolean))];
}

function getMeaningfulTokens(value) {
  return normalize(value)
    .split(" ")
    .filter(Boolean)
    .filter((token) => !PRODUCT_STOP_WORDS.has(token))
    .filter((token) => !/^\d+$/.test(token));
}

function scoreProductMatch(clause, item) {
  const normalizedClause = normalize(clause);
  const aliases = getProductAliases(item);
  const direct = aliases
    .filter((alias) => alias.length >= 3 && normalizedClause.includes(alias))
    .sort((left, right) => right.length - left.length)[0];
  if (direct) return { score: 1000 + direct.length, alias: direct };

  const clauseTokens = new Set(getMeaningfulTokens(normalizedClause));
  let best = { score: 0, alias: aliases[0] || "" };
  aliases.forEach((alias) => {
    const tokens = getMeaningfulTokens(alias);
    if (!tokens.length) return;
    const matched = tokens.filter((token) => clauseTokens.has(token)).length;
    const coverage = matched / tokens.length;
    const score = matched > 0 && coverage >= 0.5 ? Math.round(coverage * 100) + matched * 12 : 0;
    if (score > best.score) best = { score, alias };
  });
  return best;
}

function findProductMatch(clause, items) {
  const ranked = items
    .map((item) => ({ item, ...scoreProductMatch(clause, item) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || String(left.item.name).localeCompare(String(right.item.name)));
  if (!ranked.length) return { status: "missing", item: null };
  if (ranked[1] && ranked[1].score === ranked[0].score) return { status: "ambiguous", item: null };
  return { status: "matched", item: ranked[0].item };
}

function getQuantityWithoutProduct(clause, item) {
  let quantityText = normalize(clause);
  const aliases = getProductAliases(item).sort((left, right) => right.length - left.length);
  const directAlias = aliases.find((alias) => quantityText.includes(alias));
  if (directAlias) quantityText = quantityText.replace(directAlias, " ");
  const match = quantityText.match(/\b\d+\b/);
  return match ? Number(match[0]) : null;
}

function splitExceptionClauses(query) {
  const exceptMatch = query.match(/\bexcept\b(.+)$/);
  const missingMatch = query.match(/\bmissing\b(.+)$/);
  const withoutMatch = query.match(/\bwithout\b(.+)$/);
  const source = exceptMatch?.[1] || missingMatch?.[1] || withoutMatch?.[1] || query;
  return source
    .split(/\s*(?:,|;|\band\b)\s*/)
    .map(clean)
    .filter(Boolean)
    .filter((clause) => /\b(?:\d+|no|none|missing|short|only|didnt|get|got|received)\b/.test(clause));
}

function buildExceptionProposal(clause, item) {
  const orderedQuantity = Number(item.quantity) || 0;
  const statedQuantity = getQuantityWithoutProduct(clause, item);
  const noneReceived = /\b(?:no|none|didnt get|did not get)\b/.test(clause);
  const receivedMode = /\b(?:only got|got only|only received|received only)\b/.test(clause);
  let receivedQuantity;
  if (noneReceived) {
    receivedQuantity = 0;
  } else if (receivedMode) {
    receivedQuantity = statedQuantity;
  } else {
    const missingQuantity = statedQuantity ?? 1;
    receivedQuantity = orderedQuantity - missingQuantity;
  }
  if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > orderedQuantity) {
    return null;
  }
  return {
    itemId: clean(item.id),
    name: clean(item.name),
    quantity: orderedQuantity,
    unit: clean(item.unit),
    receivedQuantity,
    status: receivedQuantity >= orderedQuantity
      ? "received"
      : receivedQuantity > 0 ? "partial" : "not-received",
  };
}

export function parseSmartReceivingTranscript(rawTranscript, orderTracking = {}) {
  const transcript = clean(rawTranscript);
  const query = normalize(transcript);
  const vendors = Array.isArray(orderTracking?.vendors) ? orderTracking.vendors : [];
  if (!query) {
    return { status: "needs-clarification", question: "What delivery arrived?", proposal: null };
  }
  if (!orderTracking?.available || !vendors.length) {
    return { status: "blocked", question: "There is no current vendor order to receive.", proposal: null };
  }

  const vendorMatches = getVendorMatches(query, vendors);
  const vendor = vendorMatches.length === 1
    ? vendorMatches[0]
    : vendorMatches.length === 0 && vendors.length === 1 ? vendors[0] : null;
  if (!vendor) {
    return {
      status: "needs-clarification",
      question: vendorMatches.length > 1 ? "Which vendor delivery is this?" : "Which vendor arrived?",
      proposal: null,
    };
  }
  if (!vendor.ordered) {
    return { status: "blocked", question: `${clean(vendor.vendor)} is not marked as ordered yet.`, proposal: null };
  }

  const items = Array.isArray(vendor.items) ? vendor.items : [];
  if (!items.length) {
    return { status: "blocked", question: `${clean(vendor.vendor)} has no current delivery lines.`, proposal: null };
  }
  const fullDelivery = /\b(?:everything|all)\s+(?:came|arrived|received)\b|\b(?:full|complete)\s+(?:delivery|order)\b/.test(query);
  const hasException = /\b(?:except|missing|short|without|didnt get|did not get|only got|only received)\b/.test(query);
  if (!fullDelivery && !hasException) {
    return {
      status: "needs-clarification",
      question: `Did the entire ${clean(vendor.vendor)} order arrive?`,
      proposal: null,
    };
  }

  const proposals = items.map((item) => ({
    itemId: clean(item.id),
    name: clean(item.name),
    quantity: Number(item.quantity) || 0,
    unit: clean(item.unit),
    receivedQuantity: Number(item.quantity) || 0,
    status: "received",
  }));

  if (hasException) {
    const clauses = splitExceptionClauses(query);
    if (!clauses.length) {
      return { status: "needs-clarification", question: "Which product was short or missing?", proposal: null };
    }
    for (const clause of clauses) {
      const match = findProductMatch(clause, items);
      if (match.status !== "matched") {
        return {
          status: "needs-clarification",
          question: match.status === "ambiguous"
            ? `Which ${clean(vendor.vendor)} product did you mean?`
            : `Which ${clean(vendor.vendor)} product did "${clean(clause)}" mean?`,
          proposal: null,
        };
      }
      const exception = buildExceptionProposal(clause, match.item);
      if (!exception) {
        return {
          status: "needs-clarification",
          question: `How many ${clean(match.item.name)} units were received?`,
          proposal: null,
        };
      }
      const index = proposals.findIndex((entry) => entry.itemId === exception.itemId);
      proposals[index] = exception;
    }
  }

  return {
    status: "ready",
    question: "",
    proposal: {
      generatedAt: clean(orderTracking.generatedAt),
      vendorId: clean(vendor.id),
      vendor: clean(vendor.vendor),
      lines: proposals,
    },
  };
}
