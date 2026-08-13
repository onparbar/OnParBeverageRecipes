import assert from "node:assert/strict";
import test from "node:test";

import {
  buildShotPricingRows,
  isShotPricingTap,
  summarizeShotPricingRows,
  validateShotPricePair,
} from "../public/shot-pricing-view.mjs";

const verified = {
  tapPosition: 1,
  wall: "Patio",
  plu: 5101,
  name: "House Vodka",
  isCurrentTap: true,
  assignments: [{ tapNumber: 1, deviceId: 9001, lineNum: 1 }],
  portions: [
    { name: "Single", price: 8, itemId: "7001", quantityOz: 1.5, priceRaw: 800, priceDp: 2 },
    { name: "Double", price: 14, itemId: "7002", quantityOz: 3, priceRaw: 1400, priceDp: 2 },
  ],
};

test("recognizes only configured liquor tap ranges", () => {
  assert.equal(isShotPricingTap(1), true);
  assert.equal(isShotPricingTap(92), true);
  assert.equal(isShotPricingTap(21), false);
  assert.equal(isShotPricingTap(82), false);
});

test("requires both stable portion identities and an enabled write adapter", () => {
  const [ready] = buildShotPricingRows([verified], { writeAvailable: true });
  assert.equal(ready.canEdit, true);

  const [schemaBlocked] = buildShotPricingRows([{ ...verified, portions: verified.portions.map(({ itemId, ...portion }) => portion) }], {
    writeAvailable: true,
  });
  assert.equal(schemaBlocked.canEdit, false);
  assert.match(schemaBlocked.blockers.join(" "), /identity verification/i);

  const [adapterBlocked] = buildShotPricingRows([verified], {
    writeAvailable: false,
    message: "Adapter needs verification.",
  });
  assert.equal(adapterBlocked.canEdit, false);
  assert.match(adapterBlocked.blockers.join(" "), /Adapter needs verification/);
});

test("filters non-liquor rows and deduplicates products shared across liquor walls", () => {
  const rows = buildShotPricingRows([
    verified,
    { ...verified, tapPosition: 83 },
    { ...verified, tapPosition: 21, plu: 6000 },
  ], { writeAvailable: true });
  assert.equal(rows.length, 1);
  assert.deepEqual(summarizeShotPricingRows(rows), { total: 1, editable: 1, setupRequired: 0, blocked: 0 });
});

test("validates the complete pair and allows intentional increases or decreases", () => {
  const [row] = buildShotPricingRows([verified], { writeAvailable: true });
  assert.deepEqual(validateShotPricePair(row, ["7.50", "15.00"]), {
    valid: true,
    cents: [750, 1500],
  });
  assert.equal(validateShotPricePair(row, ["8.00", "14.00"]).valid, false);
  assert.equal(validateShotPricePair(row, ["8.001", "14.00"]).valid, false);
  assert.equal(validateShotPricePair(row, ["", "14.00"]).valid, false);
});
