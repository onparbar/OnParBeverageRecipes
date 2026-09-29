import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bindWeeklyPrepAdder } from "../public/weekly-prep-add.mjs";

const GENERATED_AT = "2026-09-29T04:59:15.144Z";
const dashboardSource = readFileSync(new URL("../public/dashboard.js", import.meta.url), "utf8");

class FakeTarget {
  constructor({ dataset = {}, hidden = false, value = "", textContent = "" } = {}) {
    this.attributes = new Map();
    this.dataset = dataset;
    this.disabled = false;
    this.hidden = hidden;
    this.listeners = new Map();
    this.textContent = textContent;
    this.value = value;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  async dispatch(type) {
    for (const listener of this.listeners.get(type) || []) {
      await listener({ currentTarget: this, target: this });
    }
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
}

function createFixture({ secondRemove = false } = {}) {
  const status = new FakeTarget();
  const rowStatus = new FakeTarget();
  const select = new FakeTarget();
  const cooler = new FakeTarget({ value: "Main" });
  const fields = new FakeTarget({ hidden: true });
  const opener = new FakeTarget();
  const save = new FakeTarget();
  const forecast = new FakeTarget();
  const remove = new FakeTarget({
    dataset: { prepSubtract: "cocktail:house%20margarita%201" },
    textContent: "×",
  });
  const row = {
    querySelector(selector) {
      return selector === "[data-prep-subtract-status]" ? rowStatus : null;
    },
  };
  remove.closest = (selector) => selector === ".weekly-plan-label-item" ? row : null;
  const secondRowStatus = new FakeTarget();
  const removeTwo = new FakeTarget({
    dataset: { prepSubtract: "cocktail:peach%20margarita%201" },
    textContent: "×",
  });
  const secondRow = {
    querySelector(selector) {
      return selector === "[data-prep-subtract-status]" ? secondRowStatus : null;
    },
  };
  removeTwo.closest = (selector) => selector === ".weekly-plan-label-item" ? secondRow : null;
  select.addEventListener = FakeTarget.prototype.addEventListener;
  select.replaceChildren = () => {};
  select.append = () => {};
  forecast.replaceChildren = () => {};
  forecast.append = () => {};

  const panelNodes = new Map([
    ["[data-prep-tap-status]", status],
    ["[data-prep-tap-select]", select],
    ["[data-prep-tap-cooler]", cooler],
    ["[data-prep-tap-fields]", fields],
    ["[data-prep-tap-open]", opener],
    ["[data-prep-tap-save]", save],
    ["[data-prep-forecast]", forecast],
  ]);
  const panel = {
    querySelector(selector) {
      return panelNodes.get(selector) || null;
    },
    querySelectorAll(selector) {
      return selector === "button, select" ? [opener, select, cooler, save] : [];
    },
  };
  const root = {
    dataset: { generatedAt: GENERATED_AT },
    querySelector(selector) {
      return selector === "[data-prep-tap-adder]" ? panel : null;
    },
    querySelectorAll(selector) {
      return selector === "[data-prep-subtract]" ? [remove, ...(secondRemove ? [removeTwo] : [])] : [];
    },
  };
  const documentRef = {
    head: { append() {} },
    createElement: () => new FakeTarget(),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  return { documentRef, remove, removeTwo, root, rowStatus, secondRowStatus, status };
}

test("clicking a cocktail remove control posts its exact item and reloads", async () => {
  const fixture = createFixture();
  const calls = [];
  let reloads = 0;
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => "11111111-1111-4111-8111-111111111111",
    reload: () => { reloads += 1; },
    request: async (payload) => {
      calls.push(payload || null);
      return payload
        ? { message: "Cocktail removed." }
        : { generatedAt: GENERATED_AT, revision: 12 };
    },
  });

  await fixture.remove.dispatch("click");

  assert.deepEqual(calls, [
    null,
    {
      action: "subtract",
      generatedAt: GENERATED_AT,
      expectedRevision: 12,
      requestId: "11111111-1111-4111-8111-111111111111",
      itemId: "cocktail:house%20margarita%201",
    },
  ]);
  assert.equal(reloads, 1);
  assert.equal(fixture.rowStatus.textContent, "Removed. Refreshing the plan...");
  assert.equal(fixture.rowStatus.dataset.error, "false");
  assert.equal(fixture.remove.textContent, "Removed");
  assert.equal(fixture.remove.disabled, true);
  assert.equal(fixture.remove.attributes.get("aria-label"), "One planned keg removed");
  assert.equal(fixture.remove.attributes.get("title"), "One planned keg removed");
});

test("the rendered Weekly Plan exposes the generation used by removal controls", () => {
  assert.match(
    dashboardSource,
    /weeklyPlan\.dataset\.generatedAt\s*=\s*clean\(recommendations\?\.generatedAt\)/,
  );
  assert.match(
    dashboardSource,
    /renderWeeklyPlanCocktailRows\(plan\.prep\.cocktails, \{ editable: planLocked \}\)/,
  );
});

test("an API revision response refreshes once and retries the cocktail removal", async () => {
  const fixture = createFixture();
  const calls = [];
  let reloads = 0;
  const requestId = "11111111-1111-4111-8111-111111111111";
  const responses = [
    { ok: true, status: 200, body: { generatedAt: GENERATED_AT, revision: 20 } },
    { ok: false, status: 409, body: { error: "The plan changed. Reload prep before subtracting a keg.", code: "WEEKLY_PREP_REVISION_CONFLICT" } },
    { ok: true, status: 200, body: { generatedAt: GENERATED_AT, revision: 21 } },
    { ok: true, status: 200, body: { message: "Cocktail removed." } },
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    const response = responses.shift();
    return { ok: response.ok, status: response.status, json: async () => response.body };
  };
  try {
    bindWeeklyPrepAdder(fixture.root, {
      documentRef: fixture.documentRef,
      createRequestId: () => requestId,
      reload: () => { reloads += 1; },
    });

    await fixture.remove.dispatch("click");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 4);
  const firstPost = JSON.parse(calls[1].options.body);
  const secondPost = JSON.parse(calls[3].options.body);
  assert.equal(firstPost.expectedRevision, 20);
  assert.equal(secondPost.expectedRevision, 21);
  assert.equal(firstPost.requestId, secondPost.requestId);
  assert.equal(reloads, 1);
  assert.equal(fixture.rowStatus.dataset.error, "false");
  assert.equal(fixture.remove.textContent, "Removed");
  assert.equal(fixture.remove.disabled, true);
});

test("an uncertain response keeps one removal id through a later storage conflict", async () => {
  const fixture = createFixture();
  const calls = [];
  const requestId = "11111111-1111-4111-8111-111111111111";
  let reloads = 0;
  let phase = 0;
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => requestId,
    reload: () => { reloads += 1; },
    request: async (payload) => {
      calls.push(payload || null);
      phase += 1;
      if (phase === 1) return { generatedAt: GENERATED_AT, revision: 20 };
      if (phase === 2) throw new Error("The response was interrupted.");
      if (phase === 3) {
        const error = new Error("Shared Keg Levels changed in another session. Reload before saving again.");
        error.status = 409;
        error.code = "KEG_STATE_REVISION_CONFLICT";
        throw error;
      }
      if (phase === 4) return { generatedAt: GENERATED_AT, revision: 21 };
      return { message: "Cocktail removed." };
    },
  });

  await fixture.remove.dispatch("click");
  assert.equal(reloads, 0);
  assert.equal(fixture.remove.disabled, false);
  await fixture.remove.dispatch("click");

  assert.equal(calls.length, 5);
  assert.equal(calls[1].requestId, requestId);
  assert.equal(calls[2].requestId, requestId);
  assert.equal(calls[4].requestId, requestId);
  assert.equal(calls[4].expectedRevision, 21);
  assert.equal(reloads, 1);
  assert.equal(fixture.remove.disabled, true);
});

test("uncertain removals retain separate retry identities for each cocktail", async () => {
  const fixture = createFixture({ secondRemove: true });
  const calls = [];
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  let reloads = 0;
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => ids.shift(),
    reload: () => { reloads += 1; },
    request: async (payload) => {
      calls.push(payload || null);
      if (!payload) return { generatedAt: GENERATED_AT, revision: 20 };
      if (calls.length < 5) throw new Error("The response was interrupted.");
      return { message: "Cocktail removed." };
    },
  });

  await fixture.remove.dispatch("click");
  await fixture.removeTwo.dispatch("click");
  await fixture.remove.dispatch("click");

  assert.equal(calls.length, 5);
  assert.equal(calls[1].itemId, "cocktail:house%20margarita%201");
  assert.equal(calls[1].requestId, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[3].itemId, "cocktail:peach%20margarita%201");
  assert.equal(calls[3].requestId, "22222222-2222-4222-8222-222222222222");
  assert.equal(calls[4].itemId, "cocktail:house%20margarita%201");
  assert.equal(calls[4].requestId, "11111111-1111-4111-8111-111111111111");
  assert.equal(reloads, 1);
});

test("a retry never removes a cocktail from a newly generated plan", async () => {
  const fixture = createFixture();
  const calls = [];
  let reloads = 0;
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => "11111111-1111-4111-8111-111111111111",
    reload: () => { reloads += 1; },
    request: async (payload) => {
      calls.push(payload || null);
      if (calls.length === 1) return { generatedAt: GENERATED_AT, revision: 20 };
      if (calls.length === 2) {
        const error = new Error("The plan changed. Reload prep before subtracting a keg.");
        error.status = 409;
        error.code = "WEEKLY_PREP_REVISION_CONFLICT";
        throw error;
      }
      return { generatedAt: "2026-10-06T04:59:15.144Z", revision: 1 };
    },
  });

  await fixture.remove.dispatch("click");

  assert.equal(calls.length, 3);
  assert.equal(reloads, 0);
  assert.match(fixture.rowStatus.textContent, /weekly plan changed/i);
  assert.equal(fixture.rowStatus.dataset.error, "true");
  assert.equal(fixture.remove.textContent, "×");
  assert.equal(fixture.remove.disabled, false);
});

test("a stale rendered plan stops before posting a removal", async () => {
  const fixture = createFixture();
  const calls = [];
  let requestIds = 0;
  let reloads = 0;
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => { requestIds += 1; return "11111111-1111-4111-8111-111111111111"; },
    reload: () => { reloads += 1; },
    request: async (payload) => {
      calls.push(payload || null);
      return { generatedAt: "2026-10-06T04:59:15.144Z", revision: 1 };
    },
  });

  await fixture.remove.dispatch("click");

  assert.deepEqual(calls, [null]);
  assert.equal(requestIds, 0);
  assert.equal(reloads, 0);
  assert.match(fixture.rowStatus.textContent, /weekly plan changed/i);
  assert.equal(fixture.rowStatus.dataset.error, "true");
  assert.equal(fixture.remove.disabled, false);
});

test("a failed removal reports the error beside the cocktail and stays retryable", async () => {
  const fixture = createFixture();
  const calls = [];
  let reloads = 0;
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => "11111111-1111-4111-8111-111111111111",
    reload: () => { reloads += 1; },
    request: async (payload) => {
      calls.push(payload || null);
      if (!payload) return { generatedAt: GENERATED_AT, revision: 12 };
      const error = new Error("The cocktail could not be removed. Try again.");
      error.status = 503;
      throw error;
    },
  });

  await fixture.remove.dispatch("click");

  assert.equal(calls.length, 2);
  assert.equal(reloads, 0);
  assert.equal(fixture.rowStatus.textContent, "The cocktail could not be removed. Try again.");
  assert.equal(fixture.rowStatus.dataset.error, "true");
  assert.equal(fixture.remove.textContent, "×");
  assert.equal(fixture.remove.disabled, false);
});

test("a completed removal stays disabled if the page cannot reload", async () => {
  const fixture = createFixture();
  bindWeeklyPrepAdder(fixture.root, {
    documentRef: fixture.documentRef,
    createRequestId: () => "11111111-1111-4111-8111-111111111111",
    reload: () => { throw new Error("Navigation unavailable"); },
    request: async (payload) => payload
      ? { message: "Cocktail removed." }
      : { generatedAt: GENERATED_AT, revision: 12 },
  });

  await fixture.remove.dispatch("click");

  assert.equal(fixture.rowStatus.textContent, "Removed. Refresh the page to see the updated plan.");
  assert.equal(fixture.rowStatus.dataset.error, "false");
  assert.equal(fixture.remove.textContent, "Removed");
  assert.equal(fixture.remove.disabled, true);
});
