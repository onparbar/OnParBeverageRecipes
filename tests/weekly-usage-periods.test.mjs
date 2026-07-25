import assert from "node:assert/strict";
import test from "node:test";
import {
  getCompletedMondayWeekStarts,
  getThisMonday,
  isCompletedMondayWeekStart,
} from "../lib/weekly-usage-periods.mjs";

const fridayJuly24 = new Date(2026, 6, 24, 12);

test("finds the current Monday without including it as completed", () => {
  assert.equal(getThisMonday(fridayJuly24).toDateString(), new Date(2026, 6, 20).toDateString());
  assert.equal(isCompletedMondayWeekStart(new Date(2026, 6, 20), fridayJuly24), false);
  assert.equal(isCompletedMondayWeekStart(new Date(2026, 6, 13), fridayJuly24), true);
});

test("returns only completed Monday week starts in chronological order", () => {
  const starts = getCompletedMondayWeekStarts(fridayJuly24, 3);
  assert.deepEqual(
    starts.map((date) => date.toDateString()),
    [
      new Date(2026, 5, 29).toDateString(),
      new Date(2026, 6, 6).toDateString(),
      new Date(2026, 6, 13).toDateString(),
    ],
  );
  assert.equal(starts.every((date) => date.getDay() === 1), true);
});

test("rejects non-Monday and future week starts", () => {
  assert.equal(isCompletedMondayWeekStart(new Date(2026, 6, 12), fridayJuly24), false);
  assert.equal(isCompletedMondayWeekStart(new Date(2026, 6, 27), fridayJuly24), false);
});
