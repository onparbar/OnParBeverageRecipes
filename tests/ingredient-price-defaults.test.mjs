import assert from "node:assert/strict";
import test from "node:test";
import { REQUIRED_INGREDIENT_PRICE_DEFAULTS } from "../public/ingredient-price-defaults.mjs";

test("keeps Kahlua and Ketel One bottle prices available before vendor sync", () => {
  assert.deepEqual(REQUIRED_INGREDIENT_PRICE_DEFAULTS.kahlua, {
    bottleOz: "33.814",
    bottlePrice: "27.26",
    updatedAt: "Default OHLQ pricing",
  });
  assert.deepEqual(REQUIRED_INGREDIENT_PRICE_DEFAULTS["ketel-one-cucumber-vodka"], {
    bottleOz: "33.814",
    bottlePrice: "28.20",
    updatedAt: "Default OHLQ pricing",
  });
});
