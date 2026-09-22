// Only navigate a successfully built cart. Never submit an order, accept terms,
// choose substitutions, or change payment/address details.
(() => {
  const key = "onpar-checkout-review";
  let active = null;
  let busy = false;
  const label = element => String(element.getAttribute("aria-label") || element.innerText || element.value || "").trim().replace(/\s+/g, " ").toLowerCase();
  const visible = element => element.getClientRects().length && !element.disabled && element.getAttribute("aria-disabled") !== "true";
  const final = /^(place order|submit order|confirm order|complete order|confirm purchase|pay now|buy now|send order)$/;
  const navigation = /^(view cart|view basket|cart|basket|checkout|check out|proceed to checkout|continue to checkout|review order|review your order|continue to review)$/;
  function persist() { sessionStorage.setItem(key, JSON.stringify(active)); }
  const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  function beesKegPickupText(element) {
    const labelledBy = (element.getAttribute("aria-labelledby") || "").split(/\s+/)
      .map(id => document.getElementById(id)?.textContent || "").join(" ");
    return [element.getAttribute("aria-label"), labelledBy,
      ...[...(element.labels || [])].map(item => item.textContent),
      element.closest("label")?.textContent,
      /^(checkbox|radio|switch)$/.test(element.getAttribute("role") || "") ? element.textContent : ""]
      .filter(Boolean).join(" ").trim().replace(/\s+/g, " ").toLowerCase();
  }
  function findBeesKegPickupControls() {
    const controls = [...document.querySelectorAll(
      'input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"], [role="switch"]',
    )].map(element => ({ element, text: beesKegPickupText(element) }));
    const exact = controls.filter(({ text }) => /\bi have kegs? to (?:be )?pick(?:ed)?[ -]?up\b/.test(text));
    const matches = exact.length ? exact : controls.filter(({ text }) => (
      /\bkegs?\b/.test(text) && /pick[ -]?up|picked up|collect(?:ion|ed)?/.test(text)
      && !/\bno\b|\bnot\b|don't|do not/.test(text)
    ));
    return matches.map(({ element }) => element);
  }
  function beesKegPickupIsChecked(control) {
    return control.matches('input[type="checkbox"], input[type="radio"]')
      ? control.checked
      : control.getAttribute("aria-checked") === "true";
  }
  async function selectBeesKegPickup() {
    let matches = findBeesKegPickupControls();
    const discoveryDeadline = Date.now() + 15000;
    while (matches.length !== 1 && Date.now() < discoveryDeadline) {
      await pause(250);
      matches = findBeesKegPickupControls();
    }
    if (matches.length !== 1) throw new Error("Please check BEES' keg-pickup box manually; its control could not be identified uniquely.");
    const checkbox = matches[0];
    if (beesKegPickupIsChecked(checkbox)) return;
    if (checkbox.disabled || checkbox.getAttribute("aria-disabled") === "true") {
      throw new Error("BEES' keg-pickup box is disabled. Please review it before submitting.");
    }
    const target = visible(checkbox) ? checkbox : [
      ...(checkbox.labels || []),
      checkbox.closest("label"),
    ].find(visible);
    if (!target) throw new Error("BEES' keg-pickup box is not available to select. Please check it before submitting.");
    target.click();
    const confirmationDeadline = Date.now() + 15000;
    while (Date.now() < confirmationDeadline) {
      matches = findBeesKegPickupControls();
      if (matches.length === 1 && beesKegPickupIsChecked(matches[0])) return;
      await pause(100);
    }
    throw new Error("Please confirm BEES saved the keg-pickup selection before submitting.");
  }
  function stop(message) {
    active = null;
    sessionStorage.removeItem(key);
    const notice = document.createElement("aside");
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;max-width:340px;padding:14px;background:#eff8f4;color:#17372f;border:1px solid #2f7467;border-radius:12px";
    notice.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Close";
    close.onclick = () => notice.remove();
    notice.append(close);
    document.body.append(notice);
  }
  async function advance() {
    if (!active || busy) return;
    busy = true;
    try {
      if (Date.now() > active.expiresAt || active.steps >= 6) return stop("Review navigation paused. Finish the remaining supplier steps manually; nothing was submitted.");
      if (document.querySelector('input[type="password"]')) return stop("Sign in to continue. Nothing was submitted.");
      const alerts = [...document.querySelectorAll('[role="alert"], .alert-danger')].filter(visible).map(element => element.textContent).join(" ");
      if (/unavailable|out of stock|substitut|fee|payment|address|minimum/i.test(alerts)) return stop("The supplier needs your review before continuing. Nothing was submitted.");
      const controls = [...document.querySelectorAll('button, a[href], input[type="submit"], input[type="button"]')].filter(visible);
      if (active.vendor === "ohlq" && /\/checkout\/?$/i.test(location.pathname)) {
        if (typeof globalThis.onParFillOhlqDelivery !== "function") return;
        await globalThis.onParFillOhlqDelivery();
      }
      if (controls.some(element => final.test(label(element)))) {
        if (active.vendor === "heidelberg" && /(^|\.)mybeesapp\.com$/i.test(location.hostname)) {
          await selectBeesKegPickup();
          return stop("Keg pickup is checked. Review the order and submit it yourself.");
        }
        return stop("Ready for your final review. You must submit the order yourself.");
      }
      const candidates = controls.filter(element => navigation.test(label(element)) && !element.closest('[role="dialog"]'));
      // Ambiguous navigation must not guess which vendor action is safe.
      if (candidates.length !== 1) return;
      const target = candidates[0];
      if (target.tagName === "A") {
        const url = new URL(target.href, location.href);
        if (url.origin !== location.origin || /submit|place.?order|payment|purchase/i.test(url.pathname)) return;
      }
      const signature = `${location.href}:${label(target)}`;
      if (active.clicked.includes(signature)) return;
      active.clicked.push(signature);
      active.steps += 1;
      persist();
      target.click();
    } catch (error) {
      stop(`${error.message || "Checkout needs your review."} Nothing was submitted.`);
    } finally { busy = false; }
  }
  globalThis.onParStartCheckoutReview = state => {
    active = { requestId: state.requestId, vendor: state.vendor || "heidelberg", expiresAt: Date.now() + 120000, steps: 0, clicked: [] };
    persist();
    void advance();
  };
  try { active = JSON.parse(sessionStorage.getItem(key) || "null"); } catch { sessionStorage.removeItem(key); }
  setInterval(() => { void advance(); }, 1200);
})();
