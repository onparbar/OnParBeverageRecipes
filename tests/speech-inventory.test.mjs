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

