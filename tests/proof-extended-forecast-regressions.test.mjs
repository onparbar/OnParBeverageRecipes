import assert from "node:assert/strict";
import test from "node:test";
import { buildProofPrepOrderContext, PROOF_PREP_LOOK_AHEAD_WEEKS } from "../public/proof-prep-replacements.mjs";
import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";
import { buildUnifiedVendorOrderModel, normalizeVendorOrderPolicy } from "../public/vendor-order-drafts.mjs";

const ingredient = {
  id: "lime-juice", name: "Lime Juice", group: "Mixer Cabinet", vendor: "Proof",
  vendorSku: "PROOF-LIME-12", vendorProductName: "Shelf Stable Lime Juice",
  bottleOz: 10, packSize: 12, casePackaged: true, shelfStable: true,
  unitCost: 5, onHandDisplay: "0", hasCurrentCount: true,
};
const recipe = { title: "Future Cocktail", ingredients: [{ inventoryId: "lime-juice", name: "Lime Juice", oz: 120 }] };
const tap = {
  key: "main:57", tapNumber: 57, wall: "Main", name: "Future Cocktail",
  currentStockKegs: 1.5, avgWeeklyKegs: 0.25,
  variabilityCushionPct: 0, preThursdayUsageSharePct: 0,
};
const options = {
  generatedAt: "2026-09-14T14:00:00.000Z",
  sourceDate: "2026-09-14T14:00:00.000Z",
  now: new Date("2026-09-14T14:00:00.000Z"),
};

function forecast(overrides = {}) {
  return buildProofPrepOrderContext({ inventoryItems: [ingredient], recipes: [recipe], tapInputs: [tap], ...overrides });
}

function basePlan(cost = 300, extraItems = []) {
  return buildWeeklyActionPlan({ inventoryItems: [{
    id: "cranberry", name: "Cranberry Juice", group: "Mixer Cabinet",
    vendor: "Proof", vendorSku: "PROOF-CRAN-12", vendorProductName: "Cranberry Juice 12 pack",
    orderUnits: 12, casePackaged: true, packSize: 12,
    unitCost: cost / 12, estimatedCost: cost,
    onHand: 0, par: 12, hasKnownPrice: true,
  }, ...extraItems] });
}

function draft(candidates, { cost = 300, extraItems = [], requirement = "required" } = {}) {
  // The base order is already required; these candidates are only its top-ups.
  return buildUnifiedVendorOrderModel(basePlan(cost, extraItems), {
    ...options,
    orderPolicy: normalizeVendorOrderPolicy({
      proofMinimum: 350, proofPrepRequirement: requirement, proofMinimumCandidates: candidates,
    }),
  }).drafts[0];
}

test("Proof forecasts all eight Thursdays, including the next batch beyond week four", () => {
  const result = forecast();
  assert.equal(PROOF_PREP_LOOK_AHEAD_WEEKS, 8);
  assert.equal(result.requirement, "not-required");
  const [candidate] = result.candidates;
  assert.equal(candidate.forecastDemands.length, 8);
  assert.deepEqual(candidate.forecastDemands.map(({ units }) => units), [0, 0, 0, 0, 0, 0, 12, 12]);
  assert.equal(candidate.replacementNeedUnits, 12);
});

test("saved order policy retains weeks five through eight and rejects later weeks", () => {
  const [candidate] = forecast().candidates;
  const saved = normalizeVendorOrderPolicy({ proofMinimumCandidates: [{
    ...candidate, forecastDemands: [...candidate.forecastDemands, { week: 8, units: 24 }],
  }] });
  assert.equal(saved.proofMinimumCandidates[0].forecastDemands.length, 8);
  assert.equal(saved.proofMinimumCandidates[0].forecastDemands.at(-1).week, 7);
  assert.equal(saved.proofMinimumCandidates[0].forecastDemands.at(-1).units, 12);
});

test("a later forecast never pads this week's Proof order or duplicates a future Monday", () => {
  const result = draft(forecast().candidates);
  assert.equal(result.lines.some((line) => line.id === "lime-juice"), false);
  assert.equal(result.estimatedTotal, 300);
  assert.equal(result.warnings.some((warning) => warning.code === "PROOF_DELIVERY_FEE"), true);
});

test("nearer prep demand wins before a cheaper distant ingredient", () => {
  const [later] = forecast().candidates;
  const earlier = {
    ...later, id: "syrup", name: "Syrup", vendorSku: "PROOF-SYRUP-12", unitCost: 10,
    forecastDemands: Array.from({ length: 8 }, (_, week) => ({ week, units: week < 1 ? 0 : 12 })),
  };
  const result = draft([later, earlier]);
  assert.equal(result.lines.find((line) => line.id === "syrup").requestedCases, 1);
  assert.equal(result.lines.some((line) => line.id === "lime-juice"), false);
  assert.equal(result.estimatedTotal, 420);
});

test("existing ordered units are deducted before choosing a Proof top-up", () => {
  const result = draft(forecast().candidates, {
    cost: 240,
    extraItems: [{ ...ingredient, onHand: 0, par: 12, orderUnits: 12, estimatedCost: 60, hasKnownPrice: true }],
  });
  assert.equal(result.lines.find((line) => line.id === "lime-juice").requestedUnits, 12);
  assert.equal(result.estimatedTotal, 300);
  assert.equal(result.warnings.some((warning) => warning.code === "PROOF_MINIMUM_TOP_UP"), false);
});

test("unrelated missing tap data does not discard justified ingredient candidates", () => {
  for (const missing of [{ currentStockKegs: null }, { name: "Unmapped Cocktail" }, { inventoryStateMissing: true }]) {
    const result = forecast({ tapInputs: [tap, { ...tap, key: "main:58", tapNumber: 58, ...missing }] });
    assert.equal(result.requirement, "unknown");
    assert.equal(result.candidates[0].replacementNeedUnits, 12);
    assert.equal(draft(result.candidates, { requirement: result.requirement }).estimatedTotal, 300);
  }
});

test("unknown tap stock never becomes an invented zero-stock forecast", () => {
  const result = forecast({ tapInputs: [{ ...tap, currentStockKegs: null }] });
  assert.equal(result.requirement, "unknown");
  assert.deepEqual(result.candidates, []);
});

test("stale or invalid counts stay protected in both forecast and explicit-prep paths", () => {
  for (const invalid of [{ hasCurrentCount: false }, { onHandDisplay: "" }, { onHandDisplay: "invalid" }, { onHandDisplay: "-1" }]) {
    for (const tapInputs of [[tap], []]) {
      const result = forecast({ inventoryItems: [{ ...ingredient, ...invalid }], tapInputs,
        cocktails: [{ name: recipe.title, quantity: 1 }] });
      assert.equal(result.requirement, "unknown");
      assert.deepEqual(result.candidates, []);
    }
  }
});

test("a verified saved count replaces a stale live field without treating missing counts as zero", () => {
  const result = forecast({
    inventoryItems: [{ ...ingredient, onHandDisplay: "999", hasCurrentCount: false }],
    savedInventoryItems: [{ id: ingredient.id, onHandDisplay: "2", hasCurrentCount: true }],
  });
  assert.equal(result.candidates[0].onHandUnits, 2);
  assert.equal(result.candidates[0].replacementNeedUnits, 10);
  const stale = forecast({ savedInventoryItems: [{ id: ingredient.id, onHandDisplay: "2", hasCurrentCount: false }] });
  assert.deepEqual(stale.candidates, []);
  assert.equal(stale.requirement, "unknown");
});

test("refrigerated ingredients cannot become forecast minimum filler", () => {
  for (const flag of [{ shelfStable: false }, { vendorProduct: { shelfStable: false } }]) {
    const result = forecast({ inventoryItems: [{ ...ingredient, ...flag }] });
    assert.deepEqual(result.candidates, []);
  }
});

test("tap deduplication and separate wall stock remain intact", () => {
  const duplicate = forecast({ tapInputs: [tap, { ...tap }] });
  assert.equal(duplicate.candidates[0].replacementNeedUnits, 12);
  const separate = forecast({ tapInputs: [tap, { ...tap, key: "karaoke:95", tapNumber: 95, wall: "Karaoke", currentStockKegs: 8 }] });
  assert.equal(separate.candidates[0].replacementNeedUnits, 12);
});

test("the eight-week boundary does not justify purchases for a later ninth Thursday", () => {
  const result = forecast({ tapInputs: [{ ...tap, currentStockKegs: 2 }] });
  assert.deepEqual(result.candidates, []);
  assert.equal(result.requirement, "not-required");
});

test("minimum top-ups stop at the threshold and never add ineffective filler", () => {
  const candidates = forecast().candidates;
  const alreadyMet = draft(candidates, { cost: 350 });
  assert.equal(alreadyMet.estimatedTotal, 350);
  assert.equal(alreadyMet.lineCount, 1);
  const insufficient = draft(candidates, { cost: 250 });
  assert.equal(insufficient.estimatedTotal, 250);
  assert.equal(insufficient.lineCount, 1);
  assert.ok(insufficient.warnings.some((warning) => warning.code === "PROOF_DELIVERY_FEE"));
});
