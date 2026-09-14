// Historical views use only the selected snapshot, never current dashboard inputs.
export function renderSavedWeeklySnapshot(snapshot, helpers) {
  const { escapeHtml: html, formatNumber: number, money, formatUpdatedAt, dateLabel, valueSummary } = helpers;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const plan = snapshot.kegPlanSnapshot;
  const taps = Array.isArray(plan?.tapInputs) ? plan.tapInputs : [];
  const recommendations = Array.isArray(plan?.items) ? plan.items : [];
  const recordedNumber = (value) => value !== null && value !== undefined && String(value).trim() !== "" && Number.isFinite(Number(value));
  const quantity = (value) => recordedNumber(value) ? html(number(Number(value))) : "Not recorded";
  const currency = (value) => recordedNumber(value) ? html(money(Number(value))) : "Not recorded";
  const groups = (rows, key, fallback) => {
    const result = new Map();
    rows.forEach((row) => {
      const name = String(row[key] || fallback);
      if (!result.has(name)) result.set(name, []);
      result.get(name).push(row);
    });
    return [...result];
  };
  const table = (caption, headers, rows) => `<div class="inventory-table-wrap"><table class="inventory-table weekly-snapshot-table"><caption class="sr-only">${html(caption)}</caption><thead><tr>${headers.map((header) => `<th scope="col">${html(header)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
  const tapRows = groups(taps, "wall", "Taps").map(([wall, rows]) => `
    <tr class="inventory-group-row"><th scope="rowgroup" colspan="4">${html(wall)}</th></tr>
    ${[...rows].sort((a, b) => Number(a.tapNumber) - Number(b.tapNumber)).map((tap) => `<tr>
      <td>${quantity(tap.tapNumber)}</td><td><strong>${html(tap.name || "Unnamed tap")}</strong></td>
      <td>${recordedNumber(tap.liveFraction) ? `${html(number(Number(tap.liveFraction) * 100))}%` : "Not recorded"}</td>
      <td>${tap.inventoryStateMissing ? "Not recorded" : quantity(tap.backupKegs)}</td>
      
    </tr>`).join("")}`).join("");
  const inventoryRows = groups(items, "group", "Other").map(([group, rows]) => `
    <tr class="inventory-group-row"><th scope="rowgroup" colspan="2">${html(group)}</th></tr>
    ${rows.map((item) => `<tr><td><strong>${html(item.name)}</strong>${item.note ? `<span class="table-note">${html(item.note)}</span>` : ""}</td><td>${quantity(item.onHandDisplay)}</td></tr>`).join("")}`).join("");
  const ingredientOrders = items.filter((item) => recordedNumber(item.orderDisplay) && Number(item.orderDisplay) > 0);
  const tapActions = recommendations.filter((item) => Number(item.orderQty) > 0);
  const lateReason = snapshot.captureMetadata?.outsideMondayReason;
  const openSections = new Set(helpers.openSections || []);
  const plannedItems = ingredientOrders.length + tapActions.length;
  const hasSavedOrders = Boolean(plan) || items.some((item) => recordedNumber(item.orderDisplay));

  return `<article class="weekly-snapshot-record" aria-label="Snapshot for ${html(dateLabel)}">
    <header class="weekly-snapshot-record__header">
      <div><h3>Week of ${html(dateLabel)}</h3><p class="muted">Saved ${html(formatUpdatedAt(snapshot.savedAt))}</p></div>
      <details class="weekly-snapshot-options"><summary>Snapshot options</summary><div class="inventory-history-actions">
        <button class="ghost-button inventory-history-restore" type="button">Recall counts</button>
        <button class="ghost-button inventory-history-delete" type="button">Delete snapshot</button>
      </div></details>
    </header>
    ${lateReason ? `<p class="muted">Late capture: ${html(lateReason)}</p>` : ""}
    <details class="weekly-snapshot-section" data-snapshot-section="kegs"${openSections.has("kegs") ? " open" : ""}>
      <summary><span>Keg levels &amp; on hand</span><strong>${taps.length ? `${quantity(taps.length)} taps` : "Not recorded"}</strong></summary>
      <div class="weekly-snapshot-section__body">
      ${taps.length ? `<p class="muted">Backups are full kegs off tap. Total stock includes the remaining keg on tap.</p>${table("Saved keg levels and stock", ["Tap", "Product", "Keg level", "Backup kegs"], tapRows)}` : '<p class="muted">Keg levels and on-hand kegs were not recorded in this snapshot.</p>'}
      </div>
    </details>
    <details class="weekly-snapshot-section" data-snapshot-section="inventory"${openSections.has("inventory") ? " open" : ""}>
      <summary><span>Cabinet inventory</span><strong>${items.length ? `${quantity(items.length)} items` : "Not recorded"}</strong></summary>
      <div class="weekly-snapshot-section__body">
      ${items.length ? table("Saved cabinet inventory", ["Item", "On hand (units)"], inventoryRows) : '<p class="muted">Inventory counts were not recorded.</p>'}
      </div>
    </details>
    <details class="weekly-snapshot-section" data-snapshot-section="orders"${openSections.has("orders") ? " open" : ""}>
      <summary><span>Orders &amp; prep</span><strong>${hasSavedOrders ? `${quantity(plannedItems)} planned items` : "Not recorded"}</strong></summary>
      <div class="weekly-snapshot-section__body">
      <p class="muted">Quantities planned when this snapshot was saved, not delivery or completion status.</p>
      <h4>Inventory to order</h4>
      ${ingredientOrders.length ? table("Saved inventory orders", ["Item", "Order (units)", "Pack", "Estimated cost"], ingredientOrders.map((item) => `<tr><td>${html(item.name)}</td><td>${quantity(item.orderDisplay)}</td><td>${item.casePackaged ? `${quantity(item.packSize)} / case` : "Each"}</td></tr>`).join("")) : '<p class="muted">No inventory orders recorded.</p>'}
      <h4>Tap orders &amp; cocktail prep</h4>
      ${tapActions.length ? table("Saved tap orders and cocktail prep", ["Tap", "Product", "Action", "Saved quantity"], tapActions.map((item) => `<tr><td>${quantity(item.tapNumber)}</td><td>${html(item.orderProductName || item.name)}</td><td>${item.actionType === "make" ? "Make" : item.actionType === "order" ? "Order" : "Planned"}</td><td>${quantity(item.orderQty)}</td></tr>`).join("")) : `<p class="muted">${plan ? "No tap orders or cocktail prep recorded." : "The weekly plan was not recorded in this snapshot."}</p>`}
      </div>
    </details>
    <details class="weekly-snapshot-section" data-snapshot-section="value"${openSections.has("value") ? " open" : ""}>
      <summary><span>Inventory value</span><strong>${currency(snapshot.summary?.totalBeverageInventoryValue)}</strong></summary>
      <div class="weekly-snapshot-section__body">${valueSummary || '<p class="muted">Inventory value was not recorded in this snapshot.</p>'}</div>
    </details>
  </article>`;
}
