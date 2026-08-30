import assert from "node:assert/strict";
import test from "node:test";

import {
  createPmbRefreshCoordinator,
  runPmbRefreshTransaction,
} from "../public/pmb-refresh.mjs";
import {
  appendOperationalLearningEvents,
  buildOperationalLearningSuggestions,
  createOperationalLearningEvent,
} from "../public/operations-learning.mjs";
import { buildOperationalRecovery } from "../public/operational-outbox.mjs";
import {
  createResilientStaffFetch,
  createStaffMutationBatch,
} from "../public/staff-resilience.mjs";

test("one PMB transaction reports every read source with one concise result", async () => {
  const result = await runPmbRefreshTransaction({
    sources: [
      { key: "levels", label: "Keg levels", run: async () => ({ count: 102 }) },
      { key: "usage", label: "Weekly usage", run: async () => ({ count: 102 }) },
      { key: "pricing", label: "Tap pricing", run: async () => ({ count: 72 }) },
      { key: "identity", label: "Tap identity", run: async () => ({ count: 102 }) },
    ],
    now: () => new Date("2026-08-31T11:00:00.000Z"),
  });

  assert.equal(result.status, "ok");
  assert.equal(result.sourceCount, 4);
  assert.equal(result.successCount, 4);
  assert.equal(result.message, "PMB refreshed.");
});

test("simultaneous PMB refresh requests share one in-flight transaction", async () => {
  let calls = 0;
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const coordinator = createPmbRefreshCoordinator({
    sources: [{
      key: "levels",
      run: async () => {
        calls += 1;
        await blocker;
        return { count: 102 };
      },
    }],
  });
  const first = coordinator.refresh();
  const second = coordinator.refresh();
  assert.equal(first, second);
  release();
  assert.equal((await first).status, "ok");
  assert.equal(calls, 1);
});

test("staff reads retry once and fall back to the last safe in-memory plan", async () => {
  let mode = "success";
  let calls = 0;
  const resilientFetch = createResilientStaffFetch({
    fetcher: async () => {
      calls += 1;
      if (mode === "failure") throw new Error("offline");
      return new Response(JSON.stringify({ available: true, generatedAt: "week-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
    maxAttempts: 2,
    retryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal((await resilientFetch("/api/staff-prep-plan")).status, 200);
  mode = "failure";
  const fallback = await resilientFetch("/api/staff-prep-plan");
  assert.equal(fallback.status, 200);
  assert.equal(fallback.headers.get("x-onpar-data-source"), "last-known");
  assert.deepEqual(await fallback.json(), { available: true, generatedAt: "week-1" });
  assert.equal(calls, 3);
});

test("staff batches replace duplicate selections and save once", async () => {
  const sent = [];
  const batch = createStaffMutationBatch({
    send: async (entries) => sent.push(entries),
  });
  batch.enqueue("cocktail-1", { completed: true });
  batch.enqueue("cocktail-1", { completed: false });
  batch.enqueue("cocktail-2", { completed: true });
  const result = await batch.flush({ actor: "Jordan" });
  assert.equal(result.count, 2);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][0], { key: "cocktail-1", value: { completed: false } });
});

test("revision conflicts become one plain recovery action without discarding work", () => {
  const recovery = buildOperationalRecovery({
    conflict: true,
    message: "Shared Weekly Usage is now revision 43; this browser used revision 42.",
  });
  assert.deepEqual(recovery, {
    kind: "reload-latest",
    message: "Newer saved data is available. Your unsaved changes are still here.",
    action: "Reload latest and retry",
  });
});

test("learning suggests a review only after the same pattern spans multiple weeks", () => {
  const event = (generatedAt, occurredAt) => createOperationalLearningEvent({
    domain: "order",
    type: "order-increase",
    generatedAt,
    occurredAt,
    productKey: "guinness",
    productName: "Guinness",
    vendor: "Bonbright",
    plannedQuantity: 1,
    actualQuantity: 2,
  });
  const oneWeek = appendOperationalLearningEvents([], [event("week-1", "2026-08-24T12:00:00.000Z")]);
  assert.deepEqual(buildOperationalLearningSuggestions(oneWeek), []);
  const twoWeeks = appendOperationalLearningEvents(oneWeek, [event("week-2", "2026-08-31T12:00:00.000Z")]);
  const suggestions = buildOperationalLearningSuggestions(twoWeeks);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].title, "Review safety stock for Guinness");
  assert.equal(suggestions[0].autoApply, false);
});
