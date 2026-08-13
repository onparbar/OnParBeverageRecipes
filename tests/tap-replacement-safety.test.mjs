import assert from "node:assert/strict";
import test from "node:test";

import {
  applyVerifiedTapReplacement,
  getUnsafeReplacementHistoryReason,
  getVerifiedTapReplacement,
} from "../lib/tap-replacement-safety.mjs";

const replacedAt = "2026-08-12T15:30:00.000Z";

function tap(type, plu = 4101) {
  return {
    key: "main-50-house-product-1",
    tapNumber: 50,
    plu,
    type,
    name: "House Product 1",
  };
}

function replacement(newKind, overrides = {}) {
  return {
    tapNumber: 50,
    oldBrand: "House Product 1",
    oldPlu: 4101,
    newBrand: "Replacement Product 1",
    newPlu: 4101,
    newKind,
    replacedAt,
    ...overrides,
  };
}

test("verified replacement metadata changes a beer template tap to cocktail", () => {
  const result = applyVerifiedTapReplacement(tap("Lager"), {
    "main-50-house-product-1": replacement("cocktail"),
  });
  assert.equal(result.type, "Cocktail");
  assert.equal(result.replacementKind, "cocktail");
  assert.equal(result.replacementChangedAt, replacedAt);
});

test("verified replacement metadata changes a cocktail template tap to beer", () => {
  const result = applyVerifiedTapReplacement(tap("Cocktail"), {
    "main-50-house-product-1": replacement("Lager"),
  });
  assert.equal(result.type, "Beer");
  assert.equal(result.replacementKind, "beer");
});

test("replacement metadata fails closed when kind or current PLU cannot be verified", () => {
  assert.throws(
    () => getVerifiedTapReplacement(tap("Lager"), {
      "main-50-house-product-1": replacement("PMB beverage"),
    }),
    (error) => error.code === "TAP_REPLACEMENT_KIND_UNKNOWN" && error.status === 409,
  );
  assert.throws(
    () => getVerifiedTapReplacement(tap("Lager", 9999), {
      "main-50-house-product-1": replacement("beer"),
    }),
    (error) => error.code === "TAP_REPLACEMENT_METADATA_AMBIGUOUS" && error.status === 409,
  );
});

test("same-PLU replacements require an approved weekly-usage boundary", () => {
  const currentTap = tap("Lager");
  const metadata = replacement("beer");
  assert.match(
    getUnsafeReplacementHistoryReason(currentTap, metadata),
    /historical usage cannot be separated automatically/,
  );
  assert.equal(getUnsafeReplacementHistoryReason(currentTap, metadata, [{
    tapNumber: 50,
    currentName: "Replacement Product",
    effectiveDate: "2026-08-12",
    splitWeek: "current",
  }]), "");
});

test("a unique replacement PLU preserves a separable historical identity", () => {
  assert.equal(getUnsafeReplacementHistoryReason(tap("Lager", 4200), replacement("beer", {
    newPlu: 4200,
  })), "");
});
