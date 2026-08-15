import assert from "node:assert/strict";
import test from "node:test";

import {
  getPreparedIngredientCost,
  getPreparedIngredientCanonicalName,
  getPreparedIngredientRecipeAmount,
  getPreparedIngredientYieldNote,
  isPreparedIngredientRecipeNote,
  normalizePreparedIngredientPriceOverride,
} from "../public/prepared-ingredient-pricing.mjs";

test("prices cold brew by each concentrate bottle while keeping the diluted recipe yield", () => {
  const migrated = normalizePreparedIngredientPriceOverride("cold-brew-coffee", {
    bottleOz: "384",
    bottlePrice: "51.67",
  });

  assert.equal(migrated.bottleOz, "32");
  assert.equal(Number(migrated.bottlePrice), 25.835);
  assert.equal(getPreparedIngredientCost("cold-brew-coffee", 384, migrated.bottlePrice), 51.67);
  assert.equal(
    getPreparedIngredientRecipeAmount("cold-brew-coffee", 384),
    "2 concentrate bottles (32 oz) + 2.5 gallons water",
  );
});

test("prices Blue Dot juice by six-packet Starburst box", () => {
  const normalized = normalizePreparedIngredientPriceOverride("blue-dot-juice", {
    bottleOz: "128",
    bottlePrice: "1",
  });

  assert.equal(normalized.bottleOz, "1");
  assert.equal(normalized.bottlePrice, "1");
  assert.equal(getPreparedIngredientCost("blue-dot-juice", 1152, normalized.bottlePrice), 9);
  assert.equal(
    getPreparedIngredientRecipeAmount("blue-dot-juice", 1152),
    "9 Starburst boxes (54 packets) + 9 gallons water",
  );
  assert.equal(
    getPreparedIngredientYieldNote("blue-dot-juice"),
    "Starburst box (6 packets) makes 128 oz with 1 gallon water",
  );
  assert.equal(getPreparedIngredientCanonicalName("1152 Blue Dot Juice"), "Blue Dot Juice");
  assert.equal(isPreparedIngredientRecipeNote({
    raw: "blue dot juice (1 gallon of water and 6 packets of blue raspberry)",
  }), true);
  assert.equal(isPreparedIngredientRecipeNote({
    raw: "Blue Dot Juice",
    ounces: "128",
  }), false);
});
