import { createHash } from "node:crypto";

import { buildOhioComplianceSnapshot } from "./ohio-compliance-watch.mjs";
import { fetchRemoteBuffer } from "./safe-remote-fetch.mjs";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_ITEM_LIMIT = 12;
const DEFAULT_MAX_ARTICLE_AGE_MS = 90 * DAY_MS;
const MAX_TITLE_LENGTH = 180;
const MAX_SUMMARY_LENGTH = 360;
const MAX_AUTHOR_LENGTH = 100;
const MAX_URL_LENGTH = 2_000;

function freezeSource(source) {
  return Object.freeze({
    ...source,
    articleHosts: Object.freeze([...source.articleHosts]),
    acceptedContentTypes: Object.freeze([...source.acceptedContentTypes]),
  });
}

// Source URLs are intentionally fixed in code. The API never accepts a URL
// from a request, which keeps this feed from becoming an SSRF proxy.
export const BEVERAGE_NEWS_SOURCES = Object.freeze([
  freezeSource({
    id: "ohio-hemp-law",
    name: "Ohio Laws",
    kind: "official",
    parser: "ohio-hemp-law",
    url: "https://codes.ohio.gov/ohio-revised-code/chapter-928",
    homepageUrl: "https://codes.ohio.gov/ohio-revised-code/chapter-928",
    articleHosts: ["codes.ohio.gov"],
    acceptedContentTypes: ["text/html", "application/xhtml+xml"],
    maxBytes: 900 * 1024,
    timeoutMs: 6_500,
  }),
  freezeSource({
    id: "ohio-sb86",
    name: "Ohio House of Representatives",
    kind: "official",
    parser: "ohio-bill",
    url: "https://ohiohouse.gov/legislation/136/sb86",
    homepageUrl: "https://ohiohouse.gov/legislation/136/sb86",
    articleHosts: ["ohiohouse.gov", "www.ohiohouse.gov"],
    acceptedContentTypes: ["text/html", "application/xhtml+xml"],
    maxBytes: 900 * 1024,
    timeoutMs: 6_500,
  }),
  freezeSource({
    id: "ohio-statehouse",
    name: "The Statehouse News Bureau",
    kind: "news",
    parser: "rss",
    relevance: "ohio-cannabinoids",
    url: "https://www.statenews.org/government-politics.rss",
    homepageUrl: "https://www.statenews.org/government-politics",
    articleHosts: ["statenews.org", "www.statenews.org"],
    acceptedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
    maxBytes: 600 * 1024,
    timeoutMs: 6_500,
  }),
  freezeSource({
    id: "beverage-industry",
    name: "Beverage Industry",
    kind: "news",
    parser: "rss",
    relevance: "beverage-trade",
    url: "https://www.bevindustry.com/rss/16",
    homepageUrl: "https://www.bevindustry.com/",
    articleHosts: ["bevindustry.com", "www.bevindustry.com"],
    acceptedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
    maxBytes: 700 * 1024,
    timeoutMs: 6_500,
  }),
  freezeSource({
    id: "beverage-daily",
    name: "BeverageDaily",
    kind: "news",
    parser: "rss",
    relevance: "beverage-trade",
    url: "https://www.beveragedaily.com/arc/outboundfeeds/rss/",
    homepageUrl: "https://www.beveragedaily.com/",
    articleHosts: ["beveragedaily.com", "www.beveragedaily.com"],
    acceptedContentTypes: ["application/rss+xml", "application/xml", "text/xml"],
    maxBytes: 700 * 1024,
    timeoutMs: 6_500,
  }),
]);

const SOURCE_BY_ID = new Map(BEVERAGE_NEWS_SOURCES.map((source) => [source.id, source]));

export class BeverageNewsSourceError extends Error {
  constructor(message, { code = "NEWS_SOURCE_UNAVAILABLE", sourceId = "" } = {}) {
    super(message);
    this.name = "BeverageNewsSourceError";
    this.code = code;
    this.sourceId = sourceId;
  }
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: "\"",
    rdquo: "”",
    rsquo: "’",
  };
  return String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (match, code) => {
      const point = Number.parseInt(code, 16);
      try {
        return Number.isFinite(point) ? String.fromCodePoint(point) : match;
      } catch {
        return "";
      }
    })
    .replace(/&#(\d+);/g, (match, code) => {
      const point = Number(code);
      try {
        return Number.isFinite(point) ? String.fromCodePoint(point) : match;
      } catch {
        return "";
      }
    })
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

export function sanitizeNewsText(value, maxLength = MAX_SUMMARY_LENGTH) {
  const withoutExecutableMarkup = String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/<(script|style|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutExecutableMarkup)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, Number(maxLength) || 0));
}

function extractTag(block, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1] || "";
}

function extractTagAttribute(block, tagName, attribute) {
  const tag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const attr = attribute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${tag}\\b[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1] || "";
}

function extractBlocks(value, tagName) {
  const matches = [];
  const pattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match;
  while ((match = pattern.exec(String(value ?? ""))) && matches.length < 80) {
    matches.push(match[1]);
  }
  return matches;
}

function hostnameAllowed(hostname, allowedHosts) {
  const normalized = String(hostname || "").toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((host) => {
    const allowed = String(host).toLowerCase().replace(/\.$/, "");
    return normalized === allowed || normalized.endsWith(`.${allowed}`);
  });
}

export function normalizeNewsUrl(value, source) {
  const raw = sanitizeNewsText(value, MAX_URL_LENGTH);
  if (!raw || !source?.homepageUrl || !Array.isArray(source.articleHosts)) return "";
  try {
    const url = new URL(raw, source.homepageUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return "";
    if (!hostnameAllowed(url.hostname, source.articleHosts)) return "";
    url.hash = "";
    [...url.searchParams.keys()].forEach((key) => {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
    });
    const normalized = url.toString();
    return normalized.length <= MAX_URL_LENGTH ? normalized : "";
  } catch {
    return "";
  }
}

function parsePublishedAt(value, now) {
  const timestamp = Date.parse(sanitizeNewsText(value, 100));
  if (!Number.isFinite(timestamp)) return "";
  if (timestamp > now.getTime() + DAY_MS) return "";
  if (timestamp < Date.UTC(2000, 0, 1)) return "";
  return new Date(timestamp).toISOString();
}

function canonicalStoryKey(item) {
  if (item.url) {
    try {
      const url = new URL(item.url);
      return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
    } catch {
      // Fall through to the normalized title.
    }
  }
  return sanitizeNewsText(item.title, MAX_TITLE_LENGTH).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function storyId(item) {
  return createHash("sha256").update(canonicalStoryKey(item)).digest("hex").slice(0, 20);
}

function getArticleTopic(item) {
  const text = `${item.title} ${item.summary} ${item.feedCategory}`;
  if (/\bhemp|cannab|cannabinoid|\bthc\b|\bcbd\b|marijuana\b/i.test(text)) {
    return { topic: "Industry", category: "Hemp & cannabis regulation" };
  }
  if (/\bnon[- ]?alcohol|alcohol[- ]?free|zero[- ]proof|mocktail|functional beverage|adaptogen|prebiotic|protein soda\b/i.test(text)) {
    return { topic: "Non-alcoholic", category: "No/low & functional" };
  }
  if (/\bbeer|brew(?:er|ery|ing)?|lager|ale|ipa|stout|pilsner|cider\b/i.test(text)) {
    return { topic: "Beer", category: "Beer & cider" };
  }
  if (/\bcocktail|mixology|bartend|highball|ready[- ]to[- ]drink|\brtd\b|seltzer\b/i.test(text)) {
    return { topic: "Cocktails", category: "Cocktails & RTD" };
  }
  if (/\bspirit|liquor|whisk(?:e)?y|bourbon|tequila|vodka|rum|gin|cognac|brandy\b/i.test(text)) {
    return { topic: "Spirits", category: "Spirits" };
  }
  if (/\bwine|winery|sommelier|vineyard|vintage\b/i.test(text)) {
    return { topic: "Wine", category: "Wine" };
  }
  if (/\brestaurant|hospitality|bar operator|taproom|foodservice\b/i.test(text)) {
    return { topic: "Hospitality", category: "Hospitality" };
  }
  return { topic: "Industry", category: "Market & operations" };
}

function isRelevantRssItem(item, source) {
  const text = `${item.title} ${item.summary} ${item.feedCategory}`;
  if (source.relevance === "ohio-cannabinoids") {
    return /\bhemp|cannab|cannabinoid|\bthc\b|\bcbd\b|marijuana\b/i.test(text)
      && /\bdrink|beverage|brew|bar|restaurant|retail|dispensary|sale|law|bill|court|judge|ban|regulat/i.test(text);
  }
  return /\bbeverage|drink|soda|water|coffee|tea|juice|beer|brew|lager|ale|cider|wine|spirit|liquor|cocktail|seltzer|vodka|tequila|rum|gin|whisk|bourbon|hydration|functional|rtd\b/i.test(text);
}

export function parseRssNews(xml, source, { now = new Date() } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const blocks = extractBlocks(xml, "item").length
    ? extractBlocks(xml, "item")
    : extractBlocks(xml, "entry");

  return blocks.slice(0, 60).map((block) => {
    const title = sanitizeNewsText(extractTag(block, "title"), MAX_TITLE_LENGTH);
    const rawLink = extractTag(block, "link") || extractTagAttribute(block, "link", "href");
    const url = normalizeNewsUrl(rawLink, source);
    const summary = sanitizeNewsText(
      extractTag(block, "description")
        || extractTag(block, "summary")
        || extractTag(block, "content:encoded")
        || extractTag(block, "content"),
      MAX_SUMMARY_LENGTH,
    );
    const publishedAt = parsePublishedAt(
      extractTag(block, "pubDate") || extractTag(block, "published") || extractTag(block, "updated"),
      current,
    );
    const author = sanitizeNewsText(
      extractTag(block, "dc:creator") || extractTag(block, "author"),
      MAX_AUTHOR_LENGTH,
    );
    const feedCategory = sanitizeNewsText(extractTag(block, "category"), 80);
    const base = { title, url, summary, publishedAt, author, feedCategory };
    const classification = getArticleTopic(base);
    return {
      ...base,
      ...classification,
      source: source.name,
      sourceId: source.id,
      sourceUrl: source.homepageUrl,
      tags: classification.category === "Hemp & cannabis regulation" ? ["Ohio", "Regulation", "Cannabinoids"] : [],
    };
  }).filter((item) => (
    item.title
    && item.url
    && item.publishedAt
    && isRelevantRssItem(item, source)
  )).map((item) => ({ ...item, id: storyId(item) }));
}

function matchText(html, pattern, maxLength = 180) {
  return sanitizeNewsText(String(html ?? "").match(pattern)?.[1], maxLength);
}

export function parseOhioBillWatch(html, source) {
  const parsedTitle = matchText(html, /<h3[^>]*class=["'][^"']*inline-header[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i);
  const title = parsedTitle || "Regulate and tax intoxicating hemp, drinkable cannabinoid product";
  const version = matchText(html, /<h3[^>]*>\s*Current Version\s*<\/h3>\s*<div[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i, 100);
  const checkedSteps = [...String(html ?? "").matchAll(/alt=["']([^"']+?)\s+Checked["']/gi)]
    .map((match) => sanitizeNewsText(match[1], 80))
    .filter(Boolean);
  const status = checkedSteps.at(-1) || version || "See official tracker";
  const url = normalizeNewsUrl(source.homepageUrl, source);
  return {
    id: source.id,
    title: "Ohio drinkable cannabinoid bill tracker (SB 86)",
    summary: `Official tracker: ${title}${version ? `. Current version: ${version}` : ""}.`,
    status,
    source: source.name,
    sourceId: source.id,
    sourceUrl: source.homepageUrl,
    url,
    topic: "Industry",
    category: "Ohio regulatory watch",
    publishedAt: "",
    isOfficial: true,
    complianceFacts: (parsedTitle || version || checkedSteps.length)
      ? {
          billTitle: parsedTitle,
          currentVersion: version,
          status,
          completedSteps: checkedSteps,
        }
      : null,
  };
}

export function parseOhioHempLawWatch(html, source) {
  const text = sanitizeNewsText(html, 120_000);
  const effectiveDate = matchText(text, /Effective:\s*([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i, 40);
  const legislation = matchText(
    text,
    /Latest Legislation:\s*((?:House|Senate) Bill \d+\s*-\s*\d+(?:st|nd|rd|th) General Assembly)/i,
    100,
  );
  const lastUpdated = matchText(text, /Last updated\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/i, 40);
  const details = [
    legislation ? `latest legislation ${legislation}` : "the current codified text",
    effectiveDate ? `effective ${effectiveDate}` : "",
  ].filter(Boolean).join(", ");
  const url = normalizeNewsUrl(source.homepageUrl, source);
  return {
    id: source.id,
    title: "Official Ohio hemp law (Chapter 928)",
    summary: `Ohio Revised Code Chapter 928 lists ${details}. Open the official text before making a compliance decision.`,
    status: lastUpdated ? `Updated ${lastUpdated}` : "See official text",
    source: source.name,
    sourceId: source.id,
    sourceUrl: source.homepageUrl,
    url,
    topic: "Industry",
    category: "Ohio regulatory watch",
    publishedAt: lastUpdated ? parsePublishedAt(`${lastUpdated} 12:00:00 UTC`, new Date()) : "",
    isOfficial: true,
    complianceFacts: (effectiveDate || legislation || lastUpdated)
      ? {
          effectiveDate,
          latestLegislation: legislation,
          lastUpdated,
        }
      : null,
  };
}

function parseSourceBody(body, source, now) {
  if (source.parser === "rss") {
    return { items: parseRssNews(body, source, { now }), regulatoryWatch: [] };
  }
  if (source.parser === "ohio-bill") {
    return { items: [], regulatoryWatch: [parseOhioBillWatch(body, source)] };
  }
  if (source.parser === "ohio-hemp-law") {
    return { items: [], regulatoryWatch: [parseOhioHempLawWatch(body, source)] };
  }
  throw new BeverageNewsSourceError("Unsupported beverage-news parser.", {
    code: "NEWS_SOURCE_CONFIG_INVALID",
    sourceId: source.id,
  });
}

export async function fetchBeverageNewsSource(sourceId, {
  now = new Date(),
  remoteFetch = fetchRemoteBuffer,
} = {}) {
  const source = SOURCE_BY_ID.get(String(sourceId || ""));
  if (!source) {
    throw new BeverageNewsSourceError("Unknown beverage-news source.", {
      code: "NEWS_SOURCE_NOT_ALLOWED",
      sourceId: String(sourceId || ""),
    });
  }

  let response;
  try {
    response = await remoteFetch(source.url, {
      acceptedContentTypes: source.acceptedContentTypes,
      headers: {
        Accept: source.kind === "official"
          ? "text/html,application/xhtml+xml"
          : "application/rss+xml,application/xml,text/xml",
        "User-Agent": "OnParBeverageDashboard/1.0 (+beverage-news)",
      },
      maxBytes: source.maxBytes,
      maxRedirects: 3,
      timeoutMs: source.timeoutMs,
    });
  } catch (error) {
    throw new BeverageNewsSourceError("Source could not be reached.", {
      code: error?.code || "NEWS_SOURCE_UNAVAILABLE",
      sourceId: source.id,
    });
  }
  if (!response?.ok) {
    throw new BeverageNewsSourceError("Source returned an unsuccessful response.", {
      code: "NEWS_SOURCE_HTTP_ERROR",
      sourceId: source.id,
    });
  }

  const parsed = parseSourceBody(response.text(), source, now instanceof Date ? now : new Date(now));
  return {
    source: {
      id: source.id,
      name: source.name,
      kind: source.kind,
      url: source.homepageUrl,
      status: "ok",
      itemCount: parsed.items.length + parsed.regulatoryWatch.length,
    },
    ...parsed,
  };
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = canonicalStoryKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankAndBoundItems(items, now, { itemLimit, maxArticleAgeMs }) {
  const cutoff = now.getTime() - maxArticleAgeMs;
  const current = deduplicate(items).filter((item) => Date.parse(item.publishedAt) >= cutoff);
  current.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));

  // A small per-source cap keeps a single publisher from monopolizing the
  // dashboard even when another feed is momentarily quiet.
  const counts = new Map();
  const selected = [];
  current.forEach((item) => {
    const sourceCount = counts.get(item.sourceId) || 0;
    if (sourceCount >= 4 || selected.length >= itemLimit) return;
    counts.set(item.sourceId, sourceCount + 1);
    selected.push(item);
  });
  return selected;
}

function publicSourceDefinition(source) {
  return {
    id: source.id,
    name: source.name,
    kind: source.kind,
    url: source.homepageUrl,
  };
}

export async function loadBeverageNews({
  now = new Date(),
  itemLimit = DEFAULT_ITEM_LIMIT,
  maxArticleAgeMs = DEFAULT_MAX_ARTICLE_AGE_MS,
  fetchSource = fetchBeverageNewsSource,
  officialOnly = false,
} = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const boundedLimit = Math.min(20, Math.max(1, Number(itemLimit) || DEFAULT_ITEM_LIMIT));
  const selectedSources = officialOnly
    ? BEVERAGE_NEWS_SOURCES.filter((source) => source.kind === "official")
    : BEVERAGE_NEWS_SOURCES;
  const results = await Promise.allSettled(
    selectedSources.map((source) => fetchSource(source.id, { now: current })),
  );

  const items = [];
  const regulatoryWatch = [];
  const sources = [];
  const errors = [];
  results.forEach((result, index) => {
    const definition = selectedSources[index];
    if (result.status === "fulfilled") {
      items.push(...(result.value.items || []));
      regulatoryWatch.push(...(result.value.regulatoryWatch || []));
      sources.push(result.value.source);
      return;
    }
    sources.push({
      ...publicSourceDefinition(definition),
      status: "unavailable",
      itemCount: 0,
    });
    errors.push({
      source: definition.name,
      message: "Unavailable during this refresh.",
      code: sanitizeNewsText(result.reason?.code, 80) || "NEWS_SOURCE_UNAVAILABLE",
    });
  });

  const successfulSources = sources.filter((source) => source.status === "ok").length;
  const boundedItems = rankAndBoundItems(items, current, {
    itemLimit: boundedLimit,
    maxArticleAgeMs: Math.max(DAY_MS, Number(maxArticleAgeMs) || DEFAULT_MAX_ARTICLE_AGE_MS),
  });
  let status = "ok";
  if (!successfulSources) status = "offline";
  else if (errors.length) status = "partial";

  const boundedRegulatoryWatch = regulatoryWatch.slice(0, 4);

  return {
    status,
    updatedAt: current.toISOString(),
    cached: false,
    stale: false,
    items: boundedItems,
    regulatoryWatch: boundedRegulatoryWatch,
    complianceWatch: buildOhioComplianceSnapshot({
      regulatoryWatch: boundedRegulatoryWatch,
      sources,
      checkedAt: current.toISOString(),
    }),
    officialResources: BEVERAGE_NEWS_SOURCES
      .filter((source) => source.kind === "official")
      .map(publicSourceDefinition),
    sources,
    errors,
  };
}

function cacheMetadata(payload, nowMs, freshMs) {
  return {
    ...payload,
    cache: {
      freshUntil: new Date(nowMs + freshMs).toISOString(),
      ttlSeconds: Math.round(freshMs / 1000),
    },
  };
}

export function createBeverageNewsService({
  loader = loadBeverageNews,
  now = () => Date.now(),
  freshMs = 15 * MINUTE_MS,
  staleMs = 24 * HOUR_MS,
} = {}) {
  let cache = null;
  let inFlight = null;

  async function refresh() {
    const startedAt = Number(now());
    let payload;
    try {
      payload = await loader({ now: new Date(startedAt) });
    } catch {
      payload = {
        status: "offline",
        updatedAt: new Date(startedAt).toISOString(),
        cached: false,
        stale: false,
        items: [],
        regulatoryWatch: [],
        complianceWatch: buildOhioComplianceSnapshot({
          regulatoryWatch: [],
          sources: [],
          checkedAt: new Date(startedAt).toISOString(),
        }),
        officialResources: BEVERAGE_NEWS_SOURCES
          .filter((source) => source.kind === "official")
          .map(publicSourceDefinition),
        sources: BEVERAGE_NEWS_SOURCES.map((source) => ({
          ...publicSourceDefinition(source),
          status: "unavailable",
          itemCount: 0,
        })),
        errors: [{ source: "Beverage news", message: "Refresh failed.", code: "NEWS_REFRESH_FAILED" }],
      };
    }

    if (payload.status !== "offline") {
      cache = {
        payload: cacheMetadata(payload, startedAt, freshMs),
        storedAt: startedAt,
        freshUntil: startedAt + freshMs,
      };
      return cache.payload;
    }

    if (cache && startedAt - cache.storedAt <= staleMs) {
      return {
        ...cache.payload,
        status: "partial",
        cached: true,
        stale: true,
        errors: [
          ...(cache.payload.errors || []),
          { source: "Beverage news", message: "Live refresh failed; showing the last successful update.", code: "NEWS_STALE_CACHE" },
        ].slice(-8),
      };
    }
    return cacheMetadata(payload, startedAt, freshMs);
  }

  return {
    async get({ force = false } = {}) {
      const current = Number(now());
      if (!force && cache && current < cache.freshUntil) {
        return { ...cache.payload, cached: true };
      }
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    clear() {
      cache = null;
      inFlight = null;
    },
  };
}
