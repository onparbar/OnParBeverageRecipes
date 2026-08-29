import assert from "node:assert/strict";
import test from "node:test";

import {
  bindWeeklyPlanController,
  getWeeklyPlanRehearsalMessage,
  WEEKLY_PLAN_REHEARSAL_MESSAGES,
} from "../public/weekly-plan-controller.mjs";

class FakeTarget {
  constructor({ value = "", dataset = {} } = {}) {
    this.value = value;
    this.dataset = dataset;
    this.disabled = false;
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    return this.listeners.get(type)?.({ currentTarget: this });
  }
}

function createControllerFixture() {
  const nodes = new Map([
    ["#run-weekly-plan-agent", new FakeTarget()],
    ["#recall-weekly-plan", new FakeTarget()],
    ["#weekly-plan-finish-save", new FakeTarget()],
    ["#weekly-plan-finish-actor", new FakeTarget()],
    ["#weekly-plan-late-reason", new FakeTarget()],
    ["#toggle-order-rehearsal", new FakeTarget()],
  ]);
  const steps = [
    new FakeTarget({ dataset: { mondayRunStep: "inventory", dashboardTarget: "inventory" } }),
    new FakeTarget({ dataset: { mondayRunStep: "orders", dashboardTarget: "weekly-plan" } }),
  ];
  return {
    nodes,
    steps,
    documentRef: {
      querySelector(selector) {
        return nodes.get(selector) || null;
      },
    },
    root: {
      querySelectorAll(selector) {
        return selector === "[data-monday-run-step]" ? steps : [];
      },
    },
  };
}

test("weekly plan rehearsal copy remains centralized and explicit", () => {
  assert.equal(getWeeklyPlanRehearsalMessage(true), WEEKLY_PLAN_REHEARSAL_MESSAGES.active);
  assert.equal(getWeeklyPlanRehearsalMessage(false), WEEKLY_PLAN_REHEARSAL_MESSAGES.inactive);
});

test("weekly plan controller binds primary actions and Monday navigation", () => {
  const fixture = createControllerFixture();
  const calls = [];
  const bound = bindWeeklyPlanController({
    ...fixture,
    runWeeklyPlanUpdate: () => calls.push("save"),
    recallCurrentWeeklyPlan: () => calls.push("recall"),
    saveWeeklyPlanFinishWeek: () => calls.push("finish"),
    openMondayRunStep: (step, target) => calls.push([step, target]),
    bindOrderTrackingEvents: () => calls.push("orders-bound"),
  });

  fixture.nodes.get("#run-weekly-plan-agent").dispatch("click");
  fixture.nodes.get("#recall-weekly-plan").dispatch("click");
  fixture.nodes.get("#weekly-plan-finish-save").dispatch("click");
  fixture.steps[0].dispatch("click");
  fixture.steps[1].dispatch("click");

  assert.equal(bound, true);
  assert.deepEqual(calls, [
    "orders-bound",
    "save",
    "recall",
    "finish",
    ["inventory", "inventory"],
    ["orders", "weekly-plan"],
  ]);
});

test("weekly plan controller updates actor and late-reason readiness", () => {
  const fixture = createControllerFixture();
  let actor = "";
  let reason = "";
  bindWeeklyPlanController({
    ...fixture,
    clean: (value) => String(value ?? "").trim(),
    getOutsideMondayReason: () => reason,
    setOutsideMondayReason: (value) => {
      reason = value;
    },
    setFinishWeekActor: (value) => {
      actor = value;
    },
  });

  fixture.nodes.get("#weekly-plan-finish-actor").value = "Sam";
  fixture.nodes.get("#weekly-plan-finish-actor").dispatch("input");
  fixture.nodes.get("#weekly-plan-late-reason").value = "   ";
  fixture.nodes.get("#weekly-plan-late-reason").dispatch("input");

  assert.equal(actor, "Sam");
  assert.equal(reason, "   ");
  assert.equal(fixture.nodes.get("#run-weekly-plan-agent").disabled, true);

  fixture.nodes.get("#weekly-plan-late-reason").value = "Inventory correction";
  fixture.nodes.get("#weekly-plan-late-reason").dispatch("input");
  assert.equal(fixture.nodes.get("#run-weekly-plan-agent").disabled, false);
});

test("weekly plan controller toggles rehearsal state before rerendering", () => {
  const fixture = createControllerFixture();
  let rehearsal = false;
  let message = "";
  let renderedState = null;
  bindWeeklyPlanController({
    ...fixture,
    getOrderRehearsalMode: () => rehearsal,
    setOrderRehearsalMode: (value) => {
      rehearsal = value;
    },
    setWeeklyOrderTrackingMessage: (value) => {
      message = value;
    },
    renderWeeklyPlan: () => {
      renderedState = rehearsal;
    },
  });

  fixture.nodes.get("#toggle-order-rehearsal").dispatch("click");
  assert.equal(rehearsal, true);
  assert.equal(message, WEEKLY_PLAN_REHEARSAL_MESSAGES.active);
  assert.equal(renderedState, true);

  fixture.nodes.get("#toggle-order-rehearsal").dispatch("click");
  assert.equal(rehearsal, false);
  assert.equal(message, WEEKLY_PLAN_REHEARSAL_MESSAGES.inactive);
  assert.equal(renderedState, false);
});

test("weekly plan controller fails closed without a render root", () => {
  assert.equal(bindWeeklyPlanController({ root: null, documentRef: {} }), false);
});
