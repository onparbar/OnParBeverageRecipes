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

async function focusVendor(vendor, state) {
  const config = VENDORS[vendor];
  if (!config) throw new Error("That vendor cart is not supported.");
  const tabs = await chrome.tabs.query({ url: config.urls });
  const tab = tabs.find((item) => item.id && !String(item.url || "").includes("#onpar-cart-check"));
  if (vendor === "proof") {
    // Bind the worker before loading Proof so no other open Proof tab can
    // consume the handoff or race the selected tab's navigation.
    const worker = tab || await chrome.tabs.create({ url: "about:blank", active: true });
    await temporaryStorage.set({ [ORDER_KEY]: { ...state, workerTabId: worker.id } });
    if (worker.windowId) await chrome.windows.update(worker.windowId, { focused: true });
    return {
      tab: await chrome.tabs.update(worker.id, { url: config.home, active: true }),
      notifyExistingPage: false,
    };
  }
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

let startingVendorCart = false;

function ownsProofWorker(state, sender) {
  return Boolean(state?.workerTabId && state.workerTabId === sender?.tab?.id
    && /^https:\/\/shop\.sgproof\.com\//i.test(sender.url || ""));
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "CHECK_PROOF_CART") {
    return (async () => {
      if (!sender?.tab?.id || !/^https:\/\/shop\.sgproof\.com\//i.test(sender.url || "")) {
        throw new Error("Cart checks must come from the Proof cart builder.");
      }
      const stored = await temporaryStorage.get(ORDER_KEY);
      const state = stored[ORDER_KEY];
      if (!state || state.vendor !== "proof" || !ownsProofWorker(state, sender) || state.requestId !== message.requestId || !["pending", "working"].includes(state.status)) {
        throw new Error("This Proof cart request is no longer active.");
      }
      // This tab only reads quantities. It never runs the cart-building worker.
      const tab = await chrome.tabs.create({ url: "https://shop.sgproof.com/sgws/en/usd/cart#onpar-cart-check", active: false });
      try {
        await waitForTabComplete(tab.id, 90000);
        for (let attempt = 0; attempt < 10; attempt += 1) {
          try {
            return await chrome.tabs.sendMessage(tab.id, { type: "READ_PROOF_CART", state });
          } catch (error) {
            if (attempt === 9) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
      } finally {
        await chrome.tabs.remove(tab.id).catch(() => {});
      }
    })().catch((error) => ({ ok: false, message: error.message }));
  }
  if (message?.type === "START_VENDOR_CART") {
    if (startingVendorCart) return Promise.resolve({ ok: false, message: "A cart is already starting. Please wait." });
    startingVendorCart = true;
    return (async () => {
      const config = VENDORS[message.payload?.vendor];
      if (!config) throw new Error("That vendor cart is not supported.");
      const existing = (await temporaryStorage.get(ORDER_KEY))[ORDER_KEY];
      if (existing?.vendor === "proof" && existing.workerTabId && ["pending", "working"].includes(existing.status)) {
        const worker = await chrome.tabs.get(existing.workerTabId).catch(() => null);
        if (worker && /^https:\/\/shop\.sgproof\.com\//i.test(worker.url || "")) {
          throw new Error("A Proof cart is already running. Use Stop in its helper before starting another build.");
        }
      }
      const state = {
        ...message.payload,
        status: "pending",
        phase: "start",
        results: [],
        searchQueue: [],
        searchCursor: 0,
        startedAt: new Date().toISOString(),
      };
      if (state.vendor !== "proof") await temporaryStorage.set({ [ORDER_KEY]: state });
      await temporaryStorage.remove(RESULT_KEY);
      const focused = await focusVendor(state.vendor, state);
      if (focused.tab?.id) {
        await waitForTabComplete(focused.tab.id);
        // Proof starts itself on page load. Sending another start after its
        // first navigation can restart the worker on the departing page.
        if (state.vendor !== "proof") {
          await chrome.tabs.sendMessage(focused.tab.id, { type: "VENDOR_CART_START" }).catch(() => {});
        }
      }
      return { ok: true, message: `${config.label} opened. The cart builder is working.` };
    })().catch((error) => ({ ok: false, message: error.message }))
      .finally(() => { startingVendorCart = false; });
  }

  if (message?.type === "GET_VENDOR_CART_STATE") {
    return temporaryStorage.get(ORDER_KEY)
      .then((stored) => {
        const state = stored[ORDER_KEY];
        return { ok: true, state: state?.vendor === "proof" && !ownsProofWorker(state, sender) ? null : state || null };
      })
      .catch((error) => ({ ok: false, message: error.message }));
  }

  if (message?.type === "SAVE_VENDOR_CART_STATE") {
    return temporaryStorage.get(ORDER_KEY)
      .then((stored) => {
        const current = stored[ORDER_KEY];
        if (current?.vendor === "proof" || message.state?.vendor === "proof") {
          if (!ownsProofWorker(current, sender) || current.requestId !== message.state?.requestId) {
            throw new Error("This Proof cart worker is no longer active.");
          }
          return temporaryStorage.set({ [ORDER_KEY]: { ...message.state, workerTabId: current.workerTabId } });
        }
        return temporaryStorage.set({ [ORDER_KEY]: message.state });
      })
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
      const current = (await temporaryStorage.get(ORDER_KEY))[ORDER_KEY];
      if (current?.vendor === "proof" || message.result?.vendor === "proof") {
        if (!ownsProofWorker(current, sender) || current.requestId !== message.result?.requestId) {
          throw new Error("This Proof cart worker is no longer active.");
        }
      }
      await temporaryStorage.set({ [RESULT_KEY]: message.result });
      await temporaryStorage.remove(ORDER_KEY);
      await broadcastResult(message.result);
      return { ok: true };
    })().catch((error) => ({ ok: false, message: error.message }));
  }
  return false;
});
