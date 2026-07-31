import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUntappdSearchResults,
  isUntappdItemKind,
  normalizeUntappdItem,
} from "../lib/untappd-search.mjs";

test("normalizes Untappd beer metadata for the Add Beer form", () => {
  const item = normalizeUntappdItem({
    untappd_id: 2799860,
    name: "Garage Beer",
    type: "beer",
    brewery: "Garage Beer Co.",
    description: "A crisp light lager.",
    style: "Lager - American Light",
    abv: "4.0",
    ibu: "5.0",
    label_image_hd: "https://beer.untappd.com/labels/2799860?size=hd",
  });

  assert.equal(item.name, "Garage Beer");
  assert.equal(item.producer, "Garage Beer Co.");
  assert.equal(item.abv, 4);
  assert.equal(item.ibu, 5);
  assert.equal(item.imageUrl, "https://beer.untappd.com/labels/2799860?size=hd");
  assert.equal(isUntappdItemKind(item, "beer"), true);
  assert.equal(isUntappdItemKind(item, "liquor"), false);
});

test("normalizes carried Untappd spirits for the Add Liquor form", () => {
  const item = normalizeUntappdItem({
    id: 42,
    name: "Tito's Handmade Vodka",
    type: "spirit",
    producer: "Tito's Handmade Vodka",
    category: "Vodka",
    abv: "40.0",
  }, {
    carried: true,
    menuName: "Shot Wall",
    sectionName: "Patio On Tap",
  });

  assert.equal(item.carried, true);
  assert.equal(item.menuName, "Shot Wall");
  assert.equal(item.style, "Vodka");
  assert.equal(item.abv, 40);
  assert.equal(isUntappdItemKind(item, "liquor"), true);
});

test("liquor search excludes misleading beer-database matches", () => {
  const results = buildUntappdSearchResults({
    query: "Titos",
    kind: "liquor",
    globalItems: [{
      untappd_id: 6529879,
      name: "Tito's Handmade Vodka",
      type: "beer",
      brewery: "Tito's Vodka",
    }],
    catalogItems: [{
      id: 91,
      name: "Tito's Handmade Vodka",
      type: "spirit",
      producer: "Tito's Handmade Vodka",
      abv: "40.0",
    }],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].type, "spirit");
  assert.equal(results[0].name, "Tito's Handmade Vodka");
});

test("carried records rank ahead of global beer matches and duplicate menu copies merge", () => {
  const results = buildUntappdSearchResults({
    query: "Garage Beer",
    kind: "beer",
    catalogItems: [
      normalizeUntappdItem({
        id: 1,
        untappd_id: 2799860,
        name: "Garage Beer",
        type: "beer",
        brewery: "Garage Beer Co.",
      }, { carried: true, menuName: "Main" }),
      normalizeUntappdItem({
        id: 2,
        untappd_id: 2799860,
        name: "Garage Beer",
        type: "beer",
        brewery: "Garage Beer Co.",
      }, { carried: true, menuName: "Karaoke" }),
    ],
    globalItems: [
      {
        untappd_id: 2799860,
        name: "Garage Beer",
        type: "beer",
        brewery: "Garage Beer Co.",
      },
      {
        untappd_id: 1895163,
        name: "SOUP",
        type: "beer",
        brewery: "Garage Beer Co.",
      },
    ],
  });

  assert.equal(results[0].name, "Garage Beer");
  assert.equal(results[0].carried, true);
  assert.match(results[0].menuName, /Main/);
  assert.match(results[0].menuName, /Karaoke/);
  assert.equal(results.filter((item) => item.untappdId === 2799860).length, 1);
});
