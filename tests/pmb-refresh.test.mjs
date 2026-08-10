import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchPmbJsonWithRetry,
  isRetryablePmbStatus,
} from "../public/pmb-refresh.mjs";

function response(status) {
  return { ok: status >= 200 && status < 300, status };
}

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
