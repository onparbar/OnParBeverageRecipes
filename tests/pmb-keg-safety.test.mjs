import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerifiedKegSlotMap,
  requireKegTargetIdentity,
  requireSuccessfulKegLevelResponse,
  verifyExactKegTarget,
  verifyUniqueKegProductAssignment,
} from "../lib/pmb-keg-safety.mjs";

const validRows = [
  {
    plu: 4101,
    deviceId: 9001,
    lineNum: 1,
    tapNumber: 12,
    product: "Test IPA",
    unused: false,
  },
  {
    plu: 4102,
    deviceId: 9001,
    lineNum: 2,
    tapNumber: 13,
    product: "Test Lager",
    unused: false,
  },
  {
    plu: 4101,
    deviceId: 9002,
    lineNum: 4,
    tapNumber: 40,
    product: "Test IPA",
    unused: false,
  },
  {
    plu: null,
    deviceId: 9001,
    lineNum: 3,
    product: "Unused",
    unused: true,
  },
];

test("builds keg slots only from exact live PMB tap configuration", () => {
  const slots = buildVerifiedKegSlotMap(validRows);
  assert.equal(slots.size, 3);
  assert.deepEqual(slots.get("tap:12"), {
    plu: 4101,
    deviceId: 9001,
    lineNum: 1,
    tapNumber: 12,
    product: "Test IPA",
    slotKey: "tap:12",
  });
  assert.deepEqual(slots.get("tap:40"), {
    plu: 4101,
    deviceId: 9002,
    lineNum: 4,
    tapNumber: 40,
    product: "Test IPA",
    slotKey: "tap:40",
  });
});

test("fails closed when tap configuration is unavailable or incomplete", () => {
  assert.throws(
    () => buildVerifiedKegSlotMap([]),
    (error) => error.code === "PMB_TAP_CONFIG_UNAVAILABLE" && error.status === 503,
  );
  assert.throws(
    () => buildVerifiedKegSlotMap([
      { plu: 4101, deviceId: 9001, lineNum: 0, product: "Test IPA", unused: false },
    ]),
    (error) => error.code === "PMB_TAP_CONFIG_UNAVAILABLE" && error.status === 503,
  );
});

test("allows one PLU on multiple physical taps but rejects ambiguous tap identities", () => {
  assert.throws(
    () => buildVerifiedKegSlotMap([
      validRows[0],
      { ...validRows[0], deviceId: 9002, lineNum: 7 },
    ]),
    (error) => error.code === "PMB_TAP_CONFIG_AMBIGUOUS" && error.status === 503,
  );
  assert.throws(
    () => buildVerifiedKegSlotMap([
      validRows[0],
      { ...validRows[1], lineNum: 1, tapNumber: 14 },
    ]),
    (error) => error.code === "PMB_TAP_CONFIG_AMBIGUOUS" && error.status === 503,
  );
});

test("requires PLU, device ID, and line number for every adjustment", () => {
  assert.deepEqual(
    requireKegTargetIdentity({ plu: "4101", deviceId: "9001", lineNum: "1" }),
    { plu: 4101, deviceId: 9001, lineNum: 1 },
  );
  assert.throws(
    () => requireKegTargetIdentity({ deviceId: 9001, lineNum: 1 }),
    (error) => error.code === "PMB_TAP_TARGET_REQUIRED" && error.status === 400,
  );
});

test("accepts only an exact PLU/device/line tuple from a fresh config", () => {
  assert.deepEqual(
    verifyExactKegTarget(validRows, { plu: 4101, deviceId: 9001, lineNum: 1 }),
    {
      plu: 4101,
      deviceId: 9001,
      lineNum: 1,
      tapNumber: 12,
      product: "Test IPA",
      slotKey: "tap:12",
    },
  );
  assert.deepEqual(
    verifyExactKegTarget(validRows, { plu: 4101, deviceId: 9002, lineNum: 4 }),
    {
      plu: 4101,
      deviceId: 9002,
      lineNum: 4,
      tapNumber: 40,
      product: "Test IPA",
      slotKey: "tap:40",
    },
  );

  assert.throws(
    () => verifyExactKegTarget(validRows, { plu: 4101, deviceId: 9001, lineNum: 2 }),
    (error) => (
      error.code === "PMB_TAP_TARGET_MISMATCH"
      && error.status === 409
      && error.details.currentTargets.length === 2
    ),
  );
});

test("allows a product rewrite only when its PLU belongs to one physical tap", () => {
  assert.deepEqual(
    verifyUniqueKegProductAssignment(validRows, { plu: 4102, deviceId: 9001, lineNum: 2 }),
    {
      plu: 4102,
      deviceId: 9001,
      lineNum: 2,
      tapNumber: 13,
      product: "Test Lager",
      slotKey: "tap:13",
    },
  );

  assert.throws(
    () => verifyUniqueKegProductAssignment(validRows, { plu: 4101, deviceId: 9001, lineNum: 1 }),
    (error) => error.code === "PMB_PRODUCT_ASSIGNMENT_AMBIGUOUS" && error.status === 409,
  );
});

test("checks every PMB keg-level response status before using its body", () => {
  const response = {
    status: 200,
    json: {
      fill_level_perc: 7250,
      fill_level_keg_size: 1984,
      fill_level_keg_size_dp: 0,
    },
  };
  assert.equal(
    requireSuccessfulKegLevelResponse(response, { deviceId: 9001, lineNum: 1 }),
    response.json,
  );

  assert.throws(
    () => requireSuccessfulKegLevelResponse(
      { status: 500, json: { fill_level_perc: 9900 } },
      { deviceId: 9001, lineNum: 1 },
    ),
    (error) => (
      error.code === "PMB_KEG_LEVEL_READ_FAILED"
      && error.status === 503
      && error.details.upstreamStatus === 500
    ),
  );

  assert.throws(
    () => requireSuccessfulKegLevelResponse(
      {
        status: 200,
        json: {
          fill_level_perc: "not-a-level",
          fill_level_keg_size: 1984,
          fill_level_keg_size_dp: 0,
        },
      },
      { deviceId: 9001, lineNum: 1 },
    ),
    (error) => (
      error.code === "PMB_KEG_LEVEL_READ_FAILED"
      && error.status === 503
      && error.details.failureReason.includes("fill_level_perc")
    ),
  );
  assert.throws(
    () => requireSuccessfulKegLevelResponse(
      { status: 200, json: { fill_level_perc: "", fill_level_keg_size: 1984, fill_level_keg_size_dp: 0 } },
      { deviceId: 9001, lineNum: 1 },
    ),
    (error) => error.code === "PMB_KEG_LEVEL_READ_FAILED" && error.status === 503,
  );

  const displayOnlyResponse = {
    status: 200,
    json: {
      fill_level_perc: 7250,
      fill_level_keg_size: 0,
      fill_level_keg_size_dp: 0,
    },
  };
  assert.equal(
    requireSuccessfulKegLevelResponse(
      displayOnlyResponse,
      { deviceId: 9001, lineNum: 1 },
      { requireKegSize: false },
    ),
    displayOnlyResponse.json,
  );
  assert.throws(
    () => requireSuccessfulKegLevelResponse(
      displayOnlyResponse,
      { deviceId: 9001, lineNum: 1 },
    ),
    (error) => error.code === "PMB_KEG_LEVEL_READ_FAILED" && error.status === 503,
  );
});
