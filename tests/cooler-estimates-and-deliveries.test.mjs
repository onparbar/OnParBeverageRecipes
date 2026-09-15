import test from "node:test";
import assert from "node:assert/strict";
import { applyCoolerEstimateObservations, parseKegTappedOn } from "../lib/keg-cooler-estimates.mjs";
import { applyBeerReceiptCounts } from "../lib/beer-receipt-counts.mjs";
import { createSharedKegParAgentStore } from "../lib/keg-par-agent-shared-store.mjs";
import { beerDeliveryDestination, beerDeliveryLabel, resolveBeerReceiptAllocations } from "../public/beer-delivery-destinations.mjs";
import { buildWeeklyActionPlan, createWeeklyPlanSnapshot, getCurrentWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";
import { buildWeeklyOrderTracking } from "../lib/weekly-order-tracking.mjs";
import { kegDestination } from "../public/keg-destination.mjs";

const start = "2026-09-14T12:00:00.000Z";
const later = "2026-09-14T13:00:00.000Z";
const generatedAt = "2026-09-14T11:30:00.000Z";
const rec = (extra = {}) => ({ key: "main-21", tapNumber: 21, wall: "Main", name: "Test Beer 1", plu: 100,
  isKegTap: true, actionType: "order", orderProductName: "Test Beer 1", orderQty: 2, unitCost: 150, vendor: "Bonbright", ...extra });
const base = () => ({ onHandOverrides: { "main-21": "3", "karaoke-73": "4" }, onDeckOverrides: {}, parOverrides: {},
  settings: { kegCountWeek: "2026-09-14" }, recommendations: { generatedAt, items: [rec()] } });
const observation = (tappedOn = "09/13/2026 10:00:00", extra = {}) => ({ tapNumber: 21, deviceId: 1, lineNum: 1, plu: 100,
  name: "Test Beer 1", levelAvailable: true, tappedOn, tappedOnCached: false, tappedOnError: "", ...extra });
const observe = (data, item, observedAt = later) => applyCoolerEstimateObservations(data, [item], { observedAt, fallbackAt: "2026-09-14T11:00:00.000Z" });
const seeded = () => observe(base(), observation(), start);
const destination = (extra = {}) => beerDeliveryDestination(rec(extra));
const line = () => ({ id: "beer-line", name: "Test Beer", lineType: "Beer keg", quantity: 3, receivedQuantity: 0, status: "pending",
  kegDestinations: [destination(), destination({ key: "karaoke-73", tapNumber: 73, wall: "Karaoke", orderQty: 1 })] });
const tracking = (item) => ({ generatedAt, vendors: [{ id: "bonbright", items: [item] }] });
function receive(state, previous, total, allocations) {
  const updated = { ...previous, receivedQuantity: total, status: total >= previous.quantity ? "received" : total > 0 ? "partial" : "not-received" };
  const recommendations = { ...state.recommendations, weeklyOrderTracking: { receipts: { [updated.id]: { receivedQuantity: total } } } };
  return applyBeerReceiptCounts(state, recommendations, tracking(previous), tracking(updated), {
    action: "set-selected-receipts", receipts: [{ itemId: updated.id, ...(allocations ? { kegAllocations: allocations } : {}) }],
  });
}

test("PMB local timestamps honor Eastern daylight and standard time", () => {
  assert.equal(new Date(parseKegTappedOn("09/14/2026 09:00:00")).toISOString(), later);
  assert.equal(new Date(parseKegTappedOn("01/14/2026 09:00:00")).toISOString(), "2026-01-14T14:00:00.000Z");
  assert.ok(Number.isNaN(parseKegTappedOn("02/31/2026 09:00:00")));
  assert.ok(Number.isNaN(parseKegTappedOn("03/08/2026 02:30:00")));
  assert.ok(Number.isNaN(parseKegTappedOn("unknown")));
});

test("initial observations establish a baseline without consuming old kegs", () => {
  const state = base();
  const next = observe(state, observation(), start);
  assert.deepEqual(next.onHandOverrides, state.onHandOverrides);
  assert.equal(next.coolerEstimateState.events.length, 0);
  assert.equal(state.coolerEstimateState, undefined);
});

test("a fresh PMB event deducts once and leaves the other cooler alone", () => {
  const next = observe(seeded(), observation("09/14/2026 08:45:00"));
  assert.equal(next.onHandOverrides["main-21"], "2");
  assert.equal(next.onHandOverrides["karaoke-73"], "4");
  assert.equal(next.coolerEstimateState.events[0].estimated, true);
  assert.deepEqual(observe(next, observation("09/14/2026 08:45:00")), next);
  assert.deepEqual(observe(next, observation("09/14/2026 08:30:00")), next);
});

test("cached, unavailable, future, and unknown-product readings do not reduce counts", () => {
  for (const extra of [{ tappedOnCached: true }, { levelAvailable: false }, { tappedOnError: "unavailable" }, { plu: 999, name: "Unknown beer" }]) {
    assert.equal(observe(seeded(), observation("09/14/2026 08:45:00", extra)).onHandOverrides["main-21"], "3");
  }
  assert.equal(observe(seeded(), observation("09/15/2026 08:45:00")).onHandOverrides["main-21"], "3");
});

test("liquor and unsupported walls do not use keg cooler deductions", () => {
  for (const extra of [{ isLiquorTap: true }, { wall: "Patio" }]) {
    const data = seeded();
    Object.assign(data.recommendations.items[0], extra);
    assert.equal(observe(data, observation("09/14/2026 08:45:00")).onHandOverrides["main-21"], "3");
  }
});

test("cocktail and no-order recommendations still consume one connected keg", () => {
  for (const actionType of ["make", "none"]) {
    const data = seeded();
    data.recommendations.items[0].actionType = actionType;
    const next = observe(data, observation("09/14/2026 08:45:00"));
    assert.equal(next.onHandOverrides["main-21"], "2");
    assert.equal(observe(next, observation("09/14/2026 08:45:00")).onHandOverrides["main-21"], "2");
  }
});

test("newer physical counts override earlier events and saved reports stay unchanged", () => {
  const data = seeded();
  data.recommendations.weeklyPlanSnapshot = { officialCount: 7 };
  data.onHandOverrides["main-21"] = "7";
  data.inputEditState = { startedAt: start, clocks: { '["onHandOverrides","main-21"]': { editedAt: "2026-09-14T12:50:00Z" } }, history: [] };
  const next = observe(data, observation("09/14/2026 08:45:00"));
  assert.equal(next.onHandOverrides["main-21"], "7");
  assert.deepEqual(next.recommendations, data.recommendations);
  assert.equal(observe(next, observation("09/14/2026 09:30:00"), "2026-09-14T14:00:00Z").onHandOverrides["main-21"], "6");
});

test("no counted backup stays zero and missing counts are not fabricated", () => {
  const empty = seeded(); empty.onHandOverrides["main-21"] = "0";
  const next = observe(empty, observation("09/14/2026 08:45:00"));
  assert.equal(next.onHandOverrides["main-21"], "0");
  assert.equal(next.coolerEstimateState.events[0].outcome, "no-counted-backup");
  delete empty.onHandOverrides["main-21"];
  assert.equal(observe(empty, observation("09/14/2026 08:45:00")).onHandOverrides["main-21"], undefined);
});

test("On Deck transfer happens once even before the browser clears its assignment", () => {
  const data = seeded();
  data.onDeckOverrides["main-21"] = { name: "New Beer", plu: 200, kind: "beer", onHand: "3", onHandUnit: "keg" };
  const first = observe(data, observation("09/14/2026 08:45:00", { plu: 200, name: "New Beer" }));
  assert.equal(first.onHandOverrides["main-21"], "2");
  assert.equal(first.onDeckOverrides["main-21"].onHand, "0");
  const second = observe(first, observation("09/14/2026 09:30:00", { plu: 200, name: "New Beer" }), "2026-09-14T14:00:00Z");
  assert.equal(second.onHandOverrides["main-21"], "1");
  assert.equal(second.coolerEstimateState.slots["21:1:1"].onDeckTransfer.product, "New Beer");
});

test("beer orders retain their cooler allocation and supplier quantity", () => {
  const recommendations = [rec(), rec({ key: "karaoke-73", wall: "Karaoke", tapNumber: 73, orderQty: 1, name: "Test Beer 2", orderProductName: "Test Beer 2" })];
  const plan = buildWeeklyActionPlan({ recommendations });
  assert.equal(plan.orders.beerKegs.length, 1);
  const order = plan.orders.beerKegs[0];
  assert.equal(order.quantity, 3);
  assert.match(beerDeliveryLabel(order), /Main cooler: 2 kegs/);
  assert.match(kegDestination(order), /Karaoke cooler: 1 keg/);
  const snapshot = createWeeklyPlanSnapshot({ generatedAt, recommendations });
  const source = { generatedAt, items: recommendations, weeklyPlanSnapshot: snapshot };
  const tracked = buildWeeklyOrderTracking(source, new Date(later));
  assert.equal(tracked.vendors[0].items[0].kegDestinations.length, 2);
  delete snapshot.plan.orders.beerKegs[0].kegDestinations;
  const upgraded = getCurrentWeeklyPlanSnapshot(source, new Date(later));
  assert.equal(upgraded.plan.orders.beerKegs[0].kegDestinations.length, 2);
  assert.equal(snapshot.plan.orders.beerKegs[0].kegDestinations, undefined);
});

test("full delivery adds only the allocated quantities and retry adds nothing", () => {
  const before = line();
  const first = receive(base(), before, 3);
  assert.equal(first.onHandOverrides["main-21"], "5");
  assert.equal(first.onHandOverrides["karaoke-73"], "5");
  const replay = receive(first, { ...before, receivedQuantity: 3 }, 3);
  assert.deepEqual(replay.onHandOverrides, first.onHandOverrides);
});

test("partial receipts require a real cooler split and later deliveries add only the remainder", () => {
  const before = line();
  assert.throws(() => receive(base(), before, 1), /each cooler/);
  const allocations = before.kegDestinations.map((entry, index) => ({ destinationId: entry.id, quantity: index === 0 ? 1 : 0 }));
  const partial = receive(base(), before, 1, allocations);
  assert.equal(partial.onHandOverrides["main-21"], "4");
  assert.equal(partial.onHandOverrides["karaoke-73"], "4");
  const full = receive(partial, { ...before, receivedQuantity: 1 }, 3);
  assert.equal(full.onHandOverrides["main-21"], "5");
  assert.equal(full.onHandOverrides["karaoke-73"], "5");
  assert.throws(() => resolveBeerReceiptAllocations(before, 2, allocations), /each cooler/);
});

test("correcting a receipt reverses only that receipt and will not make stock negative", () => {
  const before = line();
  const full = receive(base(), before, 3);
  const corrected = receive(full, { ...before, receivedQuantity: 3 }, 0);
  assert.deepEqual(corrected.onHandOverrides, base().onHandOverrides);
  full.onHandOverrides["main-21"] = "0";
  assert.throws(() => receive(full, { ...before, receivedQuantity: 3 }, 0), /before correcting/);
});

test("previously received deliveries are not retroactively added", () => {
  const next = receive(base(), { ...line(), receivedQuantity: 3 }, 3);
  assert.deepEqual(next.onHandOverrides, base().onHandOverrides);
});

test("remaining On Deck deliveries credit current backups after connection and cleanup", () => {
  const data = seeded();
  data.onDeckOverrides["main-21"] = { name: "New Beer", plu: 200, kind: "beer", onHand: "3", onHandUnit: "keg" };
  const connected = observe(data, observation("09/14/2026 08:45:00", { plu: 200, name: "New Beer" }));
  delete connected.onDeckOverrides["main-21"];
  const target = { ...line(), name: "New Beer", quantity: 1,
    kegDestinations: [destination({ orderQty: 1, orderProductName: "New Beer", onDeckProduct: { name: "New Beer" } })] };
  assert.equal(receive(connected, target, 1).onHandOverrides["main-21"], "3");
});

test("shared compare-and-swap serializes duplicate observations and preserves estimate bookkeeping", async () => {
  let currentTime = start;
  let row = { id: "keg-par-agent", initialized: true, revision: 1, data: base(), initialized_at: start, updated_at: start, updated_by_role: "owner" };
  const store = createSharedKegParAgentStore({
    env: { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test" },
    now: () => new Date(currentTime),
    fetchImpl: async (input, init) => {
      const url = new URL(input);
      if (init.method === "GET") return Response.json([structuredClone(row)]);
      if (Number(url.searchParams.get("revision").replace("eq.", "")) !== row.revision) return Response.json([]);
      row = { ...row, ...JSON.parse(init.body) };
      return Response.json([structuredClone(row)]);
    },
  });
  await store.observeKegChanges([observation()], start);
  currentTime = later;
  await Promise.all([store.observeKegChanges([observation("09/14/2026 08:45:00")], later), store.observeKegChanges([observation("09/14/2026 08:45:00")], later)]);
  const saved = await store.read();
  assert.equal(saved.data.onHandOverrides["main-21"], "2");
  assert.equal(saved.data.coolerEstimateState.events.length, 1);
  const client = structuredClone(saved.data);
  client.coolerEstimateState = { version: 1, slots: {}, events: [] };
  currentTime = "2026-09-14T13:10:00.000Z";
  const replaced = await store.replace({ expectedRevision: saved.revision, data: client });
  assert.deepEqual(replaced.data.coolerEstimateState, saved.data.coolerEstimateState);
});
