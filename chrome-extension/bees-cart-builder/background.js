const ORDER_KEY = "onParVendorPendingOrder";
const RESULT_KEY = "onParVendorLastResult";
const TEMP_STATE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const temporaryStorage = chrome.storage.local;

// Session storage can be unavailable in some restored vendor-tab contexts.
// Keep the temporary handoff in extension-private local storage. Vendor pages
// can reach it only through the validated runtime messages below.

async function clearExpiredTemporaryState() {
  const stored = await temporaryStorage.get([ORDER_KEY, RESULT_KEY]);
  const now = Date.now();
  const expiredKeys = [ORDER_KEY, RESULT_KEY].filter((key) => {
    const value = stored[key];
    if (!value) return false;
    const timestamp = Date.parse(value.completedAt || value.startedAt || "");
    return !Number.isFinite(timestamp) || now - timestamp > TEMP_STATE_MAX_AGE_MS;
  });
  if (expiredKeys.length) await temporaryStorage.remove(expiredKeys);
}

void clearExpiredTemporaryState().catch(() => {});
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
    home: "https://portal.ohlq.com/Previously-Purchased",
    urls: ["https://*.ohlq.com/*"],
  },
});

async function focusVendor(vendor) {
  const config = VENDORS[vendor];
  if (!config) throw new Error("That vendor cart is not supported.");
  const tabs = await chrome.tabs.query({ url: config.urls });
  const tab = tabs.find((item) => item.id);
  if (!tab) {
    return {
      tab: await chrome.tabs.create({ url: config.home, active: true }),
      notifyExistingPage: false,
    };
  }
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  if (["proof", "ohlq"].includes(vendor)) {
    const currentUrl = String(tab.url || "").replace(/\/+$/, "");
    const homeUrl = config.home.replace(/\/+$/, "");
    if (currentUrl === homeUrl) {
      await chrome.tabs.reload(tab.id);
      return { tab, notifyExistingPage: false };
    }
    return {
      tab: await chrome.tabs.update(tab.id, { url: config.home }),
      notifyExistingPage: false,
    };
  }
  return { tab, notifyExistingPage: true };
}

async function waitForTabComplete(tabId, timeout = 15000) {
  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current?.status === "complete") return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timer);
      resolve();
    };
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeout);
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function broadcastResult(result) {
  const tabs = await chrome.tabs.query({ url: "https://onparbev.com/*" });
  await Promise.all(tabs.map((tab) => (
    tab.id
      ? chrome.tabs.sendMessage(tab.id, { type: "VENDOR_CART_RESULT", result }).catch(() => {})
      : null
  )));
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "START_VENDOR_CART") {
    return (async () => {
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
      await temporaryStorage.set({ [ORDER_KEY]: state });
      await temporaryStorage.remove(RESULT_KEY);
      const focused = await focusVendor(state.vendor);
      if (focused.tab?.id) {
        await waitForTabComplete(focused.tab.id);
        await chrome.tabs.sendMessage(focused.tab.id, { type: "VENDOR_CART_START" }).catch(() => {});
      }
      return { ok: true, message: `${config.label} opened. The cart builder is working.` };
    })().catch((error) => ({ ok: false, message: error.message }));
  }

  if (message?.type === "GET_VENDOR_CART_STATE") {
    return temporaryStorage.get(ORDER_KEY)
      .then((stored) => ({ ok: true, state: stored[ORDER_KEY] || null }))
      .catch((error) => ({ ok: false, message: error.message }));
  }

  if (message?.type === "SAVE_VENDOR_CART_STATE") {
    return temporaryStorage.set({ [ORDER_KEY]: message.state })
      .then(() => ({ ok: true }))
      .catch((error) => ({ ok: false, message: error.message }));
  }

  if (message?.type === "GET_OHLQ_DELIVERY_PREFERENCE") {
    return temporaryStorage
      .get(RESULT_KEY)
      .then((stored) => {
        const result = stored[RESULT_KEY];
        const preference = result?.vendor === "ohlq" ? result.deliveryPreference : null;
        const date = typeof preference?.date === "string" ? preference.date : "";
        const time = preference?.time === "09:00" ? preference.time : "";
        return {
          ok: true,
          preference:
            /^\d{4}-\d{2}-\d{2}$/.test(date) && time
              ? { date, time }
              : null,
        };
      })
      .catch((error) => ({
        ok: false,
        preference: null,
        message: error.message,
      }));
  }

  if (message?.type === "VENDOR_CART_FINISHED") {
    return (async () => {
      await temporaryStorage.set({ [RESULT_KEY]: message.result });
      await temporaryStorage.remove(ORDER_KEY);
      await broadcastResult(message.result);
      return { ok: true };
    })().catch((error) => ({ ok: false, message: error.message }));
  }
  return false;
});
