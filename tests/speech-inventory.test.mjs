import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpeechInventoryChanges,
  parseInventoryTranscript,
  parseSpokenInventoryNumber,
} from "../public/speech-inventory.mjs";

const items = [
  { id: "guinness", name: "Guinness", target: "inventory", group: "Beer", unit: "units" },
  { id: "modelo", name: "Modelo", target: "inventory", group: "Beer", unit: "units" },
  { id: "garage-lime", name: "Garage Beer Lime", aliases: ["Garage Lime"], target: "inventory", group: "Beer", unit: "units" },
  { id: "buffalo-trace", name: "Buffalo Trace Bourbon", aliases: ["Buffalo Trace"], target: "inventory", group: "Liquor Cabinet", unit: "bottles", packSize: 12 },
  { id: "fireball", name: "Fireball Cinnamon Whisky", aliases: ["Fireball"], target: "inventory", group: "Liquor Cabinet", unit: "bottles" },
  { id: "titos", name: "Tito's Vodka", aliases: ["Titos"], target: "inventory", group: "Liquor Cabinet", unit: "bottles" },
  { id: "blue-moon", name: "Blue Moon", target: "inventory", group: "Beer", unit: "units" },
  { id: "keg-main-michelob", name: "Michelob ULTRA", aliases: ["Michelob", "Main wall Michelob"], target: "keg", wall: "Main", group: "Main tap 21", unit: "kegs" },
  { id: "keg-main-garage", name: "Garage Beer", target: "keg", wall: "Main", group: "Main tap 22", unit: "kegs" },
  { id: "keg-karaoke-garage", name: "Garage Beer", target: "keg", wall: "Karaoke", group: "Karaoke tap 72", unit: "kegs" },
];

test("parses natural and decimal inventory numbers", () => {
  assert.equal(parseSpokenInventoryNumber("twenty-four"), 24);
  assert.equal(parseSpokenInventoryNumber("point five"), 0.5);
  assert.equal(parseSpokenInventoryNumber("no"), 0);
});

test("parses several products from one unpunctuated transcript", () => {
  const result = parseInventoryTranscript("Guinness one Modelo two Garage Lime three", items);
  assert.deepEqual(result.proposals.map((entry) => [entry.matchedId, entry.quantity]), [
    ["guinness", 1], ["modelo", 2], ["garage-lime", 3],
  ]);
});

test("parses a natural quantity-first cooler walk with voice variants and a current-count increment", () => {
  const main = (id, name, currentValue = "0") => ({ id, name, target: "keg", wall: "Main", group: `Main ${id}`, unit: "kegs", currentValue });
  const karaoke = (id, name) => ({ id, name, target: "keg", wall: "Karaoke", group: `Karaoke ${id}`, unit: "kegs", currentValue: "0" });
  const coolerItems = [
    main("michelob", "MICHELOB ULTRA 1"),
    main("miller", "MILLER LITE 1"), karaoke("miller-2", "MILLER LITE 2"),
    main("busch", "BUSCH LIGHT 1"), main("coors", "COORS LIGHT 1"), main("pbr", "PABST BLUE RIBBON 1"),
    main("bud", "BUD LIGHT 1"), main("cincy", "CINCY LIGHT 1"), karaoke("cincy-2", "CINCY LIGHT 2"),
    main("kona", "KONA BIG WAVE 1"), main("garage-lime", "GARAGE BEER LIME 1"), karaoke("garage-lime-2", "GARAGE BEER LIME 2"),
    main("garage", "GARAGE BEER 1"), main("blue-moon", "BLUE MOON 1"), main("corona", "CORONA 1"),
    main("voodoo-juicy", "VOODOO RANGER JUICY HAZE 1"), main("dortmunder", "DORTMUNDER GOLD LAGER 1"),
    main("guinness", "GUINNESS DRAUGHT 1"), main("modelo", "MODELO 1"), karaoke("modelo-2", "MODELO 2"),
    main("two-hearted", "TWO HEARTED IPA 1"), main("angry-orchard", "ANGRY ORCHARD 1"),
    main("triple-jam", "TRIPLE JAM CIDER 1"), main("astra", "ASTRA RED CREAM SODA 1"), karaoke("astra-2", "ASTRA RED CREAM SODA 2"),
    main("truly", "TRULY WILD BERRY 1"), main("truth", "TRUTH 1", "1"),
  ];
  const transcript = "okay I have three Mich Ultra 3 Miller Lite two Busch Light one, Coors, one PBR One Bud Light, one Scentsy light, one Kona one garage beer lime one regular garage beer, one blue moon one Corona One Voodoo juicy Haze one dortmundder, two Guinness, one Modelo, One Two Hearted IPA, two Angry Orchard, two triple Jam, one Astra, one truly and I need to add another truth";
  const result = parseInventoryTranscript(transcript, coolerItems);

  assert.deepEqual(result.proposals.map((entry) => [entry.matchedId, entry.quantity]), [
    ["michelob", 3], ["miller", 3], ["busch", 2], ["coors", 1], ["pbr", 1], ["bud", 1],
    ["cincy", 1], ["kona", 1], ["garage-lime", 1], ["garage", 1], ["blue-moon", 1], ["corona", 1],
    ["voodoo-juicy", 1], ["dortmunder", 1], ["guinness", 2], ["modelo", 1], ["two-hearted", 1],
    ["angry-orchard", 2], ["triple-jam", 2], ["astra", 1], ["truly", 1], ["truth", 2],
  ]);
  assert.equal(result.proposals.every((entry) => entry.status === "matched"), true);
});

test("matches naturally spoken cocktail names without PMB spirit suffixes", () => {
  const cocktail = (id, name, aliases = []) => ({
    id,
    name,
    aliases,
    target: "keg",
    wall: "Main",
    group: `Main ${id}`,
    unit: "kegs",
    currentValue: "0",
  });
  const cocktailItems = [
    cocktail("garage", "GARAGE BEER 1"),
    cocktail("espresso", "ESPRESSO MARTINI (TITO'S) 1", ["Espresso Martini"]),
    cocktail("jacked-up", "JACKED UP STRAWBERRY LEMONADE (JACK DANIELS) 1", ["Jacked Up Strawberry Lemonade"]),
    cocktail("whiskey-smash", "WHISKEY SMASH (JIM BEAM) 1", ["Whiskey Smash"]),
    cocktail("blueberry", "BLUEBERRY MARGARITA (JOSE CUERVO) 1", ["Blueberry Margarita"]),
    cocktail("whiskey-sour", "WHISKEY SOUR (JACK DANIELS) 1", ["Whiskey Sour"]),
    cocktail("washington-apple", "WASHINGTON APPLE (CROWN APPLE) 1", ["Washington Apple"]),
    cocktail("bacardi-sunset", "BACARDI SUNSET 1", ["Bacardi Sunset"]),
    cocktail("senorita", "STRAWBERRY SENORITA (JOSE CUERVO) 1", ["Strawberry Senorita"]),
    cocktail("spiked-strawberry", "SPIKED STRAWBERRY LEMONADE (TITO'S) 1", ["Spiked Strawberry Lemonade"]),
  ];
  const transcript = "one garage rear regular, one espresso Martini one jacked up strawberry lemonade One Whiskey smash one blueberry margarita One Whiskey Sour one Washington Apple Schnapps One Bacardi Sunset one strawberry senorita and one spiked strawberry lemonade";
  const result = parseInventoryTranscript(transcript, cocktailItems);

  assert.deepEqual(result.proposals.map((entry) => [entry.matchedId, entry.quantity]), [
    ["garage", 1], ["espresso", 1], ["jacked-up", 1], ["whiskey-smash", 1], ["blueberry", 1],
    ["whiskey-sour", 1], ["washington-apple", 1], ["bacardi-sunset", 1], ["senorita", 1], ["spiked-strawberry", 1],
  ]);
  assert.equal(result.proposals.every((entry) => entry.status === "matched"), true);
});

test("supports bottles, cases, zero, walls, corrections, and skips", () => {
  const bottles = parseInventoryTranscript("Buffalo Trace twelve bottles", items).proposals[0];
  const cases = parseInventoryTranscript("Buffalo Trace two cases", items).proposals[0];
  const zero = parseInventoryTranscript("I have no Blue Moon", items).proposals[0];
  const wall = parseInventoryTranscript("Main wall Michelob is point five", items).proposals[0];
  const corrected = parseInventoryTranscript("Titos twenty, actually make that twenty four", items).proposals[0];
  const skipped = parseInventoryTranscript("Skip Modelo for now", items).proposals[0];
  assert.equal(bottles.quantity, 12);
  assert.equal(cases.quantity, 24);
  assert.equal(zero.quantity, 0);
  assert.equal(wall.matchedId, "keg-main-michelob");
  assert.equal(wall.quantity, 0.5);
  assert.equal(corrected.quantity, 24);
  assert.equal(corrected.corrected, true);
  assert.equal(skipped.status, "skipped");
});

test("keeps ambiguous and unknown products from becoming changes", () => {
  const ambiguous = parseInventoryTranscript("Garage Beer one keg", items).proposals[0];
  const unknown = parseInventoryTranscript("Mystery Lager two", items).proposals[0];
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(unknown.status, "unmatched");
  assert.deepEqual(buildSpeechInventoryChanges([ambiguous, unknown]), []);
});

test("later duplicate mentions replace rather than duplicate a field update", () => {
  const result = parseInventoryTranscript("Fireball three, change Fireball to five", items);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.proposals[0].quantity, 5);
  assert.deepEqual(buildSpeechInventoryChanges(result.proposals), [
    { id: "fireball", target: "inventory", value: "5" },
  ]);
});
