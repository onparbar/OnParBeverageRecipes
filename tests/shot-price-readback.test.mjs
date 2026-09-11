import assert from "node:assert/strict";
import test from "node:test";
import { classifyShotPriceReadback } from "../public/shot-price-readback.mjs";
import { getDashboardIdentityById } from "../lib/dashboard-identities.mjs";

const row = {
  plu: 145687, tapNumber: 1,
  portions: [
    { itemId: "63", name: "Single", quantityOz: 1.5, price: 10 },
    { itemId: "157", name: "Double", quantityOz: 2, price: 13.5 },
  ],
};
function snapshot(prices) {
  return {
    updatedAt: new Date().toISOString(),
    items: [{ plu: row.plu, tapPosition: row.tapNumber,
      portions: row.portions.map((portion, index) => ({ ...portion, price: prices[index] })),
    }],
  };
}
const requested = [1100, 1500];

test("shot read-back recognizes both exact requested prices", () => {
  assert.deepEqual(classifyShotPriceReadback(snapshot([11, 15]), row, requested, Date.now() - 1000), {
    state: "saved", amounts: requested,
  });
});

test("shot read-back distinguishes unchanged and partially saved prices", () => {
  assert.equal(classifyShotPriceReadback(snapshot([10, 13.5]), row, requested, Date.now() - 1000).state, "unchanged");
  assert.equal(classifyShotPriceReadback(snapshot([11, 13.5]), row, requested, Date.now() - 1000).state, "partial");
});

test("saved or degraded snapshots cannot confirm a write", () => {
  for (const flag of [{ stale: true }, { degraded: true }, { error: "offline" }, { updatedAt: "" }, { updatedAt: "2020-01-01T00:00:00Z" }]) {
    assert.equal(classifyShotPriceReadback({ ...snapshot([11, 15]), ...flag }, row, requested, Date.now() - 1000).state, "unknown");
  }
});

test("another tap or mismatched portion identity cannot confirm a write", () => {
  for (const mutate of [
    (data) => { data.items[0].tapPosition = 84; },
    (data) => { data.items[0].plu = 145831; },
    (data) => { data.items[0].portions[0].itemId = "343"; },
    (data) => { data.items[0].portions[0].quantityOz = 3; },
    (data) => { data.items.push(data.items[0]); },
  ]) {
    const data = snapshot([11, 15]);
    mutate(data);
    assert.equal(classifyShotPriceReadback(data, row, requested, Date.now() - 1000).state, "unknown");
  }
});

test("Christina Myers has the requested Admin role", () => {
  const identity = getDashboardIdentityById("christina-myers");
  assert.equal(identity.name, "Christina Myers");
  assert.equal(identity.role, "owner");
  assert.equal(identity.sevenShiftsId, "7227007");
});
