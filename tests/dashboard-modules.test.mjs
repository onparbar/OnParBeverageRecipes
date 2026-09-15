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
  assert.doesNotMatch(deliveries, /type="checkbox"/);
  assert.match(deliveries, /1 received/);

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

test("Monday Run has three steps and only completes when all orders are placed", () => {
  const run = buildMondayRunModel({ coolerCountComplete: true, inventorySharedInitialized: true, inventoryCountedThisWeek: true });
  assert.deepEqual(run.steps.map((step) => step.id), ["cooler", "inventory", "orders"]);
  assert.equal(run.completedCount, 1);
  assert.equal(run.nextStep.id, "inventory");
  const locked = buildMondayRunModel({ planLocked: true, inventorySaveError: "live count retry", kegCountSaveError: "live count retry", weeklyOrderTrackingAvailable: true, vendorOrders: [{ ordered: true }], orderLineCount: 3, now: new Date("2026-09-14T15:00:00Z") });
  assert.equal(locked.complete, true);
  assert.equal(locked.steps[2].status, "All placed");
  assert.match(renderMondayRun(locked), />Complete</);
  assert.match(renderMondayRun(locked), /Sep 14 - 20/);
  assert.doesNotMatch(renderMondayRun(locked), /monday-run-steps|Save needs retry|>Continue</);
  assert.doesNotMatch(renderMondayRunCompact(locked), /Next:/);
  const pending = buildMondayRunModel({ planLocked: true, weeklyOrderTrackingAvailable: true, vendorOrders: [{ ordered: false }], orderLineCount: 1 });
  assert.equal(pending.complete, false);
  assert.equal(pending.nextStep.id, "orders");
  assert.match(renderMondayRun(pending), /data-monday-run-step="orders" data-dashboard-target="weekly-plan"/);
  const snapshotOnly = buildMondayRunModel({ mondaySnapshotSaved: true, inventorySharedInitialized: true });
  assert.equal(snapshotOnly.steps[0].complete, true);
  assert.equal(snapshotOnly.steps[1].complete, false);
  assert.equal(snapshotOnly.steps[1].status, "Submit to finish saving");
});

test("Monday Run renderers route verified cooler counts to inventory", () => {
  const run = buildMondayRunModel({ coolerCountComplete: true, inventorySharedInitialized: true, inventoryCountedThisWeek: true });
  const full = renderMondayRun(run);
  const compact = renderMondayRunCompact(run);
  assert.match(full, /data-monday-run-step="inventory"/);
  assert.match(full, /aria-current="step"/);
  assert.match(full, /Step 2 of 3/);
  assert.match(compact, /Step 2 of 3/);
  assert.match(compact, /Next:<\/span> <strong>Inventory/);
});
