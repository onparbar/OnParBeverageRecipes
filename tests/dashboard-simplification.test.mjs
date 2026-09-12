import assert from "node:assert/strict";
import test from "node:test";
import { formatPrepCompletionSummary, renderInlinePrepCompletion, renderFinishWeekDeliveries, renderFinishWeekPanel } from "../public/finish-week-view.mjs";
import { validatePmbPriceChange } from "../public/pricing-advisor.mjs";
import { parsePmbKegTimestamps } from "../lib/pmb-keg-timestamps.mjs";
import { renderSavedWeeklySnapshot } from "../public/weekly-snapshot-view.mjs";
import { escapeHtml, formatNumber, money } from "../public/dashboard-formatters.mjs";

test("pending deliveries have a receive control and completed deliveries show the saved quantity", () => {
  const render = (item, options) => renderFinishWeekDeliveries({ available: true, vendors: [{ id: "vendor", vendor: "Vendor", items: [{ id: "beer", name: "Beer <one>", quantity: 2, ...item }] }] }, options);
  assert.match(render({ status: "pending" }), /data-finish-delivery-item="beer"/);
  assert.match(render({ status: "pending" }), /Beer &lt;one&gt;/);
  assert.match(render({ status: "pending" }, { saving: true }), /disabled/);
  assert.match(render({ status: "received", receivedQuantity: 1 }), /1 received/);
  assert.doesNotMatch(render({ status: "received" }), /type="checkbox"/);
  assert.match(render({ status: "partial", receivedQuantity: 1 }), /1 of 2 received \(partial\)/);
  assert.match(render({ status: "not-received", receivedQuantity: 0 }), /Update delivery in Staff View/);
});

test("inline prep displays actual bottles added and preserves pending completion controls", () => {
  const item = { id: "refill", name: "Vodka", quantity: 3, actualQuantity: 2 };
  assert.match(renderInlinePrepCompletion(item, "liquor"), /data-finish-liquor-quantity="refill"/);
  assert.match(renderInlinePrepCompletion(item, "liquor", { saving: true }), /disabled/);
  assert.equal(renderInlinePrepCompletion({ ...item, completed: true }, "liquor"), "<b>2 bottles added</b>");
  assert.equal(renderInlinePrepCompletion({ ...item, quantity: 1, completed: true }, "cocktail"), "<b>1 cocktail prepped</b>");
});

test("prep status counts cocktails and taps rather than refill bottles", () => {
  const cocktails = [{ quantity: 2, completed: true }, { quantity: 1, completed: false }];
  const liquor = [{ quantity: 9, tapNumbers: [4, 10], completed: true }];
  assert.equal(formatPrepCompletionSummary({ cocktails, liquor, completionAvailable: true }), "2 of 3 cocktails prepped, 2 liquor taps refilled");
  assert.equal(formatPrepCompletionSummary({ cocktails, liquor }), "3 cocktails to make, 2 liquor taps to refill");
});

test("inline completion status does not restore the removed Receive and complete panel", () => {
  for (const section of ["prep", "deliveries"]) {
    const html = renderFinishWeekPanel({ planLocked: true, inline: true, section, message: "Saved <item>" });
    assert.match(html, /role="status"/);
    assert.match(html, /Saved &lt;item&gt;/);
    assert.doesNotMatch(html, /<section|type="checkbox"|Save selected/);
  }
});

test("manual price edits allow increases and decreases but reject invalid or unchanged prices", () => {
  for (const price of ["0.70", "0.78", "0.01", "100.00"]) {
    assert.equal(validatePmbPriceChange({ currentPricePerOz: 0.72, newPricePerOz: price }).valid, true);
  }
  for (const price of ["", "0", "-1", "0.72", "0.721", "100.01", "abc", "1e1"]) {
    assert.equal(validatePmbPriceChange({ currentPricePerOz: 0.72, newPricePerOz: price }).valid, false);
  }
});

const kegCard = (name = "Michelob ULTRA 1") => `<article class="main"><p>Tap Number: 21</p><p class="desc">${name}</p><p id="66952917946726_2_text">88 %</p><p>tapped on: 09/10/2026 21:34:13</p></article>`;
test("PMB keg history preserves exact physical identity and server timestamp", () => {
  assert.deepEqual(parsePmbKegTimestamps(kegCard()), [{ deviceId: 66952917946726, lineNum: 2, tapNumber: 21, name: "Michelob ULTRA 1", tappedOn: "09/10/2026 21:34:13" }]);
  assert.equal(parsePmbKegTimestamps(kegCard("Beer &amp; Cider"))[0].name, "Beer & Cider");
  assert.deepEqual(parsePmbKegTimestamps(kegCard() + kegCard()), []);
  assert.deepEqual(parsePmbKegTimestamps("<p>No history</p>"), []);
});

test("weekly snapshots display saved levels and counts without replacing missing values with zero", () => {
  const helpers = { escapeHtml, formatNumber, money, formatUpdatedAt: String, dateLabel: "Sep 7", valueSummary: "" };
  const snapshot = { savedAt: "2026-09-07", items: [{ name: "Saved bottle", group: "Liquor", onHandDisplay: "7", unitCost: 10, totalValue: 70 }], kegPlanSnapshot: { tapInputs: [{ wall: "Main", tapNumber: 21, name: "Saved beer", liveFraction: 0.5, backupKegs: 0, currentStockKegs: 0.5 }] } };
  const html = renderSavedWeeklySnapshot(snapshot, helpers);
  assert.match(html, /Saved beer/);
  assert.match(html, /50%/);
  assert.match(html, /<td>0<\/td>/);
  assert.match(html, /<td>7<\/td>/);
  assert.match(html, /\$70\.00/);
  snapshot.kegPlanSnapshot.tapInputs[0].inventoryStateMissing = true;
  assert.match(renderSavedWeeklySnapshot(snapshot, helpers), /Not recorded/);
  assert.match(renderSavedWeeklySnapshot({}, helpers), /Keg levels and on-hand kegs were not recorded/);
});
