const OVERLAY_ID = "onpar-vendor-cart-builder";
const VENDOR_CONFIG = Object.freeze({
  proof: { label: "Proof", hostname: /(?:^|\.)sgproof\.com$/i },
  ohlq: { label: "OHLQ", hostname: /(?:^|\.)ohlq\.com$/i },
});

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return clean(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function canonical(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function currentVendor() {
  return Object.entries(VENDOR_CONFIG).find(([, config]) => config.hostname.test(location.hostname))?.[0] || "";
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function visible(element) {
  return Boolean(element && !element.disabled && element.getClientRects().length);
}

function isLoginPage() {
  return Boolean(document.querySelector('input[type="password"]'))
    || /(?:login|sign-in|signin|authenticate)/i.test(`${location.pathname} ${document.title}`);
}

function renderOverlay(state, message) {
  const config = VENDOR_CONFIG[state.vendor];
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
      <h2>Building your ${escapeHtml(config?.label)} cart</h2>
      <p>${escapeHtml(message)}</p>
      <p class="count">${added} of ${state.lines.length} added</p>
      ${missed.length ? `<ul>${missed.map((item) => `<li class="warn">${escapeHtml(item.name)}: ${escapeHtml(item.message)}</li>`).join("")}</ul>` : ""}
      <button type="button" data-onpar-stop>${state.status === "ready" ? "Close" : "Stop"}</button>
    </div>`;
  host.shadowRoot.querySelector("[data-onpar-stop]")?.addEventListener("click", async () => {
    if (state.status !== "ready") await finish(state, "cancelled", "Stopped before checkout.");
    host.remove();
  }, { once: true });
}

async function saveState(state) {
  const response = await chrome.runtime.sendMessage({ type: "SAVE_VENDOR_CART_STATE", state });
  if (!response?.ok) throw new Error(response?.message || "Could not save the temporary vendor cart state.");
}

async function finish(state, status = "ready", message = "Cart ready for your review. Nothing was submitted.") {
  const result = {
    requestId: state.requestId,
    orderId: state.orderId,
    vendor: state.vendor,
    status,
    results: state.results,
    completedAt: new Date().toISOString(),
    message,
  };
  state.status = status;
  renderOverlay(state, message);
  try {
    const response = await chrome.runtime.sendMessage({ type: "VENDOR_CART_FINISHED", result });
    if (!response?.ok) throw new Error("The final cart status could not be saved.");
  } catch {
    renderOverlay(
      state,
      `${message} Reload the extension before starting another cart.`,
    );
  }
}

function searchInput() {
  const selectors = [
    'input[type="search"]',
    'input[name*="search" i]',
    'input[id*="search" i]',
    'input[placeholder*="search" i]',
  ];
  return selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).find(visible) || null;
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, String(value));
  else input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function addButtons() {
  return [...document.querySelectorAll('button, input[type="button"], input[type="submit"]')].filter((button) => {
    const label = clean(button.textContent || button.value);
    return visible(button) && /^(?:add|add item|add to cart)$/i.test(label);
  });
}

function quantityControl(root) {
  return [...root.querySelectorAll('input[type="number"], input[inputmode="numeric"], select[name*="quantity" i], select[id*="quantity" i]')].find(visible) || null;
}

function candidateForButton(button) {
  let root = button.parentElement;
  for (let depth = 0; root && depth < 8; depth += 1, root = root.parentElement) {
    const text = clean(root.innerText);
    if (text.length > 10 && text.length < 2200 && (quantityControl(root) || depth >= 2)) {
      return { root, button, quantity: quantityControl(root), text: canonical(text) };
    }
  }
  return null;
}

function lineScore(candidate, line) {
  const sku = canonical(line.vendorSku);
  if (sku && candidate.text.includes(sku)) return 1000;
  const tokens = canonical(line.name).split(" ").filter((token) => token.length > 1);
  if (!tokens.length || !tokens.every((token) => candidate.text.includes(token))) return 0;
  return tokens.length;
}

function exactMatches(line) {
  const matches = addButtons()
    .map(candidateForButton)
    .filter(Boolean)
    .map((candidate) => ({ ...candidate, score: lineScore(candidate, line) }))
    .filter((candidate) => candidate.score > 0);
  const bestScore = Math.max(0, ...matches.map((candidate) => candidate.score));
  return matches.filter((candidate) => candidate.score === bestScore);
}

function setQuantity(control, quantity) {
  if (!control) return quantity === 1;
  if (control instanceof HTMLSelectElement) {
    const option = [...control.options].find((item) => Number(item.value) === quantity || Number(item.textContent) === quantity);
    if (!option) return false;
    control.value = option.value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  setInputValue(control, quantity);
  return true;
}

async function addExactMatch(state, lineIndex) {
  const line = state.lines[lineIndex];
  const matches = exactMatches(line);
  if (matches.length !== 1) {
    return {
      lineIndex,
      name: line.name,
      status: "unmatched",
      message: matches.length > 1 ? "More than one exact product matched. Review manually." : "No exact vendor product matched. Review manually.",
    };
  }
  const match = matches[0];
  if (match.button.disabled || /out of stock|unavailable/i.test(match.root.innerText)) {
    return { lineIndex, name: line.name, status: "unmatched", message: "The product is unavailable." };
  }
  if (!setQuantity(match.quantity, line.quantity)) {
    return { lineIndex, name: line.name, status: "unmatched", message: "The requested quantity is not available in the vendor control." };
  }
  await delay(120);
  match.button.click();
  await delay(650);
  return { lineIndex, name: line.name, status: "added", quantity: line.quantity, message: "Added" };
}

async function submitSearch(state, lineIndex) {
  const input = searchInput();
  if (!input) return false;
  const line = state.lines[lineIndex];
  const term = line.vendorSku || line.name;
  state.phase = "search-results";
  state.searchCursor = lineIndex;
  await saveState(state);
  setInputValue(input, term);
  const form = input.closest("form");
  if (form?.requestSubmit) form.requestSubmit();
  else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  await delay(1400);
  return true;
}

async function waitForResults(timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (addButtons().length) return true;
    await delay(250);
  }
  return false;
}

let running = false;
function startSafely() {
  void start().catch((error) => {
    const vendor = currentVendor();
    const label = VENDOR_CONFIG[vendor]?.label || "Vendor";
    renderOverlay({
      lines: [],
      results: [{ name: label, status: "unmatched", message: error.message }],
      status: "needs_review",
    }, `The ${label} cart could not start. Reload this page and try again.`);
  });
}

async function start() {
  if (running) return;
  const response = await chrome.runtime.sendMessage({ type: "GET_VENDOR_CART_STATE" });
  if (!response?.ok) throw new Error(response?.message || "Could not load the temporary vendor cart state.");
  const state = response.state;
  const vendor = currentVendor();
  if (!state || state.vendor !== vendor || !["pending", "working"].includes(state.status)) return;
  if (isLoginPage()) {
    renderOverlay(state, `Sign in to ${VENDOR_CONFIG[vendor].label}. The cart builder will continue after sign-in.`);
    return;
  }
  running = true;
  state.status = "working";
  state.results = Array.isArray(state.results) ? state.results : [];
  state.searchCursor = Number.isInteger(state.searchCursor) ? state.searchCursor : 0;
  await saveState(state);
  try {
    while (state.searchCursor < state.lines.length) {
      const lineIndex = state.searchCursor;
      const line = state.lines[lineIndex];
      renderOverlay(state, `Finding an exact match for ${line.name}...`);
      if (state.phase !== "search-results") {
        const submitted = await submitSearch(state, lineIndex);
        if (!submitted) {
          state.results.push({ lineIndex, name: line.name, status: "unmatched", message: "The vendor search control was not available." });
          state.searchCursor += 1;
          state.phase = "start";
          await saveState(state);
          continue;
        }
      }
      await waitForResults();
      state.results.push(await addExactMatch(state, lineIndex));
      state.searchCursor += 1;
      state.phase = "start";
      await saveState(state);
    }
    await finish(state);
  } catch (error) {
    state.results.push({ name: VENDOR_CONFIG[vendor].label, status: "unmatched", message: error.message });
    await finish(state, "needs_review", `${VENDOR_CONFIG[vendor].label} changed before the cart could be completed. Review the listed items manually.`);
  } finally {
    running = false;
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "VENDOR_CART_START") startSafely();
});

startSafely();
