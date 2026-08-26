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

function inferVendorFromProducts(query, vendors) {
  const ranked = vendors
    .map((vendor) => ({
      vendor,
      matches: (Array.isArray(vendor.items) ? vendor.items : []).filter((item) => (
        getProductAliases(item).some((alias) => alias.length >= 3 && query.includes(alias))
      )).length,
    }))
    .filter((entry) => entry.matches > 0)
    .sort((left, right) => right.matches - left.matches);
  if (!ranked.length || (ranked[1] && ranked[1].matches === ranked[0].matches)) return null;
  return ranked[0].vendor;
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

function getQuantitiesWithoutProduct(clause, item) {
  let quantityText = normalize(clause);
  const aliases = getProductAliases(item).sort((left, right) => right.length - left.length);
  const directAlias = aliases.find((alias) => quantityText.includes(alias));
  if (directAlias) quantityText = quantityText.replace(directAlias, " ");
  return [...quantityText.matchAll(/\b\d+\b/g)].map((match) => Number(match[0]));
}

function splitNarrativeClauses(value) {
  return clean(value)
    .replace(/[.;:\n]+/g, " | ")
    .replace(/[\u2013\u2014-]+/g, " | ")
    .split(/\s*(?:\||\bexcept\b|\bbut\b|\bhowever\b|\band\b|\bthen\b|\balso\b)\s*/i)
    .map(clean)
    .filter(Boolean);
}

function explicitReceivedQuantity(clause, item) {
  const normalizedClause = normalize(clause);
  const actionMatch = normalizedClause.match(/\b(?:did get|got|received|accepted|came with|delivered)\s+(\d+)\b/);
  if (actionMatch) return Number(actionMatch[1]);
  for (const alias of getProductAliases(item).sort((left, right) => right.length - left.length)) {
    const aliasIndex = normalizedClause.indexOf(alias);
    if (aliasIndex < 0) continue;
    const beforeProduct = normalizedClause.slice(0, aliasIndex);
    const quantityMatch = beforeProduct.match(/(\d+)\s*(?:bottles?|cases?|kegs?|units?|of)?\s*$/);
    if (quantityMatch) return Number(quantityMatch[1]);
  }
  return null;
}

function buildLineProposal(clause, item) {
  const orderedQuantity = Number(item.quantity) || 0;
  const normalizedClause = normalize(clause);
  const quantities = getQuantitiesWithoutProduct(clause, item);
  const statedQuantity = quantities[0] ?? null;
  const actualQuantity = explicitReceivedQuantity(clause, item);
  const rejected = /\b(?:bad|broken|damaged|leaking|rejected|spoiled|unusable|wrong product)\b/.test(normalizedClause);
  const unavailable = /\b(?:out of stock|unavailable|not available|didnt get|did not get|not delivered|never arrived|missing)\b/.test(normalizedClause);
  const short = /\b(?:short|shorted|missing)\b/.test(normalizedClause);
  const noneReceived = /\b(?:no|none|nothing|didnt get|did not get|never arrived|not delivered)\b/.test(normalizedClause);
  const actualMode = /\b(?:did get|got|received|accepted|came with|delivered|only got|only received)\b/.test(normalizedClause);
  const extraMode = /\b(?:extra|more than|instead of|plan said|ordered only|overage)\b/.test(normalizedClause);
  let receivedQuantity = orderedQuantity;
  let reason = "";
  let handled = false;

  if (rejected) {
    receivedQuantity = 0;
    reason = /\bbad\b/.test(normalizedClause) ? "Rejected: product was bad" : "Rejected at delivery";
    handled = true;
  } else if (unavailable) {
    const missingQuantity = statedQuantity ?? orderedQuantity;
    receivedQuantity = noneReceived ? 0 : Math.max(0, orderedQuantity - missingQuantity);
    reason = /\bout of stock\b/.test(normalizedClause) ? "Out of stock" : "Missing from delivery";
    handled = true;
  } else if (short) {
    receivedQuantity = Math.max(0, orderedQuantity - (statedQuantity ?? 1));
    reason = `Received ${receivedQuantity} of ${orderedQuantity}`;
    handled = true;
  } else if (actualMode && actualQuantity !== null) {
    receivedQuantity = actualQuantity;
    handled = true;
  } else if (extraMode && actualQuantity !== null) {
    receivedQuantity = actualQuantity;
    handled = true;
  }

  if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > 9999) {
    return { line: null, handled };
  }

  const status = receivedQuantity > orderedQuantity
    ? "extra"
    : receivedQuantity >= orderedQuantity
      ? "received"
      : receivedQuantity > 0
        ? "partial"
        : rejected ? "rejected" : "not-received";
  if (!reason && status === "extra") reason = `Received ${receivedQuantity}; ordered ${orderedQuantity}`;
  if (!reason && status === "partial") reason = `Received ${receivedQuantity} of ${orderedQuantity}`;

  return { handled, line: {
    itemId: clean(item.id),
    name: clean(item.name),
    quantity: orderedQuantity,
    unit: clean(item.unit),
    receivedQuantity,
    status,
    reason,
  } };
}

function isGenericDeliveryClause(clause) {
  const normalizedClause = normalize(clause);
  return /\b(?:everything|all)\s+(?:came|arrived|was delivered|received)\b/.test(normalizedClause)
    || /\b(?:full|complete)\s+(?:delivery|order)\b/.test(normalizedClause)
    || /\b(?:delivery|order)\s+(?:came|arrived)\b/.test(normalizedClause);
}

function clauseNeedsProductClarification(clause) {
  return /\b(?:out of stock|unavailable|not delivered|missing|short|shorted|rejected|bad|damaged|broken|extra)\b/.test(normalize(clause));
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
  const orderedVendors = vendors.filter((entry) => entry.ordered);
  const vendor = vendorMatches.length === 1
    ? vendorMatches[0]
    : vendorMatches.length === 0
      ? inferVendorFromProducts(query, orderedVendors)
        || (orderedVendors.length === 1 ? orderedVendors[0] : null)
      : null;
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
  const fullDelivery = /\b(?:everything|all)\s+(?:came|arrived|was delivered|received)\b|\b(?:full|complete)\s+(?:delivery|order)\b/.test(query);
  const hasException = /\b(?:except|missing|short|without|out of stock|unavailable|rejected|bad|damaged|broken|didnt get|did not get|only got|only received|extra)\b/.test(query);
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
    reason: "",
  }));

  const noteClauses = [];
  const clauses = splitNarrativeClauses(transcript);
  for (const clause of clauses) {
    if (isGenericDeliveryClause(clause)) continue;
    const match = findProductMatch(clause, items);
    if (match.status !== "matched") {
      if (clauseNeedsProductClarification(clause)) {
        return {
          status: "needs-clarification",
          question: match.status === "ambiguous"
            ? `Which ${clean(vendor.vendor)} product did you mean?`
            : `Which ${clean(vendor.vendor)} product did "${clean(clause)}" mean?`,
          proposal: null,
        };
      }
      const normalizedClause = normalize(clause);
      const mentionsVendorOnly = Object.values(VENDOR_ALIASES).flat().some((alias) => normalizedClause === normalize(alias));
      if (!mentionsVendorOnly) noteClauses.push(clause);
      continue;
    }
    const result = buildLineProposal(clause, match.item);
    if (!result.line) {
      return {
        status: "needs-clarification",
        question: `How many ${clean(match.item.name)} units were received?`,
        proposal: null,
      };
    }
    const index = proposals.findIndex((entry) => entry.itemId === result.line.itemId);
    proposals[index] = result.line;
    if (!result.handled) noteClauses.push(clause);
  }

  return {
    status: "ready",
    question: "",
    proposal: {
      generatedAt: clean(orderTracking.generatedAt),
      vendorId: clean(vendor.id),
      vendor: clean(vendor.vendor),
      lines: proposals,
      note: clean(noteClauses.join("; ")),
    },
  };
}
