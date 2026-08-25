const DASHBOARD_SOURCE = "onpar-dashboard";
const EXTENSION_SOURCE = "onpar-bees-cart-builder";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function validateOrder(payload) {
  if (!payload || payload.vendor !== "heidelberg" || payload.approved !== true) {
    throw new Error("Only an approved Heidelberg order can build a BEES cart.");
  }
  if (!clean(payload.requestId) || !clean(payload.orderId)) {
    throw new Error("The approved order identity is missing.");
  }
  if (!Array.isArray(payload.lines) || !payload.lines.length || payload.lines.length > 100) {
    throw new Error("The approved Heidelberg order has no usable lines.");
  }
  const lines = payload.lines.map((line) => {
    const quantity = positiveInteger(line.requestedCases) || positiveInteger(line.requestedUnits);
    const name = clean(line.name);
    if (!name || !quantity) throw new Error("A Heidelberg line is missing its product or quantity.");
    return {
      internalItemId: clean(line.internalItemId),
      name,
      vendorSku: clean(line.vendorSku),
      packSize: clean(line.packSize),
      quantity,
    };
  });
  return {
    requestId: clean(payload.requestId),
    orderId: clean(payload.orderId),
    vendor: "heidelberg",
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
    event.data?.type !== "ONPAR_BEES_BUILD_REQUEST"
  ) return;

  let payload;
  try {
    payload = validateOrder(event.data.payload);
  } catch (error) {
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: "ONPAR_BEES_BUILD_REJECTED",
      requestId: event.data.payload?.requestId,
      message: error.message,
    }, window.location.origin);
    return;
  }

  chrome.runtime.sendMessage({ type: "START_BEES_CART", payload }, (response) => {
    const error = chrome.runtime.lastError?.message;
    window.postMessage({
      source: EXTENSION_SOURCE,
      type: error || !response?.ok
        ? "ONPAR_BEES_BUILD_REJECTED"
        : "ONPAR_BEES_BUILD_ACCEPTED",
      requestId: payload.requestId,
      message: error || response?.message || "BEES opened. The cart builder is working.",
    }, window.location.origin);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "BEES_CART_RESULT") return;
  window.postMessage({
    source: EXTENSION_SOURCE,
    type: "ONPAR_BEES_CART_RESULT",
    ...message.result,
  }, window.location.origin);
});
