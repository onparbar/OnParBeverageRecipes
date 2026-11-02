import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import { getComingSoonKindLabel, mergeRequiredComingSoonItems } from "../public/coming-soon-items.mjs";
import { clean, escapeHtml, formatNumber, money, toNumber } from "../public/dashboard-formatters.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
const catalogUrl = new URL("../public/ohlq-product-catalog.mjs", import.meta.url);
const OHLQ_MAPPINGS = existsSync(catalogUrl)
  ? (await import(catalogUrl.href)).OHLQ_MAPPINGS
  : (() => {
      const match = source.match(/const OHLQ_MAPPINGS = (\{[\s\S]*?\n\});/);
      assert.ok(match, "Dashboard has the actual inline OHLQ catalog");
      return vm.runInNewContext(`(${match[1]})`);
    })();

function loadComingSoonHelpers() {
  const context = vm.createContext({
    clean, escapeHtml, formatNumber, money, toNumber, getComingSoonKindLabel, OHLQ_MAPPINGS,
    URL,
    window: { location: { origin: "https://dashboard.example" } },
    STANDARD_BEER_KEG_OZ: 1984,
    STANDARD_COCKTAIL_KEG_OZ: 1452,
    fetch: () => assert.fail("Rendering a Coming Soon product must not publish or activate it"),
  });
  for (const name of [
    "getComingSoonImageUrl",
    "getComingSoonCardDescription",
    "getComingSoonLiquorCatalogPricing",
    "renderComingSoonLiquorDetails",
    "renderComingSoonItem",
    "buildPmbPayloadFromComingSoonItem",
    "sendComingSoonItemToPmb",
  ]) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `Dashboard helper ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}

const liquor = {
  id: "liquor:ciroc-pineapple",
  kind: "liquor",
  name: "Ciroc Pineapple",
  producer: "Cîroc",
  style: "Pineapple vodka",
  description: "Pineapple flavor with a smooth finish.",
  imageUrl: "/images/products/ciroc-pineapple.png",
  abvPercent: 35,
  bottleCost: 29.99,
  bottleOz: 25.3605,
  pricePerOz: 3.25,
};

test("liquor cards display the saved picture, description, product details, and prices", () => {
  const helpers = loadComingSoonHelpers();
  const before = JSON.stringify(liquor);
  const html = helpers.renderComingSoonItem(liquor);
  assert.match(html, /src="\/images\/products\/ciroc-pineapple\.png"/);
  assert.match(html, /<p>Pineapple flavor with a smooth finish\.<\/p>/);
  assert.match(html, /Cîroc/);
  assert.match(html, /Pineapple vodka/);
  assert.match(html, /35%<\/b> ABV/);
  assert.match(html, /\$29\.99<\/b> bottle cost/);
  assert.match(html, /25\.36 oz<\/b> bottle size/);
  assert.match(html, /\$3\.25<\/b> tap price \/ oz/);
  assert.match(html, /\$5<\/b> Single · 1\.5 oz/);
  assert.match(html, /\$7<\/b> Double · 2 oz/);
  assert.equal(JSON.stringify(liquor), before);
});

test("the migrated Maker's Mark and Ciroc cards show their complete approved product defaults", () => {
  const helpers = loadComingSoonHelpers();
  const items = mergeRequiredComingSoonItems([
    { id: "liquor:makers-mark", kind: "liquor", name: "Maker's Mark" },
    { id: "liquor:ciroc-pineapple", kind: "liquor", name: "Ciroc Pineapple" },
  ]);
  for (const [id, single, double, label, rate, abv] of [
    ["liquor:makers-mark", 7, 9, "1.75 L", "4.67", 45],
    ["liquor:ciroc-pineapple", 12, 16, "1 L", "8.00", 35],
  ]) {
    const item = items.find((entry) => entry.id === id);
    const html = helpers.renderComingSoonItem(item);
    assert.ok(item.description.length > 30);
    assert.ok(html.includes(`<p>${escapeHtml(item.description)}</p>`));
    assert.ok(html.includes(`src="${item.imageUrl}"`));
    assert.match(item.imageUrl, /\/images\/products\/.*\.webp$/);
    assert.ok(html.includes(`<b>${label}</b> bottle size`));
    assert.ok(html.includes(`<b>${abv}%</b> ABV`));
    assert.ok(html.includes(`<b>$${single}</b> Single · 1.5 oz`));
    assert.ok(html.includes(`<b>$${double}</b> Double · 2 oz`));
    assert.ok(html.includes(`<b>$${rate}</b> tap price / oz`));
    assert.doesNotMatch(html, /proposed|Tap price not set/);
    assert.match(html, /activate-coming-soon-pmb" type="button" disabled/);
  }
  const cirocHtml = helpers.renderComingSoonItem(items.find((entry) => entry.id === "liquor:ciroc-pineapple"));
  assert.match(cirocHtml, /\$38\.99<\/b> bottle cost/);
  assert.match(cirocHtml, /Bottle cost source: OHLQ largest bottle · 2056L/);
  assert.doesNotMatch(cirocHtml, /estimated bottle cost/);
});

test("bottle size labels are used and escaped while an absent label retains the ounce fallback", () => {
  const helpers = loadComingSoonHelpers();
  const labeledHtml = helpers.renderComingSoonLiquorDetails({ ...liquor, bottleSizeLabel: "750 mL <bottle>" });
  assert.match(labeledHtml, /750 mL &lt;bottle&gt;<\/b> bottle size/);
  assert.doesNotMatch(labeledHtml, /<bottle>|25\.36 oz<\/b> bottle size/);
  const fallbackHtml = helpers.renderComingSoonLiquorDetails({ ...liquor, bottleSizeLabel: "" });
  assert.match(fallbackHtml, /25\.36 oz<\/b> bottle size/);
});

test("proposed prices are identified on both ounce and serving prices", () => {
  const helpers = loadComingSoonHelpers();
  const html = helpers.renderComingSoonItem({ ...liquor, priceStatus: "proposed" });
  assert.match(html, /\$3\.25<\/b> proposed price \/ oz/);
  assert.match(html, /\$5<\/b> proposed Single · 1\.5 oz/);
  assert.match(html, /\$7<\/b> proposed Double · 2 oz/);
  assert.doesNotMatch(html, /tap price \/ oz/);
});

test("saved Single and Double prices are displayed as whole dollars instead of being recalculated", () => {
  const helpers = loadComingSoonHelpers();
  const item = {
    ...liquor,
    portions: [
      { name: "Single", servingOz: 1.5, price: 12 },
      { name: "Double", servingOz: 2, price: 16 },
    ],
  };
  const before = JSON.stringify(item);
  const html = helpers.renderComingSoonItem(item);
  assert.match(html, /\$12<\/b> Single · 1\.5 oz/);
  assert.match(html, /\$16<\/b> Double · 2 oz/);
  assert.match(html, /\$3\.25<\/b> tap price \/ oz/);
  assert.doesNotMatch(html, /\$12\.00|\$16\.00|\$5<\/b>|\$7<\/b>/);
  assert.equal(JSON.stringify(item), before);
});

test("saved portion prices retain cents when present and support the PMB quantity field", () => {
  const helpers = loadComingSoonHelpers();
  const html = helpers.renderComingSoonItem({
    ...liquor,
    priceStatus: "proposed",
    portions: [{ name: "Single", quantityOz: 1.5, price: 12.5 }],
  });
  assert.match(html, /\$12\.50<\/b> proposed Single · 1\.5 oz/);
  assert.doesNotMatch(html, /Double ·/);
});

test("new liquor products preserve saved portion prices by blocking unsupported PMB creation", async () => {
  const helpers = loadComingSoonHelpers();
  const item = { ...liquor, portions: [{ name: "Single", servingOz: 1.5, price: 12 }, { name: "Double", servingOz: 2, price: 16 }] };
  const html = helpers.renderComingSoonItem(item);
  assert.match(html, /Single\/Double prices are saved\. PMB portion setup is required before activation\./);
  assert.match(html, /activate-coming-soon-pmb" type="button" disabled/);
  assert.throws(() => helpers.buildPmbPayloadFromComingSoonItem(item), { code: "COMING_SOON_PORTION_SETUP_REQUIRED" });
  let renderCount = 0;
  helpers.comingSoonItems = [item];
  helpers.kegSyncMessage = "";
  helpers.renderKegLevels = () => { renderCount += 1; };
  helpers.openComingSoonLiquorSetup = () => assert.fail("Portion setup must not fall back to the flat-price auto-publishing form");
  assert.equal(await helpers.sendComingSoonItemToPmb(item.id, { activate: true }), null);
  assert.match(helpers.kegSyncMessage, /PMB portion setup is required/);
  assert.equal(renderCount, 1);
});

test("existing PMB products are not blocked by saved portion display metadata", () => {
  const helpers = loadComingSoonHelpers();
  const item = { ...liquor, plu: 1234, portions: [{ name: "Single", servingOz: 1.5, price: 12 }] };
  const html = helpers.renderComingSoonItem(item);
  assert.doesNotMatch(html, /activate-coming-soon-pmb" type="button" disabled|PMB portion setup is required/);
  assert.equal(helpers.buildPmbPayloadFromComingSoonItem(item).plu, 1234);
});

test("missing tap prices are explicit and are never displayed as zero dollars", () => {
  const helpers = loadComingSoonHelpers();
  const html = helpers.renderComingSoonItem({ id: "liquor:unpriced", kind: "liquor", name: "Unpriced liquor" });
  assert.match(html, /Tap price not set/);
  assert.doesNotMatch(html, /\$0\.00/);
  assert.doesNotMatch(html, /Single|Double/);
});

test("estimated bottle costs and their source are clearly labeled", () => {
  const helpers = loadComingSoonHelpers();
  const html = helpers.renderComingSoonItem({
    ...liquor,
    bottleCost: 24.99,
    bottleCostStatus: "estimate",
    bottleCostSource: "OHLQ listed price <estimate>",
  });
  assert.match(html, /\$24\.99<\/b> estimated bottle cost/);
  assert.match(html, /Bottle cost source: OHLQ listed price &lt;estimate&gt;/);
});

test("liquor catalog costs are available while saved purchase and sale prices take priority", () => {
  const helpers = loadComingSoonHelpers();
  const maker = { ...liquor, id: "liquor:makers-mark", name: "Maker's Mark" };
  assert.equal(helpers.getComingSoonLiquorCatalogPricing(maker), OHLQ_MAPPINGS["makers-mark"]);
  assert.equal(helpers.getComingSoonLiquorCatalogPricing({ kind: "beer", id: maker.id }), null);
  const html = helpers.renderComingSoonLiquorDetails({ ...maker, bottleCost: 50, bottleOz: 59.1745, chargePerOz: 4 });
  assert.match(html, /\$50\.00<\/b> bottle cost/);
  assert.match(html, /59\.17 oz<\/b> bottle size/);
  assert.match(html, /\$4\.00<\/b> tap price \/ oz/);
  assert.match(html, /\$6<\/b> Single · 1\.5 oz/);
  assert.match(html, /\$8<\/b> Double · 2 oz/);
  assert.doesNotMatch(html, /\$47\.00|\$3\.25/);
  const catalogHtml = helpers.renderComingSoonLiquorDetails({ id: maker.id, kind: "liquor" });
  assert.match(catalogHtml, /\$47\.00<\/b> bottle cost/);
  assert.match(catalogHtml, /Tap price not set/);
});

test("saved manufacturer and style survive PMB payload preparation without publishing", () => {
  const helpers = loadComingSoonHelpers();
  const payload = helpers.buildPmbPayloadFromComingSoonItem({ ...liquor, chargePerOz: 4 });
  assert.equal(payload.brewery, "Cîroc");
  assert.equal(payload.style, "Pineapple vodka");
  assert.equal(payload.pricePerOz, 4);
  assert.equal(payload.servingOz, 1.5);
  assert.equal(payload.kegCost, 29.99);
  assert.equal(payload.imageUrl, "https://dashboard.example/images/products/ciroc-pineapple.png");
  assert.equal(payload.isActive, undefined);
  assert.equal(payload.isInUse, undefined);
  assert.equal(payload.sendConfigUpdate, undefined);
  const breweryPayload = helpers.buildPmbPayloadFromComingSoonItem({ ...liquor, producer: "", brewery: "Saved manufacturer" });
  assert.equal(breweryPayload.brewery, "Saved manufacturer");
  const servingPayload = helpers.buildPmbPayloadFromComingSoonItem({ ...liquor, servingOz: 2 });
  assert.equal(servingPayload.servingOz, 2, "saved servingOz is preserved when pourOz is absent");
  const pourPayload = helpers.buildPmbPayloadFromComingSoonItem({ ...liquor, servingOz: 2, pourOz: 1.5 });
  assert.equal(pourPayload.servingOz, 1.5, "an explicit saved pourOz still takes priority");
});

test("card descriptions and manufacturer details are escaped and liquor stats stay scoped to liquor", () => {
  const helpers = loadComingSoonHelpers();
  const html = helpers.renderComingSoonItem({ ...liquor, description: "<script>alert(1)</script>", producer: "Maker & Sons" });
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /Maker &amp; Sons/);
  assert.doesNotMatch(html, /<script>/);
  const beerHtml = helpers.renderComingSoonItem({ id: "beer:future", kind: "beer", name: "Future Lager" });
  assert.doesNotMatch(beerHtml, /Tap price not set|bottle cost|oz pour/);
});
