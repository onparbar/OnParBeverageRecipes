const MIN_CARD_COUNT = 4;
const MAX_CARD_COUNT = 6;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const BEVERAGE_NEWS_VIEW_DEFAULTS = Object.freeze({
  minItems: MIN_CARD_COUNT,
  maxItems: MAX_CARD_COUNT,
  feedFreshMinutes: 60,
  feedStaleHours: 6,
  articleNewHours: 24,
  articleRecentDays: 7,
});

const SUCCESS_STATUSES = new Set(["ok", "ready", "success", "fresh"]);
const OFFLINE_STATUSES = new Set(["error", "failed", "offline", "unavailable"]);

function clean(value, maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.round(finiteNumber(value, fallback));
  return Math.min(maximum, Math.max(minimum, number));
}

function validDate(value) {
  const text = clean(value, 80);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedNow(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return validDate(value) || new Date();
}

function ageMilliseconds(value, now) {
  const date = validDate(value);
  if (!date) return Number.POSITIVE_INFINITY;
  return Math.max(0, now.getTime() - date.getTime());
}

export function getSafeBeverageNewsUrl(value) {
  const text = clean(value, 2_000);
  if (!text) return "";
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function sourceFromUrl(url) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

const TOPICS = Object.freeze([
  { key: "non-alcoholic", label: "Non-alcoholic", pattern: /\bnon[- ]?alcoholic|alcohol[- ]?free|zero[- ]proof|sober|functional beverage|mocktail\b/i },
  { key: "beer", label: "Beer", pattern: /\bbeer|brew(?:er|ery|ing)?|ale|lager|ipa|stout|pilsner\b/i },
  { key: "cocktails", label: "Cocktails", pattern: /\bcocktail|mixology|bartend|highball\b/i },
  { key: "spirits", label: "Spirits", pattern: /\bspirit|liquor|whisk(?:e)?y|bourbon|tequila|vodka|rum|gin|cognac|brandy\b/i },
  { key: "wine", label: "Wine", pattern: /\bwine|winery|sommelier|vineyard|vintage\b/i },
  { key: "hospitality", label: "Hospitality", pattern: /\bhospitality|restaurant|bar operator|taproom|venue|foodservice\b/i },
  { key: "industry", label: "Industry", pattern: /\bindustry|distribution|distributor|regulation|legislation|market|sales|supplier|tariff\b/i },
]);

export function getBeverageNewsTopic(item = {}) {
  const explicit = clean(item.topic || item.category || item.section, 80);
  const tags = Array.isArray(item.tags) ? item.tags.map((tag) => clean(tag, 60)).join(" ") : clean(item.tags, 120);
  const searchable = [explicit, tags, item.title, item.headline, item.summary, item.description]
    .map((value) => clean(value, 300))
    .filter(Boolean)
    .join(" ");
  const match = TOPICS.find((topic) => topic.pattern.test(searchable));
  return match ? { key: match.key, label: match.label } : { key: "beverage", label: "Beverage news" };
}

export function formatBeverageNewsAge(value, options = {}) {
  const now = normalizedNow(options.now);
  const date = validDate(value);
  if (!date) return "Date unavailable";
  const ageMs = Math.max(0, now.getTime() - date.getTime());
  if (ageMs < 60 * 1000) return "Just now";
  if (ageMs < HOUR_MS) return `${Math.floor(ageMs / (60 * 1000))}m ago`;
  if (ageMs < DAY_MS) return `${Math.floor(ageMs / HOUR_MS)}h ago`;
  if (ageMs < 7 * DAY_MS) return `${Math.floor(ageMs / DAY_MS)}d ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

export function getBeverageNewsArticleFreshness(value, options = {}) {
  const settings = { ...BEVERAGE_NEWS_VIEW_DEFAULTS, ...options };
  const ageMs = ageMilliseconds(value, normalizedNow(settings.now));
  if (!Number.isFinite(ageMs)) return "unknown";
  if (ageMs <= Math.max(0, finiteNumber(settings.articleNewHours, 24)) * HOUR_MS) return "new";
  if (ageMs <= Math.max(0, finiteNumber(settings.articleRecentDays, 7)) * DAY_MS) return "recent";
  return "older";
}

function getFeedFreshness(value, options) {
  const ageMs = ageMilliseconds(value, options.now);
  if (!Number.isFinite(ageMs)) return "unknown";
  if (ageMs <= options.feedFreshMinutes * 60 * 1000) return "fresh";
  if (ageMs <= options.feedStaleHours * HOUR_MS) return "aging";
  return "stale";
}

function normalizeError(value) {
  if (typeof value === "string") return clean(value, 240);
  if (!value || typeof value !== "object") return "";
  const source = clean(value.source || value.provider, 60);
  const message = clean(value.message || value.error || value.code, 200);
  return [source, message].filter(Boolean).join(": ");
}

function normalizeErrors(value) {
  const errors = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(errors.map(normalizeError).filter(Boolean))].slice(0, 6);
}

function normalizeStatus(value) {
  if (value && typeof value === "object") {
    return clean(value.state || value.status || value.code, 40).toLowerCase();
  }
  return clean(value, 40).toLowerCase();
}

function cardKey(item, url, index) {
  const explicit = clean(item.id || item.guid, 120);
  if (explicit) return explicit;
  if (url) return url;
  return `${clean(item.title || item.headline, 100).toLowerCase()}:${index}`;
}

function normalizeCard(item, index, options) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const title = clean(item.title || item.headline, 180);
  const url = getSafeBeverageNewsUrl(item.url || item.link || item.href);
  if (!title || !url) return null;

  const publishedDate = validDate(item.publishedAt || item.published_at || item.date || item.pubDate);
  const publishedAt = publishedDate?.toISOString() || "";
  const source = clean(item.source?.name || item.sourceName || item.source || item.publisher, 90)
    || sourceFromUrl(url)
    || "News source";
  const summary = clean(item.summary || item.description || item.excerpt, 320);
  const topic = getBeverageNewsTopic(item);
  return {
    id: cardKey(item, url, index),
    title,
    summary,
    source,
    topicKey: topic.key,
    topicLabel: topic.label,
    publishedAt,
    ageLabel: formatBeverageNewsAge(publishedAt, options),
    freshness: getBeverageNewsArticleFreshness(publishedAt, options),
    url,
    link: Object.freeze({
      href: url,
      target: "_blank",
      rel: "noopener noreferrer",
      ariaLabel: `Read ${title} from ${source}`,
    }),
  };
}

function stateCopy(state, cardCount, errorCount, freshness) {
  if (state === "loading") {
    return { label: "Loading", message: "Refreshing beverage news…", tone: "neutral" };
  }
  if (state === "offline") {
    return { label: "Offline", message: "Beverage news is unavailable. Try refresh when the connection returns.", tone: "error" };
  }
  if (state === "empty") {
    return { label: "No stories", message: "No beverage stories are available right now. Try refresh later.", tone: "neutral" };
  }
  if (state === "partial") {
    const cause = errorCount
      ? "Some news sources could not be refreshed."
      : cardCount < MIN_CARD_COUNT
        ? "Fewer than four current stories were available."
        : "The latest news refresh was incomplete.";
    return { label: "Partial", message: `Showing ${cardCount} available ${cardCount === 1 ? "story" : "stories"}. ${cause}`, tone: "warning" };
  }
  if (freshness === "stale") {
    return { label: "Update needed", message: `Showing ${cardCount} stories from the last successful refresh.`, tone: "warning" };
  }
  return { label: "Current", message: `Showing ${cardCount} beverage ${cardCount === 1 ? "story" : "stories"}.`, tone: "ready" };
}

export function buildBeverageNewsViewModel(payload, options = {}) {
  const now = normalizedNow(options.now);
  const settings = {
    ...BEVERAGE_NEWS_VIEW_DEFAULTS,
    ...options,
    now,
    minItems: clampInteger(options.minItems, MIN_CARD_COUNT, MAX_CARD_COUNT, MIN_CARD_COUNT),
    maxItems: clampInteger(options.maxItems, MIN_CARD_COUNT, MAX_CARD_COUNT, MAX_CARD_COUNT),
    feedFreshMinutes: Math.max(1, finiteNumber(options.feedFreshMinutes, BEVERAGE_NEWS_VIEW_DEFAULTS.feedFreshMinutes)),
    feedStaleHours: Math.max(1, finiteNumber(options.feedStaleHours, BEVERAGE_NEWS_VIEW_DEFAULTS.feedStaleHours)),
  };
  settings.minItems = Math.min(settings.minItems, settings.maxItems);

  const isObjectPayload = Boolean(payload && typeof payload === "object" && !Array.isArray(payload));
  const status = normalizeStatus(isObjectPayload ? payload.status : "");
  const loading = options.loading === true || status === "loading";
  const errors = normalizeErrors(isObjectPayload ? payload.errors : "Invalid beverage-news response.");
  const rawItems = isObjectPayload && Array.isArray(payload.items) ? payload.items : [];
  const normalizedItems = rawItems.map((item, index) => normalizeCard(item, index, settings));
  const rejectedItemCount = normalizedItems.filter((item) => !item).length;
  const byUrl = new Map();
  normalizedItems.filter(Boolean).forEach((item) => {
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  });
  const availableCards = [...byUrl.values()].sort((left, right) => {
    const leftTime = validDate(left.publishedAt)?.getTime() || 0;
    const rightTime = validDate(right.publishedAt)?.getTime() || 0;
    return rightTime - leftTime;
  });
  const cards = availableCards.slice(0, settings.maxItems);
  const hiddenItemCount = Math.max(0, availableCards.length - cards.length);
  const updatedDate = validDate(isObjectPayload ? payload.updatedAt : "");
  const updatedAt = updatedDate?.toISOString() || "";
  const freshness = getFeedFreshness(updatedAt, settings);
  const hasProblems = errors.length > 0 || rejectedItemCount > 0;
  const recognizedSuccess = SUCCESS_STATUSES.has(status);
  const explicitOffline = OFFLINE_STATUSES.has(status);
  let state = "ready";

  if (loading) {
    state = "loading";
  } else if (!cards.length && (!isObjectPayload || explicitOffline || hasProblems || (!recognizedSuccess && status !== "empty"))) {
    state = "offline";
  } else if (!cards.length) {
    state = "empty";
  } else if (explicitOffline || status === "partial" || hasProblems || !recognizedSuccess || cards.length < settings.minItems) {
    state = "partial";
  }

  const copy = stateCopy(state, cards.length, errors.length + rejectedItemCount, freshness);
  return {
    state,
    status: status || "unknown",
    statusLabel: copy.label,
    statusMessage: copy.message,
    statusTone: copy.tone,
    isLoading: state === "loading",
    isPartial: state === "partial",
    isOffline: state === "offline",
    isEmpty: state === "empty",
    canRefresh: state !== "loading",
    cards: state === "loading" && !rawItems.length ? [] : cards,
    itemCount: cards.length,
    rejectedItemCount,
    hiddenItemCount,
    targetItemRange: Object.freeze({ min: settings.minItems, max: settings.maxItems }),
    updatedAt,
    updatedLabel: updatedAt ? `Updated ${formatBeverageNewsAge(updatedAt, settings)}` : "Update time unavailable",
    freshness,
    errors,
  };
}
