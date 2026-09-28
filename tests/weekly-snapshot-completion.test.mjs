import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeeklySnapshotCompletion,
  summarizeWeeklySnapshotCompletion,
} from "../public/weekly-snapshot-completion.mjs";
import { applyInventoryStateAction, createEmptyInventoryState } from "../lib/inventory-store.mjs";
import { renderSavedWeeklySnapshot } from "../public/weekly-snapshot-view.mjs";

test("weekly completion keeps delivery and cocktail accountability", () => {
  const completion = buildWeeklySnapshotCompletion({
    generatedAt: "2026-09-21T17:18:09.254Z",
    updatedAt: "2026-09-24T16:31:31.979Z",
    tracking: { vendors: [{
      id: "vendor:proof", vendor: "Proof", items: [
        { id: "lime", name: "Lime Juice", quantity: 3, receivedQuantity: 3, unit: "cases", status: "received", handledBy: "Molly Adams", updatedAt: "2026-09-24T14:23:10Z" },
        { id: "triple-sec", name: "Triple Sec", quantity: 3, status: "pending" },
      ],
    }] },
    prep: { items: [
      { id: "cocktail:vodka-cran", name: "Vodka Cran 2", displayName: "Vodka Cran", quantity: 1, tapNumbers: [94], walls: ["Karaoke"], completed: true, preparedBy: "Cameron Reilly", completedAt: "2026-09-25T18:00:00Z" },
      { id: "cocktail:crown-rita", name: "Crown Apple Rita 1", quantity: 1, completed: false },
    ] },
  });

  assert.equal(completion.deliveries[0].items[0].handledBy, "Molly Adams");
  assert.equal(completion.cocktails[0].preparedBy, "Cameron Reilly");
  assert.deepEqual(summarizeWeeklySnapshotCompletion(completion), {
    deliveryChecked: 1,
    deliveryTotal: 2,
    deliveryExceptions: 0,
    cocktailCompleted: 1,
    cocktailTotal: 2,
  });
});

test("a status without a checker stays not checked", () => {
  const completion = buildWeeklySnapshotCompletion({
    generatedAt: "2026-09-21T17:18:09.254Z",
    tracking: { vendors: [{ id: "vendor:test", vendor: "Test", items: [
      { id: "item", name: "Item", quantity: 1, status: "received" },
    ] }] },
  });
  assert.equal(completion.deliveries[0].items[0].status, "pending");
  assert.equal(summarizeWeeklySnapshotCompletion(completion).deliveryChecked, 0);
});

test("inventory snapshot sync permanently stores the matching weekly checklist", () => {
  const generatedAt = "2026-09-21T17:18:09.254Z";
  const state = createEmptyInventoryState();
  state.initialized = true;
  state.snapshots = [{
    id: "inventory-2026-09-21",
    weekOf: "2026-09-21",
    savedAt: generatedAt,
    savedByRole: "owner",
    summary: {},
    kegPlanSnapshot: { generatedAt, items: [], tapInputs: [], summary: {} },
    items: [{ id: "vodka", name: "Vodka", group: "Liquor", onHandDisplay: "2", parDisplay: "4" }],
  }];
  const completion = buildWeeklySnapshotCompletion({
    generatedAt,
    tracking: { vendors: [{ id: "vendor:ohlq", vendor: "OHLQ", items: [
      { id: "titos", name: "Tito's", quantity: 6, receivedQuantity: 6, status: "received", handledBy: "Molly", updatedAt: "2026-09-24T14:22:43Z" },
    ] }] },
    prep: { items: [] },
  });

  const saved = applyInventoryStateAction(state, "sync-weekly-completion", {
    weeklySnapshotCompletion: completion,
  }, "owner", new Date("2026-09-24T14:23:00Z"));
  assert.equal(saved.snapshots[0].completion.deliveries[0].items[0].handledBy, "Molly");
});

test("weekly snapshot view shows delivery and cocktail completion separately", () => {
  const generatedAt = "2026-09-21T17:18:09.254Z";
  const completion = buildWeeklySnapshotCompletion({
    generatedAt,
    tracking: { vendors: [{ id: "vendor:proof", vendor: "Proof", items: [
      { id: "lime", name: "Lime Juice", quantity: 3, receivedQuantity: 3, status: "received", handledBy: "Molly", updatedAt: "2026-09-24T14:23:10Z" },
    ] }] },
    prep: { items: [{ id: "cocktail:vodka-cran", name: "Vodka Cran", quantity: 1, completed: false }] },
  });
  const html = renderSavedWeeklySnapshot({
    id: "inventory-2026-09-21", weekOf: "2026-09-21", savedAt: generatedAt,
    summary: {}, items: [], completion,
    kegPlanSnapshot: { generatedAt, items: [], tapInputs: [], summary: {} },
    orders: [],
  }, {
    escapeHtml: (value) => String(value),
    formatNumber: (value) => String(value),
    money: (value) => `$${value}`,
    formatUpdatedAt: (value) => String(value),
    dateLabel: "Sep 21, 2026",
    simpleSyrupNeed: "0 gal",
  });
  assert.match(html, /Deliveries<\/span><strong>1 of 1 checked/);
  assert.match(html, /Cocktail prep<\/span><strong>0 of 1 prepared/);
  assert.match(html, /Molly/);
  assert.match(html, /Vodka Cran/);
  assert.match(html, /Not checked/);
});
