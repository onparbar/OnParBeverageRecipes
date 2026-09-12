import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { requireSuccessfulKegLevelResponse } from "../lib/pmb-keg-safety.mjs";
import { normalizePmbLevelSnapshot } from "../lib/pmb-level-snapshot-store.mjs";
import { findExactLastKnownKegLevel } from "../public/keg-level-fallback.mjs";
import { selectPmbCurrentTapSnapshot } from "../public/pmb-current-tap-snapshot.mjs";
import { classifyPmbLevelState } from "../public/operations-truth-model.mjs";
import { getInventoryCountSections } from "../public/inventory-weekly-counts.mjs";
import { getUncountedInventoryAmount } from "../public/inventory-count-policy.mjs";
import { inventorySnapshotBaseMatches } from "../lib/inventory-snapshot-guard.mjs";
import { createEmptyInventoryState, applyInventoryStateAction } from "../lib/inventory-store.mjs";
import { normalizeDashboardQuestion, getConversationalItemQuery } from "../public/global-dashboard-search.mjs";
import { answerLocalInventoryQuestion } from "../public/local-inventory-questions.mjs";

const source = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");
function load(name, scope) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.indexOf("\n}\n", start) + 2;
  return vm.runInNewContext(`(${source.slice(start, end)})`, scope);
}
const monday = new Date("2026-09-07T14:00:00.000Z");
const tap = { tapNumber: 34, deviceId: 123, lineNum: 1, plu: 101,
  name: "Corona", fillLevelPercent: 0, rawPercent: 0, rawKegSize: 0, rawKegSizeDp: 0 };

test("HTTP 200 all-zero controller payload is unavailable, not an empty keg", () => {
  for (const size of [0, null, "", undefined]) {
    assert.throws(() => requireSuccessfulKegLevelResponse({ status: 200,
      json: { fill_level_perc: 0, fill_level_keg_size: size, fill_level_keg_size_dp: 0 },
    }, tap, { requireKegSize: false }), /empty level is unverified/);
  }
  const configured = { fill_level_perc: 0, fill_level_keg_size: 1984, fill_level_keg_size_dp: 0 };
  assert.equal(requireSuccessfulKegLevelResponse({ status: 200, json: configured }, tap), configured);
  const positive = { fill_level_perc: 5000, fill_level_keg_size: 0, fill_level_keg_size_dp: 0 };
  assert.equal(requireSuccessfulKegLevelResponse({ status: 200, json: positive }, tap, { requireKegSize: false }), positive);
});

test("old saved false zeros cannot return through snapshots or last-known fallbacks", () => {
  const saved = { updatedAt: monday.toISOString(), items: [tap] };
  assert.equal(findExactLastKnownKegLevel(saved, tap), null);
  assert.equal(findExactLastKnownKegLevel({ ...saved, items: [{ ...tap, fillLevelPercent: null }] }, tap), null);
  const normalized = normalizePmbLevelSnapshot(saved);
  const selected = selectPmbCurrentTapSnapshot({ candidate: normalized, expectedTapNumbers: [34] });
  assert.equal(selected.snapshot.items[0].fillLevelPercent, null);
  assert.equal(selected.snapshot.items[0].levelAvailable, false);
  assert.equal(normalized.deviceLevels[123][0].fillLevelPercent, null);
  assert.equal(findExactLastKnownKegLevel(normalized, tap), null);
  const confirmed = normalizePmbLevelSnapshot({ ...saved, items: [{ ...tap, rawKegSize: 1984 }] });
  assert.equal(confirmed.items[0].fillLevelPercent, 0);
  assert.equal(findExactLastKnownKegLevel(confirmed, tap).fillLevelPercent, 0);
});

test("browser does not promote an unconfigured cached zero to a usable level", () => {
  const context = { kegTemplateAssignments: new Map([[34, { ...tap, levelAvailable: true }]]),
    getKegItemKey: () => 34, kegLiveLevelsStale: false, toNumber: Number, classifyPmbLevelState };
  const getLive = load("getKegLiveRow", context);
  assert.equal(getLive(tap).levelAvailable, false);
  assert.equal(getLive(tap).fillLevelPercent, null);
  context.kegTemplateAssignments.set(34, { ...tap, levelAvailable: true, rawKegSize: 1984 });
  assert.equal(getLive(tap).fillLevelPercent, 0);
  assert.equal(getLive(tap).levelAvailable, true);
});

const inventory = [
  { id: "vodka", name: "Vodka", group: "Liquor Cabinet", onHandDisplay: "3" },
  { id: "gin", name: "Gin", group: "Liquor Cabinet", onHandDisplay: "4" },
  { id: "lime", name: "Lime", group: "Mixer Cabinet", onHandDisplay: "5" },
  { id: "garnish", name: "Garnish", group: "Other", onHandDisplay: "2" },
  { id: "sour-mix", name: "Sour Mix", group: "Other" },
];

test("section completion needs this week's item inputs, not an old baseline or assumed quantity", () => {
  const sections = getInventoryCountSections(inventory, { vodka: monday.toISOString(), gin: "2026-09-06T14:00:00Z" }, monday);
  assert.equal(sections[0].complete, false);
  assert.deepEqual(sections[0].missing.map((item) => item.id), ["gin"]);
  assert.equal(sections[2].total, 1);
  const all = Object.fromEntries(inventory.map((item) => [item.id, monday.toISOString()]));
  assert.ok(getInventoryCountSections(inventory, all, monday).every((section) => section.complete));
  assert.ok(getInventoryCountSections(inventory, all, new Date("2026-09-14T14:00:00Z")).every((section) => !section.complete));
});

test("submitting a cabinet zeros unmentioned items only in submitted sections", () => {
  const countedItemsAt = {};
  const complete = load("buildCompletedInventorySectionChanges", { inventoryItems: inventory,
    inventoryCountedItemsAt: countedItemsAt, getInventoryCountSections, getUncountedInventoryAmount });
  const liquor = complete("Liquor Cabinet", [{ id: "vodka", target: "inventory", value: "3" }]);
  assert.deepEqual(Array.from(liquor, ({ id, value }) => [id, value]), [["vodka", "3"], ["gin", "0"]]);
  liquor.forEach(({ id }) => { countedItemsAt[id] = new Date().toISOString(); });
  const mixer = complete("Mixer Cabinet", []);
  assert.deepEqual(Array.from(mixer, ({ id, value }) => [id, value]), [["lime", "0"], ["garnish", "0"]]);
});

test("saving zero records count evidence; price edits and clearing do not count a section", () => {
  let state = applyInventoryStateAction(createEmptyInventoryState(), "initialize", {}, "owner", monday);
  state = applyInventoryStateAction(state, "update-field", { id: "vodka", field: "par", value: "5" }, "owner", monday);
  assert.deepEqual(state.current.countedItemsAt, {});
  state = applyInventoryStateAction(state, "batch-update-fields", { source: "section-count",
    changes: [{ id: "vodka", field: "onHand", value: "0" }] }, "owner", monday);
  assert.equal(state.current.countedItemsAt.vodka, monday.toISOString());
  state = applyInventoryStateAction(state, "batch-update-fields", { source: "clear-on-hand",
    changes: [{ id: "vodka", field: "onHand", value: "" }] }, "owner", monday);
  assert.equal(state.current.countedItemsAt.vodka, undefined);
});

test("snapshot revision recovery ignores aliases but never ignores changed inventory inputs", () => {
  const base = applyInventoryStateAction(createEmptyInventoryState(), "initialize", {}, "owner", monday);
  const latest = structuredClone(base);
  latest.revision += 1;
  latest.current.speechAliases = [{ heard: "new pronunciation" }];
  latest.current.updatedAt = "2026-09-07T15:00:00Z";
  assert.equal(inventorySnapshotBaseMatches(base, latest), true);
  for (const field of ["onHandOverrides", "groupOverrides", "countedItemsAt", "inventoryContributions"]) {
    const changed = structuredClone(latest);
    changed.current[field].vodka = "different";
    assert.equal(inventorySnapshotBaseMatches(base, changed), false, field);
  }
  latest.snapshots.push({ weekOf: "2026-09-07" });
  assert.equal(inventorySnapshotBaseMatches(base, latest), false);
});

test("local questions recognize PBR and do not present old inventory as a current count", () => {
  assert.equal(normalizeDashboardQuestion("PBR over the last eight weeks"), "pabst blue ribbon last eight weeks");
  assert.equal(getConversationalItemQuery("Could you show me the PBR recipe"), "pabst blue ribbon");
  assert.match(answerLocalInventoryQuestion("How much vodka do we have on hand?", inventory, {}, monday).rows[0].text, /not been received/);
  assert.match(answerLocalInventoryQuestion("How much vodka do we have on hand?", inventory,
    { vodka: monday.toISOString() }, monday).rows[0].text, /3 units/);
});

test("liquor order labels give only quantity and use singular for one bottle", () => {
  const render = load("renderKegNeedValue", { getParAgentRecommendation: () => null,
    getCanonicalProductDisplayName: String, getKegOnDeckItem: () => null,
    getKegDisplayBrand: () => "Skrewball", getKegLiveRow: () => null,
    isLiquorOunceTap: () => true, toNumber: Number, formatNumber: String });
  assert.equal(render({ tapNumber: 8 }, 5), '<span class="inventory-order-value">Order 5 bottles</span>');
  assert.equal(render({ tapNumber: 8 }, 1), '<span class="inventory-order-value">Order 1 bottle</span>');
});
