import assert from "node:assert/strict";
import test from "node:test";
import { parseSmartReceivingTranscript } from "../public/smart-receiving.mjs";

function currentOrder() {
  return {
    available: true,
    generatedAt: "2026-08-24T12:00:00.000Z",
    vendors: [{
      id: "bonbright",
      vendor: "Bonbright",
      ordered: true,
      items: [
        { id: "voodoo-ranger-ipa", name: "Voodoo Ranger IPA", quantity: 2, unit: "kegs" },
        { id: "coors-light", name: "Coors Light", quantity: 1, unit: "kegs" },
      ],
    }],
  };
}

test("everything delivered except one product leaves that product undelivered", () => {
  const result = parseSmartReceivingTranscript(
    "okay everything from bomb right was delivered except for the voodoo Ranger IPA",
    currentOrder(),
  );

  assert.equal(result.status, "ready");
  assert.equal(result.proposal.vendor, "Bonbright");
  assert.deepEqual(
    result.proposal.lines.map(({ name, receivedQuantity, status }) => ({ name, receivedQuantity, status })),
    [
      { name: "Voodoo Ranger IPA", receivedQuantity: 0, status: "not-received" },
      { name: "Coors Light", receivedQuantity: 1, status: "received" },
    ],
  );
});

test("a stated exception quantity subtracts only the missing amount", () => {
  const result = parseSmartReceivingTranscript(
    "everything from Bonbright was delivered except one Voodoo Ranger IPA",
    currentOrder(),
  );
  const voodoo = result.proposal.lines.find((line) => line.name === "Voodoo Ranger IPA");

  assert.equal(voodoo.receivedQuantity, 1);
  assert.equal(voodoo.status, "partial");
});
