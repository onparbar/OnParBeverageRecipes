import assert from "node:assert/strict";
import test from "node:test";
import { buildMondayRunModel, renderMondayRun, renderMondayRunCompact } from "../public/monday-run-view.mjs";

const ready = {
  kegFeed: { status: "online" },
  pricingFeed: { status: "online" },
  weeklyUsageCaptured: true,
  inventorySharedInitialized: true,
};

for (const [view, render] of [["compact", renderMondayRunCompact], ["expanded", renderMondayRun]]) {
  test(`${view} weekly plan starts after reset even when background work is complete`, () => {
    const run = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: false });
    assert.match(render(run), /class="primary-button"[^>]*>Start<\/button>/);
  });

  test(`${view} weekly plan keeps Start while step one is incomplete`, () => {
    const run = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: true, inventoryMissingCount: 1 });
    assert.match(render(run), /class="primary-button"[^>]*>Start<\/button>/);
  });

  test(`${view} weekly plan waits for inventory to finish saving`, () => {
    const run = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: true, inventorySaving: true });
    assert.match(render(run), /class="primary-button"[^>]*>Start<\/button>/);
  });

  test(`${view} weekly plan continues once step one is complete`, () => {
    const run = buildMondayRunModel({ ...ready, coolerCountComplete: true, inventoryCountedThisWeek: true });
    assert.match(render(run), view === "compact" ? /class="monday-run__card-link"[^>]*data-dashboard-target="inventory"/ : /class="primary-button"[^>]*>Continue<\/button>/);
  });

  test(`${view} weekly plan uses the visible step rather than background PMB readiness`, () => {
    const run = buildMondayRunModel({ coolerCountComplete: true, inventorySharedInitialized: true, inventoryCountedThisWeek: true });
    assert.match(render(run), view === "compact" ? /class="monday-run__card-link"[^>]*data-dashboard-target="inventory"/ : /class="primary-button"[^>]*>Continue<\/button>/);
  });

  test(`${view} weekly plan starts at keg levels and retains later destinations`, () => {
    const start = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: false });
    assert.match(render(start), /data-dashboard-target="keg-levels">Start<\/button>/);
    const next = buildMondayRunModel({ ...ready, coolerCountComplete: true, inventoryCountedThisWeek: true });
    assert.match(render(next), view === "compact" ? /class="monday-run__card-link"[^>]*data-dashboard-target="inventory"/ : /data-dashboard-target="inventory">Continue<\/button>/);
  });
}

test("locked weekly plans retain their existing actions", () => {
  const run = buildMondayRunModel({ ...ready, planLocked: true, weeklyOrderTrackingAvailable: true, vendorOrders: [], orderLineCount: 0 });
  assert.match(renderMondayRunCompact(run), /class="monday-run__card-link"[^>]*data-dashboard-target="weekly-plan"[^>]*aria-label="View weekly plan"/);
  assert.match(renderMondayRun(run), />Complete</);
  assert.doesNotMatch(renderMondayRun(run), /monday-run-steps/);
});
