const ORDER_KEY = "onParBeesPendingOrder";
const RESULT_KEY = "onParBeesLastResult";
const BEES_HOME = "https://mybeesapp.com/globalrecommendation/entire/order";

async function focusBees() {
  const tabs = await chrome.tabs.query({ url: "https://mybeesapp.com/*" });
  const tab = tabs.find((item) => item.id);
  if (!tab) return chrome.tabs.create({ url: BEES_HOME, active: true });
  await chrome.tabs.update(tab.id, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  return tab;
}

async function broadcastResult(result) {
  const tabs = await chrome.tabs.query({ url: "https://onparbev.com/*" });
  await Promise.all(tabs.map((tab) => (
    tab.id
      ? chrome.tabs.sendMessage(tab.id, { type: "BEES_CART_RESULT", result }).catch(() => {})
      : null
  )));
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_BEES_CART") {
    (async () => {
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
      await focusBees();
      sendResponse({ ok: true, message: "BEES opened. The cart builder is working." });
    })().catch((error) => sendResponse({ ok: false, message: error.message }));
    return true;
  }

  if (message?.type === "BEES_CART_FINISHED") {
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
