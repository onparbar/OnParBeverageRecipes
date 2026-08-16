import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

async function readProjectFile(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

test("PMB product creation authenticates the owner before parsing input or opening the connector", async () => {
  const source = await readProjectFile("app/api/pmb-products/route.js");
  const start = source.indexOf("export async function POST(request)");
  const handler = source.slice(start);
  const auth = handler.indexOf("requireDashboardRequestRole(request, { owner: true })");
  assert.ok(auth >= 0);
  assert.ok(auth < handler.indexOf("request.json()"));
  assert.ok(auth < handler.indexOf("getConfig()"));
});

test("PMB tap changes authenticate the owner before parsing input or opening the connector", async () => {
  const source = await readProjectFile("app/api/pmb-tap-product/route.js");
  const start = source.indexOf("export async function POST(request)");
  const handler = source.slice(start);
  const auth = handler.indexOf("requireDashboardRequestRole(request, { owner: true })");
  assert.ok(auth >= 0);
  assert.ok(auth < handler.indexOf("request.json()"));
  assert.ok(auth < handler.indexOf("getConfig()"));
  assert.match(source, /headers\.Cookie = cookie/);
});
