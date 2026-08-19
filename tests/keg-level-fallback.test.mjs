import assert from "node:assert/strict";
import test from "node:test";

import { findExactLastKnownKegLevel } from "../public/keg-level-fallback.mjs";

const snapshot = {
  updatedAt: "2026-08-18T12:00:00.000Z",
  items: [{ tapNumber: 21, deviceId: 5, lineNum: 2, plu: 4101, fillLevelPercent: 42.5, rawPercent: 4250 }],
};

test("reuses a last-known level only for the exact physical tap and PLU", () => {
  const level = findExactLastKnownKegLevel(snapshot, { tapNumber: 21, deviceId: 5, lineNum: 2, plu: 4101 });
  assert.equal(level.fillLevelPercent, 42.5);
  assert.equal(level.lastKnownAt, snapshot.updatedAt);
});

test("does not carry a prior level onto a changed product or physical line", () => {
  assert.equal(findExactLastKnownKegLevel(snapshot, { tapNumber: 21, deviceId: 5, lineNum: 2, plu: 9999 }), null);
  assert.equal(findExactLastKnownKegLevel(snapshot, { tapNumber: 21, deviceId: 5, lineNum: 3, plu: 4101 }), null);
});
