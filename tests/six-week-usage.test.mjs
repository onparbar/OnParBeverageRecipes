import assert from "node:assert/strict";
import test from "node:test";
import { getSixWeekUsage } from "../lib/six-week-usage.mjs";

test("uses completed calendar weeks, excludes unknown values, and deduplicates dates", () => {
  const result = getSixWeekUsage({ history: [
    { source: "PMB", label: "7/20/26 - 7/26/26", value: 900 },
    { source: "PMB", label: "8/24/26 - 8/30/26", value: 10 },
    { source: "PMB", label: "9/7/26 - 9/13/26", value: 900 },
    { source: "PMB", label: "8/31/26 - 9/6/26", value: 20 },
    { source: "PMB", label: "8/31/26 - 9/6/26", value: 20 },
    { source: "PMB", label: "8/17/26 - 8/23/26", value: 0, hasValue: false },
    { source: "PMB", label: "7/27/26 - 8/2/26", value: 0, zeroUsageVerified: true },
  ] }, new Date("2026-09-09T12:00:00Z"));
  assert.deepEqual(result.values, [20, 10, 0]);
  assert.equal(result.average, 10);
  assert.equal(result.sampleWeeks, 3);
});
