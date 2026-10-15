import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { getTapConfigRows } from "../lib/pmb-tap-config.mjs";
import { readPmbPricingManagementPage, readPmbOperationalPage } from "../lib/pmb-item-management.mjs";

const mapping = '<tbody><tr id="dev9001_r1"><td class="plunum">1: PLU#500 Test Beer 1</td><td><input type="text" name="fd_line_name" value="21"></td></tr></tbody>';
async function controller(t, handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, username: "fixture", password: "fixture" };
}
const challenge = (res, nonce = "first") => { res.writeHead(401, { "WWW-Authenticate": `Digest realm="fixture", nonce="${nonce}", qop="auth"` }); res.end(); };

test("keg configuration recovers from interrupted connections and reuses pricing authentication", async t => {
  let unauthenticated = 0;
  let interrupted = 0;
  const requests = [];
  const config = await controller(t, (req, res) => {
    requests.push({ method: req.method, url: req.url });
    if (!req.headers.authorization) { unauthenticated++; return challenge(res); }
    if (interrupted++ < 2) return req.socket.destroy();
    res.end(mapping);
  });
  assert.equal(await readPmbPricingManagementPage(config), mapping);
  const rows = await getTapConfigRows(config);
  assert.equal(rows[0].tapNumber, 21);
  assert.equal(rows[0].plu, 500);
  assert.equal(unauthenticated, 1);
  assert.ok(requests.every(req => req.method === "GET" && req.url === "/pages/tapconfig"));
});

test("keg reads recover from temporary HTTP failures and reject invalid tap mappings", async t => {
  let requests = 0;
  let valid = true;
  const config = await controller(t, (req, res) => {
    requests++;
    if (requests < 3) { res.statusCode = 503; return res.end("Unavailable"); }
    res.end(valid ? mapping : "<html>No taps</html>");
  });
  assert.equal((await getTapConfigRows(config))[0].plu, 500);
  assert.equal(requests, 3);
  valid = false;
  await assert.rejects(getTapConfigRows(config), error => error.code === "PMB_TAP_CONFIG_UNAVAILABLE");
});

test("operational reads renew a rejected challenge and remain bounded", async t => {
  let authenticated = 0;
  const config = await controller(t, (req, res) => {
    if (!req.headers.authorization) return challenge(res);
    authenticated++;
    if (authenticated === 2) return challenge(res, "renewed");
    if (authenticated === 3) assert.match(req.headers.authorization, /nonce="renewed"/);
    if (req.url === "/pages/keglevel") return;
    res.end(mapping);
  });
  await getTapConfigRows(config);
  await getTapConfigRows(config);
  const start = Date.now();
  await assert.rejects(readPmbOperationalPage(config, "/pages/keglevel", { timeoutMs: 40 }));
  assert.ok(Date.now() - start < 1000);
  await assert.rejects(readPmbOperationalPage(config, "/pages/configupdate"), /Unsupported/);
});
