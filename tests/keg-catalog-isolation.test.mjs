import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as safety from "../lib/pmb-keg-safety.mjs";
import { findExactLastKnownKegLevel } from "../public/keg-level-fallback.mjs";
import { sameTapProduct } from "../lib/pmb-tap-product-history.mjs";

const slots = [
  { tapNumber: 23, deviceId: 9001, lineNum: 1, plu: 4101, product: "Test Lager" },
  { tapNumber: 24, deviceId: 9001, lineNum: 2, plu: 4102, product: "Test IPA" },
  { tapNumber: 38, deviceId: 9002, lineNum: 1, plu: 11111, product: "Coming Soon!" },
];
const catalog = slots.map(slot => ({ plu: slot.plu, name: slot.product, volume_unit: "oz", volume_unit_dp: 0 }));
const saved = {
  updatedAt: "2026-10-15T15:01:49.812Z",
  items: slots.map(slot => ({ ...slot, tapProduct: slot.product, name: slot.product,
    fillLevelPercent: 80, rawPercent: 8000, rawKegSize: 1984, rawKegSizeDp: 0, levelAvailable: true })),
};

async function readLevels({ products = catalog, config = slots, failedTaps = [], snapshot = saved } = {}) {
  // Execute the real route with only its I/O replaced. No PMB or storage writes.
  const source = readFileSync(new URL("../app/api/keg-levels/route.js", import.meta.url), "utf8")
    .replace(/^import\s[\s\S]*?;\n/gm, "")
    .replace("export async function GET", "async function GET");
  const effects = { requests: [], snapshots: [], finished: [] };
  const dependencies = {
    ...safety,
    NextResponse: { json: (body, options) => Response.json(body, options) },
    process: { env: { PMB_API_BASE_URL: "http://pmb.invalid", PMB_API_USERNAME: "test", PMB_API_PASSWORD: "test" } },
    fetch: async (url, options) => {
      const path = new URL(url).pathname;
      const body = JSON.parse(options.body);
      effects.requests.push({ path, body });
      if (path === "/api/authtoken") return Response.json({ authtoken: "test-token" });
      if (path === "/api/productlist") return Response.json({ productlist: products });
      assert.equal(path, "/api/getkeglevels");
      const slot = config.find(s => s.deviceId === body.device_id && s.lineNum === body.line_num);
      assert.ok(slot, "Only verified controller slots are read");
      if (failedTaps.includes(slot.tapNumber)) return Response.json({ fill_level_perc: 0, fill_level_keg_size: 0, fill_level_keg_size_dp: 0 });
      return Response.json({ fill_level_perc: 4250, fill_level_keg_size: 1984, fill_level_keg_size_dp: 0 });
    },
    getTapConfigRows: async () => config,
    getKegTappedOnRows: async () => [],
    readPmbLevelSnapshot: async () => snapshot,
    savePmbLevelSnapshot: async value => effects.snapshots.push(value),
    findExactLastKnownKegLevel,
    sameTapProduct,
    createPmbCheckHistory: () => ({ start: async () => {}, stage() {}, expect() {}, attempt() {}, finish: async value => effects.finished.push(value) }),
    recordTapProductObservations: async () => [],
    attachTapProductHistory: items => items,
    getKegWallItems: async () => [],
    observeSharedKegChanges: async () => ({ available: true, changed: false }),
  };
  const handler = new Function(...Object.keys(dependencies), `${source}\nreturn GET;`)(...Object.values(dependencies));
  const response = await handler(new Request("http://localhost/api/keg-levels"));
  return { status: response.status, body: await response.json(), effects };
}

test("an invalid unassigned catalog record cannot replace fresh controller readings with an old snapshot", async () => {
  const { body, effects } = await readLevels({ products: [...catalog, { plu: 0, name: "Unassigned catalog entry" }] });
  assert.equal(body.stale, false);
  assert.equal(body.capturedCount, 3);
  assert.equal(body.partial, false);
  assert.ok(Date.parse(body.updatedAt) > Date.parse(saved.updatedAt));
  assert.deepEqual(body.items.map(item => item.fillLevelPercent), [42.5, 42.5, 42.5]);
  assert.equal(effects.snapshots.length, 1);
  assert.deepEqual(body.catalogIssues, [{ recordNumber: 4, plu: 0, name: "Unassigned catalog entry", code: "PMB_PRODUCT_IDENTITY_INVALID" }]);
});

test("unassigned conflicting catalog records do not block exact tap products", async () => {
  const { body } = await readLevels({ products: [...catalog, { plu: 9999, name: "Old" }, { plu: 9999, name: "Other" }, null] });
  assert.equal(body.stale, false);
  assert.deepEqual(body.items.map(item => item.plu), slots.map(slot => slot.plu));
  assert.deepEqual(body.catalogIssues, [{ recordNumber: 6, plu: null, name: "", code: "PMB_PRODUCT_IDENTITY_INVALID" }]);
});

test("failed controllers retain only their exact last-known readings while other taps refresh", async () => {
  const snapshot = structuredClone(saved);
  // The old snapshot still calls tap 38 Stella. It must not be reused for Coming Soon.
  Object.assign(snapshot.items[2], { plu: 59321, name: "Stella Artois 1", tapProduct: "Stella Artois 1" });
  const { body, effects } = await readLevels({ products: [...catalog, { plu: "invalid" }], failedTaps: [24, 38], snapshot });
  assert.equal(body.stale, false);
  assert.equal(body.partial, true);
  assert.equal(body.capturedCount, 1);
  assert.equal(body.expectedCount, 3);
  assert.equal(body.items[0].fillLevelPercent, 42.5);
  assert.equal(body.items[0].levelAvailable, true);
  assert.equal(body.items[1].fillLevelPercent, 80);
  assert.equal(body.items[1].levelAvailable, false);
  assert.equal(body.items[1].lastKnownAt, saved.updatedAt);
  assert.equal(body.items[2].fillLevelPercent, null);
  assert.equal(body.items[2].levelAvailable, false);
  assert.equal(body.items[2].name, "Coming Soon!");
  assert.equal(effects.snapshots.length, 0, "A partial read cannot overwrite the complete fallback snapshot");
});

test("ambiguous live tap assignments still fail closed", async () => {
  const { body, effects } = await readLevels({ config: [...slots, { ...slots[0], plu: 9999 }] });
  assert.equal(body.stale, true);
  assert.equal(effects.snapshots.length, 0);
  assert.equal(effects.requests.some(request => request.path === "/api/getkeglevels"), false);
});

test("conflicting records for an assigned product still fail closed", async () => {
  const { body, effects } = await readLevels({ products: [...catalog, { ...catalog[0], name: "Different product" }] });
  assert.equal(body.stale, true);
  assert.match(body.liveError, /conflicting product records/);
  assert.equal(effects.snapshots.length, 0);
});

test("missing or mismatched assigned product identities fail before reading controllers", async () => {
  for (const products of [catalog.slice(1), [{ ...catalog[0], name: "Another beer" }, ...catalog.slice(1)]]) {
    const { body, effects } = await readLevels({ products });
    assert.equal(body.stale, true);
    assert.match(body.liveError, /product identity.*tap 23/i);
    assert.equal(effects.snapshots.length, 0);
    assert.equal(effects.requests.some(request => request.path === "/api/getkeglevels"), false);
  }
});
