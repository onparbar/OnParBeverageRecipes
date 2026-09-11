import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  attachVerifiedPmbPortionIdentity,
  VERIFIED_PMB_PORTION_SCHEMA,
} from "../lib/verified-pmb-portions.mjs";

const moduleUrl = new URL("../lib/pmb-item-management.mjs", import.meta.url);
const source = (await readFile(moduleUrl, "utf8"))
  .replace(/from "(\.\/[^\"]+)"/g, (_, path) => `from ${JSON.stringify(new URL(path, moduleUrl).href)}`);
const { digestRequest, readOnlyDigestRequest } = await import(
  `data:text/javascript;base64,${Buffer.from(`${source}\nexport { digestRequest, readOnlyDigestRequest };`).toString("base64")}`
);

async function controller(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, username: "fixture", password: "fixture" };
}

function challenge(response, nonce = "first") {
  response.writeHead(401, { "WWW-Authenticate": `Digest realm="fixture", nonce="${nonce}", qop="auth"` });
  response.end();
}

test("management reuses a recent challenge with increasing nonce counts", async (t) => {
  let unauthenticated = 0;
  const authorizations = [];
  const config = await controller(t, (request, response) => {
    if (!request.headers.authorization) {
      unauthenticated += 1;
      return challenge(response);
    }
    authorizations.push(request.headers.authorization);
    response.end("Items");
  });
  for (let i = 0; i < 2; i += 1) {
    const result = await digestRequest(config, "GET", "/pages/items", Buffer.alloc(0), {}, new Map());
    assert.equal(result.status, 200);
  }
  assert.equal(unauthenticated, 1);
  assert.match(authorizations[0], /nc=00000001/);
  assert.match(authorizations[1], /nc=00000002/);
});

test("an explicit 401 renews an expired management challenge", async (t) => {
  let authenticated = 0;
  const config = await controller(t, (request, response) => {
    if (!request.headers.authorization) return challenge(response);
    authenticated += 1;
    if (authenticated === 2) return challenge(response, "renewed");
    if (authenticated === 3) assert.match(request.headers.authorization, /nonce="renewed"/);
    response.end("Items");
  });
  await digestRequest(config, "GET", "/pages/items", Buffer.alloc(0), {}, new Map());
  const result = await digestRequest(config, "GET", "/pages/items", Buffer.alloc(0), {}, new Map());
  assert.equal(result.status, 200);
  assert.equal(authenticated, 3);
});

test("read-only discovery recovers from two interrupted connections", async (t) => {
  let requests = 0;
  const config = await controller(t, (request, response) => {
    requests += 1;
    if (requests <= 2) return request.socket.destroy();
    if (!request.headers.authorization) return challenge(response);
    response.end("Items");
  });
  const result = await readOnlyDigestRequest(config, "GET", "/pages/items", Buffer.alloc(0), {}, new Map());
  assert.equal(result.status, 200);
  assert.equal(requests, 4);
});

test("an uncertain authenticated save is never automatically replayed", async (t) => {
  let saves = 0;
  const config = await controller(t, (request, response) => {
    if (!request.headers.authorization) return challenge(response);
    saves += 1;
    request.socket.destroy();
  });
  await assert.rejects(digestRequest(config, "POST", "/pages/items", Buffer.from("fixture=save"), {}, new Map()));
  assert.equal(saves, 1);
});

test("all ten Karaoke liquor products have distinct Single and Double identities", () => {
  const products = [196542, 145831, 52323, 46287, 25469, 35417, 23154, 132541, 115468, 4];
  const rows = attachVerifiedPmbPortionIdentity(products.flatMap((product_plu) => [
    { product_plu, portion_name: "Single" }, { product_plu, portion_name: "Double" },
  ]));
  const ids = rows.map((row) => row[VERIFIED_PMB_PORTION_SCHEMA.itemIdField]);
  assert.equal(new Set(ids).size, 20);
  assert.ok(ids.every(Boolean));
  assert.deepEqual(rows.map((row) => row[VERIFIED_PMB_PORTION_SCHEMA.quantityField]), products.flatMap(() => [1.5, 2]));
  const patron = attachVerifiedPmbPortionIdentity([
    { product_plu: 132541, portion_name: "Single" },
    { product_plu: 136985, portion_name: "Single" },
  ]);
  assert.equal(patron[0][VERIFIED_PMB_PORTION_SCHEMA.itemIdField], "321");
  assert.equal(patron[1][VERIFIED_PMB_PORTION_SCHEMA.itemIdField], "317");
});
