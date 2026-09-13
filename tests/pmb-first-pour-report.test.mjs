import test from "node:test";
import assert from "node:assert/strict";
import { findFirstPourInRange, getFirstPourWindow, pmbLocalMidnight, summarizeFirstPourTransactions } from "../lib/pmb-first-pour-report.mjs";

const target = { tapNumber: 48, deviceId: 9001, lineNum: 1, plu: 54705, product: "Bacardi Sunset 1" };
const now = new Date("2026-09-13T12:00:00Z");

test("first-pour ranges are valid, bounded, and not in the future", () => {
  assert.equal(getFirstPourWindow("2026-08-01", "2026-08-31", now).end - Date.parse("2026-08-01"), 31 * 86400000);
  for (const [start, end] of [["2026-02-30", "2026-03-01"], ["2026-07-01", "2026-08-31"], ["2026-09-14", "2026-09-14"]]) {
    assert.throws(() => getFirstPourWindow(start, end, now));
  }
});

test("PMB day boundaries honor Eastern DST transitions", () => {
  assert.equal(pmbLocalMidnight(Date.parse("2026-03-08")), "2026-03-08T00:00:00-05:00");
  assert.equal(pmbLocalMidnight(Date.parse("2026-03-09")), "2026-03-09T00:00:00-04:00");
  assert.equal(pmbLocalMidnight(Date.parse("2026-11-01")), "2026-11-01T00:00:00-04:00");
  assert.equal(pmbLocalMidnight(Date.parse("2026-11-02")), "2026-11-02T00:00:00-05:00");
});

test("zero pours and other products or physical taps cannot establish a first pour", () => {
  const summary = summarizeFirstPourTransactions([
    { plu: 54705, volume_amount: 0, tap_number: 48 },
    { plu: 54705, volume_amount: 10, tap_number: 49 },
    { plu: 999, volume_amount: 10, tap_number: 48 },
    { plu: 54705, volume_amount: 10, device_id: 9002, line_num: 1 },
    { plu: 54705, volume_amount: 4, device_id: 9001, line_num: 1 },
  ], target);
  assert.equal(summary.matchedRows, 1);
  assert.equal(summary.physicalTapRows, 1);
  assert.equal(summary.volumeOz, 4);
});

test("product-only evidence is explicitly distinguished from historical tap evidence", () => {
  assert.equal(summarizeFirstPourTransactions([{ plu: 54705, volume_amount: 4 }], target).productOnlyRows, 1);
  assert.throws(() => summarizeFirstPourTransactions([{ plu: 54705, volume_amount: null }], target));
  assert.throws(() => summarizeFirstPourTransactions(null, target));
});

test("binary date search finds the first positive day without transaction timestamps", async () => {
  const pours = ["2026-08-29T20:42:00Z", "2026-08-30T19:00:00Z"];
  const result = await findFirstPourInRange({ target, startDate: "2026-08-01", endDate: "2026-08-31", now,
    readTransactions: async ({ start_time, end_time }) => pours
      .filter((date) => Date.parse(date) >= Date.parse(start_time) && Date.parse(date) < Date.parse(end_time))
      .map(() => ({ plu: 54705, tap_number: 48, volume_amount: 4 })),
  });
  assert.equal(result.firstRecordedPourDate, "2026-08-29");
  assert.equal(result.identityEvidence, "physical-tap-and-product-plu");
  assert.equal(result.firstEverVerified, false);
  assert.ok(result.reportRequests <= 7);
});

test("empty history remains no recorded pour, not an invented date", async () => {
  const result = await findFirstPourInRange({ target, startDate: "2026-08-01", endDate: "2026-08-31", now,
    readTransactions: async () => [],
  });
  assert.equal(result.firstRecordedPourDate, null);
  assert.equal(result.reportRequests, 1);
});

test("timestamp evidence excludes customer and payment values", () => {
  const result = summarizeFirstPourTransactions([{
    plu: 54705, volume_amount: 4, time: "2026-08-29T12:00:00",
    customer_name: "private customer", card_id: "private card",
  }], target);
  assert.deepEqual(result.timestampSamples, [{ time: "2026-08-29T12:00:00" }]);
  assert.ok(!JSON.stringify(result).includes("private customer"));
  assert.ok(!JSON.stringify(result).includes("private card"));
});

test("report failures and inconsistent date windows do not silently advance the start", async () => {
  let calls = 0;
  await assert.rejects(findFirstPourInRange({ target, startDate: "2026-08-01", endDate: "2026-08-02", now,
    readTransactions: async () => ++calls === 1 ? [{ plu: 54705, volume_amount: 4 }] : [],
  }), /disagreed/);
  await assert.rejects(findFirstPourInRange({ target, startDate: "2026-08-01", endDate: "2026-08-02", now,
    readTransactions: async () => { throw new Error("PMB unavailable"); },
  }), /unavailable/);
});
