import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePmbPortionItem,
  pmbScaledPriceToCents,
  portionCentsToPmbScaledPrice,
  portionDollarsToCents,
  validatePmbPortionPriceUpdateInput,
  verifyPmbPortionFormTargets,
  verifyPmbPortionItems,
  verifyPmbPortionReadback,
  verifyPmbPortionTarget,
} from "../lib/pmb-portion-price-update.mjs";

const schema = {
  itemIdField: "item_id",
  quantityField: "portion_quantity",
  quantityDpField: "portion_quantity_dp",
};

const itemRows = [
  {
    item_id: 7001,
    product_plu: 5101,
    portion_name: "Single",
    portion_quantity: 150,
    portion_quantity_dp: 2,
    price: 800,
    price_dp: 2,
  },
  {
    item_id: 7002,
    product_plu: 5101,
    portion_name: "Double",
    portion_quantity: 300,
    portion_quantity_dp: 2,
    price: 1400,
    price_dp: 2,
  },
  {
    item_id: 8001,
    product_plu: 5200,
    portion_name: "Single",
    portion_quantity: 150,
    portion_quantity_dp: 2,
    price: 900,
    price_dp: 2,
  },
];

const tapRows = [
  { plu: 5101, deviceId: 9001, lineNum: 1, tapNumber: 1, product: "House Vodka", unused: false },
  { plu: 5101, deviceId: 9002, lineNum: 3, tapNumber: 83, product: "House Vodka", unused: false },
  { plu: 5200, deviceId: 9001, lineNum: 21, tapNumber: 21, product: "House Beer", unused: false },
];

const input = {
  kind: "liquor",
  plu: 5101,
  exactIdentity: {
    plu: 5101,
    deviceId: 9001,
    lineNum: 1,
    tapNumber: 1,
    name: "House Vodka",
  },
  expectedAssignments: [
    { deviceId: 9001, lineNum: 1, tapNumber: 1 },
    { deviceId: 9002, lineNum: 3, tapNumber: 83 },
  ],
  portions: [
    {
      itemId: "7001",
      name: "Single",
      quantityOz: 1.5,
      expectedPriceRaw: 800,
      priceDp: 2,
      expectedCurrentPrice: "8.00",
      newPrice: "9.00",
    },
    {
      itemId: "7002",
      name: "Double",
      quantityOz: 3,
      expectedPriceRaw: 1400,
      priceDp: 2,
      expectedCurrentPrice: "14.00",
      newPrice: "15.50",
    },
  ],
};

test("converts PMB scaled prices without losing precision", () => {
  assert.equal(pmbScaledPriceToCents(800, 2), 800);
  assert.equal(pmbScaledPriceToCents(8, 0), 800);
  assert.equal(portionCentsToPmbScaledPrice(1550, 2), 1550);
  assert.equal(portionDollarsToCents("15.50"), 1550);
  assert.throws(
    () => pmbScaledPriceToCents(123, 3),
    (error) => error.code === "PMB_PORTION_PRICE_PRECISION_UNSUPPORTED" && error.status === 503,
  );
  assert.throws(
    () => portionCentsToPmbScaledPrice(1550, 0),
    (error) => error.code === "PMB_PORTION_PRICE_PRECISION_UNSUPPORTED" && error.status === 400,
  );
});

test("requires controller-confirmed item ID and quantity fields", () => {
  assert.deepEqual(normalizePmbPortionItem(itemRows[0], schema), {
    itemId: "7001",
    productPlu: 5101,
    portionName: "Single",
    quantityOz: 1.5,
    priceRaw: 800,
    priceDp: 2,
    priceCents: 800,
  });
  assert.throws(
    () => normalizePmbPortionItem(itemRows[0], {}),
    (error) => error.code === "PMB_PORTION_SCHEMA_UNVERIFIED" && error.status === 503,
  );
  assert.throws(
    () => normalizePmbPortionItem({ ...itemRows[0], item_id: "" }, schema),
    (error) => error.code === "PMB_PORTION_ITEM_INVALID" && error.status === 503,
  );
});

test("validates a complete two-price tuple and permits intentional decreases", () => {
  assert.deepEqual(validatePmbPortionPriceUpdateInput(input), {
    kind: "liquor",
    identity: { plu: 5101, deviceId: 9001, lineNum: 1, tapNumber: 1, name: "House Vodka" },
    expectedAssignments: [
      { tapNumber: 1, deviceId: 9001, lineNum: 1 },
      { tapNumber: 83, deviceId: 9002, lineNum: 3 },
    ],
    portions: [
      {
        itemId: "7001",
        name: "Single",
        quantityOz: 1.5,
        expectedPriceRaw: 800,
        priceDp: 2,
        expectedCurrentPriceCents: 800,
        newPriceCents: 900,
        newPriceRaw: 900,
      },
      {
        itemId: "7002",
        name: "Double",
        quantityOz: 3,
        expectedPriceRaw: 1400,
        priceDp: 2,
        expectedCurrentPriceCents: 1400,
        newPriceCents: 1550,
        newPriceRaw: 1550,
      },
    ],
  });

  const decrease = validatePmbPortionPriceUpdateInput({
    ...input,
    portions: input.portions.map((portion, index) => ({
      ...portion,
      newPrice: index === 0 ? "7.50" : portion.expectedCurrentPrice,
    })),
  });
  assert.equal(decrease.portions[0].newPriceCents, 750);

  for (const invalidInput of [
    { ...input, kind: "cocktail" },
    { ...input, portions: input.portions.slice(0, 1) },
    { ...input, exactIdentity: { ...input.exactIdentity, tapNumber: 21 } },
    { ...input, expectedAssignments: [] },
    {
      ...input,
      portions: input.portions.map((portion) => ({ ...portion, newPrice: portion.expectedCurrentPrice })),
    },
    {
      ...input,
      portions: [input.portions[0], { ...input.portions[1], itemId: input.portions[0].itemId }],
    },
  ]) {
    assert.throws(() => validatePmbPortionPriceUpdateInput(invalidInput));
  }
});

test("re-verifies all physical assignments and refuses a PLU shared with a non-liquor tap", () => {
  const request = validatePmbPortionPriceUpdateInput(input);
  assert.deepEqual(verifyPmbPortionTarget(tapRows, request).affectedAssignments, [
    { plu: 5101, deviceId: 9001, lineNum: 1, tapNumber: 1, name: "House Vodka" },
    { plu: 5101, deviceId: 9002, lineNum: 3, tapNumber: 83, name: "House Vodka" },
  ]);

  assert.throws(
    () => verifyPmbPortionTarget(tapRows.slice(0, 1), request),
    (error) => error.code === "PMB_PORTION_ASSIGNMENTS_CHANGED" && error.status === 409,
  );
  assert.throws(
    () => verifyPmbPortionTarget([
      tapRows[0],
      { ...tapRows[1], tapNumber: 22 },
      tapRows[2],
    ], {
      ...request,
      expectedAssignments: [
        request.expectedAssignments[0],
        { ...request.expectedAssignments[1], tapNumber: 22 },
      ],
    }),
    (error) => error.code === "PMB_PORTION_SHARED_WITH_NON_LIQUOR_TAP" && error.status === 409,
  );
});

test("matches both live portion items by stable ID, never by array order", () => {
  const request = validatePmbPortionPriceUpdateInput(input);
  const verified = verifyPmbPortionItems([itemRows[1], itemRows[2], itemRows[0]], request, schema);
  assert.deepEqual(verified.map((item) => item.itemId), ["7002", "7001"]);

  assert.throws(
    () => verifyPmbPortionItems([itemRows[0], { ...itemRows[1], price: 1450 }], request, schema),
    (error) => error.code === "PMB_PORTION_PRICE_STALE" && error.status === 409,
  );
  assert.throws(
    () => verifyPmbPortionItems([
      itemRows[0],
      { ...itemRows[1], item_id: 7003 },
    ], request, schema),
    (error) => error.code === "PMB_PORTION_IDENTITY_CHANGED" && error.status === 409,
  );
  assert.throws(
    () => verifyPmbPortionItems([...itemRows.slice(0, 2), { ...itemRows[0], item_id: 7004 }], request, schema),
    (error) => error.code === "PMB_PORTION_SET_CHANGED" && error.status === 409,
  );
});

test("verifies an exact management-form mapping before producing price edits", () => {
  const request = validatePmbPortionPriceUpdateInput(input);
  const formTargets = [
    {
      controlKey: "portion-price-7002",
      itemId: "7002",
      productPlu: 5101,
      portionName: "Double",
      quantityOz: 3,
      currentPriceRaw: 1400,
      priceDp: 2,
    },
    {
      controlKey: "portion-price-7001",
      itemId: "7001",
      productPlu: 5101,
      portionName: "Single",
      quantityOz: 1.5,
      currentPriceRaw: 800,
      priceDp: 2,
    },
  ];
  assert.deepEqual(verifyPmbPortionFormTargets(formTargets, request), [
    {
      controlKey: "portion-price-7001",
      itemId: "7001",
      previousPriceRaw: 800,
      newPriceRaw: 900,
      priceDp: 2,
    },
    {
      controlKey: "portion-price-7002",
      itemId: "7002",
      previousPriceRaw: 1400,
      newPriceRaw: 1550,
      priceDp: 2,
    },
  ]);

  assert.throws(
    () => verifyPmbPortionFormTargets(formTargets.slice(0, 1), request),
    (error) => error.code === "PMB_PORTION_FORM_UNVERIFIED" && error.status === 503,
  );
  assert.throws(
    () => verifyPmbPortionFormTargets([
      formTargets[0],
      { ...formTargets[1], currentPriceRaw: 801 },
    ], request),
    (error) => error.code === "PMB_PORTION_FORM_TARGET_MISMATCH" && error.status === 409,
  );
  assert.throws(
    () => verifyPmbPortionFormTargets([
      formTargets[0],
      { ...formTargets[1], quantityOz: "not-a-quantity" },
    ], request),
    (error) => error.code === "PMB_PORTION_FORM_TARGET_MISMATCH" && error.status === 409,
  );
});

test("requires exact readback of both portion item IDs and prices", () => {
  const request = validatePmbPortionPriceUpdateInput(input);
  const savedRows = [
    { ...itemRows[0], price: 900 },
    { ...itemRows[1], price: 1550 },
  ];
  assert.equal(verifyPmbPortionReadback(savedRows, request, schema).length, 2);
  assert.throws(
    () => verifyPmbPortionReadback([{ ...savedRows[0], price: 899 }, savedRows[1]], request, schema),
    (error) => error.code === "PMB_PORTION_READBACK_FAILED" && error.status === 502,
  );
});
