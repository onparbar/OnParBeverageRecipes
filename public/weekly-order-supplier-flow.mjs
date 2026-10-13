const STORAGE_KEY = "onpar-weekly-order-supplier-flow-v1";
const SUPPLIER_PREFIX = "supplier:";

// The caller supplies the existing, already-rendered order and prep cards.
// Navigation only changes visibility; the existing controls keep their state.
export function renderSupplierOrderFlow({ ordersHtml = "", prepHtml = "" } = {}) {
  return `<section class="supplier-order-flow" data-supplier-order-flow>
    <header class="supplier-order-flow-header">
      <p data-supplier-order-progress></p>
      <h2 class="weekly-order-title" data-supplier-order-title tabindex="-1">Supplier orders</h2>
    </header>
    <div data-supplier-order-orders>${ordersHtml}<p class="supplier-order-flow-empty" data-supplier-order-empty hidden>No supplier orders to show.</p></div>
    <div data-supplier-order-prep hidden>${prepHtml}</div>
    <footer class="weekly-order-footer"><div class="weekly-order-footer-buttons">
      <button type="button" class="weekly-order-button" data-supplier-order-nav="back">Back</button>
      <button type="button" class="weekly-order-button weekly-order-button--primary" data-supplier-order-nav="next">Next</button>
    </div></footer>
  </section>`;
}

export function createSupplierOrderFlow({ storage = globalThis.localStorage, onExit = () => {} } = {}) {
  let flow = null;
  let cards = [];
  let bindings = [];
  let state = { scope: "", screen: "orders" };
  let pendingTarget = "";

  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
    if (typeof saved?.scope === "string" && typeof saved?.screen === "string"
      && (saved.screen === "orders" || saved.screen === "prep" || saved.screen.startsWith(SUPPLIER_PREFIX))) {
      state = { scope: saved.scope, screen: saved.screen };
    }
  } catch { /* The current visit remains usable without browser storage. */ }

  const name = (card) => card.dataset.supplierOrderCard;
  const supplierScreen = (card) => `${SUPPLIER_PREFIX}${name(card)}`;

  function firstOrder() {
    const card = cards.find((entry) => entry.dataset.supplierOrderPlaced !== "true") || cards[0];
    return card ? supplierScreen(card) : "orders";
  }

  function persist() {
    try { storage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Keep navigation in memory. */ }
  }

  function detach() {
    bindings.forEach(({ button, handler }) => button.removeEventListener("click", handler));
    bindings = [];
  }

  function currentIndex() {
    return cards.findIndex((card) => supplierScreen(card) === state.screen);
  }

  function paint({ focus = false } = {}) {
    if (!flow) return;
    const isPrep = state.screen === "prep";
    const index = currentIndex();
    cards.forEach((card, cardIndex) => { card.hidden = isPrep || cardIndex !== index; });
    const orders = flow.querySelector("[data-supplier-order-orders]");
    const prep = flow.querySelector("[data-supplier-order-prep]");
    const empty = flow.querySelector("[data-supplier-order-empty]");
    const title = flow.querySelector("[data-supplier-order-title]");
    const progress = flow.querySelector("[data-supplier-order-progress]");
    if (orders) orders.hidden = isPrep;
    if (prep) prep.hidden = !isPrep;
    if (empty) empty.hidden = isPrep || cards.length > 0;
    if (title) title.textContent = isPrep ? "Prep plan" : index >= 0 ? name(cards[index]) : "Supplier orders";
    if (progress) {
      progress.textContent = !isPrep && index >= 0 ? `Order ${index + 1} of ${cards.length}` : "";
      progress.hidden = !progress.textContent;
    }
    const next = flow.querySelector('[data-supplier-order-nav="next"]');
    if (next) next.textContent = isPrep ? "Done" : "Next";
    if (focus) {
      title?.focus?.({ preventScroll: true });
      title?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }

  function navigate(direction) {
    if (!flow) return;
    const index = currentIndex();
    if (direction === "back") {
      if (state.screen === "prep") state.screen = cards.length ? supplierScreen(cards.at(-1)) : "orders";
      else if (index > 0) state.screen = supplierScreen(cards[index - 1]);
      else { onExit(); return; }
    } else {
      if (state.screen === "prep") { onExit(); return; }
      state.screen = index >= 0 && index + 1 < cards.length ? supplierScreen(cards[index + 1]) : "prep";
    }
    persist();
    paint({ focus: true });
  }

  function show(target) {
    if (target !== "orders" && target !== "prep") return false;
    if (!flow) { pendingTarget = target; return false; }
    state.screen = target === "prep" ? "prep" : firstOrder();
    persist();
    paint({ focus: true });
    return true;
  }

  function bind({ root, scope = "" } = {}) {
    detach();
    flow = root?.matches?.("[data-supplier-order-flow]") ? root : root?.querySelector?.("[data-supplier-order-flow]");
    cards = flow ? [...flow.querySelectorAll("[data-supplier-order-card]")] : [];
    if (!flow) return false;
    const nextScope = typeof scope === "string" ? scope : JSON.stringify(scope);
    if (state.scope !== nextScope) state = { scope: nextScope, screen: firstOrder() };
    else if (state.screen !== "prep" && currentIndex() < 0) state.screen = firstOrder();
    for (const direction of ["back", "next"]) {
      const button = flow.querySelector(`[data-supplier-order-nav="${direction}"]`);
      if (!button) continue;
      const handler = (event) => {
        if (button.disabled) return;
        event.preventDefault?.();
        navigate(direction);
      };
      button.addEventListener("click", handler);
      bindings.push({ button, handler });
    }
    if (pendingTarget) {
      state.screen = pendingTarget === "prep" ? "prep" : firstOrder();
      pendingTarget = "";
    }
    persist();
    paint();
    return true;
  }

  return {
    bind,
    show,
    getState: () => ({ ...state, index: currentIndex(), supplierCount: cards.length }),
    destroy() { detach(); flow = null; cards = []; },
  };
}
