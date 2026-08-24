import test from "node:test";
import assert from "node:assert/strict";

import { parseInventoryTranscript } from "../public/speech-inventory.mjs";

function item(id, name, group = "Liquor Cabinet") {
  return {
    id,
    name,
    target: "inventory",
    group,
    unit: "units",
    packSize: 1,
    currentValue: "",
  };
}

test("separates and matches the complete real cabinet voice count", () => {
  const parsed = parseInventoryTranscript(
    "okay I have two bullet five Crown nine Svedka 60 Jose 14 Tito's 12 Ketel One 14 absolute Citron 4 Crown Apple three Bombay Sapphire 14 Jack Daniels One Gym Beam for Bacardi two Makers Mark, I have eight bitters 19 lemon juice 10 raspberry 32 pomegranate eight strawberry 31 Triple Sec 12 Peach 16 blueberry 28 lime 12 watermelon 17 Apple 12 cream to cacao four cold brew 13 sweet and sour and 16 bottles of Corbell Brew",
    [
      item("bulleit", "Bulleit Bourbon"),
      item("crown", "Crown Royal"),
      item("svedka", "Svedka Blue Raspberry Vodka"),
      item("jose", "Jose Cuervo Silver"),
      item("titos", "Tito's"),
      item("ketel", "Ketel One Cucumber Vodka"),
      item("citron", "Absolut Citron"),
      item("crown-apple", "Crown Apple"),
      item("bombay", "Bombay Sapphire"),
      item("jack", "Jack Daniel's"),
      item("jim", "Jim Beam"),
      item("bacardi", "Bacardi"),
      item("makers", "Makers Mark"),
      item("bitters", "Bitters", "Mixer Cabinet"),
      item("lemon", "Lemon Juice", "Mixer Cabinet"),
      item("raspberry", "Raspberry Schnapps", "Mixer Cabinet"),
      item("pomegranate", "Pomegranate Schnapps", "Mixer Cabinet"),
      item("strawberry", "Strawberry Schnapps", "Mixer Cabinet"),
      item("triple-sec", "Triple Sec", "Mixer Cabinet"),
      item("peach", "Peach Schnapps", "Mixer Cabinet"),
      item("blueberry", "Blueberry Schnapps", "Mixer Cabinet"),
      item("lime", "Lime Juice", "Mixer Cabinet"),
      item("watermelon", "Watermelon Schnapps", "Mixer Cabinet"),
      item("apple", "Apple Schnapps", "Mixer Cabinet"),
      item("cacao", "Creme De Cacao", "Mixer Cabinet"),
      item("cold-brew", "Cold Brew", "Mixer Cabinet"),
      item("sour-mix", "Sour Mix", "Mixer Cabinet"),
      item("korbel", "Korbel Brut", "Other"),
    ],
  );

  assert.deepEqual(
    parsed.proposals.map(({ status, matchedId, quantity }) => ({ status, matchedId, quantity })),
    [
      ["bulleit", 2], ["crown", 5], ["svedka", 9], ["jose", 60], ["titos", 14],
      ["ketel", 12], ["citron", 14], ["crown-apple", 4], ["bombay", 3], ["jack", 14],
      ["jim", 1], ["bacardi", 4], ["makers", 2], ["bitters", 8], ["lemon", 19],
      ["raspberry", 10], ["pomegranate", 32], ["strawberry", 8], ["triple-sec", 31], ["peach", 12],
      ["blueberry", 16], ["lime", 28], ["watermelon", 12], ["apple", 17], ["cacao", 12],
      ["cold-brew", 4], ["sour-mix", 13], ["korbel", 16],
    ].map(([matchedId, quantity]) => ({ status: "matched", matchedId, quantity })),
  );
});

test("separates Bacardi and Makers Mark and removes repeated Schnapps from the live transcript", () => {
  const parsed = parseInventoryTranscript(
    "okay, I have 14 bullet five Crown Royal nine Svedka 60 Jose, 14 Tito's 12 Ketel One 14 absolute Citron four Crown Apple Schnapps Schnapps Schnapps, three Bombay Sapphire, 14 Jack Daniels one Jim Beam, for Bacardi, to Maker's Mark, 8 bitters 19 lemon 10 raspberry 32 pomegranate 8 strawberry 31 Triple Sec 12 Peach 16 blueberry 28 lime, 12 watermelon 17 Apple Schnapps Schnapps Schnapps 12 cream to cacao four cold brew 13 sweet and sour and 16 corbel Brew",
    [
      item("bulleit", "Bulleit Bourbon"),
      item("crown", "Crown Royal"),
      item("svedka", "Svedka Blue Raspberry Vodka"),
      item("jose", "Jose Cuervo Silver"),
      item("titos", "Tito's"),
      item("ketel", "Ketel One Cucumber Vodka"),
      item("citron", "Absolut Citron"),
      item("crown-apple", "Crown Apple"),
      item("bombay", "Bombay Sapphire"),
      item("jack", "Jack Daniel's"),
      item("jim", "Jim Beam"),
      item("bacardi", "Bacardi"),
      item("makers", "Makers Mark"),
      item("bitters", "Bitters", "Mixer Cabinet"),
      item("lemon", "Lemon Juice", "Mixer Cabinet"),
      item("raspberry", "Raspberry Schnapps", "Mixer Cabinet"),
      item("pomegranate", "Pomegranate Schnapps", "Mixer Cabinet"),
      item("strawberry", "Strawberry Schnapps", "Mixer Cabinet"),
      item("triple-sec", "Triple Sec", "Mixer Cabinet"),
      item("peach", "Peach Schnapps", "Mixer Cabinet"),
      item("blueberry", "Blueberry Schnapps", "Mixer Cabinet"),
      item("lime", "Lime Juice", "Mixer Cabinet"),
      item("watermelon", "Watermelon Schnapps", "Mixer Cabinet"),
      item("apple", "Apple Schnapps", "Mixer Cabinet"),
      item("cacao", "Creme De Cacao", "Mixer Cabinet"),
      item("cold-brew", "Cold Brew", "Mixer Cabinet"),
      item("sour-mix", "Sour Mix", "Mixer Cabinet"),
      item("korbel", "Korbel Brut", "Other"),
    ],
  );

  assert.deepEqual(
    parsed.proposals.map(({ status, matchedId, quantity }) => ({ status, matchedId, quantity })),
    [
      ["bulleit", 14], ["crown", 5], ["svedka", 9], ["jose", 60], ["titos", 14],
      ["ketel", 12], ["citron", 14], ["crown-apple", 4], ["bombay", 3], ["jack", 14],
      ["jim", 1], ["bacardi", 4], ["makers", 2], ["bitters", 8], ["lemon", 19],
      ["raspberry", 10], ["pomegranate", 32], ["strawberry", 8], ["triple-sec", 31], ["peach", 12],
      ["blueberry", 16], ["lime", 28], ["watermelon", 12], ["apple", 17], ["cacao", 12],
      ["cold-brew", 4], ["sour-mix", 13], ["korbel", 16],
    ].map(([matchedId, quantity]) => ({ status: "matched", matchedId, quantity })),
  );
  assert.equal(parsed.proposals.some((proposal) => /schnapps schnapps/i.test(proposal.source)), false);
});
