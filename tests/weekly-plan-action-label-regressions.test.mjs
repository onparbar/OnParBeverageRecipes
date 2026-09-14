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
    const run = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: true });
    assert.match(render(run), /class="primary-button"[^>]*>Continue<\/button>/);
  });

  test(`${view} weekly plan uses the visible step rather than background PMB readiness`, () => {
    const run = buildMondayRunModel({ inventorySharedInitialized: true, inventoryCountedThisWeek: true });
    assert.match(render(run), /class="primary-button"[^>]*>Continue<\/button>/);
  });

  test(`${view} weekly plan starts at keg levels and retains later destinations`, () => {
    const start = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: false });
    assert.match(render(start), /data-dashboard-target="keg-levels">Start<\/button>/);
    const next = buildMondayRunModel({ ...ready, inventoryCountedThisWeek: true });
    assert.match(render(next), /data-dashboard-target="weekly-plan">Continue<\/button>/);
  });
}

test("locked weekly plans retain their existing actions", () => {
  const run = buildMondayRunModel({ ...ready, planLocked: true });
  assert.match(renderMondayRunCompact(run), /class="primary-button"[^>]*>View plan<\/button>/);
  assert.match(renderMondayRun(run), /class="primary-button"[^>]*>Continue<\/button>/);
});
