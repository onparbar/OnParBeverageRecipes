import assert from "node:assert/strict";
import test from "node:test";
import { sendFullPmbConfigUpdate } from "../lib/pmb-full-config-update.mjs";

const ENV = {
  PMB_API_BASE_URL: "https://pmb.test/",
  PMB_API_USERNAME: "test-user",
  PMB_API_PASSWORD: "test-password",
};
const AUTH_RESPONSE = { status: 200, body: { authtoken: "test-token" } };

function fakeFetch(responses, events = []) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      events.push(new URL(url).pathname);
      const response = responses[calls.length - 1];
      assert.ok(response, "Unexpected PMB request");
      if (response instanceof Error) throw response;
      return {
        status: response.status,
        text: async () => {
          if (response.readError) throw response.readError;
          return typeof response.body === "string" ? response.body : JSON.stringify(response.body ?? {});
        },
      };
    },
  };
}

test("authenticates, checks the window, and sends exactly one bounded full-wall update", async (t) => {
  const timeoutCalls = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    timeoutCalls.push(milliseconds);
    return new AbortController().signal;
  });
  const events = [];
  const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE, { status: 200, body: "" }], events);
  const result = await sendFullPmbConfigUpdate({
    env: ENV,
    fetchImpl,
    beforeWrite: async () => events.push("guard"),
  });

  assert.equal(result.path, "/api/configupdate");
  assert.match(result.message, /Configuration update sent/);
  assert.deepEqual(events, ["/api/authtoken", "guard", "/api/configupdate"]);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    username: "test-user", password: "test-password", id: 910423,
    name: "PourMyBeer API", type: "json-server-control", version: 1,
  });
  assert.deepEqual(JSON.parse(calls[1].options.body), { id: "910423" });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(timeoutCalls, [15_000, 15_000]);
  for (const { options } of calls) {
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("does not send an update when the window closes during authentication", async () => {
  const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE]);
  const windowError = new Error("Outside the scheduled repair window.");
  await assert.rejects(sendFullPmbConfigUpdate({
    env: ENV,
    fetchImpl,
    beforeWrite: async () => { throw windowError; },
  }), (error) => error === windowError);
  assert.equal(calls.length, 1);
});

for (const status of [404, 405]) {
  test(`allows one fallback after definitive HTTP ${status}, checking the window again`, async () => {
    const events = [];
    const { fetchImpl, calls } = fakeFetch([
      AUTH_RESPONSE, { status, body: "Unavailable endpoint" }, { status: 200, body: "OK" },
    ], events);
    const result = await sendFullPmbConfigUpdate({
      env: ENV, fetchImpl, beforeWrite: async () => events.push("guard"),
    });
    assert.equal(result.path, "/m2m/api/configupdate");
    assert.deepEqual(events, ["/api/authtoken", "guard", "/api/configupdate", "guard", "/m2m/api/configupdate"]);
    assert.deepEqual(JSON.parse(calls[2].options.body), { id: "910423" });
  });
}

test("suppresses fallback if the scheduled window closes after the first endpoint response", async () => {
  const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE, { status: 404 }]);
  let guardCalls = 0;
  await assert.rejects(sendFullPmbConfigUpdate({
    env: ENV,
    fetchImpl,
    beforeWrite: async () => {
      guardCalls += 1;
      if (guardCalls === 2) throw new Error("Window closed.");
    },
  }), /Window closed/);
  assert.equal(guardCalls, 2);
  assert.equal(calls.length, 2);
});

for (const status of [201, 202, 204, 302, 400, 401, 403, 408, 429, 500, 502, 503]) {
  test(`stops without fallback when HTTP ${status} does not confirm the update`, async () => {
    const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE, { status }]);
    await assert.rejects(sendFullPmbConfigUpdate({ env: ENV, fetchImpl }), /did not confirm.*No automatic retry/);
    assert.equal(calls.length, 2);
  });
}

for (const body of [{ success: false }, { ok: false }, { error: "private PMB failure detail" }]) {
  test(`rejects an explicitly failed HTTP 200 response (${Object.keys(body)[0]})`, async () => {
    const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE, { status: 200, body }]);
    await assert.rejects(sendFullPmbConfigUpdate({ env: ENV, fetchImpl }), (error) => {
      assert.match(error.message, /did not confirm/);
      assert.doesNotMatch(error.message, /private PMB/);
      return true;
    });
    assert.equal(calls.length, 2);
  });
}

for (const response of [
  new Error("Network error containing test-password"),
  new DOMException("Timed out with test-token", "TimeoutError"),
  { status: 200, readError: new Error("Body interrupted with test-token") },
  { status: 404, readError: new Error("Body interrupted with test-token") },
]) {
  test("never retries an uncertain request or exposes the underlying error", async () => {
    const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE, response]);
    await assert.rejects(sendFullPmbConfigUpdate({ env: ENV, fetchImpl }), (error) => {
      assert.match(error.message, /outcome is unconfirmed.*No automatic retry/);
      assert.doesNotMatch(error.message, /test-password|test-token/);
      return true;
    });
    assert.equal(calls.length, 2);
  });
}

test("never sends config updates without successful authentication", async () => {
  for (const response of [
    { status: 401 }, { status: 200, body: {} },
    { status: 200, body: { authtoken: "test-token", success: false } },
    new Error("private authentication error"),
  ]) {
    const { fetchImpl, calls } = fakeFetch([response]);
    let guardCalls = 0;
    await assert.rejects(sendFullPmbConfigUpdate({
      env: ENV, fetchImpl, beforeWrite: async () => { guardCalls += 1; },
    }), /authenticat/i);
    assert.equal(calls.length, 1);
    assert.equal(guardCalls, 0);
  }
});

test("validates connection settings before any request", async () => {
  for (const env of [{}, { ...ENV, PMB_API_CLIENT_ID: "NaN" }, { ...ENV, PMB_API_CLIENT_ID: "0" }]) {
    const { fetchImpl, calls } = fakeFetch([]);
    await assert.rejects(sendFullPmbConfigUpdate({ env, fetchImpl }), /settings are missing or invalid/);
    assert.equal(calls.length, 0);
  }
});

test("stops after a fallback failure without starting another repair", async () => {
  const { fetchImpl, calls } = fakeFetch([AUTH_RESPONSE, { status: 405 }, { status: 404 }]);
  await assert.rejects(sendFullPmbConfigUpdate({ env: ENV, fetchImpl }), /did not confirm/);
  assert.equal(calls.length, 3);
});
