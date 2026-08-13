import assert from "node:assert/strict";
import test from "node:test";

import {
  StaffPrepPlanError,
  applyStaffPrepPlanUpdate,
  buildStaffPrepPlan,
} from "../lib/staff-prep-plan.mjs";

function recommendations(overrides = {}) {
  return {
    generatedAt: "2026-08-10T14:00:00.000Z",
    items: [
      { actionType: "make", orderQty: 1, name: "Bacardi Sunset 1", tapNumber: 4, wall: "Main", priority: 2 },
      { actionType: "make", orderQty: 2, name: "Bacardi Sunset 2", tapNumber: 7, wall: "Main", priority: 1 },
      { actionType: "order", orderQty: 1, name: "Beer", tapNumber: 9, wall: "Main" },
    ],
    ...overrides,
  };
}

test("staff prep plan contains only aggregated cocktails from the weekly plan", () => {
  const plan = buildStaffPrepPlan(recommendations());

  assert.equal(plan.totalCount, 1);
  assert.equal(plan.items[0].name, "Bacardi Sunset");
  assert.equal(plan.items[0].quantity, 3);
  assert.deepEqual(plan.items[0].tapNumbers, [4, 7]);
  assert.equal(plan.items[0].completed, false);
});

test("checking off prep requires a preparer and records shared completion metadata", () => {
  const base = recommendations();
  const itemId = buildStaffPrepPlan(base).items[0].id;

  assert.throws(
    () => applyStaffPrepPlanUpdate(base, {
      generatedAt: base.generatedAt,
      itemId,
      completed: true,
      preparedBy: "",
    }),
    (error) => error instanceof StaffPrepPlanError && error.code === "STAFF_PREPARER_REQUIRED",
  );

  const updated = applyStaffPrepPlanUpdate(base, {
    generatedAt: base.generatedAt,
    itemId,
    completed: true,
    preparedBy: "  Alex   M. ",
  }, { now: () => new Date("2026-08-11T16:30:00.000Z") });
  const plan = buildStaffPrepPlan(updated);

  assert.equal(plan.completedCount, 1);
  assert.equal(plan.items[0].preparedBy, "Alex M.");
  assert.equal(plan.items[0].completedAt, "2026-08-11T16:30:00.000Z");
});

test("staff cannot save a completion against an old or unrelated weekly plan", () => {
  const base = recommendations();
  const itemId = buildStaffPrepPlan(base).items[0].id;

  assert.throws(
    () => applyStaffPrepPlanUpdate(base, {
      generatedAt: "2026-08-03T14:00:00.000Z",
      itemId,
      completed: true,
      preparedBy: "Alex",
    }),
    (error) => error.code === "STAFF_PREP_PLAN_CHANGED",
  );
  assert.throws(
    () => applyStaffPrepPlanUpdate(base, {
      generatedAt: base.generatedAt,
      itemId: "cocktail:not-on-the-plan",
      completed: true,
      preparedBy: "Alex",
    }),
    (error) => error.code === "STAFF_PREP_ITEM_NOT_FOUND",
  );
});

test("reopening prep removes its completion from the checklist", () => {
  const base = recommendations();
  const itemId = buildStaffPrepPlan(base).items[0].id;
  const completed = applyStaffPrepPlanUpdate(base, {
    generatedAt: base.generatedAt,
    itemId,
    completed: true,
    preparedBy: "Alex",
  });
  const reopened = applyStaffPrepPlanUpdate(completed, {
    generatedAt: base.generatedAt,
    itemId,
    completed: false,
    preparedBy: "",
  });

  assert.equal(buildStaffPrepPlan(reopened).completedCount, 0);
  assert.deepEqual(reopened.prepChecklist, {});
});
