import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPmbJsonWithRetry,
  isRetryablePmbStatus,
} from "../public/pmb-refresh.mjs";

function response(status) {
  return { ok: status >= 200 && status < 300, status };
}

test("retries saved keg readings even when the server returns HTTP 200", async () => {
  const readings = [
    { stale: true, updatedAt: "2026-09-10T12:00:00Z", liveError: "Connection interrupted" },
    { stale: false, updatedAt: "2026-09-11T12:00:00Z", capturedCount: 102 },
  ];
  const result = await fetchPmbJsonWithRetry({
    fetcher: async () => response(200),
    parseResponse: async () => readings.shift(),
    shouldRetryResult: (value) => value?.stale === true,
    sleep: async () => {},
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.result.stale, false);
  assert.equal(result.result.capturedCount, 102);
  assert.equal(result.result.updatedAt, "2026-09-11T12:00:00Z");
});

test("exhausted keg retries preserve the stale flag, old timestamp, and error", async () => {
  const saved = { stale: true, updatedAt: "2026-09-10T12:00:00Z", liveError: "PMB unavailable" };
  const result = await fetchPmbJsonWithRetry({
    fetcher: async () => response(200),
    parseResponse: async () => saved,
    shouldRetryResult: (value) => value?.stale === true,
    sleep: async () => {},
  });
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.result, saved);
});

test("fresh keg readings return immediately without a duplicate refresh", async () => {
  let calls = 0;
  const result = await fetchPmbJsonWithRetry({
    fetcher: async () => { calls += 1; return response(200); },
    parseResponse: async () => ({ stale: false, capturedCount: 102 }),
    shouldRetryResult: (value) => value?.stale === true,
    sleep: async () => {},
  });
  assert.equal(calls, 1);
  assert.equal(result.attempts, 1);
});

test("recognizes transient PMB gateway failures, including Cloudflare 520", () => {
  [502, 503, 504, 520, 521, 522, 523, 524].forEach((status) => {
    assert.equal(isRetryablePmbStatus(status), true, String(status));
  });
  [400, 401, 403, 404, 500].forEach((status) => {
    assert.equal(isRetryablePmbStatus(status), false, String(status));
  });
});

test("retries a temporary HTML 520 response and returns the next JSON success", async () => {
  const statuses = [520, 200];
  const sleeps = [];
  const result = await fetchPmbJsonWithRetry({
    fetcher: async () => response(statuses.shift()),
    parseResponse: async (currentResponse) => currentResponse.status === 200
      ? { items: [{ name: "Guinness" }] }
      : { error: "HTML page instead of JSON (520)" },
    sleep: async (delayMs) => sleeps.push(delayMs),
    retryDelayMs: 25,
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.result, { items: [{ name: "Guinness" }] });
  assert.equal(result.attempts, 2);
  assert.deepEqual(sleeps, [25]);
});

test("does not retry login errors or loop forever on repeated gateway failures", async () => {
  let loginAttempts = 0;
  const login = await fetchPmbJsonWithRetry({
    fetcher: async () => {
      loginAttempts += 1;
      return response(401);
    },
    parseResponse: async () => ({ error: "Login required" }),
    sleep: async () => {},
  });
  assert.equal(loginAttempts, 1);
  assert.equal(login.response.status, 401);

  let gatewayAttempts = 0;
  const gateway = await fetchPmbJsonWithRetry({
    fetcher: async () => {
      gatewayAttempts += 1;
      return response(520);
    },
    parseResponse: async () => ({ error: "Gateway error" }),
    sleep: async () => {},
    maxAttempts: 2,
  });
  assert.equal(gatewayAttempts, 2);
  assert.equal(gateway.attempts, 2);
  assert.equal(gateway.response.status, 520);
});
