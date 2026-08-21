import assert from "node:assert/strict";
import test from "node:test";

import { createDashboardRenderCoordinator } from "../public/dashboard-render-coordinator.mjs";

test("coalesces repeated render requests while preserving first-seen view order", async () => {
  const coordinator = createDashboardRenderCoordinator();
  const calls = [];
  const renders = {
    pricing: () => calls.push("pricing"),
    inventory: () => calls.push("inventory"),
    overview: () => calls.push("overview"),
  };

  await coordinator.batch(async () => {
    for (let index = 0; index < 10_000; index += 1) {
      coordinator.defer("pricing", renders.pricing);
      coordinator.defer("inventory", renders.inventory);
      coordinator.defer("overview", renders.overview);
    }
  });

  assert.deepEqual(calls, ["pricing", "inventory", "overview"]);
  assert.deepEqual(coordinator.getStats(), {
    requested: 30_000,
    deferred: 30_000,
    deduplicated: 29_997,
    rendered: 3,
    flushes: 1,
    pending: 0,
    batchDepth: 0,
    flushing: false,
  });
});

test("supports nested batches and schedules dependent views without recursive rendering", async () => {
  const coordinator = createDashboardRenderCoordinator();
  const calls = [];
  const renderWeeklyPlan = () => {
    if (coordinator.defer("weekly-plan", renderWeeklyPlan)) return;
    calls.push("weekly-plan");
  };
  const renderInventory = () => {
    if (coordinator.defer("inventory", renderInventory)) return;
    calls.push("inventory");
    renderWeeklyPlan();
    renderWeeklyPlan();
  };

  await coordinator.batch(async () => {
    renderInventory();
    await coordinator.batch(async () => {
      renderInventory();
      renderWeeklyPlan();
    });
  });

  assert.deepEqual(calls, ["inventory", "weekly-plan"]);
  assert.equal(coordinator.getStats().deduplicated, 3);
});

test("renders immediately outside a transaction", () => {
  const coordinator = createDashboardRenderCoordinator();
  let count = 0;
  const render = () => {
    if (coordinator.defer("overview", render)) return;
    count += 1;
  };

  render();
  render();
  assert.equal(count, 2);
  assert.equal(coordinator.getStats().rendered, 0);
});
