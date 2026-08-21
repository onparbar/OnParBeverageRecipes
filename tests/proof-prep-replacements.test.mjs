import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProofPrepOrderContext,
  buildProofPrepReplacementCandidates,
} from "../public/proof-prep-replacements.mjs";

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
      onHandDisplay: "12",
      parDisplay: "12",
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 33.814 },
    }],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].projectedPrepUseOz, 540);
  assert.equal(candidates[0].projectedPrepUseUnits, 16);
  assert.equal(candidates[0].replacementNeedUnits, 16);
  assert.equal(candidates[0].unitCost, 5);
  assert.equal(candidates[0].shelfStable, true);
});

test("uses inventory on hand and par before permitting a Proof prep replacement", () => {
  const context = buildProofPrepOrderContext({
    cocktails: [{ name: "House Margarita", quantity: 1 }],
    recipes: [{ title: "House Margarita", ingredients: [{ name: "Lime Juice", oz: 270 }] }],
    inventoryItems: [{
      id: "lime-juice",
      name: "Lime Juice",
      casePackaged: true,
      packSize: 12,
      caseCost: 60,
      matchedSku: "PROOF-LIME-12",
      onHandDisplay: "24",
      parDisplay: "12",
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 33.814 },
    }],
  });

  assert.equal(context.requirement, "not-required");
  assert.deepEqual(context.candidates, []);
});

test("defers a sub-minimum Proof order when inventory covers prep even if prep will lower stock below par", () => {
  const context = buildProofPrepOrderContext({
    cocktails: [{ name: "House Margarita", quantity: 1 }],
    recipes: [{ title: "House Margarita", ingredients: [{ name: "Lime Juice", oz: 270 }] }],
    inventoryItems: [{
      id: "lime-juice",
      name: "Lime Juice",
      casePackaged: true,
      packSize: 12,
      caseCost: 60,
      matchedSku: "PROOF-LIME-12",
      onHandDisplay: "10",
      parDisplay: "12",
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 33.814 },
    }],
  });

  assert.equal(context.requirement, "not-required");
  assert.equal(context.candidates[0].projectedPrepUseUnits, 8);
  assert.equal(context.candidates[0].replacementNeedUnits, 10);
});

test("keeps Proof under review when a required inventory count is blank", () => {
  const context = buildProofPrepOrderContext({
    cocktails: [{ name: "House Margarita", quantity: 1 }],
    recipes: [{ title: "House Margarita", ingredients: [{ name: "Lime Juice", oz: 270 }] }],
    inventoryItems: [{
      id: "lime-juice",
      name: "Lime Juice",
      casePackaged: true,
      packSize: 12,
      caseCost: 60,
      matchedSku: "PROOF-LIME-12",
      onHandDisplay: "",
      parDisplay: "12",
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 33.814 },
    }],
  });

  assert.equal(context.requirement, "unknown");
  assert.deepEqual(context.candidates, []);
});

test("matches wall cocktail names through the existing recipe aliases", () => {
  const context = buildProofPrepOrderContext({
    cocktails: [{ name: "Blueberry Margarita (Jose Cuervo) 1", quantity: 1 }],
    recipes: [{
      title: "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)",
      ingredients: [{ name: "Lime Juice", oz: 270 }],
    }],
    recipeAliases: {
      "BLUEBERRY MARGARITA (JOSE CUERVO)": "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)",
    },
    inventoryItems: [{
      id: "lime-juice",
      name: "Lime Juice",
      casePackaged: true,
      packSize: 12,
      caseCost: 60,
      matchedSku: "PROOF-LIME-12",
      onHandDisplay: "28",
      parDisplay: "40",
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 33.814 },
    }],
  });

  assert.equal(context.requirement, "not-required");
  assert.equal(context.candidates[0].projectedPrepUseUnits, 8);
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
