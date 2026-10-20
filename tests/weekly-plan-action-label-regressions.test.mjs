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

const placedOrders = {
  planLocked: true,
  weeklyOrderTrackingAvailable: true,
  orderLineCount: 2,
  expectedVendorCount: 2,
};

for (const [name, vendors, status] of [
  ["placed orders waiting for both suppliers", [
    { ordered: true, items: [{ status: "pending" }] },
    { ordered: true, items: [{ status: "pending" }] },
  ], "Awaiting delivery"],
  ["one supplier still on the way", [
    { ordered: true, items: [{ status: "received" }] },
    { ordered: true, items: [{ status: "pending" }] },
  ], "Awaiting delivery"],
  ["all deliveries checked in", [
    { ordered: true, items: [{ status: "received" }] },
    { ordered: true, items: [{ status: "received" }] },
  ], "Received"],
  ["partial delivery", [
    { ordered: true, items: [{ status: "partial" }] },
    { ordered: true, items: [{ status: "pending" }] },
  ], "Delivery issue"],
  ["missing delivery", [
    { ordered: true, items: [{ status: "not-received" }] },
    { ordered: true, items: [{ status: "received" }] },
  ], "Delivery issue"],
  ["missing receipt details", [
    { ordered: true, items: [{ status: "received" }] },
    { ordered: true },
  ], "Awaiting delivery"],
]) {
  test(`home weekly order reports ${name}`, () => {
    const run = buildMondayRunModel({ ...placedOrders, vendorOrders: vendors });
    assert.equal(run.complete, true);
    assert.equal(run.deliveryStatus, status);
    assert.ok(renderMondayRunCompact(run).includes(`>${status}</p>`));
  });
}

test("home weekly order does not await delivery until every supplier order is placed", () => {
  const run = buildMondayRunModel({ ...placedOrders, vendorOrders: [
    { ordered: true, items: [{ status: "pending" }] },
    { ordered: false, items: [{ status: "pending" }] },
  ] });
  assert.equal(run.complete, false);
  assert.equal(run.deliveryStatus, "");
  assert.match(renderMondayRunCompact(run), /Your weekly plan is saved/);
});

test("home weekly order distinguishes an empty order from a pending delivery", () => {
  const run = buildMondayRunModel({ ...placedOrders, orderLineCount: 0, expectedVendorCount: 0 });
  assert.equal(run.complete, true);
  assert.equal(run.deliveryStatus, "No orders needed");
  assert.match(renderMondayRunCompact(run), /No orders needed/);
});
