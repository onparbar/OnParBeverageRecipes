import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BEVERAGE_NEWS_SOURCES,
  BeverageNewsSourceError,
  createBeverageNewsService,
  fetchBeverageNewsSource,
  loadBeverageNews,
  normalizeNewsUrl,
  parseOhioBillWatch,
  parseOhioHempLawWatch,
  parseRssNews,
  sanitizeNewsText,
} from "../lib/beverage-news.mjs";

const NOW = new Date("2026-08-12T16:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const tradeSource = BEVERAGE_NEWS_SOURCES.find((source) => source.id === "beverage-industry");
const ohioNewsSource = BEVERAGE_NEWS_SOURCES.find((source) => source.id === "ohio-statehouse");
const billSource = BEVERAGE_NEWS_SOURCES.find((source) => source.id === "ohio-sb86");
const lawSource = BEVERAGE_NEWS_SOURCES.find((source) => source.id === "ohio-hemp-law");

function rssItem({
  title = "RTD cocktails gain momentum",
  link = "https://www.bevindustry.com/articles/rtd-growth?utm_source=rss",
  description = "Ready-to-drink cocktails are growing with bar operators.",
  pubDate = "Wed, 12 Aug 2026 12:00:00 GMT",
  category = "Wine & Spirits",
} = {}) {
  return `<item>
    <title><![CDATA[${title}]]></title>
    <link>${link.replaceAll("&", "&amp;")}</link>
    <description><![CDATA[${description}]]></description>
    <pubDate>${pubDate}</pubDate>
    <category>${category}</category>
  </item>`;
}

test("sanitizes and bounds remote story text", () => {
  const value = sanitizeNewsText(
    "<script>alert(1)</script><p>Fresh &amp; useful</p>\u202E text".repeat(30),
    40,
  );
  assert.equal(value.includes("alert"), false);
  assert.equal(value.includes("\u202E"), false);
  assert.ok(value.startsWith("Fresh & useful text"));
  assert.ok(value.length <= 40);
});

test("RSS parsing returns direct, sanitized, bounded publisher links", () => {
  const xml = `<rss><channel>${rssItem({
    title: "<b>New RTD &amp; cocktail trend</b>",
    description: "<p>Operators are testing a new format.</p><script>bad()</script>",
  })}${rssItem({
    title: "Malicious redirect",
    link: "https://attacker.example/story",
  })}</channel></rss>`;
  const items = parseRssNews(xml, tradeSource, { now: NOW });

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "New RTD & cocktail trend");
  assert.equal(items[0].summary, "Operators are testing a new format.");
  assert.equal(items[0].url, "https://www.bevindustry.com/articles/rtd-growth");
  assert.equal(items[0].topic, "Cocktails");
  assert.equal(items[0].source, "Beverage Industry");
});

test("RSS parser rejects future, ancient, irrelevant Ohio, and non-HTTPS items", () => {
  const xml = `<rss><channel>
    ${rssItem({ title: "Ohio election update", link: "https://www.statenews.org/story/election" })}
    ${rssItem({ title: "Ohio THC beverage court ruling", link: "http://www.statenews.org/story/hemp" })}
    ${rssItem({ title: "Ohio THC beverage court ruling", link: "https://www.statenews.org/story/future", pubDate: "Fri, 14 Aug 2026 12:00:00 GMT" })}
    ${rssItem({ title: "Ohio hemp beverage judge issues ruling", link: "https://www.statenews.org/story/current" })}
  </channel></rss>`;
  const items = parseRssNews(xml, ohioNewsSource, { now: NOW });
  assert.deepEqual(items.map((item) => item.url), ["https://www.statenews.org/story/current"]);
  assert.equal(items[0].category, "Hemp & cannabis regulation");
});

test("normalizes only allowlisted direct HTTPS article URLs", () => {
  assert.equal(
    normalizeNewsUrl("https://www.bevindustry.com/story?a=1&utm_medium=rss#top", tradeSource),
    "https://www.bevindustry.com/story?a=1",
  );
  assert.equal(normalizeNewsUrl("https://evil.example/story", tradeSource), "");
  assert.equal(normalizeNewsUrl("http://www.bevindustry.com/story", tradeSource), "");
  assert.equal(normalizeNewsUrl("javascript:alert(1)", tradeSource), "");
});

test("official Ohio parsers report source facts without inventing legal conclusions", () => {
  const bill = parseOhioBillWatch(`
    <h3 class="inline-header">Regulate and tax intoxicating hemp, drinkable cannabinoid product</h3>
    <img alt="Passed By Senate Checked">
    <img alt="Sent To The Governor Unchecked">
    <h3>Current Version</h3><div><span>As Passed by the Senate</span></div>
  `, billSource);
  assert.equal(bill.status, "Passed By Senate");
  assert.match(bill.summary, /Current version: As Passed by the Senate/);
  assert.equal(bill.isOfficial, true);
  assert.deepEqual(bill.complianceFacts, {
    billTitle: "Regulate and tax intoxicating hemp, drinkable cannabinoid product",
    currentVersion: "As Passed by the Senate",
    status: "Passed By Senate",
    completedSteps: ["Passed By Senate"],
  });

  const law = parseOhioHempLawWatch(`
    <div>Effective: March 20, 2026 Latest Legislation: Senate Bill 56 - 136th General Assembly</div>
    <div>Last updated March 23, 2026 at 9:30 PM</div>
  `, lawSource);
  assert.match(law.summary, /Senate Bill 56/);
  assert.match(law.summary, /effective March 20, 2026/i);
  assert.match(law.summary, /before making a compliance decision/i);
  assert.equal(law.status, "Updated March 23, 2026");
  assert.deepEqual(law.complianceFacts, {
    effectiveDate: "March 20, 2026",
    latestLegislation: "Senate Bill 56 - 136th General Assembly",
    lastUpdated: "March 23, 2026",
  });
});

test("official-only scope fetches no trade or news sources and returns a complete watch", async () => {
  const fetchedIds = [];
  const fetchSource = async (sourceId) => {
    fetchedIds.push(sourceId);
    const source = BEVERAGE_NEWS_SOURCES.find((entry) => entry.id === sourceId);
    const item = sourceId === "ohio-hemp-law"
      ? parseOhioHempLawWatch(`
          <div>Effective: March 20, 2026 Latest Legislation: Senate Bill 56 - 136th General Assembly</div>
          <div>Last updated March 23, 2026</div>
        `, source)
      : parseOhioBillWatch(`
          <h3 class="inline-header">Regulate and tax intoxicating hemp, drinkable cannabinoid product</h3>
          <img alt="Passed By Senate Checked">
          <h3>Current Version</h3><div><span>As Passed by the Senate</span></div>
        `, source);
    return {
      source: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        url: source.homepageUrl,
        status: "ok",
        itemCount: 1,
      },
      items: [],
      regulatoryWatch: [item],
    };
  };

  const payload = await loadBeverageNews({ now: NOW, fetchSource, officialOnly: true });
  assert.deepEqual(fetchedIds, ["ohio-hemp-law", "ohio-sb86"]);
  assert.deepEqual(payload.items, []);
  assert.equal(payload.sources.length, 2);
  assert.equal(payload.complianceWatch.isComplete, true);
  assert.match(payload.complianceWatch.currentFingerprint, /^ohio-compliance-v1:[a-f0-9]{64}$/);
});

test("source fetching accepts only fixed source ids and applies strict network limits", async () => {
  await assert.rejects(
    fetchBeverageNewsSource("https://127.0.0.1/admin"),
    (error) => error instanceof BeverageNewsSourceError && error.code === "NEWS_SOURCE_NOT_ALLOWED",
  );

  let capturedUrl = "";
  let capturedOptions = null;
  const result = await fetchBeverageNewsSource("beverage-industry", {
    now: NOW,
    remoteFetch: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        text: () => `<rss><channel>${rssItem()}</channel></rss>`,
      };
    },
  });
  assert.equal(capturedUrl, "https://www.bevindustry.com/rss/16");
  assert.equal(capturedOptions.timeoutMs, 6_500);
  assert.equal(capturedOptions.maxBytes, 700 * 1024);
  assert.equal(capturedOptions.maxRedirects, 3);
  assert.ok(capturedOptions.acceptedContentTypes.includes("application/rss+xml"));
  assert.equal(result.items.length, 1);
});

test("aggregation stays useful when a source fails and bounds publisher dominance", async () => {
  const fetchSource = async (sourceId) => {
    if (sourceId === "ohio-statehouse") {
      throw new BeverageNewsSourceError("timeout", { code: "REMOTE_FETCH_UNAVAILABLE", sourceId });
    }
    if (sourceId === "ohio-hemp-law") {
      return {
        source: { id: sourceId, name: "Ohio Laws", kind: "official", url: lawSource.homepageUrl, status: "ok", itemCount: 1 },
        items: [],
        regulatoryWatch: [{ id: sourceId, title: "Official law", url: lawSource.homepageUrl }],
      };
    }
    if (sourceId === "ohio-sb86") {
      return {
        source: { id: sourceId, name: "Ohio House", kind: "official", url: billSource.homepageUrl, status: "ok", itemCount: 1 },
        items: [],
        regulatoryWatch: [{ id: sourceId, title: "Bill tracker", url: billSource.homepageUrl }],
      };
    }
    const source = BEVERAGE_NEWS_SOURCES.find((entry) => entry.id === sourceId);
    return {
      source: { id: sourceId, name: source.name, kind: "news", url: source.homepageUrl, status: "ok", itemCount: 8 },
      regulatoryWatch: [],
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `${sourceId}-${index}`,
        title: `${sourceId} beverage ${index}`,
        summary: "Beverage industry trend",
        url: `${source.homepageUrl}story/${index}`,
        publishedAt: new Date(NOW.getTime() - index * HOUR_MS).toISOString(),
        source: source.name,
        sourceId,
        topic: "Industry",
        category: "Market & operations",
      })),
    };
  };

  const payload = await loadBeverageNews({ now: NOW, itemLimit: 12, fetchSource });
  assert.equal(payload.status, "partial");
  assert.equal(payload.errors.length, 1);
  assert.equal(payload.errors[0].source, "The Statehouse News Bureau");
  assert.equal(payload.regulatoryWatch.length, 2);
  assert.equal(payload.items.length, 8);
  const counts = Object.groupBy(payload.items, (item) => item.sourceId);
  assert.equal(counts["beverage-industry"].length, 4);
  assert.equal(counts["beverage-daily"].length, 4);
});

test("cache coalesces refreshes, serves fresh results, and falls back to stale data", async () => {
  let clock = NOW.getTime();
  let calls = 0;
  let fail = false;
  const loader = async ({ now }) => {
    calls += 1;
    if (fail) throw new Error("offline");
    return {
      status: "ok",
      updatedAt: now.toISOString(),
      items: [{ title: "Current beverage story", url: "https://example.com/story", publishedAt: now.toISOString() }],
      regulatoryWatch: [],
      officialResources: [],
      sources: [],
      errors: [],
    };
  };
  const service = createBeverageNewsService({
    loader,
    now: () => clock,
    freshMs: 15 * 60 * 1000,
    staleMs: 24 * 60 * 60 * 1000,
  });

  const [first, coalesced] = await Promise.all([service.get(), service.get()]);
  assert.equal(calls, 1);
  assert.equal(first.status, "ok");
  assert.equal(coalesced.items.length, 1);

  const cached = await service.get();
  assert.equal(calls, 1);
  assert.equal(cached.cached, true);

  clock += 16 * 60 * 1000;
  fail = true;
  const stale = await service.get();
  assert.equal(calls, 2);
  assert.equal(stale.status, "partial");
  assert.equal(stale.stale, true);
  assert.equal(stale.cached, true);
  assert.equal(stale.items[0].title, "Current beverage story");
  assert.match(stale.errors.at(-1).message, /last successful update/i);
});

test("returns an explicit bounded offline payload when no source has ever succeeded", async () => {
  const service = createBeverageNewsService({
    loader: async () => { throw new Error("offline"); },
    now: () => NOW.getTime(),
  });
  const payload = await service.get();
  assert.equal(payload.status, "offline");
  assert.deepEqual(payload.items, []);
  assert.equal(payload.officialResources.length, 2);
  assert.deepEqual(payload.errors, [{
    source: "Beverage news",
    message: "Refresh failed.",
    code: "NEWS_REFRESH_FAILED",
  }]);
});

test("API authenticates an owner before cache access or network refresh", async () => {
  const routeSource = await readFile(
    new URL("../app/api/beverage-news/route.js", import.meta.url),
    "utf8",
  );
  const authIndex = routeSource.indexOf("requireDashboardRequestRole(request, { owner: true })");
  const serviceIndex = routeSource.indexOf("service.get({ force })");
  assert.ok(authIndex >= 0, "owner auth must be required");
  assert.ok(serviceIndex > authIndex, "auth must happen before any cache or network access");
  assert.match(routeSource, /searchParams\.get\("scope"\) === "compliance"/);
  assert.match(routeSource, /loadBeverageNews\(\{ now, officialOnly: true \}\)/);
  assert.match(routeSource, /error\?\.status\s*\|\|\s*403/);
  assert.match(routeSource, /"Cache-Control": "no-store"/);
});
