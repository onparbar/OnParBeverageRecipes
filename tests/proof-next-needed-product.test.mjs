import assert from "node:assert/strict";
import test from "node:test";
import { buildProofPrepOrderContext } from "../public/proof-prep-replacements.mjs";
import { buildUnifiedVendorOrderModel } from "../public/vendor-order-drafts.mjs";

function fixture() {
  const inventoryItems = [
    { id: "pomegranate-schnapps", name: "Pomegranate Schnapps", bottleOz: 33.81,
      onHandDisplay: "10", unitCost: 12.03, vendorSku: "186701" },
    { id: "bitters", name: "Bitters", bottleOz: 16,
      onHandDisplay: "2", unitCost: 23.99, vendorSku: "38000" },
    { id: "lemon-juice", name: "Lemon Juice", bottleOz: 33.81,
      onHandDisplay: "22", unitCost: 6.27, vendorSku: "472535" },
  ].map(item => ({ ...item, vendor: "Proof", group: "Mixer Cabinet", packSize: 12,
    casePackaged: true, shelfStable: true, hasCurrentCount: true }));
  const recipes = [
    { title: "Pomegranate Martini", ingredients: [{ name: "Pomegranate Schnapps",
      raw: "Pomegrante Schnapps (1 Liter)=22 bottles", oz: 743.9 }] },
    { title: "Old Fashioned", ingredients: [{ name: "Bitters", raw: "Bitters=3 bottles (16oz)", oz: 48 }] },
    { title: "Lemon Drop Martini", ingredients: [{ name: "Lemon Juice",
      raw: "300 oz lemon juice=9 bottles (1L)", oz: 300 }] },
  ];
  const tapInputs = [
    { key: "main-61", tapNumber: 61, name: "Pomegranate Martini 1", currentStockKegs: 0.323, avgWeeklyKegs: 0.099 },
    { key: "main-69", tapNumber: 69, name: "Old Fashioned 1", currentStockKegs: 0.575, avgWeeklyKegs: 0.149 },
    { key: "main-60", tapNumber: 60, name: "Lemon Drop Martini 1", currentStockKegs: 0.293, avgWeeklyKegs: 0.132 },
  ].map(tap => ({ ...tap, wall: "Main" }));
  const cocktails = [
    { name: "Pomegranate Martini 1", quantity: 1, tapNumbers: [61], walls: ["Main"] },
    { name: "Lemon Drop Martini 1", quantity: 1, tapNumbers: [60], walls: ["Main"] },
  ];
  return { inventoryItems, recipes, tapInputs, cocktails };
}

test("22 declared pomegranate bottles do not become 23 from rounded ounces", () => {
  const options = fixture();
  for (const tapInputs of [options.tapInputs, []]) {
    const context = buildProofPrepOrderContext({ ...options, tapInputs });
    const pomegranate = context.candidates.find(item => item.id === "pomegranate-schnapps");
    assert.equal(pomegranate.forecastDemands?.[0].units ?? pomegranate.projectedPrepUseUnits, 22);
    if (!tapInputs.length) assert.equal(pomegranate.replacementNeedUnits, 12);
  }
});

test("an existing pomegranate case covers prep and the next genuine shortage fills Proof", () => {
  const options = fixture();
  const context = buildProofPrepOrderContext(options);
  const pomegranate = options.inventoryItems[0];
  const model = buildUnifiedVendorOrderModel({ orders: { mixers: [{ ...pomegranate,
    quantity: 12, caseCount: 1, estimatedCost: 144.36, hasKnownPrice: true,
    cocktailPrepShortageUnits: 12 }] } }, {
    generatedAt: "2026-11-09T19:07:30.456Z", sourceDate: "2026-11-09T19:07:34.796Z",
    now: new Date("2026-11-09T20:00:00Z"),
    orderPolicy: { proofMinimum: 350, proofPrepRequirement: "required", proofMinimumCandidates: context.candidates },
  });
  const proof = model.drafts[0];
  assert.deepEqual(proof.lines.map(line => [line.id, line.requestedUnits]), [
    ["pomegranate-schnapps", 12], ["bitters", 12],
  ]);
  assert.equal(Math.round(proof.estimatedTotal * 100), 43224);
  assert.match(proof.lines[1].reason, /upcoming Thursday 2/);
});

test("22 lemon bottles cover two whole batches before another case is considered", () => {
  const context = buildProofPrepOrderContext(fixture());
  const lemon = context.candidates.find(item => item.id === "lemon-juice");
  assert.equal(lemon.forecastDemands[0].units, 9);
  const nextNeed = lemon.forecastDemands.find(entry => entry.units > 22);
  assert.equal(nextNeed.week, 15);
  assert.equal(nextNeed.units, 27);
});

test("Proof honors explicit inventory links even if the ingredient name changes", () => {
  const options = fixture();
  Object.assign(options.recipes[0].ingredients[0], { inventoryItemId: "pomegranate-schnapps", name: "Pomegranate cordial" });
  const context = buildProofPrepOrderContext(options);
  assert.equal(context.candidates.find(item => item.id === "pomegranate-schnapps")?.forecastDemands[0].units, 22);
});

test("a genuine quantity above available stock still requires the next case", () => {
  const options = fixture();
  Object.assign(options.recipes[0].ingredients[0], { raw: "Pomegranate Schnapps", oz: 760 });
  const context = buildProofPrepOrderContext(options);
  assert.equal(context.candidates.find(item => item.id === "pomegranate-schnapps").forecastDemands[0].units, 23);
});
