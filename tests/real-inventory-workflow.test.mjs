import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applyInventoryStateAction } from "../lib/inventory-store.mjs";
import { applyMappedInventoryPackageRule } from "../public/inventory-product-rules.mjs";
import { getProviInventoryUnitPrice } from "../public/provi-package-pricing.mjs";
import { haveKegLevelInputsChanged } from "../public/keg-level-state.mjs";
import { productPriceKeysMatch } from "../public/product-price-matching.mjs";

function state() {
  const base = {
    version: 1,
    revision: 4,
    initialized: true,
    current: {
      onHandOverrides: { bitters: "4", fireball: "3", hidden: "7" },
      parOverrides: { bitters: "12", fireball: "6" },
      customItems: [{ id: "custom", name: "Custom" }],
      itemOrder: ["bitters", "fireball"],
      updatedAt: "",
      updatedByRole: "",
    },
    snapshots: [],
  };
  const withSnapshot = applyInventoryStateAction(base, "save-snapshot", {
    summary: { tapCount: 1, liveTapCount: 1 },
    items: [{
      id: "bitters",
      name: "Bitters",
      group: "Mixer Cabinet",
      onHandDisplay: "4",
      parDisplay: "12",
      shortageDisplay: "8",
      orderDisplay: "12",
      packSize: 12,
      casePackaged: true,
      unitCost: 23.99,
      totalValue: 95.96,
    }],
  }, "owner", new Date("2026-08-10T14:00:00Z"));
  withSnapshot.current.onHandOverrides = { bitters: "4", fireball: "3", hidden: "7" };
  return withSnapshot;
}

test("one batch clears every requested on-hand field without touching protected inventory data", () => {
  const before = state();
  const after = applyInventoryStateAction(before, "batch-update-fields", {
    changes: [
      { id: "bitters", field: "onHand", value: "" },
      { id: "fireball", field: "onHand", value: "" },
      { id: "hidden", field: "onHand", value: "" },
    ],
  }, "owner", new Date("2026-08-17T14:00:00Z"));
  assert.deepEqual(after.current.onHandOverrides, {});
  assert.deepEqual(after.current.parOverrides, before.current.parOverrides);
  assert.deepEqual(
    after.current.customItems.map(({ id, name }) => ({ id, name })),
    before.current.customItems.map(({ id, name }) => ({ id, name })),
  );
  assert.deepEqual(after.current.itemOrder, before.current.itemOrder);
  assert.deepEqual(after.snapshots, before.snapshots);
});

test("reviewed speech-style batches are absolute and idempotent", () => {
  const payload = { changes: [{ id: "fireball", field: "onHand", value: "5" }] };
  const first = applyInventoryStateAction(state(), "batch-update-fields", payload);
  const second = applyInventoryStateAction(first, "batch-update-fields", payload);
  assert.equal(first.current.onHandOverrides.fireball, "5");
  assert.equal(second.current.onHandOverrides.fireball, "5");
});

test("bitters use the mapped Proof and Provi 12 by 16 ounce package", () => {
  const mapped = applyMappedInventoryPackageRule({ id: "bitters", packSize: 1, caseCost: 279.95 }, {
    vendor: "Proof",
    syncVendor: "Provi",
    bottleOz: 16,
    packSize: 12,
    casePrice: 287.88,
  });
  assert.equal(mapped.packSize, 12);
  assert.equal(mapped.casePackaged, true);
  assert.equal(mapped.unitCost, 23.99);
  assert.equal(getProviInventoryUnitPrice({ case_price: 287.88 }, { packSize: 12 }), 23.99);
});

test("canonical pricing connects Fireball, Buffalo Trace, and wall suffixes without brand substitution", () => {
  assert.equal(productPriceKeysMatch("Fireball 2", "Fireball Cinnamon Whisky"), true);
  assert.equal(productPriceKeysMatch("Buffalo Trace Bourbon 2", "Buffalo Trace"), true);
  assert.equal(productPriceKeysMatch("Blue Moon 2", "Blue Moon"), true);
  assert.equal(productPriceKeysMatch("Buffalo Trace", "Bulleit Bourbon"), false);
});

test("unchanged keg payloads do not become pending while genuine edits do", () => {
  const current = { onHandOverrides: { main: "1" }, parOverrides: {}, onDeckOverrides: {}, settings: {} };
  assert.equal(haveKegLevelInputsChanged(current, { ...current, onHandOverrides: { main: "1" } }), false);
  assert.equal(haveKegLevelInputsChanged(current, { ...current, onHandOverrides: { main: "2" } }), true);
  assert.equal(haveKegLevelInputsChanged(
    { ...current, onDeckOverrides: { main: { name: "Modelo", plu: 12 } } },
    { ...current, onDeckOverrides: { main: { plu: 12, name: "Modelo" } } },
  ), false);
});

test("operational fields opt out of password managers without changing the login form", async () => {
  const [page, dashboard] = await Promise.all([
    readFile(new URL("../app/page.jsx", import.meta.url), "utf8"),
    readFile(new URL("../public/dashboard.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /custom-inventory-form[^>]+autoComplete="off"[^>]+data-form-type="other"/);
  assert.match(page, /custom-inventory-on-hand[^>]+type="text"[^>]+data-1p-ignore="true"/);
  assert.match(dashboard, /name="inventory-on-hand-\$\{escapeHtml\(item\.id\)\}"[^>]+autocomplete="off"[^>]+data-1p-ignore="true"/);
  assert.doesNotMatch(page, /custom-inventory-on-hand[^>]+type="password"/);
});
