import assert from "node:assert/strict";
import test from "node:test";
import { selectPmbCurrentTapSnapshot } from "../public/pmb-current-tap-snapshot.mjs";

const completeSnapshot = {
  updatedAt: "2026-08-15T13:00:00.000Z",
  items: [
    { tapNumber: 2, plu: 202, name: "Current Lager" },
    { tapNumber: 1, plu: 101, name: "Current IPA" },
  ],
  deviceLevels: { 9: [{ lineNum: 1 }] },
};

test("accepts and sorts a complete authoritative PMB wall", () => {
  const result = selectPmbCurrentTapSnapshot({
    candidate: completeSnapshot,
    expectedTapNumbers: [1, 2],
  });

  assert.equal(result.accepted, true);
  assert.equal(result.source, "candidate");
  assert.deepEqual(result.snapshot.items.map((item) => item.tapNumber), [1, 2]);
});

test("retains the last complete snapshot when the PMB wall is partial", () => {
  const result = selectPmbCurrentTapSnapshot({
    candidate: { items: [completeSnapshot.items[0]] },
    fallback: completeSnapshot,
    expectedTapNumbers: [1, 2],
  });

  assert.equal(result.accepted, false);
  assert.equal(result.source, "fallback");
  assert.equal(result.snapshot.updatedAt, completeSnapshot.updatedAt);
});

test("rejects duplicate taps and does not invent a snapshot", () => {
  const result = selectPmbCurrentTapSnapshot({
    candidate: {
      items: [
        { tapNumber: 1, plu: 101, name: "Current IPA" },
        { tapNumber: 1, plu: 202, name: "Current Lager" },
      ],
    },
    expectedTapNumbers: [1, 2],
  });

  assert.equal(result.accepted, false);
  assert.equal(result.source, "none");
  assert.equal(result.snapshot, null);
});
