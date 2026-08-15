import assert from "node:assert/strict";
import test from "node:test";

import { buildProofPrepReplacementCandidates } from "../public/proof-prep-replacements.mjs";

test("projects exact Proof bottle replacement needs from locked cocktail batches", () => {
  const candidates = buildProofPrepReplacementCandidates({
    cocktails: [{ name: "House Margarita", quantity: 2 }],
    recipes: [{
      id: "house-margarita",
      title: "House Margarita",
      ingredients: [
        { name: "Lime Juice", oz: 270 },
        { name: "Jose Cuervo", oz: 355 },
      ],
    }],
    inventoryItems: [{
      id: "lime-juice",
      name: "Lime Juice",
      casePackaged: true,
      packSize: 12,
      caseCost: 60,
      matchedSku: "PROOF-LIME-12",
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 33.814 },
    }],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].projectedPrepUseOz, 540);
  assert.equal(candidates[0].projectedPrepUseUnits, 16);
  assert.equal(candidates[0].unitCost, 5);
  assert.equal(candidates[0].shelfStable, true);
});

test("skips candidates with ambiguous identity or missing ordering data", () => {
  const candidates = buildProofPrepReplacementCandidates({
    cocktails: [{ name: "House Margarita", quantity: 1 }],
    recipes: [{ title: "House Margarita", ingredients: [{ name: "Lime Juice", oz: 270 }] }],
    inventoryItems: [
      { id: "lime", name: "Different Name", vendorProduct: { vendor: "Proof", bottleOz: 33.814 } },
      { id: "lime-juice", name: "Lime Juice", casePackaged: true, packSize: 12, vendorProduct: { vendor: "Proof", bottleOz: 33.814 } },
    ],
  });

  assert.deepEqual(candidates, []);
});
