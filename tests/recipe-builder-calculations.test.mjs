import assert from "node:assert/strict";
import test from "node:test";

import {
  getRecipeBuilderPackageSizeOz,
  repairLegacyGallonRecipeIngredients,
} from "../public/recipe-builder-calculations.mjs";

test("uses 128 ounces for a gallon even when pricing is stored by 18-gallon case", () => {
  assert.equal(getRecipeBuilderPackageSizeOz({
    isGallon: true,
    overrideBottleOz: 2304,
  }), 128);
});

test("continues to use mapped or overridden package sizes for bottles", () => {
  assert.equal(getRecipeBuilderPackageSizeOz({
    mappedBottleOz: 59.17,
  }), 59.17);
  assert.equal(getRecipeBuilderPackageSizeOz({
    overrideBottleOz: 33.814,
    mappedBottleOz: 59.17,
  }), 33.814);
});

test("repairs saved Strawberry mixer edits from the legacy gallon model", () => {
  const source = [{ name: "Strawberry Lemonade", raw: "8 Gallons Strawberry Lemonade", oz: 1024 }];
  const edited = [{
    name: "Strawberry Lemonade",
    raw: "Strawberry Lemonade 0.44 gallons",
    oz: 1013.76,
    packageCount: "0.44",
    packageUnit: "gallons",
    packageSizeOz: 2304,
  }];

  const result = repairLegacyGallonRecipeIngredients(edited, source);
  assert.equal(result.repaired, true);
  assert.deepEqual(result.ingredients[0], {
    ...edited[0],
    raw: source[0].raw,
    oz: 1024,
    packageCount: "8",
    packageUnit: "gallons",
    packageSizeOz: 128,
  });
});

test("repairs both Cranberry mixers and preserves unrelated ingredient edits", () => {
  const source = [
    { name: "Tito's", raw: "Tito's 6 bottles", oz: 355 },
    { name: "Lemonade", raw: "5 Gallons Lemonade", oz: 640 },
    { name: "Cranberry Juice", raw: "3 Gallons Cranberry", oz: 384 },
  ];
  const edited = [
    { name: "Tito's", raw: "Tito's 6 bottles", oz: 355, packageSizeOz: 59.17 },
    { name: "Lemonade", raw: "Lemonade 0.28 gallons", oz: 645.12, packageCount: "0.28", packageUnit: "gallons", packageSizeOz: 2304 },
    { name: "Cranberry Juice", raw: "Cranberry Juice 0.17 gallons", oz: 391.68, packageCount: "0.17", packageUnit: "gallons", packageSizeOz: 2304 },
  ];

  const result = repairLegacyGallonRecipeIngredients(edited, source);
  assert.equal(result.repaired, true);
  assert.equal(result.ingredients[0], edited[0]);
  assert.deepEqual(
    result.ingredients.slice(1).map(({ oz, packageCount, packageSizeOz }) => ({ oz, packageCount, packageSizeOz })),
    [
      { oz: 640, packageCount: "5", packageSizeOz: 128 },
      { oz: 384, packageCount: "3", packageSizeOz: 128 },
    ],
  );
});

test("repairs Arnold Palmer half-gallon quantities without changing its yield", () => {
  const source = [
    { name: "Lemonade", raw: "4.5 Gallons Lemonade", oz: 576 },
    { name: "Sweet Tea", raw: "4.5 Gallons Sweet Tea", oz: 576 },
  ];
  const edited = source.map((ingredient) => ({
    ...ingredient,
    raw: `${ingredient.name} 0.25 gallons`,
    packageCount: "0.25",
    packageUnit: "gallons",
    packageSizeOz: 2304,
  }));

  const result = repairLegacyGallonRecipeIngredients(edited, source);
  assert.equal(result.repaired, true);
  assert.deepEqual(
    result.ingredients.map(({ oz, packageCount, packageSizeOz }) => ({ oz, packageCount, packageSizeOz })),
    [
      { oz: 576, packageCount: "4.5", packageSizeOz: 128 },
      { oz: 576, packageCount: "4.5", packageSizeOz: 128 },
    ],
  );
});
