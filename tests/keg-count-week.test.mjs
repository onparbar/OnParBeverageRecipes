import assert from "node:assert/strict";
import test from "node:test";
import { getKegCountWeek } from "../lib/keg-count-week.mjs";
import { kegDestination } from "../public/keg-destination.mjs";
import { reconcileKegLevelInputs } from "../public/keg-level-state.mjs";

test("keg counts roll over Monday at 7 Eastern in summer and winter", () => {
  assert.equal(getKegCountWeek(new Date("2026-09-07T10:59:59Z")), "2026-08-31");
  assert.equal(getKegCountWeek(new Date("2026-09-07T11:00:00Z")), "2026-09-07");
  assert.equal(getKegCountWeek(new Date("2026-01-05T11:59:59Z")), "2025-12-29");
  assert.equal(getKegCountWeek(new Date("2026-01-05T12:00:00Z")), "2026-01-05");
});

test("receiving names physical coolers and does not guess missing assignments", () => {
  assert.equal(kegDestination({ unit: "kegs", tapNumbers: [21] }), "Store in: Main cooler (Tap 21)");
  assert.equal(kegDestination({ wall: "karaoke" }, { cocktail: true }), "Store in: Karaoke cooler");
  assert.match(kegDestination({ unit: "kegs" }), /assignment needed/);
  assert.equal(kegDestination({ unit: "bottles" }), "");
});

test("equal count formatting resolves without an old baseline", () => {
  assert.equal(reconcileKegLevelInputs(null,
    { onHandOverrides: { tap: "2.0" } },
    { onHandOverrides: { tap: 2 }, settings: { kegCountWeek: "2026-09-07" } }).ok, true);
  assert.equal(reconcileKegLevelInputs(null,
    { onHandOverrides: { tap: 1 } }, { onHandOverrides: { tap: 2 } }).ok, false);
});
