import assert from "node:assert/strict";
import test from "node:test";
import { carryForwardPlannedProofPrep } from "../public/proof-planned-prep.mjs";
import { buildProofPrepOrderContext } from "../public/proof-prep-replacements.mjs";
import { buildVendorOrderDrafts } from "../public/vendor-order-drafts.mjs";

function fixture() {
  return {
    cocktails: [{ name: "House Margarita 1", quantity: 1, tapNumbers: [52], walls: ["Main"] }],
    recipes: [{ title: "House Margarita", ingredients: [{ name: "Lime Juice", oz: 120 }] }],
    inventoryItems: [{
      id: "lime-juice", name: "Lime Juice", casePackaged: true, packSize: 12,
      caseCost: 60, unitCost: 5, matchedSku: "PROOF-LIME", onHandDisplay: "12",
      parDisplay: "40", hasCurrentCount: true, shelfStable: true,
      vendorProduct: { vendor: "Proof", productName: "Lime Juice", bottleOz: 10 },
    }],
    tapInputs: [{
      key: "main-52", tapNumber: 52, wall: "Main", name: "House Margarita 1",
      currentStockKegs: 0.15, avgWeeklyKegs: 0.1,
      variabilityCushionPct: 25, preThursdayUsageSharePct: 0, inventoryStateMissing: false,
    }],
  };
}

test("planned prep is consumed once and prevents a duplicate batch next Thursday", () => {
  const options = fixture();
  options.inventoryItems[0].onHandDisplay = "0";
  const result = buildProofPrepOrderContext(options);
  assert.equal(result.candidates[0].projectedPrepUseOz, 720);
  assert.equal(result.candidates[0].forecastDemands[0].units, 12);
  assert.equal(result.candidates[0].forecastDemands[1].units, 12);
  assert.equal(result.candidates[0].forecastDemands.at(-1).units, 72);
});

test("covered planned prep does not create a Proof purchasing requirement", () => {
  assert.equal(buildProofPrepOrderContext(fixture()).requirement, "not-required");
});

test("carry-forward never mutates the saved tap counts", () => {
  const options = fixture();
  const before = structuredClone(options);
  const result = carryForwardPlannedProofPrep(options);
  assert.equal(result.options.tapInputs[0].currentStockKegs, 1.15);
  assert.deepEqual(options, before);
});

test("a Main batch does not become Karaoke stock for the same cocktail", () => {
  const options = fixture();
  options.tapInputs.push({ ...options.tapInputs[0], key: "karaoke-93", tapNumber: 93, wall: "Karaoke", name: "House Margarita 2" });
  const result = carryForwardPlannedProofPrep(options);
  assert.equal(result.options.tapInputs[0].currentStockKegs, 1.15);
  assert.equal(result.options.tapInputs[1].currentStockKegs, 0.15);
});

test("duplicate tap observations do not double a planned batch", () => {
  const options = fixture();
  options.inventoryItems[0].onHandDisplay = "0";
  options.tapInputs.push({ ...options.tapInputs[0] });
  assert.equal(buildProofPrepOrderContext(options).candidates[0].projectedPrepUseOz, 720);
});

test("an ambiguous cross-wall batch cannot claim complete coverage", () => {
  const options = fixture();
  options.cocktails = [{ name: "House Margarita", quantity: 1 }];
  options.inventoryItems[0].onHandDisplay = "999";
  options.tapInputs.push({ ...options.tapInputs[0], key: "karaoke-93", tapNumber: 93, wall: "Karaoke", name: "House Margarita 2" });
  assert.equal(buildProofPrepOrderContext(options).requirement, "unknown");
});

test("missing tap stock remains unknown instead of receiving invented coverage", () => {
  const options = fixture();
  options.tapInputs[0].currentStockKegs = null;
  options.tapInputs[0].inventoryStateMissing = true;
  assert.equal(buildProofPrepOrderContext(options).requirement, "unknown");
});

test("Thursday prep is not spent retroactively on pre-Thursday missing stock", () => {
  const options = fixture();
  options.inventoryItems[0].onHandDisplay = "0";
  Object.assign(options.tapInputs[0], { currentStockKegs: 0, avgWeeklyKegs: 0.7, variabilityCushionPct: 10, preThursdayUsageSharePct: 300 / 7 });
  assert.equal(buildProofPrepOrderContext(options).candidates[0].forecastDemands[0].units, 12);
});

test("additional same-week batches still reserve ingredients beyond planned prep", () => {
  const options = fixture();
  options.inventoryItems[0].onHandDisplay = "0";
  Object.assign(options.tapInputs[0], { currentStockKegs: 0, avgWeeklyKegs: 1.2, variabilityCushionPct: 0 });
  assert.equal(buildProofPrepOrderContext(options).candidates[0].forecastDemands[0].units, 24);
});

test("planned and additional cocktails sharing an ingredient are added rather than maxed", () => {
  const options = fixture();
  options.inventoryItems[0].onHandDisplay = "0";
  options.recipes.push({ title: "Another Cocktail", ingredients: [{ name: "Lime Juice", oz: 60 }] });
  options.tapInputs.push({ ...options.tapInputs[0], key: "main-53", tapNumber: 53, name: "Another Cocktail 1", currentStockKegs: 0 });
  assert.equal(buildProofPrepOrderContext(options).candidates[0].forecastDemands[0].units, 18);
});

function orderFixture() {
  return {
    plan: { orders: { mixers: [{
      id: "lime-juice", name: "Lime Juice", quantity: 24, vendor: "Proof",
      vendorSku: "PROOF-LIME", vendorProductName: "Lime Juice", unitCost: 20,
      estimatedCost: 480, hasKnownPrice: true, casePackaged: true, packSize: 12, caseCount: 2,
    }] }, prep: { cocktails: [] } },
    options: {
      generatedAt: "2026-09-14T20:36:33.772Z", sourceDate: "2026-09-14",
      proofPrepRequirement: "not-required", proofMinimum: 350,
    },
  };
}

test("old par targets cannot trigger an unnecessary Proof order above its minimum", () => {
  const { plan, options } = orderFixture();
  const result = buildVendorOrderDrafts(plan, options);
  assert.equal(result.drafts.length, 0);
  assert.equal(result.weeklyTotal, 0);
  assert.equal(result.deferredOrders[0].vendor, "Proof");
});

test("an explicitly requested Proof quantity is preserved even when prep is covered", () => {
  const { plan, options } = orderFixture();
  options.manualCatalog = [{ catalogId: "catalog-lime", internalId: "lime-juice", name: "Lime Juice", vendor: "Proof", vendorSku: "PROOF-LIME", vendorProductName: "Lime Juice", lineType: "Mixer", packSize: 12, casePackaged: true, unitCost: 20, currentPlanQuantity: 24 }];
  options.manualAdjustments = [{ catalogId: "catalog-lime", quantity: 12, reason: "Manager requested", adjustedBy: "Owner" }];
  assert.equal(buildVendorOrderDrafts(plan, options).drafts.length, 1);
});

test("a real Proof ingredient shortage is not suppressed", () => {
  const { plan, options } = orderFixture();
  options.proofPrepRequirement = "required";
  assert.equal(buildVendorOrderDrafts(plan, options).drafts.length, 1);
});

test("unknown coverage cannot silently remove a Proof order", () => {
  const { plan, options } = orderFixture();
  options.proofPrepRequirement = "unknown";
  assert.equal(buildVendorOrderDrafts(plan, options).drafts.length, 1);
});
