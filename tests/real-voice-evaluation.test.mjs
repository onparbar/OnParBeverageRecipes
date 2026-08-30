import assert from "node:assert/strict";
import test from "node:test";

import { parseSmartReceivingTranscript } from "../public/smart-receiving.mjs";
import { parseInventoryTranscript } from "../public/speech-inventory.mjs";

function keg(id, name, wall = "Main", aliases = []) {
  return { id, name, wall, aliases, target: "keg", group: wall + " cooler", unit: "kegs", currentValue: "0" };
}

test("real cooler speech keeps every adjacent product separate", () => {
  const result = parseInventoryTranscript(
    "three mich ultra three miller light one coors one garage beer regular one blue moon one voodoo juicy haze one truth one spike strawberry lemonade",
    [
      keg("ultra", "Michelob ULTRA 1"),
      keg("miller", "Miller Lite 1"),
      keg("coors", "Coors Light 1"),
      keg("garage", "Garage Beer 1"),
      keg("blue-moon", "Blue Moon 1"),
      keg("voodoo", "Voodoo Ranger Juicy Haze 1"),
      keg("truth", "Truth 1"),
      keg("strawberry", "Spiked Strawberry Lemonade (Tito's) 1", "Main", ["Spiked Strawberry Lemonade"]),
    ],
  );

  assert.deepEqual(result.proposals.map(({ matchedId, quantity }) => [matchedId, quantity]), [
    ["ultra", 3],
    ["miller", 3],
    ["coors", 1],
    ["garage", 1],
    ["blue-moon", 1],
    ["voodoo", 1],
    ["truth", 1],
    ["strawberry", 1],
  ]);
  assert.equal(result.proposals.every((proposal) => proposal.status === "matched"), true);
});

test("one delivery sentence can confirm multiple vendor orders", () => {
  const result = parseSmartReceivingTranscript(
    "Heidelberg and OHLQ came, everything's here",
    {
      available: true,
      generatedAt: "2026-08-24T12:00:00.000Z",
      vendors: [
        {
          id: "heidelberg",
          vendor: "Heidelberg",
          ordered: true,
          items: [{ id: "angry", name: "Angry Orchard", quantity: 2, unit: "kegs" }],
        },
        {
          id: "ohlq",
          vendor: "OHLQ",
          ordered: true,
          items: [{ id: "titos", name: "Tito's", quantity: 2, unit: "bottles" }],
        },
      ],
    },
  );

  assert.equal(result.status, "ready");
  assert.equal(result.proposal.batches.length, 2);
  assert.equal(result.proposal.lines.every((line) => line.status === "received"), true);
});
