import test from "node:test";
import assert from "node:assert/strict";

import { parseInventoryTranscript } from "../public/speech-inventory.mjs";

function keg(id, name, aliases = []) {
  return {
    id,
    name,
    aliases,
    target: "keg",
    group: "Karaoke cooler",
    wall: "karaoke",
    unit: "kegs",
    packSize: 1,
    currentValue: "",
  };
}

test("separates Garage Beer Lime and Triple Jam in Chrome karaoke speech", () => {
  const parsed = parseInventoryTranscript(
    "one garage for your lime one triple jam",
    [
      keg("garage-lime", "Garage Beer Lime 2", ["Garage Lime"]),
      keg("triple-jam", "Triple Jam Cider 2", ["Triple Jam"]),
    ],
  );

  assert.deepEqual(
    parsed.proposals.map(({ matchedId, quantity }) => ({ matchedId, quantity })),
    [
      { matchedId: "garage-lime", quantity: 1 },
      { matchedId: "triple-jam", quantity: 1 },
    ],
  );
});
