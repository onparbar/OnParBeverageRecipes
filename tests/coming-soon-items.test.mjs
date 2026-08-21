import assert from "node:assert/strict";
import test from "node:test";

import {
  getComingSoonKindLabel,
  mergeRequiredComingSoonItems,
  REQUIRED_COMING_SOON_ITEMS,
} from "../public/coming-soon-items.mjs";

test("keeps the six requested products in Coming Soon", () => {
  assert.deepEqual(
    REQUIRED_COMING_SOON_ITEMS.map(({ name }) => name),
    [
      "Bacardi Sunset",
      "On Par Tee (Crown Royal) 1",
      "Whiskey Smash (Jim Beam) 1",
      "Triple Jam 2",
      "Woodford Reserve",
      "Captain Morgan",
    ],
  );

  const merged = mergeRequiredComingSoonItems([]);
  assert.equal(merged.length, 6);
  assert.deepEqual(merged.map(({ kind }) => kind), ["recipe", "recipe", "recipe", "beer", "liquor", "liquor"]);
  assert.equal(
    merged.find(({ id }) => id === "liquor:woodford-reserve")?.untappdQuery,
    "Woodford Reserve Bourbon",
  );
  assert.equal(
    merged.find(({ id }) => id === "liquor:captain-morgan")?.untappdQuery,
    "Captain Morgan Original Spiced Rum",
  );
});

test("preserves saved Coming Soon details without duplicating required products", () => {
  const merged = mergeRequiredComingSoonItems([
    {
      id: "recipe:on-par-tee",
      name: "On Par Tee",
      kind: "recipe",
      batchOz: 1452,
      replacedAt: "2026-08-14T18:00:00.000Z",
    },
    {
      id: "liquor:woodford-reserve",
      name: "Woodford Reserve",
      kind: "liquor",
      untappdQuery: "old broad search",
      untappdId: 6686987,
    },
    { id: "beer:99", name: "Future Lager", kind: "beer", plu: 99 },
  ]);

  assert.equal(merged.filter(({ id }) => id === "recipe:on-par-tee").length, 1);
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.name, "On Par Tee (Crown Royal) 1");
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.batchOz, 1452);
  assert.equal(merged.find(({ id }) => id === "recipe:on-par-tee")?.replacedAt, "2026-08-14T18:00:00.000Z");
  assert.equal(merged.find(({ id }) => id === "liquor:woodford-reserve")?.untappdQuery, "Woodford Reserve Bourbon");
  assert.equal(merged.find(({ id }) => id === "liquor:woodford-reserve")?.untappdId, 6686987);
  assert.equal(merged.find(({ id }) => id === "beer:99")?.plu, 99);
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
    id: "pmb-publish:liquor:woodford-reserve",
    kind: "liquor",
    name: "Woodford Reserve",
    status: "ready",
    payload: {
      name: "Woodford Reserve",
      bottleCost: 64,
      bottleOz: 59.1745,
      pricePerOz: 2.25,
      abvPercent: 45.2,
    },
  }]);
  const woodford = merged.find(({ id }) => id === "liquor:woodford-reserve");

  assert.equal(woodford?.kind, "liquor");
  assert.equal(woodford?.bottleCost, 64);
  assert.equal(woodford?.bottleOz, 59.1745);
});
