import { clean, escapeHtml, formatNumber, toNumber } from "./dashboard-formatters.mjs";

export function renderFinishWeekChecklistItems(items, kind) {
  if (!items.length) return '<p class="finish-week-empty">Nothing scheduled. This part is complete automatically.</p>';
  return items.map((item) => {
    const completed = item.completed === true;
    const isLiquor = kind === "liquor";
    const taps = Array.isArray(item.tapNumbers) && item.tapNumbers.length
      ? `Tap${item.tapNumbers.length === 1 ? "" : "s"} ${item.tapNumbers.join(", ")}`
      : "";
    return `
      <div class="finish-week-item${completed ? " is-complete" : ""}">
        <label>
          <input type="checkbox" data-finish-prep-item="${escapeHtml(item.id)}" data-finish-prep-kind="${escapeHtml(kind)}" data-completed="${completed}"${completed ? " checked" : ""}>
          <span>
            <strong>${escapeHtml(item.displayName || item.name)}</strong>
            <small>${escapeHtml([isLiquor ? `${formatNumber(item.quantity)} bottle${toNumber(item.quantity) === 1 ? "" : "s"}` : `${formatNumber(item.quantity)} batch${toNumber(item.quantity) === 1 ? "" : "es"}`, taps].filter(Boolean).join(" · "))}</small>
          </span>
        </label>
        ${isLiquor ? `
          <label class="finish-week-quantity">
            <span>Bottles added</span>
            <input type="number" min="1" max="99" step="1" data-finish-liquor-quantity="${escapeHtml(item.id)}" value="${escapeHtml(String(item.actualQuantity || item.quantity || 1))}">
          </label>
        ` : ""}
      </div>
    `;
  }).join("");
}

export function renderFinishWeekDeliveries(weeklyOrderTracking = {}) {
  if (!weeklyOrderTracking.available) {
    return '<p class="finish-week-empty">Delivery tracking will appear after the order plan is published.</p>';
  }
  if (!weeklyOrderTracking.vendors?.length) {
    return '<p class="finish-week-empty">No deliveries are expected. This part is complete automatically.</p>';
  }
  return weeklyOrderTracking.vendors.map((vendor) => `
    <div class="finish-week-vendor">
      <h4>${escapeHtml(vendor.vendor)}</h4>
      ${(vendor.items || []).map((item) => {
        const reviewed = clean(item.status) !== "pending";
        const result = reviewed
          ? item.status === "received"
            ? "Received"
            : `${formatNumber(item.receivedQuantity)} of ${formatNumber(item.quantity)} reviewed`
          : `${formatNumber(item.quantity)} ${clean(item.unit) || "items"}`;
        return `
          <label class="finish-week-item${reviewed ? " is-complete" : ""}">
            <input type="checkbox" data-finish-delivery-item="${escapeHtml(item.id)}" data-vendor-id="${escapeHtml(vendor.id)}" data-quantity="${escapeHtml(String(item.quantity || 0))}" data-completed="${reviewed}"${reviewed ? " checked disabled" : ""}>
            <span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(result)}</small></span>
          </label>
        `;
      }).join("")}
    </div>
  `).join("");
}

export function renderFinishWeekPanel({
  planLocked = false,
  progress,
  weeklyOrderTracking = {},
  cocktails = [],
  liquor = [],
  actor = "",
  saving = false,
  message = "",
} = {}) {
  if (!planLocked) return "";
  const checklistSections = [
    {
      title: "Deliveries Received",
      description: "Check an item only when the full planned quantity arrived. Use Staff View for shortages, rejections, or extras.",
      content: renderFinishWeekDeliveries(weeklyOrderTracking),
    },
    {
      title: "Cocktails Prepared",
      description: "Completing a batch subtracts its mapped ingredients from on-hand inventory.",
      content: renderFinishWeekChecklistItems(cocktails, "cocktail"),
    },
    {
      title: "Liquor Added",
      description: "Enter the actual bottles added before checking off the refill.",
      content: renderFinishWeekChecklistItems(liquor, "liquor"),
    },
  ];
  return `
    <section class="finish-week-panel" id="weekly-plan-finish-week" aria-labelledby="finish-week-title">
      <header class="finish-week-header">
        <div>
          <p class="eyebrow">Shared with Staff View</p>
          <h2 id="finish-week-title">Finish the Week</h2>
          <p>Check off deliveries, prepared cocktails, and liquor added to taps. Both views update together.</p>
        </div>
        <strong class="finish-week-state${progress.complete ? " is-complete" : ""}">${progress.complete ? "Complete" : `${formatNumber(progress.remainingCount)} left`}</strong>
      </header>
      <div class="finish-week-progress" aria-label="Finish the Week progress">
        ${progress.sections.map((section) => `
          <div class="${section.complete ? "is-complete" : ""}">
            <span>${escapeHtml(section.label)}</span>
            <strong>${formatNumber(section.completedCount)} / ${formatNumber(section.totalCount)}</strong>
          </div>
        `).join("")}
      </div>
      <div class="finish-week-checklists">
        ${checklistSections.map((item, index) => {
          const section = progress.sections[index] || { complete: false, completedCount: 0, totalCount: 0 };
          return `
            <details class="finish-week-checklist${section.complete ? " is-complete" : ""}"${section.complete ? "" : " open"}>
              <summary><span>${escapeHtml(item.title)}</span><strong>${formatNumber(section.completedCount)} / ${formatNumber(section.totalCount)}</strong></summary>
              <div class="finish-week-checklist__body">
                <p>${escapeHtml(item.description)}</p>
                <div class="finish-week-list">${item.content}</div>
              </div>
            </details>
          `;
        }).join("")}
      </div>
      <footer class="finish-week-actions">
        <label>
          <span>Completed by</span>
          <input id="weekly-plan-finish-actor" type="text" maxlength="80" autocomplete="name" value="${escapeHtml(actor)}" placeholder="Manager name">
        </label>
        <button class="primary-button" id="weekly-plan-finish-save" type="button"${saving ? " disabled" : ""}>${saving ? "Saving..." : "Save selected"}</button>
        <p id="weekly-plan-finish-status" role="status" aria-live="polite"${message ? "" : " hidden"}>${escapeHtml(message)}</p>
      </footer>
    </section>
  `;
}
