export const VENDOR_CART_BUILDER_KEYS = Object.freeze([
  "heidelberg",
  "proof",
  "ohlq",
]);

const VENDOR_CART_BUILDER_KEY_SET = new Set(VENDOR_CART_BUILDER_KEYS);

export function canBuildVendorCart(vendorKey) {
  return VENDOR_CART_BUILDER_KEY_SET.has(vendorKey);
}

export function getVendorCartLabel(order) {
  return order?.vendorKey === "heidelberg" ? "BEES" : order?.vendor;
}

export function buildVendorCartRequest(view, { now = Date.now } = {}) {
  const order = view?.order;
  return {
    requestId: `${order.id}:${now()}`,
    orderId: order.id,
    vendor: order.vendorKey,
    approved: order.actionsEnabled === true,
    rehearsal: order.rehearsal === true,
    operatingWeekReference: order.operatingWeekReference,
    expectedTotal: order.expectedTotal,
    lineCount: order.lineCount,
    lines: (order.lines || []).map((line) => ({
      internalItemId: line.internalItemId,
      name: line.name,
      vendorSku: line.vendorSku,
      packSize: line.packSize,
      requestedCases: line.requestedCases,
      requestedUnits: line.requestedUnits,
    })),
  };
}

export function sendVendorCartRequest(view, {
  windowRef = globalThis.window,
  timeoutMs = 1800,
  now = Date.now,
} = {}) {
  if (!windowRef?.location?.origin) {
    return Promise.reject(new Error("The vendor cart helper requires a browser window."));
  }
  const payload = buildVendorCartRequest(view, { now });
  return new Promise((resolve, reject) => {
    const timeout = windowRef.setTimeout(() => {
      windowRef.removeEventListener("message", receiveResponse);
      reject(new Error("The cart helper did not respond. Automatic cart building requires Chrome with the On Par Vendor Cart Builder enabled. If this browser cannot run the helper, open the dashboard in that Chrome browser to build the cart. You can still review and edit the order here; no order was submitted."));
    }, timeoutMs);

    function receiveResponse(event) {
      if (
        event.source !== windowRef
        || event.origin !== windowRef.location.origin
        || event.data?.source !== "onpar-vendor-cart-builder"
        || event.data?.requestId !== payload.requestId
      ) return;
      windowRef.clearTimeout(timeout);
      windowRef.removeEventListener("message", receiveResponse);
      if (event.data.type === "ONPAR_VENDOR_CART_BUILD_ACCEPTED") resolve(event.data);
      else reject(new Error(event.data.message || "The vendor cart helper could not start."));
    }

    windowRef.addEventListener("message", receiveResponse);
    windowRef.postMessage({
      source: "onpar-dashboard",
      type: "ONPAR_VENDOR_CART_BUILD_REQUEST",
      payload,
    }, windowRef.location.origin);
  });
}
