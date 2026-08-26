const ORDER_KEY = "onParVendorPendingOrder";
const RESULT_KEY = "onParVendorLastResult";
const VENDORS = Object.freeze({
  heidelberg: {
    label: "BEES",
    home: "https://mybeesapp.com/globalrecommendation/entire/order",
    urls: ["https://mybeesapp.com/*"],
  },
  proof: {
    label: "Proof",
    home: "https://shop.sgproof.com/",
    urls: ["https://*.sgproof.com/*"],
  },
  ohlq: {
    label: "OHLQ",
    home: "https://portal.ohlq.com/",
    urls: ["https://*.ohlq.com/*"],
  },
});

async function focusVendor(vendor) {
  const config = VENDORS[vendor];
  if (!config) throw new Error("That vendor cart is not supported.");
  const tabs = await chrome.tabs.query({ url: config.urls });
  const tab = tabs.find((item) => item.id);
  if (!tab) return chrome.tabs.create({ url: config.home, active: true });
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  return tab;
}

async function broadcastResult(result) {
  const tabs = await chrome.tabs.query({ url: "https://onparbev.com/*" });
  await Promise.all(tabs.map((tab) => (
    tab.id
      ? chrome.tabs.sendMessage(tab.id, { type: "VENDOR_CART_RESULT", result }).catch(() => {})
      : null
  )));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_VENDOR_CART") {
    (async () => {
      const config = VENDORS[message.payload?.vendor];
      if (!config) throw new Error("That vendor cart is not supported.");
      const state = {
        ...message.payload,
        status: "pending",
        phase: "start",
        results: [],
        searchQueue: [],
        searchCursor: 0,
        startedAt: new Date().toISOString(),
      };
      await chrome.storage.session.set({ [ORDER_KEY]: state });
      const tab = await focusVendor(state.vendor);
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, { type: "VENDOR_CART_START" }).catch(() => {});
      }
      sendResponse({ ok: true, message: `${config.label} opened. The cart builder is working.` });
    })().catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "GET_VENDOR_CART_STATE") {
    (async () => {
      const stored = await chrome.storage.session.get(ORDER_KEY);
      sendResponse({ ok: true, state: stored[ORDER_KEY] || null });
    })().catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "SAVE_VENDOR_CART_STATE") {
    (async () => {
      await chrome.storage.session.set({ [ORDER_KEY]: message.state });
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "VENDOR_CART_FINISHED") {
    (async () => {
      await chrome.storage.session.set({ [RESULT_KEY]: message.result });
      await chrome.storage.session.remove(ORDER_KEY);
      await broadcastResult(message.result);
      sendResponse({ ok: true });
    })().catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }
  return false;
});
