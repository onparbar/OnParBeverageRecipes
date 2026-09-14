import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKegOnDeckOptions,
  isKegOnDeckProductInstalled,
  normalizeKegOnDeckOverrides,
  resolveKegOnDeckOption,
} from "../public/keg-on-deck-options.mjs";

const recipes = [
  { id: "whiskey-smash", title: "Whiskey Smash (Jim Beam) 1" },
  { id: "on-par-tee", title: "On Par Tee (Crown Royal) 1" },
  { id: "washington-apple", title: "Washington Apple" },
];

test("does not invent On Deck options when the shared Coming Soon queue is empty", () => {
  assert.deepEqual(buildKegOnDeckOptions({ recipes }), []);
});

test("keeps an already-selected legacy Bacardi Sunset without a saved recipe card", () => {
  assert.deepEqual(buildKegOnDeckOptions({ selected: { comingSoonId: "recipe:bacardi-sunset" } }), [
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
    "custom:blue-horizon",
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

test("offers an active Octoberfest Coming Soon beer for On Deck selection", () => {
  const options = buildKegOnDeckOptions({
    comingSoonItems: [{ id: "beer:octoberfest", name: "Octoberfest", kind: "beer", kegCost: 185 }],
  });

  assert.equal(resolveKegOnDeckOption(options, "beer:octoberfest")?.name, "Octoberfest");
});

test("a different wall copy or reused PLU never clears the queued product", () => {
  assert.equal(isKegOnDeckProductInstalled({ name: "Vodka Cran 2", plu: 100 }, { name: "Vodka Cran 1", plu: 100 }), false);
  assert.equal(isKegOnDeckProductInstalled({ name: "Vodka Cran 2", plu: 100 }, { name: "Vodka Cran 2", plu: 101 }), false);
  assert.equal(isKegOnDeckProductInstalled({ name: "Vodka Cran 2", plu: 100 }, { name: "Different Cocktail 2", plu: 100 }), false);
  assert.equal(isKegOnDeckProductInstalled({ name: "Vodka Cran 2", plu: 100 }, { name: "Vodka Cran 2", plu: 100 }), true);
});

test("offers an active queued liquor tap for On Deck selection", () => {
  const options = buildKegOnDeckOptions({
    comingSoonItems: [{ id: "liquor:woodford-reserve", name: "Woodford Reserve", kind: "liquor" }],
  });

  assert.equal(resolveKegOnDeckOption(options, "liquor:woodford-reserve")?.name, "Woodford Reserve");
});

test("upgrades an older saved Triple Jam clone name to the required Cider name", () => {
  const normalized = normalizeKegOnDeckOverrides({
    overrides: {
      "karaoke-79": {
        comingSoonId: "beer:triple-jam-2",
        name: "Triple Jam 2",
        kind: "beer",
        onHand: "1",
      },
    },
    comingSoonItems: [{
      id: "beer:triple-jam-2",
      name: "Triple Jam Cider 2",
      kind: "beer",
    }],
  });

  assert.equal(normalized["karaoke-79"].name, "Triple Jam Cider 2");
  assert.equal(normalized["karaoke-79"].onHand, "1");
});
