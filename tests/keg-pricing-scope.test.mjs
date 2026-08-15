import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActiveComingSoonBeerItems,
  buildAssignedOnDeckBeerItems,
  buildVerifiedCurrentBeerTapItems,
  filterCurrentTapPricingItems,
} from "../public/keg-pricing-scope.mjs";

const wallItems = [
  { tapNumber: 39, wall: "Main", type: "Stout", brand: "BREAKFAST STOUT 1" },
  { tapNumber: 42, wall: "Main", type: "IPA", brand: "BUDWEISER 1" },
  { tapNumber: 58, wall: "Main", type: "Cocktail", brand: "BOOZY CUCUMBER LEMONADE 1" },
];

function isBeerTap(item) {
  return [39, 42].includes(Number(item.tapNumber ?? item.tapPosition));
}

test("Tap Pricing keeps only products verified on current physical wall taps", () => {
  const result = filterCurrentTapPricingItems([
    { tapPosition: null, name: "Archived Lager", isCurrentTap: false, tapMatchSource: "" },
    { tapPosition: 39, name: "Old Template Stout", isCurrentTap: false, tapMatchSource: "template-fallback" },
    { tapPosition: 42, name: "Voodoo Ranger IPA", isCurrentTap: true, tapMatchSource: "pmb-tap-config" },
    { tapPosition: 21, name: "Michelob Ultra", isCurrentTap: true, tapMatchSource: "pmb-tap-config" },
    { tapPosition: 0, name: "Coming Soon", isCurrentTap: true, tapMatchSource: "pmb-tap-config" },
  ]);

  assert.deepEqual(result.map(({ tapPosition, name }) => ({ tapPosition, name })), [
    { tapPosition: 21, name: "Michelob Ultra" },
    { tapPosition: 42, name: "Voodoo Ranger IPA" },
  ]);
});

test("uses verified physical PMB products instead of old template products", () => {
  const result = buildVerifiedCurrentBeerTapItems({
    wallItems,
    liveLevelItems: [
      { tapNumber: 39, name: "Guinness Draught 1", plu: 39001 },
      { tapNumber: 42, name: "Voodoo Ranger IPA 1", plu: 42001 },
    ],
    tapPriceItems: [
      { tapPosition: 39, name: "Breakfast Stout 1", isCurrentTap: false },
    ],
    isBeerTapPosition: isBeerTap,
  });

  assert.deepEqual(result.map(({ tapPosition, name, wall }) => ({ tapPosition, name, wall })), [
    { tapPosition: 39, name: "Guinness Draught 1", wall: "Main" },
    { tapPosition: 42, name: "Voodoo Ranger IPA 1", wall: "Main" },
  ]);
  assert.equal(result.some((item) => /breakfast stout/i.test(item.name)), false);
});

test("keeps saved active wall products when live keg levels are only partial", () => {
  const result = buildVerifiedCurrentBeerTapItems({
    wallItems,
    weeklyUsageItems: [
      { tapNumber: 39, name: "Guinness Draught 1", plu: 39001 },
      { tapNumber: 42, name: "Voodoo Ranger IPA 1", plu: 42001 },
    ],
    liveLevelItems: [
      { tapNumber: 42, name: "Voodoo Ranger IPA 1", plu: 42001 },
    ],
    tapPriceItems: [],
    isBeerTapPosition: isBeerTap,
  });

  assert.deepEqual(result.map(({ tapPosition, name, tapMatchSource }) => ({ tapPosition, name, tapMatchSource })), [
    { tapPosition: 39, name: "Guinness Draught 1", tapMatchSource: "saved-weekly-usage" },
    { tapPosition: 42, name: "Voodoo Ranger IPA 1", tapMatchSource: "pmb-keg-levels" },
  ]);
});

test("accepts only tap-pricing rows verified by PMB tap configuration", () => {
  const result = buildVerifiedCurrentBeerTapItems({
    wallItems,
    liveLevelItems: [],
    tapPriceItems: [
      { tapPosition: 39, wall: "Main", name: "Breakfast Stout 1", isCurrentTap: false },
      { tapPosition: 42, wall: "Main", name: "Voodoo Ranger IPA 1", isCurrentTap: true },
    ],
    isBeerTapPosition: isBeerTap,
  });

  assert.deepEqual(result.map((item) => item.name), ["Voodoo Ranger IPA 1"]);
});

test("adds assigned On Deck beers but excludes cocktail choices", () => {
  const result = buildAssignedOnDeckBeerItems({
    wallItems,
    isBeerTapPosition: isBeerTap,
    resolveOnDeck: (item) => {
      if (item.tapNumber === 39) return { id: "beer:guinness", name: "Guinness", kind: "beer", plu: 39001 };
      if (item.tapNumber === 42) return { id: "recipe:on-par-tee", name: "On Par Tee", kind: "recipe" };
      return null;
    },
  });

  assert.deepEqual(result, [{
    id: "beer:guinness",
    name: "Guinness",
    kind: "beer",
    plu: 39001,
    tapNumber: 39,
    wall: "Main",
    type: "Beer",
    sourceTapLabel: "On Deck for Main 39",
    isOnDeckProduct: true,
  }]);
});

test("keeps only active beer products from Coming Soon", () => {
  const result = buildActiveComingSoonBeerItems({
    comingSoonItems: [
      { id: "beer:future-lager", name: "Future Lager", kind: "beer", kegOz: 1984 },
      { id: "beer:old-ipa", name: "Old IPA", kind: "beer", replacedAt: "2026-08-01T12:00:00.000Z" },
      { id: "recipe:on-par-tee", name: "On Par Tee", kind: "recipe" },
      { id: "liquor:woodford", name: "Woodford Reserve", kind: "liquor" },
    ],
  });

  assert.deepEqual(result, [{
    id: "beer:future-lager",
    name: "Future Lager",
    kind: "beer",
    kegOz: 1984,
    tapNumber: 0,
    wall: "Coming Soon",
    type: "Beer",
    sourceTapLabel: "Coming Soon",
    isComingSoonProduct: true,
  }]);
});
