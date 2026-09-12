import { clean, escapeHtml, formatNumber, toNumber } from "./dashboard-formatters.mjs";
import { kegDestination } from "./keg-destination.mjs";

export function formatPrepCompletionSummary({ cocktails = [], liquor = [], completionAvailable = false } = {}) {
  const countCocktails = (items) => items.reduce((total, item) => total + Math.max(0, toNumber(item.quantity)), 0);
  const countTaps = (items) => items.reduce((total, item) => total + (
    Array.isArray(item.tapNumbers) && item.tapNumbers.length ? new Set(item.tapNumbers).size : 1
  ), 0);
  const describe = (items, count, singular, plural, pending, completed) => {
    const total = count(items);
    const done = completionAvailable ? count(items.filter((item) => item.completed === true)) : 0;
    const noun = total === 1 ? singular : plural;
    if (completionAvailable && done === total) return `${formatNumber(total)} ${noun} ${completed}`;
    if (done > 0) return `${formatNumber(done)} of ${formatNumber(total)} ${noun} ${completed}`;
    return `${formatNumber(total)} ${noun} ${pending}`;
  };
  return [
    describe(cocktails, countCocktails, "cocktail", "cocktails", "to make", "prepped"),
    describe(liquor, countTaps, "liquor tap", "liquor taps", "to refill", "refilled"),
  ].join(", ");
}

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
            ${!isLiquor ? `<small>${escapeHtml(kegDestination(item, { cocktail: true }))}</small>` : ""}
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

export function renderInlinePrepCompletion(item, kind, { saving = false } = {}) {
  const isLiquor = kind === "liquor";
  const completed = item.completed === true;
  const quantity = completed && isLiquor ? toNumber(item.actualQuantity ?? item.quantity) : toNumber(item.quantity);
  const unit = isLiquor ? `bottle${quantity === 1 ? "" : "s"}` : `cocktail${quantity === 1 ? "" : "s"}`;
  if (completed) return `<b>${formatNumber(quantity)} ${unit} ${isLiquor ? "added" : "prepped"}</b>`;
  return `<div class="weekly-plan-inline-completion">
    ${isLiquor ? `<label class="finish-week-quantity"><span>Bottles to add</span><input type="number" min="1" max="99" step="1" data-finish-liquor-quantity="${escapeHtml(item.id)}" value="${escapeHtml(String(item.actualQuantity || item.quantity || 1))}"${saving ? " disabled" : ""}></label>` : ""}
    <label class="weekly-plan-inline-check"><input type="checkbox" data-finish-prep-item="${escapeHtml(item.id)}" data-finish-prep-kind="${escapeHtml(kind)}" data-completed="false" aria-label="Mark ${escapeHtml(item.displayName || item.name)} ${isLiquor ? "added" : "prepped"}"${saving ? " disabled" : ""}><span>${isLiquor ? "Added" : `${formatNumber(quantity)} ${unit} prepped`}</span></label>
  </div>`;
}

export function renderFinishWeekDeliveries(weeklyOrderTracking = {}, { showVendor = true, saving = false } = {}) {
  if (!weeklyOrderTracking.available) {
    return '<p class="finish-week-empty">Delivery tracking will appear after the order plan is published.</p>';
  }
  if (!weeklyOrderTracking.vendors?.length) {
    return '<p class="finish-week-empty">No deliveries are expected. This part is complete automatically.</p>';
  }
  return weeklyOrderTracking.vendors.map((vendor) => `
    <div class="finish-week-vendor">
      ${showVendor ? `<h4>${escapeHtml(vendor.vendor)}</h4>` : ""}
      ${(vendor.items || []).map((item) => {
        const reviewed = clean(item.status) !== "pending";
        const result = reviewed
          ? item.status === "received"
            ? `${formatNumber(item.receivedQuantity ?? item.quantity)} received`
            : `${formatNumber(item.receivedQuantity)} of ${formatNumber(item.quantity)} received${item.status === "not-received" ? " (not received)" : " (partial)"}`
          : `${formatNumber(item.quantity)} ${clean(item.unit) || "items"} to receive`;
        return `
          <div class="weekly-plan-item">
            <div><strong>${escapeHtml(item.name)}</strong>${kegDestination(item) ? `<span>${escapeHtml(kegDestination(item))}</span>` : ""}</div>
            ${reviewed ? `<div><b>${escapeHtml(result)}</b>${item.status !== "received" ? '<a href="/staff">Update delivery in Staff View</a>' : ""}</div>` : `<label class="weekly-plan-inline-check"><input type="checkbox" data-finish-delivery-item="${escapeHtml(item.id)}" data-vendor-id="${escapeHtml(vendor.id)}" data-quantity="${escapeHtml(String(item.quantity || 0))}" data-completed="false" aria-label="Receive ${formatNumber(item.quantity)} ${escapeHtml(clean(item.unit) || "items")} of ${escapeHtml(item.name)}"${saving ? " disabled" : ""}><span>${escapeHtml(result)}</span></label>`}
          </div>
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
  expandFirstIncomplete = true,
  section = "all",
  inline = false,
} = {}) {
  if (!planLocked) return "";
  const embedded = section !== "all";
  const controlSuffix = section === "deliveries" ? "-deliveries" : "";
  if (inline) return `<p class="weekly-plan-live-status" id="weekly-plan-finish-status${controlSuffix}" role="status" aria-live="polite"${message ? "" : " hidden"}>${escapeHtml(message)}</p>`;
  const sectionIndexes = section === "deliveries" ? [0] : section === "prep" ? [1, 2] : [0, 1, 2];
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
    <section class="${embedded ? "finish-week-embedded" : "finish-week-panel"}" id="${embedded ? `weekly-plan-completion-${section}` : "weekly-plan-finish-week"}" ${embedded ? `aria-label="${section === "deliveries" ? "Delivery completion" : "Prep completion"}"` : 'aria-labelledby="finish-week-title"'}>
      ${embedded ? "" : `<header class="finish-week-header">
        <div>
          <p class="eyebrow">After ordering</p>
          <h2 id="finish-week-title">Receive &amp; complete</h2>
          <p>Record what arrived and what was prepared. Changes sync with Staff View.</p>
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
      </div>`}
      <div class="finish-week-checklists">
        ${sectionIndexes.map((index) => {
          const item = checklistSections[index];
          const section = progress.sections[index] || { complete: false, completedCount: 0, totalCount: 0 };
          return `
            <details id="finish-week-checklist-${index}" class="finish-week-checklist${section.complete ? " is-complete" : ""}"${expandFirstIncomplete && index === progress.sections.findIndex((entry) => !entry.complete) ? " open" : ""}>
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
          <input id="weekly-plan-finish-actor${controlSuffix}" data-current-user-name-input type="text" maxlength="80" autocomplete="name" value="${escapeHtml(actor)}" placeholder="Signed-in manager">
        </label>
        <button class="primary-button" id="weekly-plan-finish-save${controlSuffix}" type="button"${saving ? " disabled" : ""}>${saving ? "Saving..." : "Save selected"}</button>
        <p id="weekly-plan-finish-status${controlSuffix}" role="status" aria-live="polite"${message ? "" : " hidden"}>${escapeHtml(message)}</p>
      </footer>
    </section>
  `;
}
