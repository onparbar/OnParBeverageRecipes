import assert from "node:assert/strict";
import test from "node:test";

import {
  getActiveComingSoonItems,
  getComingSoonKindLabel,
  mergeRequiredComingSoonItems,
  REQUIRED_COMING_SOON_ITEMS,
} from "../public/coming-soon-items.mjs";

test("shows only unresolved products in the Coming Soon section", () => {
  const active = getActiveComingSoonItems([
    { id: "beer:waiting", name: "Waiting Lager" },
    { id: "recipe:completed", name: "Completed Cocktail", replacedAt: "2026-08-30T12:00:00.000Z" },
    null,
  ]);

  assert.deepEqual(active, [{ id: "beer:waiting", name: "Waiting Lager" }]);
});

test("keeps the required products in Coming Soon", () => {
  assert.deepEqual(
    REQUIRED_COMING_SOON_ITEMS.map(({ name }) => name),
    [
      "Bacardi Sunset",
      "On Par Tee (Crown Royal) 1",
      "Whiskey Smash (Jim Beam) 1",
      "Triple Jam Cider 2",
      "Vodka Cran (Tito's) 2",
    ],
  );

  const merged = mergeRequiredComingSoonItems([]);
  assert.equal(merged.length, 5);
  assert.deepEqual(merged.map(({ kind }) => kind), ["recipe", "recipe", "recipe", "beer", "recipe"]);
  assert.deepEqual(
    merged.find(({ id }) => id === "recipe:vodka-cran-2"),
    {
      id: "recipe:vodka-cran-2",
      kind: "recipe",
      recipeId: "vodka-cran-tito-s",
      name: "Vodka Cran (Tito's) 2",
      cloneSourceName: "VODKA CRAN (TITO'S) 1",
      imageUrl: "/images/products/vodka-cran-2.png",
    },
  );
  assert.equal(merged.some(({ id }) => id === "liquor:don-julio-blanco-2"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:woodford-reserve"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:captain-morgan"), false);
});

test("preserves saved Coming Soon details while removing retired products", () => {
  const merged = mergeRequiredComingSoonItems([
    {
      id: "recipe:on-par-tee",
      name: "On Par Tee",
      kind: "recipe",
      batchOz: 1452,
      imageUrl: "https://old.example/on-par-tee.png",
      replacedAt: "2026-08-14T18:00:00.000Z",
    },
    {
      id: "liquor:woodford-reserve",
      name: "Woodford Reserve",
      kind: "liquor",
      imageUrl: "https://labels.untappd.com/old-woodford",
      untappdQuery: "old broad search",
      untappdId: 6686987,
    },
    { id: "liquor:captain-morgan", name: "Captain Morgan", kind: "liquor" },
    { id: "liquor:don-julio-blanco-2", name: "Don Julio Blanco 2", kind: "liquor" },
    { id: "beer:99", name: "Future Lager", kind: "beer", plu: 99 },
  ]);

  assert.equal(merged.filter(({ id }) => id === "recipe:on-par-tee").length, 1);
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.name, "On Par Tee (Crown Royal) 1");
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.batchOz, 1452);
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.replacedAt, "2026-08-14T18:00:00.000Z");
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.imageUrl, "/images/products/on-par-tee-classic.png");
  assert.equal(merged.find(({ id }) => id === "recipe:whiskey-smash")?.imageUrl, "/images/products/whiskey-smash-classic.png");
  assert.equal(merged.some(({ id }) => id === "liquor:woodford-reserve"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:captain-morgan"), false);
  assert.equal(merged.some(({ id }) => id === "liquor:don-julio-blanco-2"), false);
  assert.equal(merged.find(({ id }) => id === "beer:99")?.plu, 99);
});

test("removes the mistaken legacy Vodka Cran card in favor of the canonical clone", () => {
  const merged = mergeRequiredComingSoonItems([
    {
      id: "recipe:vodka-cran-tito-s",
      recipeId: "vodka-cran-tito-s",
      name: "VODKA CRAN (TITO'S)",
      kind: "recipe",
      chargePerOz: 2.09,
    },
    {
      id: "recipe:vodka-cran-2",
      recipeId: "vodka-cran-tito-s",
      name: "Vodka Cran (Tito's) 2",
      kind: "recipe",
    },
  ]);

  assert.equal(merged.some(({ id }) => id === "recipe:vodka-cran-tito-s"), false);
  assert.equal(merged.filter(({ id }) => id === "recipe:vodka-cran-2").length, 1);
  assert.equal(merged.find(({ id }) => id === "recipe:vodka-cran-2")?.cloneSourceName, "VODKA CRAN (TITO'S) 1");
  assert.equal(merged.find(({ id }) => id === "beer:triple-jam-2")?.imageUrl, "/images/products/triple-jam-cider-2.png");
  assert.equal(merged.find(({ id }) => id === "recipe:vodka-cran-2")?.imageUrl, "/images/products/vodka-cran-2.png");
});

test("labels beer, liquor, and cocktail Coming Soon items correctly", () => {
  assert.equal(getComingSoonKindLabel("beer"), "Beer keg");
  assert.equal(getComingSoonKindLabel("liquor"), "Liquor tap");
  assert.equal(getComingSoonKindLabel("recipe"), "Cocktail recipe");
  assert.equal(getComingSoonKindLabel("liquor", { compact: true }), "liquor");
});

test("includes an unpublished queued beer in Coming Soon immediately", () => {
  const merged = mergeRequiredComingSoonItems([], [{
    id: "pmb-publish:beer:octoberfest",
    kind: "beer",
    name: "Octoberfest",
    status: "ready",
    updatedAt: "2026-08-15T05:32:00.000Z",
    payload: {
      name: "Octoberfest",
      kegCost: 185,
      kegOz: 1984,
      pricePerOz: 0.52,
      abvPercent: 5.3,
    },
  }]);
  const octoberfest = merged.find(({ id }) => id === "beer:octoberfest");

  assert.equal(octoberfest?.kind, "beer");
  assert.equal(octoberfest?.name, "Octoberfest");
  assert.equal(octoberfest?.kegCost, 185);
  assert.equal(octoberfest?.source, "PMB publishing queue");
});

test("includes an unpublished queued liquor tap in Coming Soon immediately", () => {
  const merged = mergeRequiredComingSoonItems([], [{
    id: "pmb-publish:liquor:future-rye",
    kind: "liquor",
    name: "Future Rye",
    status: "ready",
    payload: {
      name: "Future Rye",
      bottleCost: 64,
      bottleOz: 59.1745,
      pricePerOz: 2.25,
      abvPercent: 45.2,
    },
  }]);
  const futureRye = merged.find(({ id }) => id === "liquor:future-rye");

  assert.equal(futureRye?.kind, "liquor");
  assert.equal(futureRye?.bottleCost, 64);
  assert.equal(futureRye?.bottleOz, 59.1745);
});
