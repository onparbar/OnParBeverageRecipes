import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUntappdSearchResults,
  isUntappdItemKind,
  normalizeUntappdItem,
  normalizeUntappdDescription,
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

test("repairs malformed escaped quotation marks in Untappd descriptions", () => {
  const item = normalizeUntappdItem({
    untappd_id: 3811,
    name: "Miller Lite",
    type: "beer",
    brewery: "Miller Brewing Company",
    description: String.raw`Consumers choose it because:\r\n\Miller Lite is the better beer choice.\" What's our proof?`,
  });

  assert.equal(
    item.description,
    'Consumers choose it because: "Miller Lite is the better beer choice." What\'s our proof?',
  );
});

test("description cleanup preserves intentional punctuation and unrelated backslashes", () => {
  const cleanPunctuation = "Brewer's “No. 1” lager — crisp & clean.";
  const pathLikeText = String.raw`Stored at C:\Batch\42 with a \u2019 marker.`;

  assert.equal(normalizeUntappdDescription(cleanPunctuation), cleanPunctuation);
  assert.equal(normalizeUntappdDescription(pathLikeText), pathLikeText);
  assert.equal(
    normalizeUntappdDescription("First line\r\nSecond line"),
    "First line Second line",
  );
});

test("description cleanup is idempotent and applies to custom and carried descriptions", () => {
  const escaped = String.raw`A carried spirit.\r\n\"Serve chilled.\"`;
  const normalized = normalizeUntappdDescription(escaped);
  assert.equal(normalized, 'A carried spirit. "Serve chilled."');
  assert.equal(normalizeUntappdDescription(normalized), normalized);

  const item = normalizeUntappdItem({
    id: 9,
    name: "House Spirit",
    type: "spirit",
    description: "Fallback description",
    custom_description: escaped,
  }, { carried: true });
  assert.equal(item.description, normalized);
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

test("recognizes Untappd catalog spirits that are encoded as beer records", () => {
  const results = buildUntappdSearchResults({
    query: "Captain Morgan Original Spiced Rum",
    kind: "liquor",
    globalItems: [{
      untappd_id: 6479245,
      name: "Original Spiced Rum",
      type: "beer",
      brewery: "Captain Morgan",
      description: "Caribbean rum with vanilla and spice.",
      style: "Spirit - Rum - Spiced",
      abv: "35.0",
      label_image_hd: "https://labels.untappd.com/6479245?size=hd",
    }],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].untappdId, 6479245);
  assert.equal(results[0].producer, "Captain Morgan");
  assert.equal(results[0].abv, 35);
  assert.equal(isUntappdItemKind(results[0], "liquor"), true);
  assert.equal(isUntappdItemKind(results[0], "beer"), false);
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

test("visually identical beers with different Untappd IDs collapse to the richer record", () => {
  const results = buildUntappdSearchResults({
    query: "Miller Lite",
    kind: "beer",
    globalItems: [
      {
        untappd_id: 3811,
        name: "Miller Lite",
        type: "beer",
        brewery: "Miller Brewing Company",
        description: "The original light lager.",
        label_image_hd: "https://example.com/miller-lite.png",
        abv: "4.2",
      },
      {
        untappd_id: 6633200,
        name: "Miller Lite",
        type: "beer",
        brewery: "Miller Brewing Company",
        abv: "4.2",
      },
    ],
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].untappdId, 3811);
  assert.equal(results[0].description, "The original light lager.");
  assert.equal(results[0].imageUrl, "https://example.com/miller-lite.png");
});

test("an ID-less duplicate merges while identical beer names from different breweries stay separate", () => {
  const results = buildUntappdSearchResults({
    query: "House Lager",
    kind: "beer",
    globalItems: [
      {
        untappd_id: 100,
        name: "House Lager",
        type: "beer",
        brewery: "Brewery One",
        description: "Crisp and clean.",
      },
      {
        name: "House Lager",
        type: "beer",
        brewery: "Brewery One",
        label_image_hd: "https://example.com/house-lager.png",
      },
      {
        untappd_id: 200,
        name: "House Lager",
        type: "beer",
        brewery: "Brewery Two",
      },
    ],
  });

  assert.equal(results.length, 2);
  const breweryOne = results.find((item) => item.producer === "Brewery One");
  assert.equal(breweryOne.untappdId, 100);
  assert.equal(breweryOne.description, "Crisp and clean.");
  assert.equal(breweryOne.imageUrl, "https://example.com/house-lager.png");
  assert.ok(results.some((item) => item.producer === "Brewery Two"));
});
