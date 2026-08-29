import assert from "node:assert/strict";
import test from "node:test";

import {
  bindVendorOrderController,
  buildVendorOrderBulkRemovalPayload,
  getVendorOrderAdjustmentOptionState,
  getVendorOrderBulkRemovalState,
} from "../public/vendor-order-controller.mjs";

class FakeButton {
  constructor(dataset = {}) {
    this.dataset = dataset;
    this.disabled = false;
    this.textContent = "";
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    return this.listeners.get(type)?.({ currentTarget: this });
  }
}

test("vendor adjustment options follow vendor and remove-mode filters", () => {
  assert.deepEqual(getVendorOrderAdjustmentOptionState({
    optionVendor: "Proof",
    currentPlanQuantity: "2",
    selectedVendor: "Proof",
    removing: true,
  }), {
    matchesVendor: true,
    isOnOrder: true,
    hidden: false,
    disabled: false,
  });
  assert.equal(getVendorOrderAdjustmentOptionState({
    optionVendor: "OHLQ",
    currentPlanQuantity: "0",
    selectedVendor: "Proof",
    removing: false,
  }).hidden, true);
  assert.equal(getVendorOrderAdjustmentOptionState({
    optionVendor: "Proof",
    currentPlanQuantity: "0",
    selectedVendor: "Proof",
    removing: true,
  }).hidden, true);
});

test("bulk removal state preserves select-all and button behavior", () => {
  assert.deepEqual(getVendorOrderBulkRemovalState([
    { checked: true },
    { checked: false },
    { checked: true },
  ]), {
    selectedCount: 2,
    allSelected: false,
    indeterminate: true,
    disabled: false,
    label: "Remove selected (2)",
  });
  assert.deepEqual(getVendorOrderBulkRemovalState([]), {
    selectedCount: 0,
    allSelected: false,
    indeterminate: false,
    disabled: true,
    label: "Remove selected",
  });
});

test("bulk removal payload keeps explicit zero quantities and audit context", () => {
  assert.deepEqual(buildVendorOrderBulkRemovalPayload({
    vendor: "Bonbright",
    adjustedBy: "Sam",
    selected: [{ value: "miller-lite" }, { value: "coors-light" }],
  }), {
    action: "set-order-adjustments",
    vendor: "Bonbright",
    adjustedBy: "Sam",
    adjustments: [
      { catalogId: "miller-lite", vendor: "Bonbright", quantity: 0, reason: "Removed during draft review." },
      { catalogId: "coors-light", vendor: "Bonbright", quantity: 0, reason: "Removed during draft review." },
    ],
  });
});

test("rehearsal copy remains local and does not record a live handoff", async () => {
  const copyButton = new FakeButton({ assistedOrderCopy: "proof" });
  const calls = [];
  const documentRef = {
    querySelector() {
      return null;
    },
    querySelectorAll(selector) {
      return selector === "[data-assisted-order-copy]" ? [copyButton] : [];
    },
  };
  const bound = bindVendorOrderController({
    documentRef,
    rehearsalMode: true,
    getDraftView: () => ({
      copyText: "Proof order",
      order: { actionsEnabled: true, rehearsal: true },
    }),
    copyAssistedOrderText: async (text) => calls.push(["copy", text]),
    saveVendorHandoffEvent: async () => calls.push(["handoff"]),
  });

  await copyButton.dispatch("click");
  assert.equal(bound, true);
  assert.equal(copyButton.textContent, "Copied");
  assert.deepEqual(calls, [["copy", "Proof order"]]);
});

test("vendor order controller fails closed without a document surface", () => {
  assert.equal(bindVendorOrderController({ documentRef: null }), false);
});
