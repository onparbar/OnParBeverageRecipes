import assert from "node:assert/strict";
import test from "node:test";
import { renderFinishWeekDeliveries } from "../public/finish-week-view.mjs";
const render = item => renderFinishWeekDeliveries({ available: true, vendors: [{ id: "beer", vendor: "Heidelberg", items: [{ id: "na", name: "Non Alcoholic Beer", unit: "cases", packSize: 24, quantity: 1, status: "pending", ...item }] }] });
test("a 24-pack displays two cases of 12 while receiving exactly one order case", () => {
  const html = render({});
  assert.match(html, /2 cases of 12 to receive/);
  assert.match(html, /data-quantity="1"/);
  assert.match(render({ quantity: 2 }), /4 cases of 12 to receive/);
  assert.match(render({ status: "received", receivedQuantity: 1 }), /2 cases of 12 received/);
});
test("other package sizes and received products keep their existing semantics", () => {
  assert.doesNotMatch(render({ packSize: 12 }), /2 cases of 12/);
  assert.match(render({ name: "Lime Juice", status: "received" }), /1 received/);
});
