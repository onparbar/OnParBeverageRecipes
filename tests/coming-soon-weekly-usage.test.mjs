import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as identity from "../lib/pmb-weekly-usage-identity.mjs";
import { verifyWeeklyReportZeros } from "../lib/pmb-weekly-zero-verification.mjs";
import { mergeRecoveredWeeklyReport } from "../lib/weekly-usage-recovery.mjs";
import { findWeeklyUsageIdentityMatch, isWeeklyUsageNameFallbackEligible, canReuseWeeklyUsageHistory } from "../public/weekly-action-plan.mjs";
import { getSavedTapOrderProduct, getTapOrderProductName } from "../public/tap-order-product.mjs";
import { buildRawRecommendation } from "../lib/par-agent.mjs";
import { isPricingPlaceholder } from "../public/pricing-placeholders.mjs";
import { getKnownBeerKegSizeOz } from "../public/beer-keg-pricing.mjs";
import { buildInventoryPosition, buildStockGapRecommendation } from "../public/operations-truth-model.mjs";
import { getCurrentTapUsage } from "../public/current-tap-usage.mjs";
import { getEightWeekPeakUsage } from "../public/keg-demand-policy.mjs";
import { resolveCanonicalTap, getCanonicalTapDisplayName } from "../public/canonical-tap-resolution.mjs";

const previous = [
  { tapNumber: 38, plu: 59321, name: "Stella Artois 1", type: "Import", wall: "Main" },
  { tapNumber: 44, plu: 136485, name: "Triple Jam Cider 1", type: "Cider", wall: "Main" },
  { tapNumber: 77, plu: 7018, name: "Busch Light 2", type: "Domestic", wall: "Karaoke" },
].map(tap => ({ ...tap, id: `saved-${tap.tapNumber}`, displayUnit: "kegs", kegOz: 1984,
  history: [{ label: "10/5/26 - 10/11/26", source: "PMB", hasValue: true, volumeOz: 500, value: 0.25 }] }));
const taps = previous.map(tap => ({ ...tap, key: `tap-${tap.tapNumber}`, plu: 11111,
  name: "Coming Soon!", brand: "Coming Soon!", templateBrand: tap.name, deviceId: 1000 + tap.tapNumber, lineNum: 1 }));
const products = new Map([[11111, { name: "Coming Soon!" }], ...previous.map(tap => [tap.plu, { name: tap.name }])]);
const context = () => identity.buildWeeklyUsageTapContext(taps);
const rows = [{ plu: 11111, volume_amount: 12.5 }, { plu: 11111, volume_amount: 7.25 }];

test("shared Coming Soon ounces remain one unassigned total, with unknown per-tap usage", () => {
  const items = identity.buildPhysicalWeeklyUsageItems(rows, products, context());
  const aggregate = items.find(item => !item.tapNumber);
  assert.equal(aggregate.volumeOz, 19.75);
  assert.equal(aggregate.transactionCount, 2);
  assert.equal(aggregate.tapAssignmentUnknown, true);
  assert.deepEqual(aggregate.candidateTapNumbers, [38, 44, 77]);
  assert.equal(items.reduce((sum, item) => sum + item.volumeOz, 0), 19.75);
  for (const tap of taps) {
    const item = items.find(item => item.tapNumber === tap.tapNumber);
    assert.equal(item.hasValue, false);
    assert.match(item.usageUnknownReason, /unassigned/i);
    assert.equal(findWeeklyUsageIdentityMatch(tap, [aggregate]), null);
    assert.equal(canReuseWeeklyUsageHistory(aggregate, tap, 1), false);
  }
  assert.equal(isWeeklyUsageNameFallbackEligible(aggregate), false);
});

test("a complete assignment history cannot turn unassigned placeholder pours into per-tap zeroes", () => {
  const report = { startDate: "2026-10-12", endDate: "2026-10-18", transactionCount: rows.length,
    items: identity.buildPhysicalWeeklyUsageItems(rows, products, context()) };
  const assignments = taps.map(tap => ({ ...tap, firstSeenAt: "2026-10-01T00:00:00Z", lastSeenAt: "2026-10-20T00:00:00Z" }));
  const verified = verifyWeeklyReportZeros(report, { currentTaps: taps, assignments,
    startTime: Date.parse("2026-10-12T04:00:00Z"), endTime: Date.parse("2026-10-19T04:00:00Z") });
  for (const item of verified.items.filter(item => item.tapNumber)) {
    assert.equal(item.hasValue, false);
    assert.notEqual(item.zeroUsageVerified, true);
  }
});

test("identified placeholder pours stay separate from the unresolved aggregate", () => {
  const items = identity.buildPhysicalWeeklyUsageItems([...rows, { plu: 11111, tap_number: 44, volume_amount: 9 }], products, context());
  assert.equal(items.find(item => item.tapNumber === 44).volumeOz, 9);
  assert.equal(items.find(item => !item.tapNumber).volumeOz, 19.75);
  assert.equal(items.reduce((sum, item) => sum + item.volumeOz, 0), 28.75);
});

test("the exception requires placeholder names in both catalog and all assignments", () => {
  for (const [catalog, current] of [
    [new Map([[11111, { name: "Real Beer" }]]), taps],
    [products, taps.map((tap, i) => i ? tap : { ...tap, name: "Real Beer" })],
    [new Map(), taps],
  ]) assert.throws(() => identity.buildPhysicalWeeklyUsageItems(rows, catalog, identity.buildWeeklyUsageTapContext(current)),
    error => error.code === "PMB_WEEKLY_USAGE_AMBIGUOUS_TAP");
  assert.throws(() => identity.buildPhysicalWeeklyUsageItems([{ plu: 59321, tap_number: 38, volume_amount: 5 }], products, context()),
    error => error.code === "PMB_WEEKLY_USAGE_TAP_MISMATCH");
  assert.throws(() => identity.buildPhysicalWeeklyUsageItems([{ plu: 11111, tap_number: 999, volume_amount: 5 }], products, context()),
    error => error.code === "PMB_WEEKLY_USAGE_AMBIGUOUS_TAP");
});

function buildReport() {
  // Run the production report builder, including its legacy name fallback.
  const source = readFileSync(new URL("../app/api/pmb-weekly-usage/route.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\n/gm, "").replaceAll("export ", "");
  return new Function(...Object.keys(identity), `${source}\nreturn buildWeeklyReport;`)(...Object.values(identity));
}

test("report building and shared recovery preserve former beer history and unassigned ounces separately", () => {
  const ctx = context();
  previous.forEach(tap => ctx.tapLookup.byExactAlias.set(tap.name.toLowerCase(), [{ ...tap, wallNumber: tap.wall === "Main" ? 1 : 2 }]));
  // Even a misleading legacy placeholder alias must not assign the aggregate.
  ctx.tapLookup.byExactAlias.set("coming soon", [previous[0]]);
  const transactions = [...rows, ...previous.map(tap => ({ plu: tap.plu, volume_amount: 150 }))];
  const report = buildReport()({ start: new Date("2026-10-12T00:00:00"), endInclusive: new Date("2026-10-18T00:00:00") },
    transactions, [rows[0]], products, ctx);
  const aggregate = report.items.find(item => item.tapAssignmentUnknown && !item.tapNumber);
  assert.equal(aggregate.volumeOz, 19.75);
  assert.equal(aggregate.preThursdayVolumeOz, 12.5);
  assert.equal(report.items.reduce((sum, item) => sum + item.volumeOz, 0), 469.75);
  const saved = { activeItems: previous, archivedItems: [], historyOverrides: {} };
  const recovered = mergeRecoveredWeeklyReport(saved, report);
  assert.deepEqual(saved.activeItems.map(item => item.history.length), [1, 1, 1], "inputs untouched");
  for (const item of recovered.activeItems) assert.equal(item.history[0].volumeOz, 150);
  const archived = recovered.archivedItems.find(item => !item.tapNumber);
  assert.equal(archived.history[0].volumeOz, 19.75);
  assert.equal(archived.tapAssignmentUnknown, true);
  assert.equal(archived.displayUnit, "oz");
  const repeated = mergeRecoveredWeeklyReport(recovered, report);
  assert.equal(repeated.archivedItems.filter(item => !item.tapNumber).length, 1);
});

test("all three placeholder taps order the retained beer, or the attached On Deck product", () => {
  const before = JSON.stringify(taps);
  for (const tap of taps) {
    const saved = getSavedTapOrderProduct(tap, previous, []);
    const retained = getSavedTapOrderProduct(tap, [tap], [{ ...saved, replacedAt: "2026-10-18T23:00:00Z", replacedBy: "Coming Soon!" }]);
    for (const selected of [saved, retained]) {
      assert.equal(getTapOrderProductName(tap, selected), saved.name);
      for (const onDeck of [null, { name: "Next Beer", kind: "beer" }]) {
        const recommendation = buildRawRecommendation(tap, { fillLevelPercent: 87.1, rawPercent: 8711, rawKegSize: 1690, rawKegSizeDp: 0 }, [],
          { onHandOverrides: { [tap.key]: 0 }, onDeckOverrides: onDeck ? { [tap.key]: onDeck } : {} }, {}, selected,
          { now: new Date("2026-10-19T18:00:00Z") });
        assert.equal(recommendation.orderProductName, onDeck?.name || saved.name);
        assert.equal(recommendation.liveFraction, 0, "placeholder levels are not connected beer stock");
        assert.equal(recommendation.orderQty, 1);
      }
    }
  }
  assert.equal(JSON.stringify(taps), before, "ordering never changes PMB assignments");
});

const dashboard = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function dashboardFunction(name, scope) {
  const start = dashboard.indexOf(`function ${name}(`);
  assert.ok(start >= 0);
  const source = dashboard.slice(start, dashboard.indexOf("\n}\n", start) + 2);
  return new Function(...Object.keys(scope), `${source}; return ${name};`)(...Object.values(scope));
}

test("dashboard ordering excludes placeholder percentages, honors cooler stock, and preserves active readings", () => {
  let name = "Coming Soon!", backups = 0, fraction = 0.871;
  const calculate = dashboardFunction("getKegNeedCalculation", {
    getKegLiveRow: () => ({ rawKegSize: 1690 }), getKegCurrentFraction: () => fraction,
    getKegDisplayBrand: () => name, isPricingPlaceholder, getWeeklyUsageForKegItem: () => previous[2],
    getSixWeekUsage: () => ({}), isLiquorOunceTap: () => false, toNumber: Number,
    getKegOnDeckItem: () => null, clean: value => String(value || "").trim(),
    normalizeTitle: value => String(value || "").toLowerCase(), getTapOrderProductName,
    getKegSizeOverrideOz: getKnownBeerKegSizeOz, STANDARD_BEER_KEG_OZ: 1984,
    getKegFullOunces: () => 1984,
    getEightWeekPeakUsage: (_item, _now, fullOz) => { assert.equal(fullOz, 1984); return { sampleWeeks: 1, targetStock: 0.6 }; },
    getKegOnHandDisplay: () => backups, buildInventoryPosition, buildStockGapRecommendation,
  });
  assert.equal(calculate(taps[2]).orderQuantity, 1);
  backups = 1;
  assert.equal(calculate(taps[2]).orderQuantity, 0);
  backups = 0;
  name = "Busch Light 2";
  assert.equal(calculate(taps[2]).orderQuantity, 0, "real connected beer still counts");
  fraction = null;
  assert.equal(calculate(taps[2]), null, "failed active readings still block calculation");
});

test("Keg Levels retains physical-tap usage when a cached pricing name hides Coming Soon", () => {
  const now = new Date("2026-10-19T18:00:00Z");
  for (const tapNumber of [44, 77]) {
    const tap = taps.find(item => item.tapNumber === tapNumber);
    const saved = previous.find(item => item.tapNumber === tapNumber);
    const archived = { ...saved, replacedAt: now.toISOString(), replacedBy: "Coming Soon!" };
    let liveRow = { ...tap, fillLevelPercent: 87.1, rawKegSize: 1690, rawKegSizeDp: 0 };
    let backups = 0;
    const scope = {
      Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } },
      getKegLiveRow: () => liveRow,
      getKegItemKey: item => item.key,
      tapReplacementOverrides: {}, liveTapPricingUpdatedAt: now.toISOString(),
      getLiveTapPriceForKegWallItem: () => ({ name: tapNumber === 77 ? "Busch Light 1" : "Triple Jam Cider 2", plu: 999, chargePerOz: 0.33 }),
      getLiveTapPortions: () => [], resolveCanonicalTap, getCanonicalTapDisplayName,
      getSavedTapOrderProduct, getTapOrderProductName, isPricingPlaceholder,
      weeklyUsageItems: [{ ...tap, history: [{ label: "10/12/26 - 10/18/26", hasValue: false, value: 0 }] }],
      weeklyUsageArchivedItems: [archived], getCurrentTapUsage,
      getWeeklyUsageNameKeys: name => [String(name || "").toLowerCase().replace(/\s+[123]$/, "")],
      getKegCurrentFraction: () => liveRow.levelAvailable === false ? null : liveRow.fillLevelPercent / 100,
      getSixWeekUsage: () => ({}), isLiquorOunceTap: () => false, toNumber: Number,
      getKegOnDeckItem: () => null, clean: value => String(value || "").trim(),
      normalizeTitle: value => String(value || "").toLowerCase(),
      getKegSizeOverrideOz: getKnownBeerKegSizeOz, STANDARD_BEER_KEG_OZ: 1984,
      getKegFullOunces: () => 1690, getEightWeekPeakUsage,
      getKegOnHandDisplay: () => backups, buildInventoryPosition, buildStockGapRecommendation,
      getParAgentRecommendation: () => ({ orderProductName: saved.name, actionType: "order" }),
      getCanonicalProductDisplayName: String, formatNumber: String, escapeHtml: String,
    };
    for (const name of ["getKegCanonicalResolution", "getKegDisplayBrand", "getWeeklyUsageForKegItem", "getKegNeedCalculation", "getKegNeed", "renderKegNeedValue", "renderKegNeedCell"]) {
      scope[name] = dashboardFunction(name, scope);
    }
    const displayName = scope.getKegDisplayBrand(tap, liveRow);
    assert.notEqual(displayName, "Coming Soon!", "reproduce the cached pricing display name");
    assert.equal(scope.getWeeklyUsageForKegItem(tap, displayName), archived);
    const recommendation = buildRawRecommendation(tap, liveRow, [], { onHandOverrides: { [tap.key]: 0 } }, {}, archived, { now });
    assert.equal(scope.getKegNeed(tap), recommendation.orderQty);
    assert.equal(scope.getKegNeed(tap), 1);
    const html = scope.renderKegNeedCell(tap, scope.getKegNeed(tap));
    assert.match(html, />Order 1</);
    const target = getEightWeekPeakUsage(archived, now, 1984).targetStock;
    assert.match(html, new RegExp(`<strong>${target} kegs</strong>`));
    assert.doesNotMatch(html, /Not available/);
    backups = 1;
    assert.equal(scope.getKegNeed(tap), 0, "the current cooler count still updates the live calculation");
    backups = 0;
    liveRow = { ...liveRow, name: "New Beer", plu: 12345, levelAvailable: false };
    assert.equal(scope.getKegNeed(tap), null, "a failed reading of a real replacement remains unknown");
    assert.notEqual(scope.getWeeklyUsageForKegItem(tap, "New Beer"), archived, "real replacements cannot revive the old beer history");
  }
});

test("browser archiving conserves unassigned ounces and reuses the shared recovery archive", () => {
  const aggregate = identity.buildPhysicalWeeklyUsageItems(rows, products, context()).find(item => !item.tapNumber);
  const saved = { id: "pmb-report-unassigned-11111-coming-soon-", archiveId: "pmb-report-unassigned-11111-coming-soon-",
    name: "Coming Soon!", plu: 11111, tapNumber: null, history: [] };
  const archived = [saved];
  const archive = dashboardFunction("archivePmbWeeklyUsageReportItem", {
    clean: value => String(value || "").trim(), toNumber: value => Number(value) || 0,
    slugify: value => value.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    weeklyUsageArchivedItems: archived,
    getWeeklyUsageDisplayUnitForTap: () => { throw new Error("No keg size may be assumed for unassigned pours"); },
    getWeeklyUsageReportValue: (item, oz) => { assert.equal(item.displayUnit, "oz"); return oz; },
    roundWeeklyUsageValue: Number, getWeeklyUsagePriceSnapshot: () => ({}),
    mergeWeeklyUsageHistory: value => value, isUsableWeeklyUsageEntry: () => true,
    calculateAverage: values => values.reduce((a, b) => a + b, 0) / values.length,
    upsertWeeklyUsageArchive: item => { const index = archived.findIndex(old => old.id === item.id); if (index >= 0) archived[index] = item; else archived.push(item); },
  });
  assert.equal(archive(aggregate, "10/12/26 - 10/18/26"), true);
  assert.equal(archive(aggregate, "10/12/26 - 10/18/26"), true);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].history.length, 1);
  assert.equal(archived[0].history[0].volumeOz, 19.75);
  assert.equal(archived[0].history[0].value, 19.75);
  assert.equal(archived[0].tapAssignmentUnknown, true);
  assert.deepEqual(archived[0].candidateTapNumbers, [38, 44, 77]);
});
