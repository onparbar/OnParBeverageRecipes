import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVendorCartRequest,
  canBuildVendorCart,
  getVendorCartLabel,
  sendVendorCartRequest,
  VENDOR_CART_BUILDER_KEYS,
} from "../public/vendor-cart-bridge.mjs";

function createOrderView(overrides = {}) {
  return {
    order: {
      id: "proof:2026-08-24",
      vendor: "Proof",
      vendorKey: "proof",
      actionsEnabled: true,
      rehearsal: false,
      operatingWeekReference: "2026-08-24",
      expectedTotal: 412.5,
      lineCount: 1,
      lines: [{
        internalItemId: "lime-juice",
        name: "Lime Juice",
        vendorSku: "LIME-12",
        packSize: 12,
        requestedCases: 1,
        requestedUnits: 12,
        ignoredField: "not exposed",
      }],
      ...overrides,
    },
  };
}

function createFakeWindow() {
  let messageListener = null;
  let timeoutListener = null;
  let posted = null;
  const windowRef = {
    location: { origin: "https://onparbev.com" },
    setTimeout(listener) {
      timeoutListener = listener;
      return 17;
    },
    clearTimeout() {
      timeoutListener = null;
    },
    addEventListener(type, listener) {
      if (type === "message") messageListener = listener;
    },
    removeEventListener(type, listener) {
      if (type === "message" && messageListener === listener) messageListener = null;
    },
    postMessage(message, origin) {
      posted = { message, origin };
    },
  };
  return {
    windowRef,
    getPosted: () => posted,
    respond(data, overrides = {}) {
      messageListener?.({
        source: windowRef,
        origin: windowRef.location.origin,
        data,
        ...overrides,
      });
    },
    expire: () => timeoutListener?.(),
  };
}

test("vendor cart bridge supports only the three automated vendor surfaces", () => {
  assert.deepEqual(VENDOR_CART_BUILDER_KEYS, ["heidelberg", "proof", "ohlq"]);
  assert.equal(canBuildVendorCart("heidelberg"), true);
  assert.equal(canBuildVendorCart("proof"), true);
  assert.equal(canBuildVendorCart("ohlq"), true);
  assert.equal(canBuildVendorCart("bonbright"), false);
  assert.equal(getVendorCartLabel({ vendorKey: "heidelberg", vendor: "Heidelberg" }), "BEES");
  assert.equal(getVendorCartLabel({ vendorKey: "proof", vendor: "Proof" }), "Proof");
});

test("vendor cart request exposes only approved order fields", () => {
  assert.deepEqual(buildVendorCartRequest(createOrderView(), { now: () => 1234 }), {
    requestId: "proof:2026-08-24:1234",
    orderId: "proof:2026-08-24",
    vendor: "proof",
    approved: true,
    rehearsal: false,
    operatingWeekReference: "2026-08-24",
    expectedTotal: 412.5,
    lineCount: 1,
    lines: [{
      internalItemId: "lime-juice",
      name: "Lime Juice",
      vendorSku: "LIME-12",
      packSize: 12,
      requestedCases: 1,
      requestedUnits: 12,
    }],
  });
});

test("vendor cart bridge accepts only the matching same-origin response", async () => {
  const fake = createFakeWindow();
  const promise = sendVendorCartRequest(createOrderView(), {
    windowRef: fake.windowRef,
    now: () => 1234,
  });
  const request = fake.getPosted();
  assert.equal(request.origin, "https://onparbev.com");
  assert.equal(request.message.type, "ONPAR_VENDOR_CART_BUILD_REQUEST");

  fake.respond({
    source: "onpar-vendor-cart-builder",
    requestId: request.message.payload.requestId,
    type: "ONPAR_VENDOR_CART_BUILD_ACCEPTED",
  }, { origin: "https://example.com" });
  fake.respond({
    source: "onpar-vendor-cart-builder",
    requestId: request.message.payload.requestId,
    type: "ONPAR_VENDOR_CART_BUILD_ACCEPTED",
  });

  assert.equal((await promise).type, "ONPAR_VENDOR_CART_BUILD_ACCEPTED");
});

test("vendor cart bridge surfaces helper rejection and timeout messages", async () => {
  const rejected = createFakeWindow();
  const rejectedPromise = sendVendorCartRequest(createOrderView(), {
    windowRef: rejected.windowRef,
    now: () => 1,
  });
  const rejectedRequest = rejected.getPosted();
  rejected.respond({
    source: "onpar-vendor-cart-builder",
    requestId: rejectedRequest.message.payload.requestId,
    type: "ONPAR_VENDOR_CART_BUILD_REJECTED",
    message: "Review the unmatched item.",
  });
  await assert.rejects(rejectedPromise, /Review the unmatched item/);

  const timedOut = createFakeWindow();
  const timeoutPromise = sendVendorCartRequest(createOrderView(), {
    windowRef: timedOut.windowRef,
    now: () => 2,
  });
  timedOut.expire();
  await assert.rejects(timeoutPromise, /Install or enable the On Par Vendor Cart Builder/);
});

test("vendor cart bridge fails closed outside a browser window", async () => {
  await assert.rejects(
    sendVendorCartRequest(createOrderView(), { windowRef: null }),
    /requires a browser window/,
  );
});
