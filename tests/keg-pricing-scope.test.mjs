import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssignedOnDeckBeerItems,
  buildVerifiedCurrentBeerTapItems,
} from "../public/keg-pricing-scope.mjs";

const wallItems = [
  { tapNumber: 39, wall: "Main", type: "Stout", brand: "BREAKFAST STOUT 1" },
  { tapNumber: 42, wall: "Main", type: "IPA", brand: "BUDWEISER 1" },
  { tapNumber: 58, wall: "Main", type: "Cocktail", brand: "BOOZY CUCUMBER LEMONADE 1" },
];

function isBeerTap(item) {
  return [39, 42].includes(Number(item.tapNumber ?? item.tapPosition));
}

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
