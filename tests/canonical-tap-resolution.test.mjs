import assert from "node:assert/strict";
import test from "node:test";

import {
  getCanonicalTapDisplayName,
  getCanonicalTapKey,
  isRetiredProduct,
  resolveCanonicalTap,
  resolveCanonicalTapMap,
  resolveOptionalMetric,
} from "../public/canonical-tap-resolution.mjs";

const NOW = new Date("2026-08-16T12:00:00.000Z");

test("verified PMB data wins over snapshots and configured fallbacks", () => {
  const tap = resolveCanonicalTap({
    physicalTapId: "main-39",
    wall: "main",
    tapNumber: 39,
    live: { verified: true, productId: "guinness", productName: "Guinness Draught 1" },
    snapshot: { verified: true, productId: "breakfast", productName: "Breakfast Stout 1" },
    configured: { productId: "breakfast", productName: "Breakfast Stout 1" },
  }, { now: NOW });
  assert.equal(tap.product.name, "Guinness Draught 1");
  assert.equal(tap.source, "pmb_live");
  assert.equal(tap.operationallyVerified, true);
  assert.equal(tap.conflicts[0].code, "product_identity_conflict");
});

test("a current manager override wins and an expired override does not", () => {
  const base = { wall: "main", tapNumber: 32, live: { verified: true, productName: "Garage Beer 1" } };
  assert.equal(resolveCanonicalTap({
    ...base,
    managerOverride: { productName: "Octoberfest 1", expiresAt: "2026-08-17T00:00:00Z" },
  }, { now: NOW }).product.name, "Octoberfest 1");
  assert.equal(resolveCanonicalTap({
    ...base,
    managerOverride: { productName: "Octoberfest 1", expiresAt: "2026-08-15T00:00:00Z" },
  }, { now: NOW }).product.name, "Garage Beer 1");
});

test("retired products are blocked from current operations", () => {
  const tap = resolveCanonicalTap({
    wall: "main",
    tapNumber: 39,
    snapshot: { verified: true, productName: "BREAKFAST STOUT 1" },
  }, { now: NOW });
  assert.equal(isRetiredProduct({ name: "Breakfast Stout" }), true);
  assert.equal(isRetiredProduct({ name: "Apple Pucker 3" }), true);
  assert.equal(tap.product, null);
  assert.equal(tap.lifecycle, "retired");
  assert.equal(tap.operationallyVerified, false);
  assert.equal(tap.blockingIssue, "retired_product");
  assert.equal(getCanonicalTapDisplayName(tap), "Needs current product");
});

test("configured fallback remains visible but cannot drive operations", () => {
  const tap = resolveCanonicalTap({
    wall: "main",
    tapNumber: 42,
    configured: { productName: "Voodoo Ranger IPA 1" },
  }, { now: NOW });
  assert.equal(tap.product.name, "Voodoo Ranger IPA 1");
  assert.equal(tap.source, "configured_fallback");
  assert.equal(tap.confidence, "unverified");
  assert.equal(tap.operationallyVerified, false);
  assert.equal(tap.blockingIssue, "unverified_fallback");
});

test("missing metrics remain unavailable instead of becoming zero", () => {
  assert.deepEqual(resolveOptionalMetric(undefined), { available: false, value: null });
  assert.deepEqual(resolveOptionalMetric("", true), { available: false, value: null });
  assert.deepEqual(resolveOptionalMetric(0, false), { available: false, value: null });
  assert.deepEqual(resolveOptionalMetric(0, true), { available: true, value: 0 });
});

test("canonical tap keys and duplicate detection are deterministic", () => {
  assert.equal(getCanonicalTapKey("Main", 39), "main-39");
  const result = resolveCanonicalTapMap([
    { physicalTapId: "main-39", wall: "main", tapNumber: 39, live: { verified: true, productName: "Guinness" } },
    { physicalTapId: "main-39", wall: "main", tapNumber: 39, live: { verified: true, productName: "Other" } },
  ], { now: NOW });
  assert.equal(result.items.length, 1);
  assert.equal(result.conflicts.at(-1).code, "duplicate_physical_tap");
});
