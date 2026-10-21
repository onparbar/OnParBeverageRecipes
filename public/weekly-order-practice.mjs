import { createWeeklyOrderController } from "./weekly-order-controller.mjs";
import { WEEKLY_ORDER_STEPS } from "./weekly-order-view.mjs";
import { escapeHtml } from "./dashboard-formatters.mjs";

const copy = (value) => JSON.parse(JSON.stringify(value));
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value) || 0);

export function renderPracticeSupplier({ drafts = [], index = 0, weekLabel = "" } = {}) {
  const draft = drafts[index];
  return `<section class="weekly-order" aria-label="Practice supplier orders">
    <div class="weekly-order-practice-notice"><strong>Practice walkthrough</strong><p>No live counts or orders change. These are this week's saved supplier orders; practice counts do not recalculate them.</p></div>
    <header class="weekly-order-header"><p>${escapeHtml(weekLabel)}${draft ? ` · Supplier ${index + 1} of ${drafts.length}` : ""}</p><h2 class="weekly-order-title" tabindex="-1">${escapeHtml(draft?.vendor || "Practice complete")}</h2></header>
    ${draft ? `<div class="vendor-order-draft-card"><div class="vendor-order-draft-lines">${(draft.lines || []).map((line) => {
      const cases = Number(line.requestedCases) > 0;
      const quantity = cases ? line.requestedCases : line.requestedUnits ?? 0;
      const unit = cases ? "case" : line.lineType === "Beer keg" ? "keg" : ["Liquor bottle", "Liquor tap bottle", "Mixer"].includes(line.lineType) ? "bottle" : "unit";
      const amount = `${quantity} ${unit}${Number(quantity) === 1 ? "" : "s"}`;
      return `<div class="vendor-order-draft-line"><span class="vendor-order-draft-line__copy"><strong>${escapeHtml(line.productName || line.name)}</strong><span>${escapeHtml(amount)}</span></span><b>${line.excludeFromOrderCost ? "—" : Number(line.extendedCost) > 0 ? money(line.extendedCost) : "Price needed"}</b></div>`;
    }).join("")}</div><p>Estimated total: <strong>${money(draft.estimatedTotal)}</strong></p><p>In the live flow, review this supplier's items, open the supplier, and mark the order placed after submitting it.</p><button class="weekly-order-button" type="button" disabled>Practice only — no order sent</button></div>` : '<p>You have finished the inventory and ordering walkthrough.</p>'}
    <footer class="weekly-order-footer"><div class="weekly-order-footer-buttons">
      <button class="weekly-order-button" type="button" data-practice-action="restart">Practice counts again</button>
      ${index > 0 ? '<button class="weekly-order-button" type="button" data-practice-action="back">Back</button>' : ""}
      <button class="weekly-order-button weekly-order-button--primary" type="button" data-practice-action="${draft ? "next" : "exit"}">${draft ? "Next" : "Done"}</button>
      ${draft ? '<button class="weekly-order-button" type="button" data-practice-action="exit">Exit practice</button>' : ""}
    </div></footer>
  </section>`;
}

// This adapter deliberately accepts no live save callbacks and supplies no storage.
// Both count drafts and supplier navigation exist only inside this visit.
export function createWeeklyOrderPractice({ root, getRows = () => [], getSupplierDrafts = () => [], weekLabel = "", exit = () => {}, now = () => new Date() } = {}) {
  let counts = null;
  let drafts = null;
  let index = 0;
  let destroyed = false;
  let rowSnapshot = {};

  function renderSuppliers() {
    if (destroyed || !root) return;
    root.setAttribute?.("aria-busy", "false");
    root.innerHTML = renderPracticeSupplier({ drafts, index, weekLabel });
    root.scrollIntoView?.({ block: "start" });
    root.querySelector?.(".weekly-order-title")?.focus?.({ preventScroll: true });
  }

  function start() {
    if (destroyed) return;
    counts?.destroy();
    drafts = null;
    index = 0;
    rowSnapshot = Object.fromEntries(WEEKLY_ORDER_STEPS.map(({ id }) => [id, copy(getRows(id) || [])]));
    counts = createWeeklyOrderController({
      root, storage: null, now,
      getContext: () => ({ ready: true, planLocked: false, needsReason: false, practice: true, weekLabel }),
      getRows: (id) => rowSnapshot[id] || [],
      saveStep: async () => {},
      savePlan: async () => {},
      openPlan: () => {
        drafts = copy(getSupplierDrafts() || []);
        counts.destroy();
        renderSuppliers();
      },
      exit,
    });
    counts.open();
  }

  function onClick(event) {
    const button = event.target?.closest?.("[data-practice-action]");
    if (destroyed || !button || button.disabled || !root?.contains?.(button)) return;
    event.preventDefault?.();
    const action = button.dataset.practiceAction;
    if (action === "exit") exit();
    else if (action === "restart") start();
    else if (drafts !== null) {
      index = Math.max(0, Math.min(drafts.length, index + (action === "back" ? -1 : 1)));
      renderSuppliers();
    }
  }
  root?.addEventListener?.("click", onClick);
  return {
    practice: true,
    open: start,
    refresh() { if (!destroyed && drafts === null) counts?.refresh(); },
    destroy() { destroyed = true; counts?.destroy(); root?.removeEventListener?.("click", onClick); },
  };
}
