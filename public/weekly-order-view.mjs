import { escapeHtml } from "./dashboard-formatters.mjs";

export const WEEKLY_ORDER_STEPS = Object.freeze([
  { id: "main", label: "Main cooler", title: "Verify main cooler", type: "cooler", wall: "main" },
  { id: "karaoke", label: "Karaoke cooler", title: "Verify karaoke cooler", type: "cooler", wall: "karaoke" },
  { id: "liquor", label: "Liquor cabinet", title: "Verify liquor cabinet", type: "inventory", group: "Liquor Cabinet" },
  { id: "mixers", label: "Mixer cabinet", title: "Verify mixer cabinet", type: "inventory", group: "Mixer Cabinet" },
  { id: "other", label: "Non-alcoholic beer", title: "Verify non-alcoholic beer", type: "inventory", group: "Other" },
].map((step) => Object.freeze(step)));

function button(action, label, { primary = false, disabled = false, hidden = false } = {}) {
  return `<button type="button" class="weekly-order-button${primary ? " weekly-order-button--primary" : ""}" data-weekly-order-action="${escapeHtml(action)}"${disabled ? " disabled" : ""}${hidden ? " hidden" : ""}>${escapeHtml(label)}</button>`;
}

function feedback(model) {
  const message = model.error || (model.busy ? "Saving. Please wait…" : "");
  return `<p class="weekly-order-feedback${model.error ? " is-error" : ""}" data-weekly-order-status role="${model.error ? "alert" : "status"}" aria-atomic="true">${escapeHtml(message)}</p>`;
}

function header(model, stepNumber, title) {
  return `<header class="weekly-order-header">
    <div class="weekly-order-eyebrow"><span>Weekly order</span>${model.weekLabel ? `<span class="weekly-order-week">${escapeHtml(model.weekLabel)}</span>` : ""}</div>
    <div class="weekly-order-progress-copy"><span>Step ${stepNumber} of 6</span></div>
    <div class="weekly-order-progress" role="progressbar" aria-label="Weekly order steps" aria-valuemin="1" aria-valuemax="6" aria-valuenow="${stepNumber}"><span style="--weekly-order-progress: ${stepNumber / 6 * 100}%"></span></div>
    <h2 class="weekly-order-title" tabindex="-1">${escapeHtml(title)}</h2>
  </header>`;
}

function landing(model, completed) {
  if (model.planLocked) {
    return `<div class="weekly-order-landing weekly-order-landing--saved">
      <span class="weekly-order-kicker">WEEKLY ORDER</span>
      <h2 class="weekly-order-title" tabindex="-1">Your weekly plan is saved.</h2>
      ${model.weekLabel ? `<p class="weekly-order-week">${escapeHtml(model.weekLabel)}</p>` : ""}
      ${feedback(model)}
      <div class="weekly-order-start-actions">${button("plan", "Open weekly plan", { primary: true, disabled: model.busy })}${button("exit", "Back to overview", { disabled: model.busy })}</div>
    </div>`;
  }
  const canResume = model.progressAvailable || completed.size > 0;
  return `<div class="weekly-order-landing">
    <h2 class="weekly-order-title" tabindex="-1"><span>WEEKLY ORDER</span><span class="weekly-order-start-here">START HERE <span aria-hidden="true">→</span></span></h2>
    ${model.weekLabel ? `<p class="weekly-order-week">${escapeHtml(model.weekLabel)}</p>` : ""}
    <div class="weekly-order-start-actions">${button("start", "Start", { primary: true, disabled: model.busy })}${canResume ? button("resume", "Continue", { disabled: model.busy }) : ""}</div>
    ${feedback(model)}
  </div>`;
}

function countRows(model) {
  const rows = Array.isArray(model.rows) ? model.rows : [];
  if (!rows.length) {
    const message = model.emptyMessage || (model.ready === false ? "Loading items…" : "No items here. Choose Next.");
    return `<p class="weekly-order-empty">${escapeHtml(message)}</p>`;
  }
  return `<div class="weekly-order-counts">${rows.map((row, index) => {
    const inputId = `weekly-order-count-${index}`;
    const unit = row.unit || "items";
    return `<div class="weekly-order-row${row.conflict ? " is-conflict" : ""}">
      <div class="weekly-order-row-copy"><label for="${inputId}">${escapeHtml(row.name)}</label>${row.detail ? `<p id="${inputId}-detail">${escapeHtml(row.detail)}</p>` : ""}</div>
      <div class="weekly-order-count-field"><span class="weekly-order-count-label" id="${inputId}-label">How many?</span><input id="${inputId}" type="text" inputmode="${row.allowsDecimal ? "decimal" : "numeric"}" pattern="${row.allowsDecimal ? "[0-9]+([.][0-9]+)?" : "[0-9]+"}" data-weekly-order-count="${escapeHtml(row.id)}" value="${escapeHtml(row.value ?? "")}" aria-label="${escapeHtml(`${row.name}: number of ${unit}`)}" aria-describedby="${inputId}-unit${row.detail ? ` ${inputId}-detail` : ""}" autocomplete="off" spellcheck="false" required${model.busy ? " disabled" : ""}><span class="weekly-order-unit" id="${inputId}-unit">${escapeHtml(unit)}</span></div>
    </div>`;
  }).join("")}</div>`;
}

function countScreen(model, step, stepIndex) {
  return `${header(model, stepIndex + 1, step.title)}
    <p class="weekly-order-count-hint">Check counts. Enter 0 for none.</p>
    ${countRows(model)}
    ${feedback(model)}
    <footer class="weekly-order-footer"><div class="weekly-order-footer-buttons">${button("back", "Back", { disabled: model.busy })}${button("next", model.busy ? "Saving…" : "Next", { primary: true, disabled: model.busy || model.ready === false })}${button("plan", "Open weekly plan", { primary: true, disabled: model.busy, hidden: true })}</div></footer>`;
}

function review(model, completed) {
  const allComplete = WEEKLY_ORDER_STEPS.every((step) => completed.has(step.id));
  return `${header(model, 6, "Review your weekly order")}
    ${allComplete ? "" : '<p class="weekly-order-review-intro">Check the remaining areas.</p>'}
    <ul class="weekly-order-checklist">${WEEKLY_ORDER_STEPS.map((step) => `<li>
      <span class="weekly-order-checkmark${completed.has(step.id) ? " is-complete" : ""}" aria-hidden="true">${completed.has(step.id) ? "✓" : "·"}</span>
      <div><strong>${escapeHtml(step.label)}</strong><small>${completed.has(step.id) ? "Checked" : "Still needs checking"}</small></div>
      <button type="button" class="weekly-order-change" data-weekly-order-step="${escapeHtml(step.id)}" aria-label="${escapeHtml(`${completed.has(step.id) ? "Change" : "Check"} ${step.label.toLowerCase()}`)}"${model.busy ? " disabled" : ""}>${completed.has(step.id) ? "Change" : "Check"}</button>
    </li>`).join("")}</ul>
    <div class="weekly-order-reason" data-weekly-order-reason-field${model.needsReason ? "" : " hidden"}><label for="weekly-order-reason">What changed?</label><textarea id="weekly-order-reason" data-weekly-order-reason rows="3"${model.needsReason ? " required" : ""}${model.busy ? " disabled" : ""}>${escapeHtml(model.reason || "")}</textarea></div>
    <p class="weekly-order-save-note">Saving does not place orders.</p>
    ${feedback(model)}
    <footer class="weekly-order-footer"><div class="weekly-order-footer-buttons">${button("back", "Back", { disabled: model.busy })}${button("save", model.busy ? "Saving…" : "Save weekly plan", { primary: true, disabled: model.busy || !allComplete })}${button("plan", "Open weekly plan", { primary: true, disabled: model.busy, hidden: true })}</div></footer>`;
}

export function renderWeeklyOrderView(model = {}) {
  const completed = new Set(Array.isArray(model.completed) ? model.completed.filter((id) => WEEKLY_ORDER_STEPS.some((step) => step.id === id)) : []);
  const stepIndex = WEEKLY_ORDER_STEPS.findIndex((step) => step.id === model.screen);
  const content = model.planLocked || (!model.screen || model.screen === "start")
    ? landing(model, completed)
    : model.screen === "review"
      ? review(model, completed)
      : stepIndex >= 0 ? countScreen(model, WEEKLY_ORDER_STEPS[stepIndex], stepIndex) : landing(model, completed);
  return `<section class="weekly-order" aria-label="Weekly order" aria-busy="${Boolean(model.busy)}">${content}</section>`;
}
