import test from "node:test";
import assert from "node:assert/strict";
import { createPmbCheckHistory } from "../lib/pmb-check-history.mjs";

function harness(trigger = "automatic") {
  const saved = [];
  let time = new Date("2026-09-17T09:00:00Z");
  const check = createPmbCheckHistory(new Request(`http://localhost/api/keg-levels?checkSource=${trigger}`), {
    store: { save: async (source, data) => { saved.push({ source, data: structuredClone(data) }); } },
    now: () => time,
  });
  return { check, saved, advance: () => { time = new Date(time.getTime() + 1000); } };
}
const slot = { tapNumber: 79, deviceId: 123, lineNum: 1, plu: 456 };

test("complete checks retain their start record and stable unique identity", async () => {
  const h = harness();
  await h.check.start();
  h.check.expect([slot]);
  h.check.stage("controller-readings");
  h.advance();
  h.check.attempt(slot, 1, "2026-09-17T09:00:00Z");
  await h.check.finish({ items: [{ ...slot, levelAvailable: true }] });
  assert.equal(h.saved[0].data.status, "running");
  assert.equal(h.saved[1].source, h.saved[0].source);
  assert.equal(h.saved[1].data.status, "complete");
  assert.equal(h.saved[1].data.durationMs, 1000);
  assert.equal(h.saved[1].data.expectedCount, 1);
  assert.equal(h.saved[1].data.capturedCount, 1);
  assert.equal(h.saved[1].data.trigger, "automatic");
  assert.equal(h.saved[1].data.attempts[0].deviceId, 123);
  const other = harness(); await other.check.start();
  assert.notEqual(other.saved[0].source, h.saved[0].source);
});

test("partial checks retain missing taps and timed-out attempts without upstream secrets", async () => {
  const h = harness("repair-verification");
  h.check.expect([slot]);
  h.check.attempt(slot, 1, "2026-09-17T09:00:00Z", Object.assign(new Error("Timed out token=private"), { name: "TimeoutError" }));
  await h.check.finish({ items: [{ ...slot, levelAvailable: false, lastKnownAt: "2026-09-17T08:00:00Z" }] });
  const record = h.saved[0].data;
  assert.equal(record.status, "partial");
  assert.equal(record.capturedCount, 0);
  assert.equal(record.trigger, "repair-verification");
  assert.equal(record.attempts[0].error.kind, "timeout");
  assert.equal(record.taps[0].available, false);
  assert.equal(record.taps[0].lastKnownAt, "2026-09-17T08:00:00Z");
  assert.ok(!JSON.stringify(record).includes("private"));
});

test("failed authentication is not presented as zero taps or a successful fallback", async () => {
  const h = harness("untrusted-value");
  await h.check.start();
  await h.check.finish({ error: Object.assign(new Error("Authentication failed"), { code: "PMB_AUTH_UNAVAILABLE" }) });
  const record = h.saved[1].data;
  assert.equal(record.status, "failed");
  assert.equal(record.expectedCount, null);
  assert.equal(record.capturedCount, null);
  assert.equal(record.error.kind, "authentication");
  assert.equal(record.trigger, "dashboard");
});
