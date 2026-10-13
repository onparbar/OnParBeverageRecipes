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
    assert.match(render(run), view === "compact" ? /class="primary-button"[^>]*>Start here<\/button>/ : /class="primary-button"[^>]*>Start Count<\/button>/);
  });

  test(`${view} weekly plan keeps Start while step one is incomplete`, () => {
    const run = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: true, inventoryMissingCount: 1 });
    assert.match(render(run), view === "compact" ? /class="primary-button"[^>]*>Start here<\/button>/ : /class="primary-button"[^>]*>Start Count<\/button>/);
  });

  test(`${view} weekly plan waits for inventory to finish saving`, () => {
    const run = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: true, inventorySaving: true });
    assert.match(render(run), view === "compact" ? /class="primary-button"[^>]*>Start here<\/button>/ : /class="primary-button"[^>]*>Start Count<\/button>/);
  });

  test(`${view} weekly plan continues once step one is complete`, () => {
    const run = buildMondayRunModel({ ...ready, coolerCountComplete: true, inventoryCountedThisWeek: true });
    assert.match(render(run), view === "compact" ? /class="monday-run__card-link"[^>]*data-dashboard-target="weekly-order"/ : /class="primary-button"[^>]*>Continue<\/button>/);
  });

  test(`${view} weekly plan uses the visible step rather than background PMB readiness`, () => {
    const run = buildMondayRunModel({ coolerCountComplete: true, inventorySharedInitialized: true, inventoryCountedThisWeek: true });
    assert.match(render(run), view === "compact" ? /class="monday-run__card-link"[^>]*data-dashboard-target="weekly-order"/ : /class="primary-button"[^>]*>Continue<\/button>/);
  });

  test(`${view} weekly plan counting actions stay inside Weekly Order`, () => {
    const start = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: false });
    assert.match(render(start), view === "compact" ? /data-dashboard-target="weekly-order">Start here<\/button>/ : /data-dashboard-target="weekly-order">Start Count<\/button>/);
    const next = buildMondayRunModel({ ...ready, coolerCountComplete: true, inventoryCountedThisWeek: true });
    assert.match(render(next), view === "compact" ? /class="monday-run__card-link"[^>]*data-dashboard-target="weekly-order"/ : /data-dashboard-target="weekly-order">Continue<\/button>/);
  });
}

test("locked weekly plans retain their existing actions", () => {
  const run = buildMondayRunModel({ ...ready, planLocked: true, weeklyOrderTrackingAvailable: true, vendorOrders: [], orderLineCount: 0 });
  assert.match(renderMondayRunCompact(run), /class="monday-run__card-link"[^>]*data-dashboard-target="weekly-order"[^>]*aria-label="Open this week&#039;s order"/);
  assert.match(renderMondayRun(run), />Complete</);
  assert.doesNotMatch(renderMondayRun(run), /monday-run-steps/);
});
