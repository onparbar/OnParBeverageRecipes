import assert from "node:assert/strict";
import test from "node:test";
import { attachTapProductHistory, recordTapProductObservations, sameTapProduct, tapProductIdentity } from "../lib/pmb-tap-product-history.mjs";
import { normalizePmbLevelSnapshot } from "../lib/pmb-level-snapshot-store.mjs";

const item = { tapNumber: 21, deviceId: 66952917946726, lineNum: 2, plu: 6655, tapProduct: "Michelob ULTRA 1", name: "Michelob ULTRA 1", levelAvailable: true };
const observedAt = "2026-09-12T04:00:00.000Z";
const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SECRET_KEY: "test-secret" };
const saved = { ...tapProductIdentity(item), firstSeenAt: observedAt, lastSeenAt: observedAt, source: "baseline", lastTappedOn: "09/10/2026 21:34:13" };

test("tap identity detects reused PLUs without treating case or whitespace as a new product", () => {
  assert.equal(sameTapProduct(item, { ...item, tapProduct: "  michelob  ultra 1 " }), true);
  assert.equal(sameTapProduct(item, { ...item, tapProduct: "Bacardi Sunset" }), false);
  assert.equal(sameTapProduct(item, { ...item, plu: 8888 }), false);
  assert.equal(sameTapProduct(item, { ...item, lineNum: 3 }), false);
  assert.equal(sameTapProduct(item, { ...item, tapNumber: 22 }), false);
  assert.equal(tapProductIdentity({ ...item, deviceId: 0 }), null);
});

test("observation writes send only verified, available products to the atomic history RPC", async () => {
  let calls = 0;
  const result = await recordTapProductObservations([item, { ...item, tapNumber: 22, levelAvailable: false }, { tapNumber: 23 }], {
    env, observedAt, fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://example.supabase.co/rest/v1/rpc/record_pmb_tap_product_observations");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.apikey, "test-secret");
      const body = JSON.parse(options.body);
      assert.equal(body.p_source, "detected");
      assert.equal(body.p_observed_at, observedAt);
      assert.equal(body.p_observations.length, 1);
      assert.equal(body.p_observations[0].slotKey, "21:66952917946726:2");
      return { ok: true, json: async () => [{ slot_key: saved.slotKey, data: saved }] };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.length, 1);
});

test("missing or ambiguous observations cannot invent product changes", async () => {
  const fetchImpl = async () => { throw new Error("Unexpected network request"); };
  assert.deepEqual(await recordTapProductObservations([{ ...item, levelAvailable: false }], { env, fetchImpl }), []);
  await assert.rejects(recordTapProductObservations([item, item], { env, fetchImpl }), /Ambiguous/);
  await assert.rejects(recordTapProductObservations([item], { env, fetchImpl, source: "invented" }), /Invalid/);
  await assert.rejects(recordTapProductObservations([item], { env, fetchImpl, observedAt: "invalid" }), /Invalid/);
});

test("confirmed product observations are explicit and storage failures remain failures", async () => {
  await recordTapProductObservations([item], { env, source: "confirmed", fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).p_source, "confirmed");
    return { ok: true, json: async () => [] };
  } });
  await assert.rejects(recordTapProductObservations([item], { env, fetchImpl: async () => ({ ok: false, json: async () => ({ message: "missing table" }) }) }), /unavailable/);
});

test("baseline history never claims a known original product-change date", () => {
  const [result] = attachTapProductHistory([item], [{ slot_key: saved.slotKey, data: saved }]);
  assert.equal(result.productHistory.source, "baseline");
  assert.equal(result.productHistory.changedAt, "");
  assert.equal(result.productHistory.firstSeenAt, observedAt);
  assert.equal(result.tappedOn, saved.lastTappedOn);
  assert.equal(result.tappedOnCached, true);
});

test("live keg dates take priority and changed products never inherit old product history", () => {
  const [live] = attachTapProductHistory([{ ...item, tappedOn: "09/12/2026 00:15:00" }], [{ slot_key: saved.slotKey, data: saved }]);
  assert.equal(live.tappedOn, "09/12/2026 00:15:00");
  assert.equal(live.tappedOnCached, false);
  const [changed] = attachTapProductHistory([{ ...item, tapProduct: "Bacardi Sunset" }], [{ slot_key: saved.slotKey, data: saved }]);
  assert.equal(changed.productHistory, null);
  assert.equal(changed.tappedOn, "");
});

test("history outages preserve explicitly cached same-product data", () => {
  const history = { source: "detected", changedAt: observedAt, previousName: "Previous beer" };
  const [result] = attachTapProductHistory([{ ...item, tappedOn: saved.lastTappedOn, tappedOnCached: true, productHistory: history }], [], { unavailable: true });
  assert.equal(result.productHistoryUnavailable, true);
  assert.deepEqual(result.productHistory, history);
  assert.equal(result.tappedOnCached, true);
});

test("shared snapshots preserve product history and cached timestamp labeling", () => {
  const snapshot = normalizePmbLevelSnapshot({ updatedAt: observedAt, items: [{ ...item, fillLevelPercent: 79, tappedOn: saved.lastTappedOn, tappedOnCached: true, productHistory: { source: "detected", firstSeenAt: observedAt, changedAt: observedAt, previousName: "Old product", lastSeenAt: observedAt } }] });
  assert.equal(snapshot.items[0].productHistory.previousName, "Old product");
  assert.equal(snapshot.items[0].productHistory.changedAt, observedAt);
  assert.equal(snapshot.items[0].tappedOnCached, true);
});
