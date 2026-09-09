const OVERLAY_ID = "onpar-vendor-cart-builder";
const VENDOR_CONFIG = Object.freeze({
  proof: { label: "Proof", hostname: /(?:^|\.)sgproof\.com$/i },
  ohlq: { label: "OHLQ", hostname: /(?:^|\.)ohlq\.com$/i },
});
const PROOF_PRODUCT_IDENTITIES = Object.freeze({
  "615006": { include: ["llords", "apple", "schnapps"] },
  "38000": { include: ["angostura", "bitters", "16"] },
  "301977": { include: ["dekuyper", "blueberry", "schnapps"] },
  "614536": { include: ["llords", "creme", "cacao"] },
  "472535": { include: ["finest", "call", "lemon", "juice"] },
  "437071": { include: ["finest", "call", "lime", "juice"] },
  "697774": { include: ["korbel", "brut", "250", "years"] },
  "437102": { include: ["master", "mixes", "mint", "syrup"] },
  "25213": { include: ["dekuyper", "peachtree"] },
  "186701": { include: ["dekuyper", "pomegranate"] },
  "293371": { include: ["dekuyper", "razzmatazz"] },
  "220898": { include: ["dekuyper", "strawberry", "pucker"] },
  "33497": { include: ["dekuyper", "triple", "sec"] },
  "49357": { include: ["dekuyper", "watermelon", "pucker"] },
});
const OHLQ_CATALOG_PATH = "/Previously-Purchased";
const OHLQ_PRODUCT_IDS = Object.freeze({
  "0066D": "66345753724699",
  "0068B": "111805928192876",
    "0069L": "143304623839284",
    "3024D": "97663185316991",
    "4982D": "199012596936030",
    "6060D": "24866493326551",
    "6765D": "167097883074878",
  "0281D": "13705430644522",
  "0439D": "107287394991507",
  "0893L": "180221973987424",
  "1327D": "146084707599901",
  "1497D": "273340084659512",
  "1499L": "208260884030338",
  "1755D": "84429962128508",
  "2375D": "98148290645302",
  "2410D": "150306335296910",
  "3907D": "117964430056456",
  "4116D": "208788558080955",
  "8780B": "6528257933874",
  "8867B": "182281370012392",
  "8894D": "157055177947678",
  "9674D": "103610807059918",
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

function buildOhlqDeliveryPreference(reference) {
  const parsed = new Date(clean(reference));
  if (!Number.isFinite(parsed.getTime())) return null;

  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(parsed)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const anchor = new Date(
    Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 12),
  );
  if (!Number.isFinite(anchor.getTime())) return null;

  const daysSinceMonday = (anchor.getUTCDay() + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - daysSinceMonday + 3);
  return {
    date: anchor.toISOString().slice(0, 10),
    time: "09:00",
  };
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
  const finished = ["ready", "needs_review", "cancelled"].includes(state.status);
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
      <button type="button" data-onpar-stop>${finished ? "Close" : "Stop"}</button>
    </div>`;
  host.shadowRoot.querySelector("[data-onpar-stop]")?.addEventListener("click", async () => {
    if (!finished) await finish(state, "cancelled", "Stopped before checkout.");
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
    deliveryPreference:
      state.vendor === "ohlq"
        ? buildOhlqDeliveryPreference(state.operatingWeekReference)
        : null,
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

function vendorSearchUrl(vendor, term) {
  if (vendor !== "proof") return "";
  const url = new URL("/search", location.origin);
  url.searchParams.set("text", term);
  return url.href;
}

function addButtons() {
  return [...document.querySelectorAll('button, input[type="button"], input[type="submit"]')].filter((button) => {
    const label = clean(button.textContent || button.value);
    // Some vendors disable Add until a quantity is entered. The button still
    // identifies the product card; check whether it is enabled after filling.
    return Boolean(button.getClientRects().length) && /^(?:add|add item|add to cart)$/i.test(label);
  });
}

function quantityControls(root) {
  return [...root.querySelectorAll('input[type="number"], input[inputmode="numeric"], select[name*="quantity" i], select[id*="quantity" i]')].filter(visible);
}

function quantityControl(root) {
  return quantityControls(root)[0] || null;
}

function quantityControlText(control, root) {
  const parts = [
    control.getAttribute("aria-label"),
    control.getAttribute("name"),
    control.getAttribute("id"),
    control.getAttribute("placeholder"),
    control.getAttribute("data-testid"),
  ];
  if (control.labels) parts.push(...[...control.labels].map((label) => label.textContent));

  let ancestor = control.parentElement;
  while (ancestor && ancestor !== root) {
    if (quantityControls(ancestor).length === 1) {
      parts.push(
        ancestor.getAttribute("aria-label"),
        ancestor.getAttribute("data-testid"),
        ancestor.textContent,
      );
    }
    ancestor = ancestor.parentElement;
  }

  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim().toLowerCase();
}

function quantityControlForKind(root, quantityKind) {
  if (!["cases", "units"].includes(quantityKind)) return null;
  const kindPattern = quantityKind === "cases" ? /\bcases?\b/i : /\bunits?\b/i;
  const otherPattern = quantityKind === "cases" ? /\bunits?\b/i : /\bcases?\b/i;
  const controls = quantityControls(root);
  const matches = controls.filter((control) => kindPattern.test(quantityControlText(control, root)));
  if (matches.length === 1) return matches[0];

  if (controls.length === 1) {
    const rootText = String(root?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (kindPattern.test(rootText) && !otherPattern.test(rootText)) return controls[0];
  }
  return null;
}

function candidateForButton(button, line) {
  let root = button.parentElement;
  let fallback = null;
  const ohlqSku = currentVendor() === "ohlq" ? clean(line?.vendorSku) : "";
  const skuPattern = /^[0-9]{4}[a-z]$/i.test(ohlqSku)
    ? new RegExp(`(?:^|[^a-z0-9])${ohlqSku}(?:[^a-z0-9]|$)`, "i")
    : null;
  for (let depth = 0; root && depth < 8; depth += 1, root = root.parentElement) {
    const text = clean(root.innerText);
    if (text.length <= 10 || text.length >= 2200) continue;
    const quantity = quantityControl(root);
    const candidate = { root, button, quantity, text: canonical(text) };
    if (quantity && (ohlqSku
      ? skuPattern && skuPattern.test(text)
      : lineScore(candidate, line) > 0)) return candidate;
    if (!fallback && depth >= 2) fallback = candidate;
  }
  return !ohlqSku && fallback && lineScore(fallback, line) > 0 ? fallback : null;
}

function lineScore(candidate, line) {
  const sku = canonical(line.vendorSku);
  if (sku) {
    if (candidate.text.includes(sku)) return 1000;
    const proofIdentity = PROOF_PRODUCT_IDENTITIES[clean(line.vendorSku)];
    if (proofIdentity?.include.every((token) => candidate.text.includes(canonical(token)))) return 900;
    return 0;
  }
  const tokens = canonical(line.name).split(" ").filter((token) => token.length > 1);
  if (!tokens.length || !tokens.every((token) => candidate.text.includes(token))) return 0;
  return tokens.length;
}

function exactMatches(line) {
  const matches = addButtons()
    .map((button) => candidateForButton(button, line))
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

function cartLinkSnapshot() {
  return [...document.querySelectorAll('a[href*="cart" i], a[href*="basket" i]')]
    .filter(visible)
    .map((link) => clean(link.textContent))
    .join("|");
}

function proofCartQuantity(line) {
  const matches = exactMatches(line);
  if (matches.length !== 1) return null;
  const text = clean(matches[0].root.innerText);
  const quantities = { cases: 0, units: 0 };
  const badges = [...text.matchAll(/(\d+)\s*(cases?|units?|bottles?)\s+in\s+cart\b/gi)];
  // Unknown wording must not be interpreted as an empty cart.
  if (!badges.length && /in\s+cart/i.test(text)) return null;
  for (const badge of badges) {
    const kind = /^case/i.test(badge[2]) ? "cases" : "units";
    quantities[kind] += Number(badge[1]);
  }
  return quantities[line.quantityKind === "cases" ? "cases" : "units"];
}

async function waitForProofAddConfirmation(line, previousQuantity, timeout = 30000) {
  const started = Date.now();
  const expected = previousQuantity + Number(line.quantity);
  while (Date.now() - started < timeout) {
    const current = proofCartQuantity(line);
    if (current !== null && current === expected) return true;
    await delay(250);
  }
  return false;
}

async function waitForAddConfirmation(previousCart, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const pageText = clean(document.body?.innerText);
    const currentCart = cartLinkSnapshot();
    if (/added to (?:cart|basket)|cart updated/i.test(pageText)) return true;
    if (currentCart && previousCart && currentCart !== previousCart) return true;
    await delay(200);
  }
  return false;
}

function ohlqCatalogRows() {
  const rows = [...document.querySelectorAll(".product-item--minimal-previously-purchased, tr")];
  return rows
    .map((row) => {
      const skuLink = [...row.querySelectorAll('a[href*="product-detail/"]')]
        .find((link) => /^[0-9]{4}[a-z]$/i.test(clean(link.textContent)));
      return { row, quantity: quantityControl(row), text: clean(row.innerText), sku: clean(skuLink?.textContent).toUpperCase() };
    })
    .filter((entry) => entry.quantity && (entry.sku || /(?:^|\s)[0-9]{4}[a-z](?:\s|$)/i.test(entry.text)));
}

function exactOhlqRows(line) {
  const sku = clean(line.vendorSku).toUpperCase();
  if (!/^[A-Z0-9]+$/.test(sku)) return [];
  const escapedSku = sku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\s)${escapedSku}(?:\\s|$)`, "i");
  return ohlqCatalogRows().filter((entry) => entry.sku ? entry.sku === sku : pattern.test(entry.text));
}

function ohlqProductId(line) {
  return OHLQ_PRODUCT_IDS[clean(line.vendorSku).toUpperCase()] || "";
}

function ohlqProductUrl(productId) {
  return new URL(`/product-detail/id=${encodeURIComponent(productId)}`, location.origin).href;
}

function ohlqDaysControl() {
  return [...document.querySelectorAll("select")].find((select) => {
    const options = [...select.options].map((option) => clean(option.textContent));
    return ["15", "30", "60", "90"].every((days) => options.includes(days));
  }) || null;
}

function buttonWithExactLabel(label) {
  return [...document.querySelectorAll('button, input[type="button"], input[type="submit"]')]
    .find((button) => visible(button) && clean(button.textContent || button.value).toLowerCase() === label.toLowerCase()) || null;
}

async function waitForOhlqCatalog(state, timeout = 90000, isReady = () => ohlqCatalogRows().length > 0) {
  const started = Date.now();
  renderOverlay(state, "Waiting for OHLQ's catalog to load (up to 90 seconds). Nothing has been added yet.");
  while (Date.now() - started < timeout) {
    if (state.status === "cancelled") return false;
    if (isReady()) return true;
    await delay(250);
  }
  return false;
}

function addResultOnce(state, result) {
  const priorIndex = state.results.findIndex((entry) => entry.lineIndex === result.lineIndex);
  if (priorIndex >= 0) state.results[priorIndex] = result;
  else state.results.push(result);
}

async function finishFromResults(state) {
  const missed = state.results.filter((result) => result.status !== "added");
  if (missed.length) {
    const added = state.results.filter((result) => result.status === "added").length;
    await finish(
      state,
      "needs_review",
      `${added} of ${state.lines.length} added. Review the listed items before continuing. Nothing was submitted.`,
    );
    return;
  }
  await finish(state);
}

async function finishOhlqStaged(state, confirmed) {
  const staged = Array.isArray(state.ohlqStaged) ? state.ohlqStaged : [];
  staged.forEach(({ lineIndex }) => {
    const line = state.lines[lineIndex];
    addResultOnce(state, {
      lineIndex,
      name: line.name,
      status: confirmed ? "added" : "unmatched",
      ...(confirmed ? { quantity: line.quantity } : {}),
      message: confirmed ? "Added" : "OHLQ did not confirm that this item was added.",
    });
  });
  state.phase = "ohlq-complete";
  delete state.ohlqStaged;
  delete state.ohlqCartBefore;
  if (state.ohlqDirectQueue?.length) {
    state.phase = "ohlq-direct";
    state.ohlqDirectCursor = Number.isInteger(state.ohlqDirectCursor) ? state.ohlqDirectCursor : 0;
    await saveState(state);
    location.assign(ohlqProductUrl(state.ohlqDirectQueue[state.ohlqDirectCursor].productId));
    return;
  }
  await saveState(state);
  await finishFromResults(state);
}

async function runOhlqDirect(state) {
  const queue = Array.isArray(state.ohlqDirectQueue) ? state.ohlqDirectQueue : [];
  const cursor = Number.isInteger(state.ohlqDirectCursor) ? state.ohlqDirectCursor : 0;
  const current = queue[cursor];
  if (!current) {
    delete state.ohlqDirectQueue;
    delete state.ohlqDirectCursor;
    state.phase = "ohlq-complete";
    await saveState(state);
    await finishFromResults(state);
    return;
  }

  const destination = ohlqProductUrl(current.productId);
  if (location.href.replace(/\/+$/, "") !== destination.replace(/\/+$/, "")) {
    await saveState(state);
    location.assign(destination);
    return;
  }

  await waitForResults();
  addResultOnce(state, await addExactMatch(state, current.lineIndex));
  state.ohlqDirectCursor = cursor + 1;
  await saveState(state);
  const next = queue[state.ohlqDirectCursor];
  if (next) {
    location.assign(ohlqProductUrl(next.productId));
    return;
  }
  delete state.ohlqDirectQueue;
  delete state.ohlqDirectCursor;
  state.phase = "ohlq-complete";
  await saveState(state);
  await finishFromResults(state);
}

async function runOhlqCatalog(state) {
  if (state.phase === "ohlq-direct") {
    await runOhlqDirect(state);
    return;
  }

  if (state.phase === "ohlq-adding") {
    const confirmed = await waitForAddConfirmation(state.ohlqCartBefore, 5000);
    await finishOhlqStaged(state, confirmed);
    return;
  }

  if (location.pathname.toLowerCase() !== OHLQ_CATALOG_PATH.toLowerCase()) {
    state.phase = "ohlq-catalog";
    await saveState(state);
    location.assign(new URL(OHLQ_CATALOG_PATH, location.origin).href);
    return;
  }

  if (state.phase !== "ohlq-filtered") {
    const filtersReady = await waitForOhlqCatalog(state, 90000, () => (
      Boolean(ohlqDaysControl() && buttonWithExactLabel("Apply Filters"))
    ));
    if (state.status === "cancelled") return;
    if (!filtersReady) {
      await finish(state, "needs_review", "OHLQ's filters did not finish loading within 90 seconds. Nothing was added. Wait for the page to load, then retry from the dashboard.");
      return;
    }
    const daysControl = ohlqDaysControl();
    const applyFilters = buttonWithExactLabel("Apply Filters");
    if (!daysControl || !applyFilters) throw new Error("The OHLQ purchased-product filters were unavailable.");
    const ninetyDays = [...daysControl.options].find((option) => clean(option.textContent) === "90");
    if (!ninetyDays) throw new Error("The OHLQ 90-day purchased-product filter was unavailable.");
    daysControl.value = ninetyDays.value;
    daysControl.dispatchEvent(new Event("change", { bubbles: true }));
    state.phase = "ohlq-filtered";
    await saveState(state);
    applyFilters.click();
    await delay(1500);
  }

  const catalogReady = await waitForOhlqCatalog(state);
  if (state.status === "cancelled") return;
  if (!catalogReady) {
    await finish(state, "needs_review", "OHLQ's catalog did not finish loading within 90 seconds. Nothing was added. Wait for the products to appear, then retry from the dashboard. If they are already visible, reload the extension and refresh this page.");
    return;
  }

  const staged = [];
  const directQueue = [];
  state.lines.forEach((line, lineIndex) => {
    const matches = exactOhlqRows(line);
    if (matches.length !== 1) {
      const productId = matches.length === 0 ? ohlqProductId(line) : "";
      if (productId) {
        directQueue.push({ lineIndex, productId });
        return;
      }
      addResultOnce(state, {
        lineIndex,
        name: line.name,
        status: "unmatched",
        message: matches.length > 1
          ? "More than one exact OHLQ item ID matched. Review manually."
          : "This exact OHLQ item ID was not in the 90-day purchased catalog. Review manually.",
      });
      return;
    }
    const match = matches[0];
    if (/out of stock|unavailable/i.test(match.row.innerText)) {
      addResultOnce(state, { lineIndex, name: line.name, status: "unmatched", message: "The product is unavailable." });
      return;
    }
    if (!setQuantity(match.quantity, line.quantity)) {
      addResultOnce(state, { lineIndex, name: line.name, status: "unmatched", message: "The requested quantity is not available in the OHLQ control." });
      return;
    }
    staged.push({ lineIndex });
  });

  state.ohlqDirectQueue = directQueue;
  state.ohlqDirectCursor = 0;

  if (!staged.length) {
    if (directQueue.length) {
      state.phase = "ohlq-direct";
      await saveState(state);
      location.assign(ohlqProductUrl(directQueue[0].productId));
      return;
    }
    await finishFromResults(state);
    return;
  }

  const addButton = buttonWithExactLabel("Add to Cart");
  if (!addButton) {
    staged.forEach(({ lineIndex }) => addResultOnce(state, {
      lineIndex,
      name: state.lines[lineIndex].name,
      status: "unmatched",
      message: "The OHLQ Add to Cart control was unavailable.",
    }));
    await finishFromResults(state);
    return;
  }

  state.ohlqStaged = staged;
  state.ohlqCartBefore = cartLinkSnapshot();
  state.phase = "ohlq-adding";
  await saveState(state);
  addButton.click();
  const confirmed = await waitForAddConfirmation(state.ohlqCartBefore);
  await finishOhlqStaged(state, confirmed);
}

async function addExactMatch(state, lineIndex) {
  const requestedLine = state.lines[lineIndex];
  const isProof = state.vendor === "proof";
  const existingQuantity = isProof ? state.proofCartCounts?.[lineIndex] : 0;
  if (isProof && !Number.isFinite(existingQuantity)) {
    return { lineIndex, name: requestedLine.name, status: "unconfirmed", message: "The existing cart quantity must be checked before adding this item." };
  }
  const line = isProof
    ? { ...requestedLine, quantity: Math.max(0, Number(requestedLine.quantity) - existingQuantity) }
    : requestedLine;
  if (isProof && line.quantity === 0) {
    return { lineIndex, name: line.name, status: "added", quantity: requestedLine.quantity, quantityKind: line.quantityKind, message: "The requested quantity is already in the cart; nothing extra was added." };
  }
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
  if (/out of stock|unavailable/i.test(match.root.innerText)) {
    return { lineIndex, name: line.name, status: "unmatched", message: "The product is unavailable." };
  }
  const controls = quantityControls(match.root);
  // OHLQ's exact-SKU detail page labels its single bottle input "Quantity",
  // not "Units". Never interpret this fallback as a case quantity.
  const requestedQuantityControl = state.vendor === "ohlq" && line.quantityKind === "units" && controls.length === 1
    ? controls[0]
    : quantityControlForKind(match.root, line.quantityKind);
  if (!requestedQuantityControl) {
    const label = line.quantityKind === "cases" ? "case" : "unit";
    return { lineIndex, name: line.name, status: "unmatched", message: `Could not identify one ${label} quantity control safely.` };
  }
  if (!setQuantity(requestedQuantityControl, line.quantity)) {
    return { lineIndex, name: line.name, status: "unmatched", message: "The requested quantity is not available in the matching vendor control." };
  }
  await delay(750);
  if (match.button.disabled) {
    return { lineIndex, name: line.name, status: "unmatched", message: "The vendor did not enable Add to Cart after the requested quantity was entered. Review the quantity and availability." };
  }
  const previousCart = cartLinkSnapshot();
  if (isProof) {
    // A page reload after clicking must not silently repeat the addition.
    state.pendingAdd = { lineIndex, name: line.name, targetQuantity: Number(requestedLine.quantity) };
    state.phase = "proof-cart-confirm";
    await saveState(state);
    renderOverlay(state, `Adding ${line.name}; checking the actual Proof cart next...`);
  }
  match.button.click();
  if (isProof) {
    // Do not depend on the search page's optional or stale In Cart badge.
    // The destination worker confirms the SKU and quantity before continuing.
    await delay(1500);
    if (state.status !== "cancelled") location.assign("https://shop.sgproof.com/sgws/en/usd/cart");
    return { lineIndex, name: line.name, status: "verifying" };
  }
  const confirmed = await waitForAddConfirmation(previousCart);
  if (!confirmed) {
    return { lineIndex, name: line.name, status: isProof ? "unconfirmed" : "unmatched", message: isProof ? "Proof may have added this item, but its cart quantity could not be confirmed. Check the cart before retrying; no further items were attempted." : "The vendor did not confirm that this item was added." };
  }
  await delay(250);
  const quantityLabel = line.quantityKind === "cases"
    ? `${line.quantity} ${line.quantity === 1 ? "case" : "cases"}`
    : `${line.quantity} ${line.quantity === 1 ? "unit" : "units"}`;
  return { lineIndex, name: line.name, status: "added", quantity: line.quantity, quantityKind: line.quantityKind, message: `Added ${quantityLabel}` };
}

async function submitSearch(state, lineIndex) {
  const line = state.lines[lineIndex];
  const term = line.vendorSku || line.name;
  state.phase = "search-results";
  state.searchCursor = lineIndex;
  await saveState(state);
  const destination = vendorSearchUrl(state.vendor, term);
  if (destination) {
    location.assign(destination);
    return "navigating";
  }
  const input = searchInput();
  if (!input) return false;
  setInputValue(input, term);
  const form = input.closest("form");
  if (form?.requestSubmit) form.requestSubmit();
  else input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  await delay(1400);
  return true;
}

async function waitForResults(timeout = 10000, line = null, state = null) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (state?.status === "cancelled") return false;
    if (line ? exactMatches(line).length : addButtons().length) return true;
    await delay(250);
  }
  return false;
}

function isOhlqCheckoutPage() {
  return /(^|\.)ohlq\.com$/i.test(window.location.hostname)
    && /\/checkout\/?$/i.test(window.location.pathname);
}

function ohlqDateLabel(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function renderOhlqDeliveryNotice(message, isError = false) {
  const id = "onpar-ohlq-delivery-notice";
  document.getElementById(id)?.remove();
  const notice = document.createElement("aside");
  notice.id = id;
  notice.setAttribute("role", isError ? "alert" : "status");
  notice.style.cssText = [
    "position:fixed",
    "right:20px",
    "bottom:20px",
    "z-index:2147483647",
    "max-width:360px",
    "padding:16px 18px",
    "border-radius:12px",
    `border:2px solid ${isError ? "#b94f3c" : "#2f7467"}`,
    `background:${isError ? "#fff1ed" : "#eff8f4"}`,
    "color:#17372f",
    "font:600 15px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
    "box-shadow:0 12px 32px rgba(21,48,40,.2)",
  ].join(";");
  notice.textContent = message;
  document.body.appendChild(notice);
  window.setTimeout(() => notice.remove(), isError ? 15000 : 8000);
}

function findOhlqDeliveryDateInput() {
  return [...document.querySelectorAll(
    'input[name="sdp"], input[ngbdatepicker], input[placeholder*="delivery date" i]',
  )].find(visible) || null;
}

function findOhlqDateChoice(isoDate) {
  const targetLabel = ohlqDateLabel(isoDate).toLowerCase();
  if (!targetLabel) return null;

  const labelled = [...document.querySelectorAll(
    "ngb-datepicker [aria-label], .ngb-datepicker [aria-label]",
  )].find(
    (element) => clean(element.getAttribute("aria-label")).toLowerCase() === targetLabel,
  );
  if (labelled) return labelled;

  const targetDay = String(Number(isoDate.slice(8, 10)));
  const dayChoices = [...document.querySelectorAll(".ngb-dp-day")].filter((element) => (
    visible(element)
    && element.getAttribute("aria-disabled") !== "true"
    && clean(element.textContent) === targetDay
  ));
  return dayChoices.length === 1 ? dayChoices[0] : null;
}

async function selectOhlqDeliveryDate(isoDate) {
  const input = findOhlqDeliveryDateInput();
  if (!input) throw new Error("OHLQ's delivery-date control could not be found.");
  input.click();
  await delay(250);

  let choice = findOhlqDateChoice(isoDate);
  if (!choice) {
    const targetMonth = String(Number(isoDate.slice(5, 7)));
    const targetYear = isoDate.slice(0, 4);
    const calendar = document.querySelector("ngb-datepicker, .ngb-datepicker");
    const selects = [...(calendar?.querySelectorAll("select") || [])];
    const monthSelect = selects.find((select) => (
      /month/i.test(clean(select.getAttribute("aria-label")))
    ));
    const yearSelect = selects.find((select) => (
      /year/i.test(clean(select.getAttribute("aria-label")))
    ));

    if (monthSelect && [...monthSelect.options].some((option) => option.value === targetMonth)) {
      monthSelect.value = targetMonth;
      monthSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (yearSelect && [...yearSelect.options].some((option) => option.value === targetYear)) {
      yearSelect.value = targetYear;
      yearSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await delay(250);
    choice = findOhlqDateChoice(isoDate);
  }

  if (!choice) {
    throw new Error("The plan week's Thursday is not available in OHLQ's delivery calendar.");
  }
  const clickable = choice.matches("button, [role='button']")
    ? choice
    : choice.querySelector("button, [role='button']") || choice;
  clickable.click();
  await delay(350);
  if (!clean(input.value)) {
    throw new Error("OHLQ did not accept the plan week's Thursday as the delivery date.");
  }
}

function findOhlqDeliveryTimeSelect() {
  const selects = [...document.querySelectorAll("select")].filter(visible);
  return selects.find((select) => (
    [...select.options].some((option) => (
      /^0?9(?::00)?\s*a\.?m\.?\b/i.test(clean(option.textContent))
    ))
  )) || selects.find((select) => (
    /requested delivery time/i.test(clean(select.parentElement?.parentElement?.textContent))
  )) || null;
}

async function selectOhlqDeliveryTime() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const select = findOhlqDeliveryTimeSelect();
    const option = select
      ? [...select.options].find((candidate) => (
          /^0?9(?::00)?\s*a\.?m\.?\b/i.test(clean(candidate.textContent))
        ))
      : null;
    if (select && option) {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await delay(200);
      if (select.value === option.value) return;
    }
    await delay(250);
  }
  throw new Error("OHLQ did not offer a 9:00 AM delivery time for that Thursday.");
}

let ohlqDeliveryFillRunning = false;
async function fillOhlqCheckoutDelivery() {
  if (ohlqDeliveryFillRunning) return;
  ohlqDeliveryFillRunning = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: "GET_OHLQ_DELIVERY_PREFERENCE",
    });
    const preference = response?.ok ? response.preference : null;
    if (!preference) return;
    await selectOhlqDeliveryDate(preference.date);
    await selectOhlqDeliveryTime();
    renderOhlqDeliveryNotice(
      `Delivery set for ${ohlqDateLabel(preference.date)} at 9:00 AM. Review the cart and submit it manually.`,
    );
  } finally {
    ohlqDeliveryFillRunning = false;
  }
}

function proofCartCounts(state) {
  const pageText = clean(document.body?.innerText);
  if (!/order summary/i.test(pageText) || !/total items\s*:/i.test(pageText)) return null;
  const productLinks = [...document.querySelectorAll('a[href*="/p/"]')];
  const counts = [];
  for (const line of state.lines) {
    const sku = clean(line.vendorSku);
    if (!sku) return null;
    const links = productLinks.filter((link) => {
      try {
        return new URL(link.href, location.href).pathname.split("/p/")[1]?.replace(/\/$/, "") === sku;
      } catch {
        return false;
      }
    });
    if (!links.length) {
      counts.push(0);
      continue;
    }
    let root = links[0].parentElement;
    let quantity = null;
    for (let depth = 0; root && depth < 12; depth += 1, root = root.parentElement) {
      const controls = quantityControls(root);
      if (controls.length > 2) break;
      if (controls.length !== 2) continue;
      const control = quantityControlForKind(root, line.quantityKind);
      if (!control || clean(control.value) === "") continue;
      const value = Number(control.value);
      if (Number.isInteger(value) && value >= 0) quantity = value;
      break;
    }
    if (quantity === null) return null;
    counts.push(quantity);
  }
  return counts;
}

async function checkProofCart(state) {
  const needsCheck = state.pendingAdd || !Array.isArray(state.proofCartCounts);
  if (!needsCheck) return false;
  renderOverlay(state, "Checking the actual Proof cart so existing items are not added twice...");
  if (!/^\/sgws\/en\/usd\/cart\/?$/.test(location.pathname)) {
    state.phase = state.pendingAdd ? "proof-cart-confirm" : "proof-cart-baseline";
    await saveState(state);
    location.assign("https://shop.sgproof.com/sgws/en/usd/cart");
    return true;
  }
  const deadline = Date.now() + 90000;
  let counts = null;
  while (Date.now() < deadline) {
    if (state.status === "cancelled") return true;
    counts = proofCartCounts(state);
    const pending = state.pendingAdd;
    const target = pending ? Number(pending.targetQuantity ?? state.lines[pending.lineIndex].quantity) : 0;
    if (counts && (!pending || counts[pending.lineIndex] >= target)) break;
    await delay(500);
  }
  const pending = state.pendingAdd;
  const target = pending ? Number(pending.targetQuantity ?? state.lines[pending.lineIndex].quantity) : 0;
  if (!counts || (pending && counts[pending.lineIndex] < target)) {
    if (pending) addResultOnce(state, { ...pending, status: "unconfirmed", message: "The actual cart could not confirm the requested quantity. Nothing was retried; review the cart before continuing." });
    await finish(state, "needs_review", "Stopped because Proof's actual cart quantity could not be confirmed. No automatic retry was made.");
    return true;
  }
  state.proofCartCounts = counts;
  if (pending) {
    const line = state.lines[pending.lineIndex];
    addResultOnce(state, { lineIndex: pending.lineIndex, name: line.name, status: "added", quantity: target, quantityKind: line.quantityKind, message: "Requested quantity confirmed in the actual Proof cart." });
    state.searchCursor = pending.lineIndex + 1;
    state.pendingAdd = null;
  }
  state.phase = "start";
  await saveState(state);
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
  if (isOhlqCheckoutPage()) {
    try {
      await fillOhlqCheckoutDelivery();
    } catch (error) {
      renderOhlqDeliveryNotice(
        error instanceof Error
          ? error.message
          : "The OHLQ delivery date and time could not be selected.",
        true,
      );
    }
  }
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
    if (vendor === "proof" && await checkProofCart(state)) return;
    if (vendor === "ohlq") {
      await runOhlqCatalog(state);
      return;
    }
    while (state.searchCursor < state.lines.length) {
      const lineIndex = state.searchCursor;
      const line = state.lines[lineIndex];
      if (vendor === "proof" && state.proofCartCounts[lineIndex] >= Number(line.quantity)) {
        addResultOnce(state, { lineIndex, name: line.name, status: "added", quantity: line.quantity, quantityKind: line.quantityKind, message: "Already in the cart; nothing extra was added." });
        state.searchCursor += 1;
        state.phase = "start";
        await saveState(state);
        continue;
      }
      renderOverlay(state, `Finding an exact match for ${line.name}...`);
      if (state.phase !== "search-results") {
        const submitted = await submitSearch(state, lineIndex);
        // A full-page navigation destroys this worker. Resume from the saved
        // cursor in the destination page instead of inspecting the old page.
        if (submitted === "navigating") return;
        if (!submitted) {
          state.results.push({ lineIndex, name: line.name, status: "unmatched", message: "The vendor search control was not available." });
          state.searchCursor += 1;
          state.phase = "start";
          await saveState(state);
          continue;
        }
      }
      renderOverlay(state, `Waiting for Proof to load ${line.name} (up to 90 seconds)...`);
      const found = await waitForResults(90000, line, state);
      if (state.status === "cancelled") return;
      if (!found) {
        addResultOnce(state, { lineIndex, name: line.name, status: "unmatched", message: "The exact Proof product and quantity controls were not detected within 90 seconds. Review this item manually; previously added items remain in the cart." });
        state.searchCursor += 1;
        state.phase = "start";
        await saveState(state);
        continue;
      }
      const addResult = await addExactMatch(state, lineIndex);
      if (state.status === "cancelled") return;
      if (addResult.status === "verifying") return;
      state.results.push(addResult);
      state.pendingAdd = null;
      await saveState(state);
      if (addResult.status === "unconfirmed") {
        await finish(state, "needs_review", "Stopped: the last item may already be in your cart. Check its quantity before retrying. Nothing was submitted.");
        return;
      }
      state.searchCursor += 1;
      state.phase = "start";
      await saveState(state);
    }
    await finishFromResults(state);
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
