const DASHBOARD_SOURCE = "onpar-dashboard";
const EXTENSION_SOURCE = "onpar-vendor-cart-builder";
const SUPPORTED_VENDORS = new Set(["heidelberg", "proof", "ohlq"]);

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validateOrder(payload) {
  const vendor = clean(payload?.vendor).toLowerCase();
  if (!payload || !SUPPORTED_VENDORS.has(vendor) || payload.approved !== true) {
    throw new Error("Only an approved Heidelberg, Proof, or OHLQ order can build a cart.");
  }
  if (!clean(payload.requestId) || !clean(payload.orderId)) {
    throw new Error("The approved order identity is missing.");
  }
  if (!Array.isArray(payload.lines) || !payload.lines.length || payload.lines.length > 100) {
    throw new Error("The approved vendor order has no usable lines.");
  }
  const lines = payload.lines.map((line) => {
    const requestedCases = positiveInteger(line.requestedCases);
    const requestedUnits = positiveInteger(line.requestedUnits);
    const quantityKind = vendor === "ohlq"
      ? "units"
      : requestedCases
        ? "cases"
        : "units";
    const quantity = quantityKind === "cases" ? requestedCases : requestedUnits;
    const name = clean(line.name);
    const vendorSku = clean(line.vendorSku);
    if (!name || !quantity) throw new Error("A vendor line is missing its product or quantity.");
    if (["proof", "ohlq"].includes(vendor) && !vendorSku) throw new Error(`${name} is missing its vendor SKU.`);
    return {
      internalItemId: clean(line.internalItemId),
      name,
      vendorSku,
      packSize: clean(line.packSize),
      quantity,
      quantityKind,
      requestedCases,
      requestedUnits,
    };
  });
  return {
    requestId: clean(payload.requestId),
    orderId: clean(payload.orderId),
    vendor,
    expectedTotal: Number(payload.expectedTotal) || 0,
    lineCount: lines.length,
    lines,
  };
}

window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data?.source !== DASHBOARD_SOURCE ||
    event.data?.type !== "ONPAR_VENDOR_CART_BUILD_REQUEST"
  ) return;

  let payload;
  try {
    payload = validateOrder(event.data.payload);
  } catch (error) {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "ONPAR_VENDOR_CART_BUILD_REJECTED",
      requestId: event.data.payload?.requestId,
      message: error.message,
    }, window.location.origin);
    return;
  }

  chrome.runtime.sendMessage({ type: "START_VENDOR_CART", payload }, (response) => {
    const error = chrome.runtime.lastError?.message;
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: error || !response?.ok
        ? "ONPAR_VENDOR_CART_BUILD_REJECTED"
        : "ONPAR_VENDOR_CART_BUILD_ACCEPTED",
      requestId: payload.requestId,
      message: error || response?.message || "The vendor cart builder is working.",
    }, window.location.origin);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "VENDOR_CART_RESULT") return;
  window.postMessage({
    source: EXTENSION_SOURCE,
    type: "ONPAR_VENDOR_CART_RESULT",
    ...message.result,
  }, window.location.origin);
});
