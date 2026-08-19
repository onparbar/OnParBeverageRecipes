import assert from "node:assert/strict";
import test from "node:test";

import { buildWhatIfPlan } from "../public/what-if-planning.mjs";

const items = [{
  id: "cocktail:one",
  name: "Blue Dot",
  wall: "main",
  category: "cocktail",
  hidden: false,
  periods: { recent: { label: "Recent 4-week average", ounces: 100 } },
}, {
  id: "cocktail:missing",
  name: "Missing",
  wall: "main",
  category: "cocktail",
  hidden: false,
  periods: { recent: null },
}];

test("previews poured-volume changes without treating unavailable rows as zero", () => {
  const plan = buildWhatIfPlan(items, "What if Main cocktails are 20% higher next week?");
  assert.equal(plan.status, "ready");
  assert.equal(plan.baselineOz, 100);
  assert.equal(plan.projectedOz, 120);
  assert.equal(plan.unavailableCount, 1);
});

test("withholds sales scenarios because wristband events make sales unreliable", () => {
  const plan = buildWhatIfPlan(items, "What if sales are 20% higher?");
  assert.equal(plan.status, "needs-clarification");
  assert.match(plan.question, /poured volume/i);
});
