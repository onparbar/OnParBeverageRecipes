import assert from "node:assert/strict";
import test from "node:test";
import { createPmbReportReader } from "../lib/pmb-report-reader.mjs";

test("concurrent denied report reads share one renewed session and keep their original inputs", async () => {
  let logins = 0;
  const calls = [];
  const read = await createPmbReportReader({ baseUrl: "https://pmb.test" }, async () => ++logins,
    async (base, path, body, token) => {
      calls.push([base, path, body.id, token]);
      return { status: token === 1 ? 401 : 200, value: body.id };
    });
  const results = await Promise.all([read("/api/transactions", { id: 1 }), read("/api/transactions", { id: 2 })]);
  assert.deepEqual(results, [{ status: 200, value: 1 }, { status: 200, value: 2 }]);
  assert.equal((await read("/api/getkeglevels", { id: 3 })).status, 200);
  assert.equal(logins, 2);
  assert.deepEqual(calls.map(call => call.slice(2)), [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2]]);
});

test("a persistent denial stays visible and other failures do not renew credentials", async () => {
  for (const status of [401, 403, 503]) {
    let logins = 0;
    let reads = 0;
    const read = await createPmbReportReader({ baseUrl: "https://pmb.test" }, async () => ++logins,
      async () => { reads++; return { status }; });
    assert.deepEqual(await read("/api/productlist", {}), { status });
    assert.deepEqual(await read("/api/productlist", {}), { status });
    assert.equal(logins, status === 401 ? 2 : 1);
    assert.equal(reads, status === 401 ? 3 : 2);
  }
});
