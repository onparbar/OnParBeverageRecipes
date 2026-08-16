import assert from "node:assert/strict";
import test from "node:test";

import { buildWeeklyActionPlan } from "../public/weekly-action-plan.mjs";
import {
  buildVendorOrderDrafts,
  getDisabledVendorOrderAdapter,
} from "../public/vendor-order-drafts.mjs";

const monday = new Date("2026-08-10T10:00:00");
const options = {
  generatedAt: "2026-08-10T14:00:00.000Z",
  sourceDate: "2026-08-10T15:00:00.000Z",
  now: monday,
};

function inventoryPlan(overrides = {}) {
  return buildWeeklyActionPlan({
    inventoryItems: [{
      id: "cranberry",
      name: "Cranberry Juice",
      group: "Mixer Cabinet",
      orderUnits: 12,
      casePackaged: true,
      packSize: 12,
      vendor: "Proof",
      vendorSku: "PROOF-CRAN-12",
      vendorProductName: "Cranberry Juice 12 pack",
      unitCost: 3,
      estimatedCost: 36,
      onHand: 0,
      par: 12,
      hasKnownPrice: true,
      ...overrides,
    }],
  });
}

test("uses the Weekly Plan par order and preserves existing case rounding", () => {
  const result = buildVendorOrderDrafts(inventoryPlan(), options);
  const line = result.drafts[0].lines[0];

  assert.equal(line.requestedUnits, 12);
  assert.equal(line.requestedCases, 1);
  assert.equal(line.packSize, 12);
  assert.match(line.reason, /0 on hand against a par of 12/);
  assert.equal(line.blockers.length, 0);
});

test("enforces an optional budget while no configured budget remains unlimited", () => {
  assert.equal(buildVendorOrderDrafts(inventoryPlan(), options).drafts[0].blockers.some((item) => item.code === "WEEKLY_BUDGET_EXCEEDED"), false);
  assert.equal(buildVendorOrderDrafts(inventoryPlan(), { ...options, budgetLimit: 20 }).drafts[0].blockers.some((item) => item.code === "WEEKLY_BUDGET_EXCEEDED"), true);
});

test("blocks stale source data and missing SKU or price instead of inferring values", () => {
  const plan = inventoryPlan({ vendorSku: "", unitCost: 0, estimatedCost: 0, hasKnownPrice: false });
  const draft = buildVendorOrderDrafts(plan, { ...options, freshness: { status: "stale" } }).drafts[0];
  const codes = draft.blockers.map((item) => item.code);

  assert.ok(codes.includes("SOURCE_DATA_NOT_READY"));
  assert.ok(codes.includes("VENDOR_SKU_REQUIRED"));
  assert.ok(codes.includes("PRICE_REQUIRED"));
  assert.equal(draft.canApprove, false);
});

test("blocks duplicate vendor identities and generates stable idempotency keys", () => {
  const line = {
    id: "duplicate",
    name: "Duplicate Product",
    quantity: 1,
    vendor: "Proof",
    vendorSku: "DUP-1",
    vendorProductName: "Duplicate Product",
    unitCost: 10,
    estimatedCost: 10,
    hasKnownPrice: true,
  };
  const plan = {
    orders: { beerKegs: [{ ...line }], liquorTapBottles: [], liquor: [], mixers: [], supplies: [{ ...line }] },
  };
  const first = buildVendorOrderDrafts(plan, options);
  const second = buildVendorOrderDrafts(plan, options);

  assert.equal(first.drafts[0].id, second.drafts[0].id);
  assert.ok(first.drafts[0].blockers.some((item) => item.code === "DUPLICATE_ORDER_LINE"));
});

test("builds an approval-ready vendor draft but keeps real submission disabled", async () => {
  const draft = buildVendorOrderDrafts(inventoryPlan(), options).drafts[0];
  assert.equal(draft.vendor, "Proof");
  assert.equal(draft.lineCount, 1);
  assert.equal(draft.canApprove, true);
  assert.equal(draft.blockers.some((item) => item.code === "DELIVERY_LOCATION_REQUIRED"), false);
  assert.ok(draft.warnings.some((item) => item.code === "PROOF_DELIVERY_FEE"));
  assert.deepEqual(draft.proofFee, { threshold: 350, amount: null, configured: false });
  assert.match(draft.warnings.find((item) => item.code === "PROOF_DELIVERY_FEE").message, /not configured/);

  const adapter = getDisabledVendorOrderAdapter("Proof");
  assert.equal(adapter.enabled, false);
  await assert.rejects(adapter.submit(), (error) => error.code === "VENDOR_ORDER_SUBMISSION_DISABLED");
});

test("blocks retired products from vendor drafts", () => {
  const result = buildVendorOrderDrafts(inventoryPlan({
    name: "Breakfast Stout",
    vendorProductName: "Breakfast Stout",
  }), options);
  assert.ok(result.drafts[0].blockers.some((item) => item.code === "RETIRED_PRODUCT"));
});

test("tops up Proof only with shelf-stable products justified by projected cocktail prep usage", () => {
  const result = buildVendorOrderDrafts(inventoryPlan({ estimatedCost: 300, unitCost: 25 }), {
    ...options,
    proofMinimumCandidates: [{
      id: "lime-juice",
      name: "Lime Juice",
      vendor: "Proof",
      vendorSku: "PROOF-LIME-12",
      vendorProductName: "Shelf Stable Lime Juice",
      casePackaged: true,
      shelfStable: true,
      packSize: 12,
      projectedPrepUseUnits: 24,
      unitCost: 5,
    }],
  });
  const draft = result.drafts[0];
  const topUp = draft.lines.find((line) => line.id === "lime-juice");

  assert.equal(topUp.requestedCases, 1);
  assert.equal(topUp.requestedUnits, 12);
  assert.equal(draft.estimatedTotal, 360);
  assert.match(topUp.reason, /projected cocktail prep usage/);
  assert.ok(draft.warnings.some((item) => item.code === "PROOF_MINIMUM_TOP_UP"));
  assert.equal(draft.warnings.some((item) => item.code === "PROOF_DELIVERY_FEE"), false);
});

test("does not use refrigerated or unjustified Proof products as minimum filler", () => {
  const result = buildVendorOrderDrafts(inventoryPlan({ estimatedCost: 300, unitCost: 25 }), {
    ...options,
    proofMinimumCandidates: [{
      id: "fresh-juice",
      name: "Fresh Juice",
      vendor: "Proof",
      vendorSku: "PROOF-FRESH-6",
      casePackaged: true,
      shelfStable: false,
      packSize: 6,
      projectedPrepUseUnits: 12,
      unitCost: 10,
    }],
  });

  assert.equal(result.drafts[0].lineCount, 1);
  assert.equal(result.drafts[0].estimatedTotal, 300);
  assert.ok(result.drafts[0].warnings.some((item) => item.code === "PROOF_DELIVERY_FEE"));
});

test("includes Proof minimum top-ups in the idempotency identity", () => {
  const candidate = {
    id: "lime-juice",
    name: "Lime Juice",
    vendor: "Proof",
    vendorSku: "PROOF-LIME-12",
    casePackaged: true,
    shelfStable: true,
    packSize: 12,
    projectedPrepUseUnits: 24,
    unitCost: 5,
  };
  const withoutTopUp = buildVendorOrderDrafts(inventoryPlan({ estimatedCost: 300, unitCost: 25 }), options);
  const withTopUp = buildVendorOrderDrafts(inventoryPlan({ estimatedCost: 300, unitCost: 25 }), {
    ...options,
    proofMinimumCandidates: [candidate],
  });

  assert.notEqual(withTopUp.drafts[0].id, withoutTopUp.drafts[0].id);
});
