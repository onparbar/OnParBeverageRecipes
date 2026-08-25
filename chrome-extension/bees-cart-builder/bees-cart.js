const ORDER_KEY = "onParBeesPendingOrder";
const QUICK_ORDER_PATH = "/globalrecommendation/entire/order";
const SEARCH_PATH = "/catalogsearch/result/";
const OVERLAY_ID = "onpar-bees-cart-builder";

const PRODUCT_IDENTITIES = Object.freeze({
  "mich ultra": { include: ["michelob", "ultra"] },
  "michelob ultra": { include: ["michelob", "ultra"] },
  "angry orchard": { include: ["angry", "orchard"] },
  "upside dawn": { include: ["athletic", "upside", "dawn"] },
  "non alcoholic beer": { include: ["athletic", "upside", "dawn"] },
  "truth": { include: ["rhinegeist", "truth"] },
  "cincy light": { include: ["rhinegeist", "cincy", "light"] },
  "triple jam": { include: ["blake", "triple", "jam"] },
  "triple jam cider": { include: ["blake", "triple", "jam"] },
  "garage beer regular": { include: ["garage", "beer"], exclude: ["lime"] },
  "garage beer": { include: ["garage", "beer"], exclude: ["lime"] },
  "garage beer lime": { include: ["garage", "beer", "lime"] },
  "goose ipa": { include: ["goose", "island", "ipa"] },
  "voodoo juicy haze": { include: ["voodoo", "juicy", "haze"] },
  "voodoo ranger juicy haze": { include: ["voodoo", "juicy", "haze"] },
  "dortmunder": { include: ["dortmunder", "gold"] },
  "dortmunder gold lager": { include: ["dortmunder", "gold"] },
  "two hearted ipa": { include: ["two", "hearted"] },
  "guinness": { include: ["guinness", "draught"] },
  "modelo": { include: ["modelo"] },
  "octoberfest": { include: ["octoberfest"] },
});

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function canonical(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:beer|cocktail|liquor)\b/g, " ")
    .replace(/\s+[123]\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productIdentity(line) {
  const name = canonical(line.name);
  const configured = PRODUCT_IDENTITIES[name];
  if (configured) return configured;
  return {
    include: name.split(" ").filter((word) => word.length > 1),
    exclude: [],
  };
}

function productText(link) {
  const imageName = [...link.querySelectorAll("img[alt]")]
    .map((image) => clean(image.alt))
    .find((value) => value && !/tag icon/i.test(value));
  return canonical(imageName || link.textContent);
}

function matchesLine(link, line) {
  const candidate = productText(link);
  const identity = productIdentity(line);
  if (!identity.include.length || !identity.include.every((word) => candidate.includes(word))) {
    return false;
  }
  if ((identity.exclude || []).some((word) => candidate.includes(word))) return false;
  const pack = canonical(line.packSize);
  if (pack.includes("keg") && !candidate.includes("keg")) return false;
  if (pack.includes("can") && !candidate.includes("can")) return false;
  return true;
}

function productLinks() {
  const unique = new Map();
  document.querySelectorAll('a[href*="/product/"]').forEach((link) => {
    if (!unique.has(link.href)) unique.set(link.href, link);
  });
  return [...unique.values()];
}

function cardFor(link) {
  let node = link;
  for (let depth = 0; node && depth < 7; depth += 1, node = node.parentElement) {
    const inputs = node.querySelectorAll('input[type="number"], input[role="spinbutton"]');
    const addButtons = [...node.querySelectorAll("button")]
      .filter((button) => canonical(button.textContent) === "add");
    if (inputs.length === 1 && addButtons.length <= 1) {
      return { root: node, input: inputs[0], addButton: addButtons[0] || null };
    }
  }
  return null;
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function waitForProducts(timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (productLinks().length) return true;
    await delay(250);
  }
  return false;
}

function renderOverlay(state, message) {
  let host = document.getElementById(OVERLAY_ID);
  if (!host) {
    host = document.createElement("aside");
    host.id = OVERLAY_ID;
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;width:min(390px,calc(100vw - 36px));font:15px/1.4 Georgia,serif;color:#17342f;";
    host.attachShadow({ mode: "open" });
    document.documentElement.append(host);
  }
  const added = (state.results || []).filter((result) => result.status === "added").length;
  const missed = (state.results || []).filter((result) => result.status !== "added");
  host.shadowRoot.innerHTML = `
    <style>
      .card{background:#fffaf0;border:2px solid #2d7568;border-radius:18px;box-shadow:0 16px 44px #17342f33;padding:18px}
      h2{font-size:20px;margin:0 0 7px}p{margin:6px 0}.count{font-weight:700;color:#2d7568}
      ul{max-height:150px;overflow:auto;margin:9px 0;padding-left:20px}.warn{color:#a44f39}
      button{border:1px solid #b9cec7;border-radius:10px;background:white;color:#17342f;font:700 14px Georgia,serif;padding:9px 12px;margin-top:9px;cursor:pointer}
    </style>
    <div class="card" role="status" aria-live="polite">
      <h2>Building your BEES cart</h2>
      <p>${clean(message)}</p>
      <p class="count">${added} of ${state.lines.length} added</p>
      ${missed.length ? `<ul>${missed.map((item) => `<li class="warn">${clean(item.name)}: ${clean(item.message)}</li>`).join("")}</ul>` : ""}
      <button type="button" data-onpar-stop>${state.status === "ready" ? "Close" : "Stop"}</button>
    </div>`;
  host.shadowRoot.querySelector("[data-onpar-stop]")?.addEventListener("click", async () => {
    if (state.status !== "ready") {
      await finish(state, "cancelled", "Stopped before checkout.");
    }
    host.remove();
  }, { once: true });
}

async function saveState(state) {
  const response = await chrome.runtime.sendMessage({
    type: "SAVE_BEES_CART_STATE",
    state,
  });
  if (!response?.ok) throw new Error(response?.message || "Could not save the temporary BEES cart state.");
}

async function addExactMatch(state, lineIndex) {
  const line = state.lines[lineIndex];
  const matches = productLinks().filter((link) => matchesLine(link, line));
  if (matches.length !== 1) {
    return {
      added: false,
      result: matches.length > 1
        ? { lineIndex, name: line.name, status: "unmatched", message: "More than one exact product matched. Review manually." }
        : null,
    };
  }
  const card = cardFor(matches[0]);
  if (!card?.input) {
    return { added: false, result: { lineIndex, name: line.name, status: "unmatched", message: "BEES did not expose a quantity control." } };
  }
  if (card.addButton?.disabled || /out of stock/i.test(card.root.textContent)) {
    return { added: false, result: { lineIndex, name: line.name, status: "unmatched", message: "Out of stock in BEES." } };
  }
  setInputValue(card.input, line.quantity);
  await delay(120);
  if (card.addButton) card.addButton.click();
  await delay(650);
  return { added: true, result: { lineIndex, name: line.name, status: "added", quantity: line.quantity, message: "Added" } };
}

async function finish(state, status = "ready", message = "Cart ready for your review. Nothing was submitted.") {
  const result = {
    requestId: state.requestId,
    orderId: state.orderId,
    status,
    results: state.results,
    completedAt: new Date().toISOString(),
    message,
  };
  state.status = status;
  renderOverlay(state, message);
  chrome.runtime.sendMessage({ type: "BEES_CART_FINISHED", result });
}

async function runQuickOrder(state) {
  if (!location.pathname.startsWith(QUICK_ORDER_PATH)) {
    state.phase = "quick-order";
    await saveState(state);
    location.assign(QUICK_ORDER_PATH);
    return;
  }
  renderOverlay(state, "Matching approved Heidelberg products...");
  await waitForProducts();
  const completed = new Set(state.results.map((result) => result.lineIndex));
  const searchQueue = [];
  for (let index = 0; index < state.lines.length; index += 1) {
    if (completed.has(index)) continue;
    const attempt = await addExactMatch(state, index);
    if (attempt.result) state.results.push(attempt.result);
    if (!attempt.added && !attempt.result) searchQueue.push(index);
    await saveState(state);
    renderOverlay(state, `Checking ${state.lines[index].name}...`);
  }
  if (!searchQueue.length) {
    await finish(state);
    return;
  }
  state.phase = "search";
  state.searchQueue = searchQueue;
  state.searchCursor = 0;
  await saveState(state);
  const line = state.lines[searchQueue[0]];
  location.assign(`${SEARCH_PATH}?q=${encodeURIComponent(line.vendorSku || line.name)}`);
}

async function runSearch(state) {
  const lineIndex = state.searchQueue[state.searchCursor];
  if (!Number.isInteger(lineIndex)) {
    await finish(state);
    return;
  }
  const line = state.lines[lineIndex];
  renderOverlay(state, `Looking for an exact BEES match for ${line.name}...`);
  await waitForProducts(9000);
  const attempt = await addExactMatch(state, lineIndex);
  state.results.push(attempt.result || {
    lineIndex,
    name: line.name,
    status: "unmatched",
    message: "No exact BEES product matched. Review manually.",
  });
  state.searchCursor += 1;
  await saveState(state);
  const nextIndex = state.searchQueue[state.searchCursor];
  if (!Number.isInteger(nextIndex)) {
    await finish(state);
    return;
  }
  const next = state.lines[nextIndex];
  location.assign(`${SEARCH_PATH}?q=${encodeURIComponent(next.vendorSku || next.name)}`);
}

let running = false;
async function start() {
  if (running) return;
  const response = await chrome.runtime.sendMessage({ type: "GET_BEES_CART_STATE" });
  if (!response?.ok) throw new Error(response?.message || "Could not load the temporary BEES cart state.");
  const state = response.state;
  if (!state || !["pending", "working"].includes(state.status)) return;
  running = true;
  state.status = "working";
  await saveState(state);
  try {
    if (state.phase === "search") await runSearch(state);
    else await runQuickOrder(state);
  } catch (error) {
    state.results.push({ name: "BEES", status: "unmatched", message: error.message });
    await finish(state, "needs_review", "BEES changed before the cart could be completed. Review the listed items manually.");
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "BEES_CART_START") void start();
});

void start();
