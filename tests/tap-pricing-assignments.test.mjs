import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCurrentTapAssignments,
  getTapPricingRepresentativeAssignment,
} from "../lib/tap-pricing-assignments.mjs";

const tapLookup = {
  byTap: new Map([
    [21, { tapNumber: 21, wall: "Main", type: "Lager", brand: "HOUSE BEER 1" }],
    [73, { tapNumber: 73, wall: "Karaoke", type: "Lager", brand: "HOUSE BEER 2" }],
    [83, { tapNumber: 83, wall: "Karaoke", type: "Shots", brand: "HOUSE VODKA 2" }],
  ]),
};

test("preserves exact device and line identity for one live tap", () => {
  const assignmentsByPlu = buildCurrentTapAssignments([
    { plu: 500, tapNumber: 21, deviceId: 9001, lineNum: 2, product: "House Beer", unused: false },
  ], tapLookup);

  assert.deepEqual(assignmentsByPlu.get(500), [{
    tapPosition: 21,
    tapNumber: 21,
    wall: "Main",
    type: "Lager",
    matchedBrand: "House Beer",
    templateBrand: "HOUSE BEER 1",
    deviceId: 9001,
    lineNum: 2,
  }]);
});

test("keeps every physical assignment when a PLU is shared across walls", () => {
  const assignmentsByPlu = buildCurrentTapAssignments([
    { plu: 500, tapNumber: 73, deviceId: 9002, lineNum: 4, product: "House Beer", unused: false },
    { plu: 500, tapNumber: 21, deviceId: 9001, lineNum: 2, product: "House Beer", unused: false },
  ], tapLookup);

  const assignments = assignmentsByPlu.get(500);
  assert.deepEqual(assignments.map(({ tapNumber, deviceId, lineNum }) => ({ tapNumber, deviceId, lineNum })), [
    { tapNumber: 21, deviceId: 9001, lineNum: 2 },
    { tapNumber: 73, deviceId: 9002, lineNum: 4 },
  ]);
  assert.equal(getTapPricingRepresentativeAssignment(assignments).tapPosition, 21);
});

test("ignores unused and incomplete assignments rather than exposing unsafe write targets", () => {
  const assignmentsByPlu = buildCurrentTapAssignments([
    { plu: 500, tapNumber: 21, deviceId: 9001, lineNum: 2, product: "House Beer", unused: true },
    { plu: 600, tapNumber: 83, deviceId: 9003, lineNum: 0, product: "House Vodka", unused: false },
    { plu: 700, tapNumber: 83, deviceId: 9003, lineNum: 1, product: "House Vodka", unused: false },
  ], tapLookup);

  assert.equal(assignmentsByPlu.has(500), false);
  assert.equal(assignmentsByPlu.has(600), false);
  assert.equal(assignmentsByPlu.get(700)?.[0].deviceId, 9003);
  assert.equal(assignmentsByPlu.get(700)?.[0].lineNum, 1);
});

test("deduplicates repeated physical rows for the same PLU", () => {
  const row = { plu: 500, tapNumber: 21, deviceId: 9001, lineNum: 2, product: "House Beer", unused: false };
  const assignmentsByPlu = buildCurrentTapAssignments([row, { ...row }], tapLookup);
  assert.equal(assignmentsByPlu.get(500).length, 1);
});
