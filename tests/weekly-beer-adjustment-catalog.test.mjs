import assert from "node:assert/strict";
import test from "node:test";
import { withSavedBeerCatalog } from "../lib/weekly-beer-adjustment-catalog.mjs";
import { applyWeeklyOrderTrackingUpdate, buildWeeklyOrderTracking } from "../lib/weekly-order-tracking.mjs";
import { createWeeklyPlanSnapshot } from "../public/weekly-action-plan.mjs";

test("a locked week offers off-plan beers from its own counts and receives a manual keg at its counted tap", async () => {
  const generatedAt = "2026-11-23T21:45:46.089Z";
  const now = () => new Date(generatedAt);
  const tap = (tapNumber, name, wall = "Main") => ({ key: `tap-${tapNumber}`, name, wall, tapNumber });
  const taps = [tap(78, "Pabst Blue Ribbon 2", "Karaoke"), tap(24, "Pabst Blue Ribbon 1"),
    tap(28, "Christmas Ale 1"), tap(44, "Triple Jam Cider 1"), tap(95, "Spiked Pink Lemonade", "Karaoke")];
  const original = { generatedAt, items: [], weeklyPlanSnapshot: createWeeklyPlanSnapshot({ generatedAt }) };
  const enriched = await withSavedBeerCatalog(original, {
    readInventory: async () => ({ snapshots: [
      { kegPlanSnapshot: { generatedAt: "2026-11-16", tapInputs: [tap(24, "Miller Lite")] } },
      { kegPlanSnapshot: { generatedAt, tapInputs: taps } },
    ] }),
    readDashboard: async () => ({ initialized: true, data: { pricing: { kegPriceOverrides: {
      "christmas-ale": { kegPrice: "190", vendorMapping: { vendor: "Bonbright" } },
    } } } }),
  });
  const before = buildWeeklyOrderTracking(enriched, now());
  const choices = before.adjustmentCatalog.filter(item => item.lineType === "Beer keg");
  assert.deepEqual(choices.map(item => [item.name, item.vendor, item.currentPlanQuantity, item.unitCost]),
    [["Christmas Ale", "Bonbright", 0, 190], ["Pabst Blue Ribbon", "Bonbright", 0, 89],
      ["Triple Jam Cider", "Heidelberg", 0, 189]]);
  assert.equal(before.itemCount, 0);
  assert.equal(choices[2].vendorSku, "041189-C");
  const save = applyWeeklyOrderTrackingUpdate(enriched, {
    action: "set-order-adjustments", generatedAt, adjustedBy: "Manager",
    adjustments: choices.map(item => ({ catalogId: item.catalogId, vendor: item.vendor, quantity: 1,
      expectedQuantity: 0, reason: "Thanksgiving week" })),
  }, { role: "owner", now });
  const orders = buildWeeklyOrderTracking(save, now()).vendors.flatMap(vendor => vendor.items);
  assert.deepEqual(orders.map(line => [line.name, line.quantity,
    line.kegDestinations.filter(d => d.quantity > 0).map(d => [d.tapNumber, d.quantity])]),
  [["Christmas Ale", 1, [[28, 1]]], ["Pabst Blue Ribbon", 1, [[24, 1]]], ["Triple Jam Cider", 1, [[44, 1]]]]);
  assert.deepEqual(original.weeklyPlanSnapshot.plan.orders.beerKegs, []);
  assert.equal(await withSavedBeerCatalog(save), save);
});
