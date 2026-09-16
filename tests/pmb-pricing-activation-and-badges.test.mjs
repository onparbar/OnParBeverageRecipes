import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { readCurrentPmbPricing, productPriceFromPmbEditForm, validateCurrentPmbPriceProducts } from "../lib/pmb-pricing-reader.mjs";
import { activateQueuedPmbProducts, resolvePmbActivationTargets, inspectPmbActivationForm } from "../lib/pmb-product-activation.mjs";
import { getTapNewBadge, getTapHistoryContext } from "../public/tap-first-pour.mjs";
import { LOCAL_AI_COLUMNS, sanitizeLocalAiSnapshot } from "../lib/local-ai-data.mjs";

const product = { plu: 500, name: "Test Beer 1", price_per_unit: 65, product_type: 1, volume_unit: "oz" };
const current = { tapNumber: 21, plu: 500, name: product.name };
const form = ({ active = false, price = "0.65", plu = 500, name = product.name } = {}) => `<form method="post">
  <input name="fd_plu" value="${plu}"><input name="fd_name" value="${name}">
  <input name="fd_price_per_unit" value="${price}"><input name="fd_price_per_unit_hh1" value="0.50">
  <input name="fd_volume_unit" value="oz"><input name="fd_product_type" value="1">
  <input name="fd_image_ref" value="keep-image"><textarea name="fd_tasting_notes">Keep these notes</textarea>
  <input type="checkbox" name="fd_is_active" value="on" ${active ? "checked" : ""}>
  <button name="submit_saveedit_product">Save</button></form>`;
const mapping = `<tbody><tr id="dev9001_r1"><td class="plunum">1: PLU#500 Test Beer 1</td>
  <td><input type="text" name="fd_line_name" value="21"></td></tr></tbody>`;

async function mockPmb(t, mode = {}) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    calls.push({ path: request.url, method: request.method, body });
    response.setHeader("Connection", "close");
    if (request.url === "/pages/tapconfig") return response.end(mapping);
    if (request.url === "/pages/products") return response.end(form({ active: true }));
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/authtoken") {
      if (mode.apiDown) { response.statusCode = 503; return response.end('{}'); }
      return response.end(JSON.stringify({ authtoken: "mock-read-token" }));
    }
    if (request.url === "/api/productlist") return response.end(JSON.stringify({ productlist: [product] }));
    if (request.url === "/api/itemlist") {
      if (mode.itemsDown) { response.statusCode = 503; return response.end('{}'); }
      return response.end(JSON.stringify({ itemlist: [{ product_plu: 500, portion_name: "Single", price: 500, price_dp: 2 }] }));
    }
    response.statusCode = 404;
    response.end('{}');
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { calls, config: { baseUrl: `http://127.0.0.1:${server.address().port}`, username: "mock", password: "mock", clientId: 1, clientName: "Test" } };
}

test("concurrent pricing refreshes share reads and post-save refreshes are fresh", async (t) => {
  const { config, calls } = await mockPmb(t);
  const results = await Promise.all([readCurrentPmbPricing(config), readCurrentPmbPricing(config), readCurrentPmbPricing(config)]);
  assert.equal(calls.filter((call) => call.path === "/api/productlist").length, 1);
  assert.equal(results[0].source, "pmb-api");
  assert.equal(results[0].itemPricesAvailable, true);
  await readCurrentPmbPricing(config);
  assert.equal(calls.filter((call) => call.path === "/api/productlist").length, 2);
});

test("a failed shot-price request retains freshly read product prices", async (t) => {
  const { config } = await mockPmb(t, { itemsDown: true });
  const result = await readCurrentPmbPricing(config);
  assert.equal(result.products[0].price_per_unit, 65);
  assert.equal(result.source, "pmb-api");
  assert.equal(result.itemPricesAvailable, false);
  assert.match(result.itemPricesError, /itemlist/);
});

test("fallback reads never save products and frequent refreshes cannot postpone primary recovery", async (t) => {
  const mode = { apiDown: true };
  const { config, calls } = await mockPmb(t, mode);
  const originalNow = Date.now;
  const started = originalNow();
  let elapsed = 0;
  Date.now = () => started + elapsed;
  try {
    const first = await readCurrentPmbPricing(config);
    assert.equal(first.source, "pmb-management");
    assert.equal(first.products[0].price_per_unit, 65);
    const initialAttempts = calls.filter((call) => call.path === "/api/authtoken").length;
    for (const minute of [1, 2, 4]) {
      elapsed = minute * 60_000;
      assert.equal((await readCurrentPmbPricing(config)).source, "pmb-management");
    }
    assert.equal(calls.filter((call) => call.path === "/api/authtoken").length, initialAttempts);
    mode.apiDown = false;
    elapsed = 5 * 60_000 + 1;
    const recovered = await readCurrentPmbPricing(config);
    assert.equal(recovered.source, "pmb-api");
    assert.equal(recovered.itemPricesAvailable, true);
    assert.ok(calls.filter((call) => call.path === "/api/authtoken").length > initialAttempts);
    assert.ok(calls.filter((call) => call.path === "/pages/products").every((call) =>
      new URLSearchParams(call.body).get("submit_edit_product") === "edit"
      && !new URLSearchParams(call.body).has("submit_saveedit_product")));
    assert.ok(calls.every((call) => !call.path.includes("configupdate")));
  } finally { Date.now = originalNow; }
});

test("management pricing rejects ambiguous identities and invalid money", () => {
  assert.equal(productPriceFromPmbEditForm(form(), product).price_per_unit, 65);
  assert.throws(() => productPriceFromPmbEditForm(form({ plu: 501 }), product));
  assert.throws(() => productPriceFromPmbEditForm(form({ name: "Other Beer" }), product));
  assert.throws(() => productPriceFromPmbEditForm(form({ price: "unknown" }), product));
  assert.throws(() => validateCurrentPmbPriceProducts([product, product], [product]));
  assert.throws(() => validateCurrentPmbPriceProducts([{ ...product, price_per_unit: null }], [product]));
});

function activationOptions(extra = {}) {
  return {
    beforeWrite: () => {}, recordActivity: async () => {},
    readDashboard: async () => ({ initialized: true, data: { products: { comingSoonItems: [{ id: "beer:test", name: product.name, plu: 500 }] } } }),
    readKegs: async () => ({ initialized: true, data: { onDeckOverrides: { "main-21": { name: product.name, plu: 500, onHand: "2" } } } }),
    ...extra,
    client: {
      taps: async () => [{ tapNumber: 79, deviceId: 123, lineNum: 1, plu: 500, product: product.name }],
      ...extra.client,
    },
  };
}

test("activation deduplicates assigned taps and both queued lists and changes only Active", async () => {
  let active = false;
  let writes = 0;
  const result = await activateQueuedPmbProducts(activationOptions({ client: {
    list: async () => [product], open: async () => ({ html: form({ active }), cookieJar: new Map() }),
    save: async (entries, cookies, guard) => {
      await guard();
      writes += 1;
      const values = Object.fromEntries(entries);
      assert.equal(values.fd_is_active, "on");
      assert.equal(values.fd_price_per_unit, "0.65");
      assert.equal(values.fd_price_per_unit_hh1, "0.50");
      assert.equal(values.fd_image_ref, "keep-image");
      assert.equal(values.fd_tasting_notes, "Keep these notes");
      assert.equal(values.submit_saveedit_product, "save");
      active = true;
    },
  } }));
  assert.equal(writes, 1);
  assert.equal(result.checked, 1);
  assert.equal(result.activated.length, 1);
  assert.equal(result.verified, true);
});

test("a changed assignment prevents scheduled product activation", async () => {
  let reads = 0;
  const result = await activateQueuedPmbProducts(activationOptions({ client: {
    taps: async () => [{ tapNumber: 79, deviceId: 123, lineNum: 1,
      plu: ++reads === 1 ? 500 : 501, product: product.name }],
    list: async () => [product],
    open: async () => ({ html: form() }),
    save: async (_entries, _cookies, guard) => { await guard(); assert.fail("Changed assignment was written"); },
  } }));
  assert.equal(result.verified, false);
  assert.equal(result.issues[0].code, "PMB_ACTIVATION_ASSIGNMENT_CHANGED");
  assert.equal(result.activated.length, 0);
});

test("already active products are verified without a write", async () => {
  const result = await activateQueuedPmbProducts(activationOptions({ client: {
    list: async () => [product], open: async () => ({ html: form({ active: true }) }),
    save: async () => assert.fail("Already-active product was written"),
  } }));
  assert.equal(result.alreadyActive, 1);
  assert.equal(result.activated.length, 0);
});

test("an unmatched product or a closed repair window prevents activation", async () => {
  assert.throws(() => resolvePmbActivationTargets([{ plu: 500, name: "Different product", source: "On Deck" }], [product]));
  assert.throws(() => resolvePmbActivationTargets([{ plu: 0, name: product.name, source: "Coming Soon" }], [product, { ...product, plu: 501 }]));
  await assert.rejects(activateQueuedPmbProducts(activationOptions({
    beforeWrite: () => { throw new Error("window closed"); },
    client: { list: async () => [product], open: async () => assert.fail("Product opened after the guard closed"), save: async () => assert.fail("Unexpected save") },
  })), /window closed/);
});

test("unverified activation readback fails and an uncertain save is never retried", async () => {
  let writes = 0;
  const base = activationOptions({ client: {
    list: async () => [product], open: async () => ({ html: form() }),
    save: async () => { writes += 1; },
  } });
  const unverified = await activateQueuedPmbProducts(base);
  assert.equal(unverified.verified, false);
  assert.equal(unverified.issues[0].code, "PMB_ACTIVATION_READBACK_FAILED");
  assert.equal(unverified.issues[0].saveUnconfirmed, true);
  assert.equal(writes, 1);
  writes = 0;
  base.client.save = async () => { writes += 1; throw new Error("connection interrupted"); };
  const uncertain = await activateQueuedPmbProducts(base);
  assert.equal(uncertain.verified, false);
  assert.equal(uncertain.issues[0].saveUnconfirmed, true);
  assert.equal(writes, 1);
  assert.throws(() => inspectPmbActivationForm(form({ name: "Different product" }), product));
});

const snapshotAt = (date) => ({ searchedEndDate: "2026-09-12", hasCoverageGaps: true,
  rows: [{ tapNumber: 21, plu: 500, product: product.name, firstRecordedPourAt: date }] });
const badge = (date, now = "2026-09-13T16:00:00Z") => getTapNewBadge(current, { now, snapshot: snapshotAt(date) });

test("New badges use three Eastern calendar months and exclude future or invalid dates", () => {
  assert.equal(badge("2026-06-13T04:00:00Z").date, "Jun 13, 2026");
  assert.equal(badge("2026-06-13T03:59:59Z"), null);
  assert.equal(badge("2026-09-13T16:00:01Z"), null);
  assert.equal(badge("not a date"), null);
  assert.equal(badge("2026-02-28T17:00:00Z", "2026-05-31T16:00:00Z").date, "Feb 28, 2026");
  assert.equal(badge("2026-02-27T17:00:00Z", "2026-05-31T16:00:00Z"), null);
});

test("a changed product or PLU cannot inherit a New badge", () => {
  const options = { now: "2026-09-13T16:00:00Z", snapshot: snapshotAt("2026-09-11T12:00:00Z") };
  assert.equal(getTapNewBadge({ ...current, plu: 999 }, options), null);
  assert.equal(getTapNewBadge({ ...current, name: "Different beer" }, options), null);
});

test("older first records and swap evidence remain available to local search", () => {
  const history = getTapHistoryContext({ ...current, productHistory: { changedAt: "2026-09-11T12:00:00Z", source: "detected", previousName: "Previous Beer" } }, snapshotAt("2025-07-01T12:00:00Z"));
  const tables = Object.fromEntries(Object.keys(LOCAL_AI_COLUMNS).map((key) => [key, []]));
  tables.levels = [{ ...current, ...history }];
  const cleaned = sanitizeLocalAiSnapshot({ capturedAt: new Date().toISOString(), tables }).tables.levels[0];
  assert.equal(cleaned.firstRecordedPourAt, "2025-07-01T12:00:00.000Z");
  assert.equal(cleaned.previousProduct, "Previous Beer");
  assert.equal(cleaned.productChangeSource, "detected");
  assert.equal(cleaned.firstPourHasCoverageGaps, true);
  assert.match(cleaned.firstPourHistoryScope, /not proof/);
  assert.equal(badge("2025-07-01T12:00:00Z"), null);
});
