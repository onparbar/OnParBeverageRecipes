import assert from "node:assert/strict";
import test from "node:test";

import {
  getKnownBeerKegSizeOz,
  GUINNESS_KEG_GALLONS,
  GUINNESS_KEG_OZ,
  GUINNESS_KEG_PRICE,
  isBeerTapPosition,
} from "../public/beer-keg-pricing.mjs";

test("prices Guinness as a 13.2-gallon keg costing $185", () => {
  assert.equal(GUINNESS_KEG_GALLONS, 13.2);
  assert.equal(GUINNESS_KEG_OZ, 1689.6);
  assert.equal(GUINNESS_KEG_PRICE, 185);
  assert.equal(GUINNESS_KEG_PRICE / GUINNESS_KEG_OZ, 185 / 1689.6);
});

test("recognizes Guinness names reported by PMB", () => {
  assert.equal(getKnownBeerKegSizeOz("Guinness 1"), 1689.6);
  assert.equal(getKnownBeerKegSizeOz("Guinness Draught 1"), 1689.6);
  assert.equal(getKnownBeerKegSizeOz({ tapProduct: "GUINNESS DRAUGHT 1" }), 1689.6);
});

test("recognizes current PMB products installed on beer taps", () => {
  assert.equal(isBeerTapPosition({ tapPosition: 42, wall: "Main" }), true);
  assert.equal(isBeerTapPosition({ tapPosition: 78, wall: "Karaoke" }), true);
  assert.equal(isBeerTapPosition({ tapPosition: 47, wall: "Main" }), false);
});
