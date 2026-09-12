import assert from "node:assert/strict";
import test from "node:test";
import { createSupplierMapping, observePackagePrice } from "../public/vendor-pricing-state.mjs";

test("only same-package price changes greater than ten percent produce alerts", () => {
  const previous = { bottlePrice: 100, bottleOz: 25 };
  for (const price of [90, 100, 110]) assert.equal(observePackagePrice(previous, { bottlePrice: price, bottleOz: 25 }).priceChangeAlerts.length, 0);
  for (const price of [89, 111]) assert.equal(observePackagePrice(previous, { bottlePrice: price, bottleOz: 25 }).priceChangeAlerts.length, 1);
  assert.equal(observePackagePrice(previous, { bottlePrice: 200, bottleOz: 50 }).priceChangeAlerts.length, 0);
  assert.equal(observePackagePrice({}, { bottlePrice: 200, bottleOz: 50 }).priceChangeAlerts.length, 0);
});

test("dismissed alerts stay dismissed after unchanged price observations", () => {
  const initial = observePackagePrice({ kegPrice: 100, kegOz: 1984 }, { kegPrice: 120, kegOz: 1984 }, { kind: "keg", source: "Provi" });
  initial.priceChangeAlerts[0].dismissedAt = "2026-09-12T12:00:00Z";
  const next = observePackagePrice(initial, { kegPrice: 120, kegOz: 1984 }, { kind: "keg", source: "Provi" });
  assert.deepEqual(next.priceChangeAlerts, initial.priceChangeAlerts);
});

test("supplier links keep pricing and ordering identities separate", () => {
  for (const [vendor, orderingSystem] of [["Heidelberg", "BEES"], ["Bonbright", "Bonbright"], ["OHLQ", "OHLQ"], ["Proof", "Proof"]]) {
    const mapping = createSupplierMapping({ name: "Example", vendor, bottleOz: 25 });
    assert.equal(mapping.orderingSystem, orderingSystem);
    assert.equal(mapping.requireExactMatch, true);
    assert.equal(mapping.orderingStatus, "needs-confirmation");
    assert.equal(mapping.preferredSku, "");
    assert.equal(mapping.orderingSku, "");
  }
});
