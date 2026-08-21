import assert from "node:assert/strict";
import test from "node:test";

import {
  createClearedKegOnHandOverrides,
  getAdjacentKegOnHandIndex,
  getKegOnHandEditorValue,
  getKegOnHandOuncesEditorValue,
  normalizeKegOnHandDraft,
  normalizeKegOnHandOuncesDraft,
} from "../public/keg-on-hand-input.mjs";

test("shows saved zero counts as an empty editor and removes accidental leading zeroes", () => {
  assert.equal(getKegOnHandEditorValue("0"), "");
  assert.equal(getKegOnHandEditorValue("00"), "");
  assert.equal(getKegOnHandEditorValue("02"), "2");
  assert.equal(normalizeKegOnHandDraft("01"), "1");
});

test("keeps the last valid whole-keg value when invalid text is entered", () => {
  assert.equal(normalizeKegOnHandDraft("1.5", "1"), "1");
  assert.equal(normalizeKegOnHandDraft("abc", "2"), "2");
  assert.equal(normalizeKegOnHandDraft("", "2"), "");
});

test("allows decimal ounces without allowing decimal backup kegs", () => {
  assert.equal(normalizeKegOnHandOuncesDraft("062.5"), "62.5");
  assert.equal(normalizeKegOnHandOuncesDraft("62.55"), "62.55");
  assert.equal(normalizeKegOnHandOuncesDraft("62.555", "62.5"), "62.5");
  assert.equal(getKegOnHandOuncesEditorValue("0"), "");
  assert.equal(normalizeKegOnHandDraft("62.5", "2"), "2");
});

test("moves to the on-hand box directly above or below without leaving the list", () => {
  assert.equal(getAdjacentKegOnHandIndex(4, 10, "up"), 3);
  assert.equal(getAdjacentKegOnHandIndex(4, 10, "down"), 5);
  assert.equal(getAdjacentKegOnHandIndex(0, 10, "up"), 0);
  assert.equal(getAdjacentKegOnHandIndex(9, 10, "down"), 9);
});

test("clearing on hand retains an explicit zero for every tap", () => {
  const result = createClearedKegOnHandOverrides(
    [{ key: "tap-1" }, { key: "tap-2" }],
    (item) => item.key,
  );
  assert.deepEqual(result, { "tap-1": "0", "tap-2": "0" });
});
