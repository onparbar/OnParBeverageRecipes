import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWeeklyUsageTapReplacementSafety,
  buildPhysicalWeeklyUsageItems,
  buildWeeklyUsageTapContext,
  requirePlausibleWeeklyTransactions,
} from "../lib/pmb-weekly-usage-identity.mjs";

function tap(tapNumber, plu, name, deviceId = 1000 + tapNumber, lineNum = 1) {
  return {
    tapNumber,
    plu,
    name,
    brand: name,
    templateBrand: name,
    wall: tapNumber < 73 ? "Main" : "Karaoke",
    type: "Lager",
    deviceId,
    lineNum,
  };
}

function context(taps) {
  return buildWeeklyUsageTapContext(taps, {
    byExactAlias: new Map(),
    byLooseAlias: new Map(),
  });
}

test("keeps duplicate PLUs separate when PMB supplies tap identity", () => {
  const taps = [tap(21, 500, "House Beer 1"), tap(73, 500, "House Beer 2")];
  const items = buildPhysicalWeeklyUsageItems([
    { plu: 500, tap_number: 21, volume_amount: 100 },
    { plu: 500, tap_number: 73, volume_amount: 250 },
  ], new Map([[500, { name: "House Beer" }]]), context(taps));

  assert.deepEqual(items.map((item) => [item.tapNumber, item.volumeOz]), [
    [21, 100],
    [73, 250],
  ]);
});

test("resolves a transaction by device and line", () => {
  const taps = [tap(21, 500, "House Beer 1", 9001, 2), tap(73, 500, "House Beer 2", 9002, 3)];
  const items = buildPhysicalWeeklyUsageItems([
    { plu: 500, device_id: 9002, line_num: 3, volume_amount: 125 },
  ], new Map([[500, { name: "House Beer" }]]), context(taps));

  assert.equal(items.find((item) => item.tapNumber === 73)?.volumeOz, 125);
  assert.equal(items.find((item) => item.tapNumber === 21)?.volumeOz, 0);
});

test("fails closed when an aggregate duplicate PLU cannot be assigned to a physical tap", () => {
  const taps = [tap(21, 500, "House Beer 1"), tap(73, 500, "House Beer 2")];
  assert.throws(
    () => buildPhysicalWeeklyUsageItems(
      [{ plu: 500, volume_amount: 350 }],
      new Map([[500, { name: "House Beer" }]]),
      context(taps),
    ),
    (error) => error?.code === "PMB_WEEKLY_USAGE_AMBIGUOUS_TAP" && /taps 21, 73/.test(error.message),
  );
});

test("fails closed when transaction identity conflicts with the live PLU", () => {
  const taps = [tap(21, 500, "House Beer"), tap(22, 600, "Other Beer")];
  assert.throws(
    () => buildPhysicalWeeklyUsageItems(
      [{ plu: 500, tap_number: 22, volume_amount: 100 }],
      new Map([[500, { name: "House Beer" }]]),
      context(taps),
    ),
    (error) => error?.code === "PMB_WEEKLY_USAGE_TAP_MISMATCH",
  );
});

test("maps a unique PLU and emits explicit zero rows for every current tap", () => {
  const taps = [tap(21, 500, "House Beer"), tap(22, 600, "Other Beer")];
  const items = buildPhysicalWeeklyUsageItems(
    [{ plu: 500, volume_amount: 75 }],
    new Map([[500, { name: "House Beer" }], [600, { name: "Other Beer" }]]),
    context(taps),
  );
  assert.deepEqual(items.map((item) => [item.tapNumber, item.volumeOz]), [
    [21, 75],
    [22, 0],
  ]);
});

test("requires explicit owner review instead of silently synthesizing an all-zero completed week", () => {
  assert.throws(
    () => requirePlausibleWeeklyTransactions([], { label: "8/3/26 - 8/9/26" }),
    (error) => error?.code === "PMB_WEEKLY_USAGE_REVIEW_REQUIRED" && error?.status === 409,
  );
  assert.throws(
    () => requirePlausibleWeeklyTransactions([{ plu: 500, volume_amount: 0 }]),
    (error) => error?.code === "PMB_WEEKLY_USAGE_REVIEW_REQUIRED",
  );
  assert.equal(
    requirePlausibleWeeklyTransactions(
      [{ plu: 500, volume_amount: 0 }],
      { allowReviewedSparseWeek: true },
    ).length,
    1,
  );
  assert.equal(
    requirePlausibleWeeklyTransactions([{ plu: 500, volume_amount: 12 }]).length,
    1,
  );
});

test("rejects malformed PMB rows even when another row contains a valid pour", () => {
  assert.throws(
    () => requirePlausibleWeeklyTransactions([
      { plu: 500, volume_amount: 12 },
      { plu: "not-a-plu", volume_amount: 4 },
      { plu: 600 },
    ]),
    (error) => (
      error?.code === "PMB_WEEKLY_USAGE_SCHEMA_INVALID"
      && error?.details?.invalidTransactionCount === 2
    ),
  );
});

test("requires review for a suspiciously sparse week and accepts the exact reviewed rows", () => {
  const rows = [{ plu: "500", volume_amount: "12.5" }];
  assert.throws(
    () => requirePlausibleWeeklyTransactions(rows, { minimumPositiveRows: 5 }),
    (error) => (
      error?.code === "PMB_WEEKLY_USAGE_REVIEW_REQUIRED"
      && error?.details?.reason === "sparse"
      && error?.details?.positiveRowCount === 1
    ),
  );
  assert.equal(
    requirePlausibleWeeklyTransactions(rows, {
      minimumPositiveRows: 5,
      allowReviewedSparseWeek: true,
    }),
    rows,
  );
});

test("weekly usage applies verified beer-to-cocktail replacement kind before conversion", () => {
  const current = tap(21, 500, "House Cocktail 1");
  const [updated] = applyWeeklyUsageTapReplacementSafety([current], {
    "main-21-house-beer-1": {
      tapNumber: 21,
      oldBrand: "House Beer 1",
      oldPlu: 400,
      newBrand: "House Cocktail 1",
      newPlu: 500,
      newKind: "cocktail",
      replacedAt: "2026-08-12T15:30:00.000Z",
    },
  });
  assert.equal(updated.type, "Cocktail");
});

test("weekly usage applies verified cocktail-to-beer replacement kind before conversion", () => {
  const current = tap(21, 500, "House Beer 1");
  current.type = "Cocktail";
  const [updated] = applyWeeklyUsageTapReplacementSafety([current], {
    "main-21-house-cocktail-1": {
      tapNumber: 21,
      oldBrand: "House Cocktail 1",
      oldPlu: 400,
      newBrand: "House Beer 1",
      newPlu: 500,
      newKind: "beer",
      replacedAt: "2026-08-12T15:30:00.000Z",
    },
  });
  assert.equal(updated.type, "Beer");
});

test("weekly usage fails closed when same-PLU history lacks an approved boundary", () => {
  const current = tap(21, 500, "New Beer 1");
  const replacements = {
    "main-21-old-beer-1": {
      tapNumber: 21,
      oldBrand: "Old Beer 1",
      oldPlu: 500,
      newBrand: "New Beer 1",
      newPlu: 500,
      newKind: "beer",
      replacedAt: "2026-08-12T15:30:00.000Z",
    },
  };
  assert.throws(
    () => applyWeeklyUsageTapReplacementSafety([current], replacements),
    (error) => error.code === "TAP_REPLACEMENT_HISTORY_UNSAFE" && error.status === 409,
  );
  assert.equal(applyWeeklyUsageTapReplacementSafety([current], replacements, [{
    tapNumber: 21,
    currentName: "New Beer",
    effectiveDate: "2026-08-12",
    splitWeek: "current",
  }])[0].type, "Beer");
});
