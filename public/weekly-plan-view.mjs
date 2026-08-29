import {
  clean,
  escapeHtml,
  formatNumber,
  money,
  toNumber,
} from "./dashboard-formatters.mjs";
import { getCocktailPrepDisplayName } from "./weekly-action-plan.mjs";

export function getWeeklyPlanTapContext(item, unit, { compact = false } = {}) {
  const taps = item.tapNumbers.length
    ? `Tap${item.tapNumbers.length === 1 ? "" : "s"} ${item.tapNumbers.map(formatNumber).join(", ")}`
    : "Tap assignment unavailable";
  const walls = item.walls.length ? ` · ${item.walls.join(", ")}` : "";
  if (compact) return `${taps}${walls}`;
  if (unit === "oz") {
    return `${taps}${walls} · ${formatNumber(item.currentStockOunces)} oz current · ${formatNumber(item.avgWeeklyOunces)} oz avg/week`;
  }
  return `${taps}${walls} · ${formatNumber(item.currentStockKegs)} kegs in stock · ${formatNumber(item.avgWeeklyKegs)} avg/week`;
}

export function renderWeeklyPlanInventoryRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">No active order lines in this section.</p>';
  return `<div class="weekly-plan-list">${items.map((item) => {
    const quantity = item.casePackaged
      ? `${formatNumber(item.caseCount)} case${item.caseCount === 1 ? "" : "s"} · ${formatNumber(item.quantity)} units`
      : `${formatNumber(item.quantity)} unit${item.quantity === 1 ? "" : "s"}`;
    const details = [
      item.vendor,
      `${formatNumber(item.onHand)} on hand / ${formatNumber(item.par)} par`,
      item.estimatedCost > 0 ? `${money(item.estimatedCost)} estimated` : "Price needed",
    ].filter(Boolean).join(" · ");
    return `
      <div class="weekly-plan-item">
        <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(details)}</span></div>
        <b>${escapeHtml(quantity)}</b>
      </div>
    `;
  }).join("")}</div>`;
}

export function renderWeeklyPlanTapRows(items, {
  action,
  unit = "kegs",
} = {}) {
  if (!items.length) return `<p class="weekly-plan-empty">No active lines to ${escapeHtml(action.toLowerCase())} in this section.</p>`;
  return `<div class="weekly-plan-list">${items.map((item) => `
    <div class="weekly-plan-item">
      <div>
        <strong>${escapeHtml(item.displayName || item.name)}</strong>
        <span>${escapeHtml(getWeeklyPlanTapContext(item, unit === "refills" ? "oz" : "kegs", { compact: true }))}</span>
      </div>
      <b>${escapeHtml(action)} ${formatNumber(item.quantity)} ${escapeHtml(unit === "refills" ? `refill${item.quantity === 1 ? "" : "s"}` : `keg${item.quantity === 1 ? "" : "s"}`)}</b>
    </div>
  `).join("")}</div>`;
}

export function renderWeeklyPlanCocktailRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">None this week.</p>';
  const orderedItems = [...items].sort((a, b) => (
    toNumber(a.tapNumbers?.[0]) - toNumber(b.tapNumbers?.[0])
    || clean(a.name).localeCompare(clean(b.name))
  ));
  return `<div class="weekly-plan-list weekly-plan-label-list">${orderedItems.map((item) => {
    const wall = clean(item.walls?.[0]);
    const details = [
      wall ? `${wall} wall` : "Wall unavailable",
      toNumber(item.batchSizeOz) > 0 ? `${formatNumber(item.batchSizeOz)} oz` : "Batch ounces unavailable",
    ].join(" · ");
    return `
      <div class="weekly-plan-item weekly-plan-label-item">
        <div>
          <strong>${escapeHtml(getCocktailPrepDisplayName(item.displayName || item.name, wall))}</strong>
          <span>${escapeHtml(details)}</span>
        </div>
        <b>${escapeHtml(item.quantityLabel || `${formatNumber(item.quantity)} label${item.quantity === 1 ? "" : "s"}`)}</b>
      </div>
    `;
  }).join("")}</div>`;
}

export function renderWeeklyPlanLiquorTapRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">No liquor-tap bottle orders this week.</p>';
  return `<div class="weekly-plan-list">${items.map((item) => `
    <div class="weekly-plan-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(getWeeklyPlanTapContext(item, "oz", { compact: true }))}${item.vendor ? ` · ${escapeHtml(item.vendor)}` : ""}${item.hasKnownPrice === false ? " · Price needed" : ""}</span>
      </div>
      <b>Order ${formatNumber(item.quantity)} bottle${item.quantity === 1 ? "" : "s"}</b>
    </div>
  `).join("")}</div>`;
}

export function renderWeeklyPlanLiquorRefillRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">None this week.</p>';
  return `<div class="weekly-plan-list">${items.map((item) => {
    const taps = (item.tapNumbers || []).filter(Boolean);
    const tapLabel = taps.length ? `Tap${taps.length === 1 ? "" : "s"} ${taps.join(", ")}` : "Tap unavailable";
    return `
      <div class="weekly-plan-item">
        <div>
          <strong>${escapeHtml(item.displayName || item.name)}</strong>
          <span>${escapeHtml(tapLabel)}</span>
        </div>
        <b>${formatNumber(item.quantity)} bottle${item.quantity === 1 ? "" : "s"}</b>
      </div>
    `;
  }).join("")}</div>`;
}

export function renderWeeklyPlanGroup(title, count, content, accent = "") {
  return `
    <section class="weekly-plan-group ${accent ? `weekly-plan-group--${accent}` : ""}">
      <div class="weekly-plan-group__header"><h3>${escapeHtml(title)}</h3><strong>${formatNumber(count)}</strong></div>
      ${content}
    </section>
  `;
}
