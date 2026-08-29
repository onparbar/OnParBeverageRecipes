import assert from "node:assert/strict";
import test from "node:test";

import {
  clean,
  cssEscape,
  escapeHtml,
  formatContainerSizeLabel,
  formatInventoryQuantity,
  getInventorySnapshotDate,
  money,
  normalizeTitle,
  slugify,
  sum,
  toNumber,
} from "../public/dashboard-formatters.mjs";
import {
  buildFinishWeekProgress,
  normalizeDashboardStaffPrepPlan,
  normalizeWeeklyOrderTracking,
} from "../public/weekly-handoff-state.mjs";
import {
  renderFinishWeekChecklistItems,
  renderFinishWeekDeliveries,
  renderFinishWeekPanel,
} from "../public/finish-week-view.mjs";
import {
  buildMondayRunModel,
  renderMondayRun,
  renderMondayRunCompact,
} from "../public/monday-run-view.mjs";

test("shared dashboard formatters preserve existing parsing and escaping behavior", () => {
  assert.equal(clean("  Tito's   Vodka  "), "Tito's Vodka");
  assert.equal(normalizeTitle("  MIXER Cabinet "), "mixer cabinet");
  assert.equal(toNumber("$1,234.50"), 1234.5);
  assert.equal(sum([1, Number.NaN, 2]), 3);
  assert.equal(money(24.4), "$24.40");
  assert.equal(formatInventoryQuantity("1,234.5"), "1,234.5");
  assert.equal(formatContainerSizeLabel(1.75, "L"), "1.75L");
  assert.equal(getInventorySnapshotDate({ weekOf: "2026-08-24" }), "2026-08-24T12:00:00");
  assert.equal(slugify("Triple Jam Cider 2"), "triple-jam-cider-2");
  assert.equal(escapeHtml('<b title="x">&</b>'), "&lt;b title=&quot;x&quot;&gt;&amp;&lt;/b&gt;");
  assert.equal(cssEscape('a"b'), 'a\\"b');
});

test("weekly handoff normalizers keep only stable arrays and numeric counters", () => {
  const orders = normalizeWeeklyOrderTracking({
    available: true,
    generatedAt: " 2026-08-24T12:00:00.000Z ",
    vendors: [{ id: "proof" }],
    itemCount: "3",
    receivedCount: "2",
    drafts: null,
  });
  assert.equal(orders.available, true);
  assert.equal(orders.generatedAt, "2026-08-24T12:00:00.000Z");
  assert.equal(orders.itemCount, 3);
  assert.equal(orders.receivedCount, 2);
  assert.deepEqual(orders.drafts, []);

  const prep = normalizeDashboardStaffPrepPlan({ available: true, totalCount: "2", completedCount: "1", items: null });
  assert.equal(prep.totalCount, 2);
  assert.equal(prep.completedCount, 1);
  assert.deepEqual(prep.items, []);
});

test("finish-week progress counts reviewed deliveries, cocktails, and liquor independently", () => {
  const progress = buildFinishWeekProgress({
    weeklyOrderTracking: {
      available: true,
      vendors: [{ items: [{ status: "received" }, { status: "pending" }] }],
    },
    dashboardStaffPrepPlan: {
      available: true,
      completedCount: 2,
      totalCount: 2,
      liquorRefillCompletedCount: 0,
      liquorRefillTotalCount: 1,
    },
  });
  assert.equal(progress.complete, false);
  assert.equal(progress.remainingCount, 2);
  assert.deepEqual(progress.sections.map(({ id, complete }) => ({ id, complete })), [
    { id: "deliveries", complete: false },
    { id: "cocktails", complete: true },
    { id: "liquor", complete: false },
  ]);
});

test("finish-week views preserve shared checklist controls and escaped labels", () => {
  const checklist = renderFinishWeekChecklistItems([{ id: "titos", name: "Tito's <3", quantity: 2, tapNumbers: [13] }], "liquor");
  assert.match(checklist, /data-finish-prep-item="titos"/);
  assert.match(checklist, /data-finish-liquor-quantity="titos"/);
  assert.match(checklist, /Tito&#039;s &lt;3/);

  const deliveries = renderFinishWeekDeliveries({
    available: true,
    vendors: [{ id: "proof", vendor: "Proof", items: [{ id: "lime", name: "Lime Juice", status: "received", quantity: 1 }] }],
  });
  assert.match(deliveries, /checked disabled/);
  assert.match(deliveries, /Received/);

  const panel = renderFinishWeekPanel({
    planLocked: true,
    progress: { complete: false, remainingCount: 1, sections: [{ label: "Deliveries", complete: false, completedCount: 0, totalCount: 1 }] },
    weeklyOrderTracking: { available: true, vendors: [] },
    actor: "Sam",
    saving: true,
  });
  assert.match(panel, /id="weekly-plan-finish-week"/);
  assert.match(panel, /value="Sam"/);
  assert.match(panel, /Saving\.\.\./);
});

test("Monday Run model preserves the six operational steps and next-action rules", () => {
  const run = buildMondayRunModel({
    kegFeed: { status: "online" },
    pricingFeed: { status: "online" },
    weeklyUsageCaptured: true,
    inventorySharedInitialized: true,
    planActionable: true,
    tapSheets: [{ isCurrent: false }, { isCurrent: true }],
  });
  assert.equal(run.steps.length, 6);
  assert.equal(run.completedCount, 2);
  assert.equal(run.nextStep.id, "plan");
  assert.equal(run.steps.find((step) => step.id === "print").status, "1 left");

  const locked = buildMondayRunModel({
    planLocked: true,
    finishWeek: { complete: true, remainingCount: 0 },
    weeklyOrderTrackingAvailable: true,
    vendorOrders: [{ ordered: true }],
    orderLineCount: 3,
    tapSheets: [{ isCurrent: true }],
  });
  assert.equal(locked.complete, true);
  assert.equal(locked.steps.find((step) => step.id === "orders").status, "Placed");
  assert.equal(locked.steps.find((step) => step.id === "finish").status, "Complete");
});

test("Monday Run renderers keep actionable data attributes and compact next-step text", () => {
  const run = buildMondayRunModel({
    kegFeed: { status: "online" },
    pricingFeed: { status: "online" },
    weeklyUsageCaptured: true,
    inventorySharedInitialized: true,
    tapSheets: [{ isCurrent: true }],
  });
  const full = renderMondayRun(run);
  const compact = renderMondayRunCompact(run);
  assert.match(full, /data-monday-run-step="plan"/);
  assert.match(full, /aria-current="step"/);
  assert.match(compact, /Next:<\/span> <strong>Save &amp; lock plan/);
});
