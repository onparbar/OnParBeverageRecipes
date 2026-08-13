import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPmbPriceOnlyEditEntries,
  getUniquePmbProduct,
  parsePmbProductEditForm,
  validatePmbPriceUpdateInput,
  verifyPmbPriceReadback,
  verifyPmbPriceTarget,
} from "../lib/pmb-price-update.mjs";

const input = {
  plu: 4101,
  kind: "beer",
  expectedCurrentPricePerOz: "0.72",
  newPricePerOz: "0.78",
  exactIdentity: {
    tapNumber: 25,
    deviceId: 9001,
    lineNum: 2,
    name: "Test IPA",
  },
  expectedAssignments: [
    { tapNumber: 25, deviceId: 9001, lineNum: 2 },
    { tapNumber: 54, deviceId: 9002, lineNum: 4 },
  ],
};

const rows = [
  { plu: 4101, deviceId: 9001, lineNum: 2, tapNumber: 25, product: "Test IPA", unused: false },
  { plu: 4101, deviceId: 9002, lineNum: 4, tapNumber: 54, product: "Test IPA", unused: false },
  { plu: 4200, deviceId: 9002, lineNum: 5, tapNumber: 55, product: "Other Beer", unused: false },
];

const product = {
  plu: 4101,
  name: "Test IPA",
  product_type: 1,
  price_per_unit: 72,
};

test("accepts only a strict beer or cocktail price increase with exact identity", () => {
  assert.deepEqual(validatePmbPriceUpdateInput(input), {
    kind: "beer",
    identity: { plu: 4101, deviceId: 9001, lineNum: 2, tapNumber: 25, name: "Test IPA" },
    expectedCurrentPriceCents: 72,
    newPriceCents: 78,
    expectedAssignments: [
      { tapNumber: 25, deviceId: 9001, lineNum: 2 },
      { tapNumber: 54, deviceId: 9002, lineNum: 4 },
    ],
  });

  for (const invalid of [
    { ...input, kind: "liquor" },
    { ...input, kind: "wine" },
    { ...input, newPricePerOz: "0.72" },
    { ...input, newPricePerOz: "0.70" },
    { ...input, newPricePerOz: "0.781" },
    { ...input, exactIdentity: { ...input.exactIdentity, tapNumber: 5 } },
    { ...input, expectedAssignments: [] },
  ]) {
    assert.throws(() => validatePmbPriceUpdateInput(invalid));
  }
});

test("re-verifies the exact physical tap and returns every live assignment sharing its PLU", () => {
  const request = validatePmbPriceUpdateInput(input);
  assert.deepEqual(verifyPmbPriceTarget(rows, request).affectedAssignments, [
    { plu: 4101, deviceId: 9001, lineNum: 2, tapNumber: 25, name: "Test IPA" },
    { plu: 4101, deviceId: 9002, lineNum: 4, tapNumber: 54, name: "Test IPA" },
  ]);

  assert.throws(
    () => verifyPmbPriceTarget(rows, validatePmbPriceUpdateInput({
      ...input,
      exactIdentity: { ...input.exactIdentity, tapNumber: 26 },
    })),
    (error) => error.status === 409 && error.code === "PMB_PRICE_TAP_NUMBER_MISMATCH",
  );
  assert.throws(
    () => verifyPmbPriceTarget(rows, validatePmbPriceUpdateInput({
      ...input,
      exactIdentity: { ...input.exactIdentity, name: "Different Beer" },
    })),
    (error) => error.status === 409 && error.code === "PMB_PRICE_PRODUCT_NAME_MISMATCH",
  );
  assert.throws(
    () => verifyPmbPriceTarget(rows.slice(0, 1), request),
    (error) => error.status === 409 && error.code === "PMB_PRICE_ASSIGNMENTS_CHANGED",
  );
  assert.throws(
    () => verifyPmbPriceTarget([
      rows[0],
      { plu: 4101, deviceId: 9002, lineNum: 4, tapNumber: null, product: "Test IPA", unused: false },
    ], request),
    (error) => error.status === 409 && error.code === "PMB_PRICE_ASSIGNMENT_INCOMPLETE",
  );
});

test("fails closed for stale, missing, duplicate, or wrong-kind product records", () => {
  const request = validatePmbPriceUpdateInput(input);
  assert.equal(getUniquePmbProduct([product], request), product);
  assert.throws(
    () => getUniquePmbProduct([{ ...product, price_per_unit: 73 }], request),
    (error) => error.status === 409 && error.code === "PMB_PRICE_STALE",
  );
  assert.throws(
    () => getUniquePmbProduct([], request),
    (error) => error.status === 409 && error.code === "PMB_PRICE_PRODUCT_AMBIGUOUS",
  );
  assert.throws(
    () => getUniquePmbProduct([product, { ...product }], request),
    (error) => error.status === 409 && error.code === "PMB_PRICE_PRODUCT_AMBIGUOUS",
  );
  assert.throws(
    () => getUniquePmbProduct([{ ...product, product_type: 3 }], request),
    (error) => error.status === 409 && error.code === "PMB_PRICE_PRODUCT_KIND_MISMATCH",
  );
});

const editForm = `
  <form action="/pages/products" method="post">
    <input type="hidden" name="fd_plu" value="4101">
    <input type="text" name="fd_name" value="Test IPA">
    <textarea name="fd_tasting_notes">Hoppy &amp; bright</textarea>
    <input type="text" name="fd_price_per_unit" value="0.72">
    <input type="text" name="fd_price_per_unit_hh1" value="0.61">
    <input type="text" name="fd_price_per_unit_hh1_percent" value="15">
    <input type="text" name="fd_price_per_unit_hh2" value="0.50">
    <input type="text" name="fd_price_per_unit_hh2_percent" value="30">
    <input type="checkbox" name="fd_is_active" checked>
    <input type="checkbox" name="fd_hidden" value="1">
    <select name="fd_product_type"><option value="1" selected>Beer</option><option value="3">Cocktail</option></select>
    <input type="file" name="file">
    <button name="fd_delete_image">Delete</button>
    <button name="submit_delete_product">Delete product</button>
    <input type="submit" name="submit_saveedit_product" value="save">
  </form>`;

test("copies the live PMB edit form and changes only the normal price field", () => {
  const before = parsePmbProductEditForm(editForm);
  const after = buildPmbPriceOnlyEditEntries(editForm, {
    plu: 4101,
    currentPriceCents: 72,
    newPriceCents: 78,
  });
  const beforeMap = new Map(before);
  const afterMap = new Map(after);
  assert.equal(afterMap.get("fd_price_per_unit"), "0.78");
  assert.equal(afterMap.get("fd_price_per_unit_hh1"), "0.61");
  assert.equal(afterMap.get("fd_price_per_unit_hh1_percent"), "15");
  assert.equal(afterMap.get("fd_price_per_unit_hh2"), "0.50");
  assert.equal(afterMap.get("fd_price_per_unit_hh2_percent"), "30");
  assert.equal(afterMap.get("fd_tasting_notes"), "Hoppy & bright");
  assert.equal(afterMap.get("fd_product_type"), "1");
  assert.equal(afterMap.get("fd_is_active"), "on");
  assert.equal(beforeMap.has("fd_hidden"), false);
  assert.equal(afterMap.has("file"), false);
  assert.equal(afterMap.has("fd_delete_image"), false);
  assert.equal(afterMap.has("submit_delete_product"), false);
  assert.equal(afterMap.get("submit_saveedit_product"), "save");
});

test("requires one edit form, its expected PLU/current price, and exact readback", () => {
  assert.throws(() => parsePmbProductEditForm("<p>not a form</p>"));
  assert.throws(
    () => buildPmbPriceOnlyEditEntries(editForm, { plu: 4102, currentPriceCents: 72, newPriceCents: 78 }),
    (error) => error.status === 409 && error.code === "PMB_PRICE_EDIT_FORM_TARGET_MISMATCH",
  );
  assert.throws(
    () => buildPmbPriceOnlyEditEntries(editForm, { plu: 4101, currentPriceCents: 73, newPriceCents: 78 }),
    (error) => error.status === 409 && error.code === "PMB_PRICE_STALE",
  );
  assert.equal(verifyPmbPriceReadback([{ ...product, price_per_unit: 78 }], { plu: 4101, newPriceCents: 78 }).price_per_unit, 78);
  assert.throws(
    () => verifyPmbPriceReadback([{ ...product, price_per_unit: 77 }], { plu: 4101, newPriceCents: 78 }),
    (error) => error.status === 502 && error.code === "PMB_PRICE_READBACK_FAILED",
  );
});
