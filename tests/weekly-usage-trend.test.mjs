import assert from "node:assert/strict";
import test from "node:test";

import { buildWeeklyUsageTrend } from "../public/weekly-usage-trend.mjs";

const newest = "8/3/26 - 8/9/26";
const middle = "7/27/26 - 8/2/26";
const oldest = "7/20/26 - 7/26/26";

test("plots tap history from oldest to newest and reports direction", () => {
  const trend = buildWeeklyUsageTrend([
    { label: newest, value: 0.5 },
    { label: middle, value: 0.25 },
    { label: oldest, value: 0.1 },
  ], [newest, middle, oldest]);

  assert.deepEqual(trend.points.map((point) => point.label), [oldest, middle, newest]);
  assert.deepEqual(trend.points.map((point) => point.value), [0.1, 0.25, 0.5]);
  assert.equal(trend.direction, "up");
  assert.equal(trend.change, 0.25);
  assert.equal(trend.segments.length, 1);
  assert.ok(trend.points[0].x < trend.points[2].x);
  assert.ok(trend.points[0].y > trend.points[2].y);
});

test("the direction arrow describes the latest week-to-week movement", () => {
  const trend = buildWeeklyUsageTrend([
    { label: newest, value: 0.4 },
    { label: middle, value: 0.6 },
    { label: oldest, value: 0.1 },
  ], [newest, middle, oldest]);

  assert.equal(trend.firstValue, 0.1);
  assert.equal(trend.previousValue, 0.6);
  assert.equal(trend.lastValue, 0.4);
  assert.equal(trend.change, -0.2);
  assert.equal(trend.direction, "down");
});

test("a missing immediately previous week never becomes a false week-over-week direction", () => {
  const trend = buildWeeklyUsageTrend([
    { label: newest, value: 0.4 },
    { label: oldest, value: 0.2 },
  ], [newest, middle, oldest]);

  assert.deepEqual(trend.points.map((point) => point.value), [0.2, null, 0.4]);
  assert.equal(trend.missingCount, 1);
  assert.equal(trend.segments.length, 2);
  assert.equal(trend.previousValue, null);
  assert.equal(trend.change, null);
  assert.equal(trend.direction, "unavailable");
});

test("keeps recorded zeroes and distinguishes flat or insufficient history", () => {
  const zero = buildWeeklyUsageTrend([
    { label: newest, value: 0 },
    { label: middle, value: 0 },
  ], [newest, middle]);
  assert.equal(zero.recordedCount, 2);
  assert.equal(zero.direction, "flat");
  assert.equal(zero.maximum, 0);

  const one = buildWeeklyUsageTrend([{ label: newest, value: 1 }], [newest, middle]);
  assert.equal(one.direction, "unavailable");
  assert.equal(one.missingCount, 1);
});
