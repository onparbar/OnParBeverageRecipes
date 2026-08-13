import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBeverageNewsViewModel,
  formatBeverageNewsAge,
  getBeverageNewsArticleFreshness,
  getBeverageNewsTopic,
  getSafeBeverageNewsUrl,
} from "../public/beverage-news-view.mjs";

const NOW = new Date("2026-08-12T16:00:00.000Z");

function story(index, overrides = {}) {
  return {
    id: `story-${index}`,
    title: `Beverage story ${index}`,
    summary: `Summary for story ${index}`,
    source: "Industry Wire",
    url: `https://example.com/news/${index}`,
    topic: "Industry",
    publishedAt: `2026-08-12T${String(16 - index).padStart(2, "0")}:00:00.000Z`,
    ...overrides,
  };
}

test("normalizes, sorts, and caps a dashboard-ready feed at six cards", () => {
  const view = buildBeverageNewsViewModel({
    status: "ok",
    updatedAt: "2026-08-12T15:45:00.000Z",
    errors: [],
    items: [story(5), story(1), story(7), story(3), story(2), story(6), story(4)],
  }, { now: NOW });

  assert.equal(view.state, "ready");
  assert.equal(view.itemCount, 6);
  assert.equal(view.hiddenItemCount, 1);
  assert.deepEqual(view.targetItemRange, { min: 4, max: 6 });
  assert.deepEqual(view.cards.map((item) => item.id), [
    "story-1", "story-2", "story-3", "story-4", "story-5", "story-6",
  ]);
  assert.deepEqual(view.cards[0].link, {
    href: "https://example.com/news/1",
    target: "_blank",
    rel: "noopener noreferrer",
    ariaLabel: "Read Beverage story 1 from Industry Wire",
  });
  assert.equal(view.freshness, "fresh");
  assert.equal(view.updatedLabel, "Updated 15m ago");
});

test("permits only absolute http and https story links", () => {
  assert.equal(getSafeBeverageNewsUrl("https://example.com/story"), "https://example.com/story");
  assert.equal(getSafeBeverageNewsUrl("http://example.com/story"), "http://example.com/story");
  assert.equal(getSafeBeverageNewsUrl("javascript:alert(1)"), "");
  assert.equal(getSafeBeverageNewsUrl("data:text/html,hello"), "");
  assert.equal(getSafeBeverageNewsUrl("/relative/story"), "");

  const view = buildBeverageNewsViewModel({
    status: "ok",
    updatedAt: NOW.toISOString(),
    items: [story(1), story(2, { url: "javascript:alert(1)" })],
  }, { now: NOW, minItems: 4 });
  assert.equal(view.cards.length, 1);
  assert.equal(view.rejectedItemCount, 1);
  assert.equal(view.state, "partial");
});

test("derives stable topical labels from explicit metadata and story copy", () => {
  assert.deepEqual(getBeverageNewsTopic({ topic: "Craft Beer" }), { key: "beer", label: "Beer" });
  assert.deepEqual(getBeverageNewsTopic({ title: "A new tequila market report" }), { key: "spirits", label: "Spirits" });
  assert.deepEqual(getBeverageNewsTopic({ tags: ["zero-proof", "menus"] }), { key: "non-alcoholic", label: "Non-alcoholic" });
  assert.deepEqual(getBeverageNewsTopic({ title: "General update" }), { key: "beverage", label: "Beverage news" });
});

test("provides compact age labels and article freshness", () => {
  assert.equal(formatBeverageNewsAge("2026-08-12T15:59:30.000Z", { now: NOW }), "Just now");
  assert.equal(formatBeverageNewsAge("2026-08-12T15:30:00.000Z", { now: NOW }), "30m ago");
  assert.equal(formatBeverageNewsAge("2026-08-12T13:00:00.000Z", { now: NOW }), "3h ago");
  assert.equal(formatBeverageNewsAge("2026-08-09T16:00:00.000Z", { now: NOW }), "3d ago");
  assert.equal(formatBeverageNewsAge("not-a-date", { now: NOW }), "Date unavailable");
  assert.equal(getBeverageNewsArticleFreshness("2026-08-12T08:00:00.000Z", { now: NOW }), "new");
  assert.equal(getBeverageNewsArticleFreshness("2026-08-10T08:00:00.000Z", { now: NOW }), "recent");
  assert.equal(getBeverageNewsArticleFreshness("2026-07-01T08:00:00.000Z", { now: NOW }), "older");
  assert.equal(getBeverageNewsArticleFreshness("", { now: NOW }), "unknown");
});

test("returns a fail-closed loading state", () => {
  const view = buildBeverageNewsViewModel({ status: "loading", items: [] }, { now: NOW });
  assert.equal(view.state, "loading");
  assert.equal(view.isLoading, true);
  assert.equal(view.canRefresh, false);
  assert.deepEqual(view.cards, []);
  assert.equal(view.statusMessage, "Refreshing beverage news…");
});

test("shows valid cards as partial when providers fail or fewer than four remain", () => {
  const withError = buildBeverageNewsViewModel({
    status: "partial",
    updatedAt: "2026-08-12T14:00:00.000Z",
    errors: [{ source: "Trade Feed", message: "Timed out" }],
    items: [story(1), story(2), story(3), story(4)],
  }, { now: NOW });
  assert.equal(withError.state, "partial");
  assert.deepEqual(withError.errors, ["Trade Feed: Timed out"]);
  assert.match(withError.statusMessage, /Some news sources/);

  const tooFew = buildBeverageNewsViewModel({
    status: "ok",
    updatedAt: "2026-08-12T14:00:00.000Z",
    items: [story(1), story(2), story(3)],
  }, { now: NOW });
  assert.equal(tooFew.state, "partial");
  assert.match(tooFew.statusMessage, /Fewer than four/);
});

test("distinguishes offline from a successful empty feed", () => {
  const offline = buildBeverageNewsViewModel({
    status: "offline",
    errors: ["Network unavailable"],
    items: [],
  }, { now: NOW });
  assert.equal(offline.state, "offline");
  assert.equal(offline.isOffline, true);
  assert.equal(offline.canRefresh, true);

  const malformed = buildBeverageNewsViewModel(null, { now: NOW });
  assert.equal(malformed.state, "offline");
  assert.deepEqual(malformed.errors, ["Invalid beverage-news response."]);

  const empty = buildBeverageNewsViewModel({
    status: "ok",
    updatedAt: NOW.toISOString(),
    errors: [],
    items: [],
  }, { now: NOW });
  assert.equal(empty.state, "empty");
  assert.equal(empty.isEmpty, true);
});

test("marks old successful refreshes stale without turning them into an outage", () => {
  const view = buildBeverageNewsViewModel({
    status: "ok",
    updatedAt: "2026-08-12T06:00:00.000Z",
    items: [story(1), story(2), story(3), story(4)],
  }, { now: NOW });
  assert.equal(view.state, "ready");
  assert.equal(view.freshness, "stale");
  assert.equal(view.statusLabel, "Update needed");
  assert.match(view.statusMessage, /last successful refresh/);
});
