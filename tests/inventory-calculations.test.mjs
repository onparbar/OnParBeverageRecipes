import assert from "node:assert/strict";
import test from "node:test";

import {
  convertLegacyCaseCountToUnits,
  getInventoryItemId,
  getInventoryOnHandUnits,
  getInventoryUnitCost,
  getOrderCaseCount,
  getRoundedOrderUnits,
  normalizeInventoryBaseName,
} from "../public/inventory-calculations.mjs";

test("keeps 1.75-liter inventory labels on their legacy item IDs", () => {
  assert.equal(normalizeInventoryBaseName("Tito's 1.75L"), "Tito's");
  assert.equal(normalizeInventoryBaseName("Tito's 1.75ml"), "Tito's");
  assert.equal(normalizeInventoryBaseName("Crown Apple 1.75"), "Crown Apple");
  assert.equal(getInventoryItemId("Tito's 1.75L"), "tito-s");
});

test("uses the individual column as the authoritative packaged-product count", () => {
  assert.equal(getInventoryOnHandUnits({
    caseEquivalent: "1.5",
    individualUnits: "18",
    packSize: "12",
    casePackaged: true,
  }), 18);
});

test("derives per-unit cost from case cost and pack size", () => {
  assert.equal(getInventoryUnitCost(143.90, 12), 143.90 / 12);
  assert.equal(getInventoryUnitCost(155.39, 6), 155.39 / 6);
});

test("rounds shortages to each product's pack size", () => {
  assert.equal(getRoundedOrderUnits(4, 12, true), 12);
  assert.equal(getRoundedOrderUnits(18, 12, true), 24);
  assert.equal(getRoundedOrderUnits(2, 6, true), 6);
  assert.equal(getRoundedOrderUnits(14, 1, false), 14);
});

test("reports order quantities as whole cases", () => {
  assert.equal(getOrderCaseCount(12, 12), 1);
  assert.equal(getOrderCaseCount(24, 12), 2);
  assert.equal(getOrderCaseCount(6, 6), 1);
});

test("converts legacy case-equivalent browser counts to individual units", () => {
  assert.equal(convertLegacyCaseCountToUnits("1.5", 12), 18);
  assert.equal(convertLegacyCaseCountToUnits("6.0", 4), 24);
  assert.equal(convertLegacyCaseCountToUnits("4.0", 1), 4);
});
