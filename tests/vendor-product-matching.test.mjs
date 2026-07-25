import assert from "node:assert/strict";
import test from "node:test";

import { selectBottleCandidate } from "../lib/vendor-product-matching.mjs";

function inventoryProduct({ id, size, bottleOz, sku, price }) {
  return {
    product: { id, container_size: size },
    bottleOz,
    sizeLabel: size.toLowerCase(),
    inventory: { sku, unit_price: price },
  };
}

test("preferred SKU wins when OHLQ returns same-size products with different prices", () => {
  const products = [
    inventoryProduct({ id: 1643945, size: "1.75 L", bottleOz: 59.1745, sku: "1683D", price: 25.85 }),
    inventoryProduct({ id: 138177, size: "1.75 L", bottleOz: 59.1745, sku: "9232D", price: 34.78 }),
  ];

  const match = selectBottleCandidate(products, {
    targetBottleOz: 59.17,
    preferredSku: "9232D",
    expectedSizeLabel: "1.75 L",
  });

  assert.equal(match.inventory.sku, "9232D");
  assert.equal(match.inventory.unit_price, 34.78);
});

test("mapped bottle products do not fall back to a different size", () => {
  const products = [
    inventoryProduct({ id: 274645, size: "1 L", bottleOz: 33.814, sku: "TITO-1L", price: 25.38 }),
    inventoryProduct({ id: 51483, size: "750 mL", bottleOz: 25.3605, sku: "TITO-750", price: 18.8 }),
  ];

  assert.equal(
    selectBottleCandidate(products, {
      targetBottleOz: 59.17,
      expectedSizeLabel: "1.75 L",
    }),
    null,
  );
});
