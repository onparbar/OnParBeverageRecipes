import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePmbLevelSnapshot,
  PmbLevelSnapshotStoreError,
} from "../lib/pmb-level-snapshot-store.mjs";

function snapshot(overrides = {}) {
  return {
    updatedAt: "2026-08-15T14:00:00.000Z",
    items: [{
      slotKey: "1:1",
      plu: 101,
      name: "Modelo",
      fillLevelPercent: 42.5,
      deviceId: 1,
      lineNum: 1,
      tapNumber: 1,
      tapProduct: "Modelo",
      rawPercent: 4250,
      rawKegSize: null,
      rawKegSizeDp: null,
    }],
    ...overrides,
  };
}

test("normalizes a PMB snapshot and derives device levels", () => {
  const normalized = normalizePmbLevelSnapshot(snapshot());
  assert.equal(normalized.items[0].fillLevelPercent, 42.5);
  assert.equal(normalized.deviceLevels["1"][0].lineNum, 1);
});

test("rejects duplicate taps", () => {
  const duplicate = snapshot();
  duplicate.items.push({ ...duplicate.items[0], plu: 102, lineNum: 2 });
  assert.throws(
    () => normalizePmbLevelSnapshot(duplicate),
    (error) => error instanceof PmbLevelSnapshotStoreError
      && error.code === "INVALID_PMB_LEVEL_SNAPSHOT",
  );
});

test("rejects missing levels instead of treating them as zero", () => {
  const missing = snapshot();
  missing.items[0].fillLevelPercent = null;
  assert.throws(() => normalizePmbLevelSnapshot(missing), PmbLevelSnapshotStoreError);
});
