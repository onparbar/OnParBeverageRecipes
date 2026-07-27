import assert from "node:assert/strict";
import test from "node:test";

import {
  getRecipeBuilderPackageQuantity,
  getRecipeBuilderPackageSizeOz,
  getRecipeBuilderPackageUnitHint,
  repairKnownRecipeFormulaEdits,
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

test("preserves written whole-bottle and gallon quantities despite rounded ounces", () => {
  assert.equal(getRecipeBuilderPackageQuantity({
    raw: "Peach Schnapps= 8 bottles",
    oz: 270,
    packageSizeOz: 33.81,
    packageUnit: "bottles",
  }), "8");
  assert.equal(getRecipeBuilderPackageQuantity({
    raw: "Water= 1.5 gallons",
    oz: 192,
    packageSizeOz: 128,
    packageUnit: "gallons",
  }), "1.5");
  assert.equal(getRecipeBuilderPackageQuantity({
    packageCount: "2",
    raw: "Sour Mix",
    oz: 256,
    packageSizeOz: 128,
    packageUnit: "gallons",
  }), "2");
});

test("preserves each ingredient's explicitly written package unit", () => {
  assert.equal(getRecipeBuilderPackageUnitHint({
    raw: "Sour Mix= 2 gallons",
  }), "gallons");
  assert.equal(getRecipeBuilderPackageUnitHint({
    raw: "Sour mix= 2 bottles (128oz)",
  }), "bottles");
  assert.equal(getRecipeBuilderPackageUnitHint({
    raw: "Simple Syrup= 384oz",
  }), "ounces");
  assert.equal(getRecipeBuilderPackageUnitHint({
    raw: "Blue Dot Juice (1 gallon of water and 6 packets)",
    oz: 0,
  }), "ounces");
  assert.equal(getRecipeBuilderPackageUnitHint({
    raw: "Water= 1.5 gallons",
    packageUnit: "bottles",
  }), "bottles");
});

test("repairs only the known saved Whiskey Smash formula signatures", () => {
  const source = [
    { name: "Jim Beam", raw: "Jim Beam = 7 bottles (1.75L)", cost: 230, oz: 414 },
    { name: "Lemonade", raw: "Lemonade = 2.5 gallons", cost: 7.23, oz: 320 },
    { name: "Water", raw: "Water= 4.5 gallons", cost: 0, oz: 576 },
  ];
  const edited = [
    { name: "Jim Beam", raw: "Jim Beam 7 bottles", cost: 230, oz: 414 },
    { name: "Lemonade", raw: "Lemonade 2.11 gallons", cost: 7.23, oz: 270.08, packageCount: "2.11" },
    { name: "Water", raw: "Water", cost: 0, oz: 256 },
  ];

  const result = repairKnownRecipeFormulaEdits("whiskey-smash", edited, source);
  assert.equal(result.repaired, true);
  assert.equal(result.ingredients[0], edited[0]);
  assert.deepEqual(
    result.ingredients.slice(1).map(({ raw, oz, packageCount, packageUnit, packageSizeOz }) => ({
      raw,
      oz,
      packageCount,
      packageUnit,
      packageSizeOz,
    })),
    [
      {
        raw: "Lemonade = 2.5 gallons",
        oz: 320,
        packageCount: "2.5",
        packageUnit: "gallons",
        packageSizeOz: 128,
      },
      {
        raw: "Water= 4.5 gallons",
        oz: 576,
        packageCount: "4.5",
        packageUnit: "gallons",
        packageSizeOz: 128,
      },
    ],
  );
});

test("repairs the known saved On Par Tee formula while preserving a manual cost", () => {
  const source = [
    { name: "Crown Royal", raw: "Crown Royal= 7 bottles (1.75L)", cost: 414, oz: 414 },
    { name: "Peach Schnapps", raw: "Peach Schnapps= 8 bottles", cost: 96.25, oz: 270 },
    { name: "Sour Mix", raw: "Sour Mix= 2 gallons", cost: 15.36, oz: 256 },
    { name: "Lemonade", raw: "Lemonade= 2 gallons", cost: 5.78, oz: 256 },
    { name: "Water", raw: "Water= 1.5 gallons", cost: 0, oz: 192 },
  ];
  const edited = [
    { name: "Crown Royal", raw: "Crown Royal 7 bottles", cost: 414, oz: 414 },
    { name: "Peach Schnapps", raw: "Peach Schnapps 7.99 bottles", cost: 96.25, oz: 270.14 },
    { name: "Sour Mix", raw: "Sour Mix 1 bottle", cost: 21, manualCost: true, oz: 128 },
    { name: "Lemonade", raw: "Lemonade 3 gallons", cost: 8.67, oz: 384 },
    { name: "Water", raw: "Water", cost: 0, oz: 320 },
  ];

  const result = repairKnownRecipeFormulaEdits("on-par-tee", edited, source);
  assert.equal(result.repaired, true);
  assert.equal(result.ingredients[0], edited[0]);
  assert.deepEqual(
    result.ingredients.slice(1).map(({ raw, cost, oz, packageCount, packageUnit }) => ({
      raw,
      cost,
      oz,
      packageCount,
      packageUnit,
    })),
    [
      { raw: "Peach Schnapps= 8 bottles", cost: 96.25, oz: 270, packageCount: "8", packageUnit: "bottles" },
      { raw: "Sour Mix= 2 gallons", cost: 21, oz: 256, packageCount: "2", packageUnit: "gallons" },
      { raw: "Lemonade= 2 gallons", cost: 5.78, oz: 256, packageCount: "2", packageUnit: "gallons" },
      { raw: "Water= 1.5 gallons", cost: 0, oz: 192, packageCount: "1.5", packageUnit: "gallons" },
    ],
  );
});

test("does not overwrite intentional formula edits or unrelated recipes", () => {
  const source = [{ name: "Water", raw: "Water= 1.5 gallons", cost: 0, oz: 192 }];
  const intentional = [{ name: "Water", raw: "Water 2 gallons", cost: 0, oz: 256 }];

  assert.deepEqual(
    repairKnownRecipeFormulaEdits("on-par-tee", intentional, source),
    { ingredients: intentional, repaired: false },
  );
  assert.deepEqual(
    repairKnownRecipeFormulaEdits("custom-on-par-tee", intentional, source),
    { ingredients: intentional, repaired: false },
  );
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
