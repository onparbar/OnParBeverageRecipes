import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKegOnDeckOptions,
  isKegOnDeckProductInstalled,
  resolveKegOnDeckOption,
} from "../public/keg-on-deck-options.mjs";

const recipes = [
  { id: "whiskey-smash", title: "Whiskey Smash (Jim Beam) 1" },
  { id: "on-par-tee", title: "On Par Tee (Crown Royal) 1" },
  { id: "washington-apple", title: "Washington Apple" },
];

test("includes all static On Deck recipes when Coming Soon is empty", () => {
  assert.deepEqual(buildKegOnDeckOptions({ recipes }), [
    {
      id: "recipe:bacardi-sunset",
      recipeId: "bacardi-sunset",
      name: "Bacardi Sunset",
      kind: "recipe",
      plu: 0,
    },
    {
      id: "recipe:on-par-tee",
      recipeId: "on-par-tee",
      name: "On Par Tee (Crown Royal) 1",
      kind: "recipe",
      plu: 0,
    },
    {
      id: "recipe:whiskey-smash",
      recipeId: "whiskey-smash",
      name: "Whiskey Smash (Jim Beam) 1",
      kind: "recipe",
      plu: 0,
    },
  ]);
});

test("keeps Bacardi Sunset available without a saved recipe card", () => {
  assert.deepEqual(buildKegOnDeckOptions(), [
    {
      id: "recipe:bacardi-sunset",
      recipeId: "bacardi-sunset",
      name: "Bacardi Sunset",
      kind: "recipe",
      plu: 0,
    },
  ]);
});

test("retains active custom cocktail and beer options in alphabetic order", () => {
  const options = buildKegOnDeckOptions({
    recipes,
    comingSoonItems: [
      { id: "beer:88", name: "Zesty Lager", kind: "beer", plu: 88 },
      { id: "custom:blue-horizon", name: "Blue Horizon", kind: "recipe", batchOz: 1400 },
    ],
  });

  assert.deepEqual(options.map(({ id }) => id), [
    "recipe:bacardi-sunset",
    "custom:blue-horizon",
    "recipe:on-par-tee",
    "recipe:whiskey-smash",
    "beer:88",
  ]);
  assert.equal(resolveKegOnDeckOption(options, "beer:88")?.name, "Zesty Lager");
});

test("retains the selected archived item but excludes other archived items", () => {
  const selectedArchived = {
    id: "beer:retired",
    name: "Retired Lager",
    kind: "beer",
    plu: 77,
    replacedAt: "2026-07-20T12:00:00.000Z",
  };
  const options = buildKegOnDeckOptions({
    recipes,
    comingSoonItems: [
      selectedArchived,
      {
        id: "recipe:retired-cocktail",
        name: "Retired Cocktail",
        kind: "recipe",
        replacedAt: "2026-07-19T12:00:00.000Z",
      },
    ],
    selected: { comingSoonId: selectedArchived.id },
  });

  assert.equal(resolveKegOnDeckOption(options, selectedArchived.id)?.plu, 77);
  assert.equal(resolveKegOnDeckOption(options, "recipe:retired-cocktail"), null);
});

test("deduplicates collisions while preserving richer Coming Soon data", () => {
  const richerOnParTee = {
    id: "recipe:on-par-tee",
    recipeId: "on-par-tee",
    name: "On Par Tee — Next Batch",
    kind: "recipe",
    plu: 9123,
    batchOz: 1376,
    chargePerOz: 0.75,
  };
  const options = buildKegOnDeckOptions({
    recipes,
    comingSoonItems: [richerOnParTee],
  });

  assert.equal(options.filter(({ id }) => id === richerOnParTee.id).length, 1);
  assert.deepEqual(resolveKegOnDeckOption(options, { id: richerOnParTee.id }), richerOnParTee);
});

test("recognizes an On Deck product after it becomes the live tap product", () => {
  assert.equal(isKegOnDeckProductInstalled(
    { name: "Voodoo Ranger IPA", plu: 4123 },
    { name: "Voodoo Ranger IPA 1", plu: 4123 },
  ), true);
  assert.equal(isKegOnDeckProductInstalled(
    { name: "Voodoo Ranger Regular IPA" },
    { tapProduct: "NB VD RGR IPA 1" },
  ), true);
  assert.equal(isKegOnDeckProductInstalled(
    { name: "Voodoo Ranger IPA", plu: 4123 },
    { name: "Angry Orchard 1", plu: 9876 },
  ), false);
});
