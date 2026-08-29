import test from "node:test";
import assert from "node:assert/strict";

import { buildWeeklyPlanPresentationModel } from "../public/weekly-plan-presentation-model.mjs";

function buildModel(overrides = {}) {
  return buildWeeklyPlanPresentationModel({
    plan: {
      summary: {
        cocktailKegTotal: 4,
      },
    },
    vendorOrderModel: {
      drafts: [
        {
          lines: [
            { lineType: "Beer keg", requestedUnits: "2", unitCost: 120 },
            { lineType: "Liquor tap bottle", requestedUnits: "3", unitCost: 0 },
          ],
        },
        {
          lines: [
            { lineType: "Inventory", requestedUnits: 1, unitCost: 15 },
            {
              lineType: "Inventory",
              requestedUnits: 1,
              unitCost: 0,
              excludeFromOrderCost: true,
            },
          ],
        },
      ],
      weeklyTotal: 255,
    },
    planLocked: false,
    isMonday: false,
    ...overrides,
  });
}

test("builds the Weekly Plan display summary from active vendor lines", () => {
  const model = buildModel();

  assert.equal(model.activeOrderLines.length, 4);
  assert.deepEqual(model.summary, {
    cocktailKegTotal: 4,
    orderLineCount: 4,
    beerKegTotal: 2,
    liquorTapBottleTotal: 3,
    estimatedKnownPurchaseCost: 255,
    missingPriceCount: 1,
    estimatedPurchaseCostComplete: false,
  });
  assert.equal(
    model.priceNote,
    "1 active line is missing a price. The total shown is the known-price subtotal, not a complete spend total.",
  );
});

test("excludes non-costed lines from missing-price warnings", () => {
  const model = buildModel({
    vendorOrderModel: {
      drafts: [{
        lines: [{
          lineType: "Inventory",
          requestedUnits: 1,
          unitCost: 0,
          excludeFromOrderCost: true,
        }],
      }],
      weeklyTotal: 0,
    },
  });

  assert.equal(model.summary.missingPriceCount, 0);
  assert.equal(model.summary.estimatedPurchaseCostComplete, true);
  assert.equal(model.priceNote, "");
});

test("identifies when an unlocked plan needs a late-snapshot reason", () => {
  const lateLive = buildModel();
  assert.equal(lateLive.requiresLateSnapshotReason, true);

  const mondayLive = buildModel({ isMonday: true });
  assert.equal(mondayLive.requiresLateSnapshotReason, false);

  const locked = buildModel({ planLocked: true });
  assert.equal(locked.requiresLateSnapshotReason, false);
});
