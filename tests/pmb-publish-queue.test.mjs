import assert from "node:assert/strict";
import test from "node:test";
import {
  enqueuePmbPublishItem,
  getPmbPublishQueueCounts,
  markPmbPublishFailed,
  markPmbPublished,
  normalizePmbPublishQueue,
  removePmbPublishItem,
} from "../public/pmb-publish-queue.mjs";

const beerPayload = {
  productKind: "beer",
  name: "Miller Lite",
  pricePerOz: 0.42,
  servingOz: 16,
  brewery: "Miller Brewing Company",
  style: "Lager",
  abvPercent: 4.2,
  kegOz: 1984,
  kegCost: 185,
  targetMargin: 82,
};

test("queues a ready PMB product without sending or inventing publish data", () => {
  const result = enqueuePmbPublishItem([], beerPayload, {
    id: "queue-1",
    now: "2026-07-31T12:00:00.000Z",
  });

  assert.equal(result.replaced, false);
  assert.equal(result.item.id, "queue-1");
  assert.equal(result.item.status, "ready");
  assert.equal(result.item.attempts, 0);
  assert.equal(result.item.publishedAt, "");
  assert.equal(result.item.publishedProduct, null);
  assert.deepEqual(result.item.payload, beerPayload);
});

test("saving the same unpublished product updates one queue entry", () => {
  const first = enqueuePmbPublishItem([], beerPayload, {
    id: "queue-1",
    now: "2026-07-31T12:00:00.000Z",
  });
  const second = enqueuePmbPublishItem(first.queue, {
    ...beerPayload,
    name: "  Miller   Lite ",
    pricePerOz: 0.45,
  }, {
    id: "queue-2",
    now: "2026-07-31T13:00:00.000Z",
  });

  assert.equal(second.replaced, true);
  assert.equal(second.queue.length, 1);
  assert.equal(second.item.id, "queue-1");
  assert.equal(second.item.payload.pricePerOz, 0.45);
  assert.equal(second.item.createdAt, "2026-07-31T12:00:00.000Z");
  assert.equal(second.item.updatedAt, "2026-07-31T13:00:00.000Z");
});

test("failed publishes remain retryable with a bounded error record", () => {
  const queued = enqueuePmbPublishItem([], beerPayload, {
    id: "queue-1",
    now: "2026-07-31T12:00:00.000Z",
  }).queue;
  const failed = markPmbPublishFailed(
    queued,
    "queue-1",
    `offline ${"x".repeat(700)}`,
    { now: "2026-07-31T14:00:00.000Z" },
  );

  assert.equal(failed[0].status, "failed");
  assert.equal(failed[0].attempts, 1);
  assert.equal(failed[0].lastAttemptAt, "2026-07-31T14:00:00.000Z");
  assert.equal(failed[0].lastError.length, 500);
  assert.deepEqual(getPmbPublishQueueCounts(failed), {
    total: 1,
    ready: 0,
    failed: 1,
    published: 0,
  });
});

test("successful publishes retain a small audit record and allow a new future entry", () => {
  const queued = enqueuePmbPublishItem([], beerPayload, {
    id: "queue-1",
    now: "2026-07-31T12:00:00.000Z",
  }).queue;
  const published = markPmbPublished(queued, "queue-1", {
    plu: 12345,
    name: "Miller Lite",
    tasting_notes: "Large PMB response fields are not retained.",
  }, {
    now: "2026-07-31T15:00:00.000Z",
  });

  assert.equal(published[0].status, "published");
  assert.equal(published[0].attempts, 1);
  assert.deepEqual(published[0].publishedProduct, {
    plu: 12345,
    name: "Miller Lite",
  });

  const next = enqueuePmbPublishItem(published, beerPayload, {
    id: "queue-2",
    now: "2026-08-01T12:00:00.000Z",
  });
  assert.equal(next.replaced, false);
  assert.equal(next.queue.length, 2);
  assert.equal(next.item.id, "queue-2");
});

test("normalization removes malformed and duplicate-id entries", () => {
  const valid = enqueuePmbPublishItem([], beerPayload, {
    id: "queue-1",
    now: "2026-07-31T12:00:00.000Z",
  }).item;
  const normalized = normalizePmbPublishQueue([
    valid,
    { ...valid, name: "Duplicate ID" },
    { id: "bad", kind: "wine", name: "Not supported", payload: {} },
    null,
  ]);

  assert.deepEqual(normalized, [valid]);
});

test("queue entries can be intentionally removed", () => {
  const queued = enqueuePmbPublishItem([], beerPayload, {
    id: "queue-1",
    now: "2026-07-31T12:00:00.000Z",
  }).queue;
  assert.deepEqual(removePmbPublishItem(queued, "queue-1"), []);
});
