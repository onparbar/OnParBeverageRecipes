import {
  normalizeWeeklySnapshotCompletion,
  summarizeWeeklySnapshotCompletion,
} from "./weekly-snapshot-completion.mjs";

export function getWeeklySnapshotCompletionSummary(snapshot) {
  const completion = normalizeWeeklySnapshotCompletion(snapshot?.completion);
  if (completion) return summarizeWeeklySnapshotCompletion(completion);
  const orders = (Array.isArray(snapshot?.orders) ? snapshot.orders : []).filter((order) => order?.ordered === true);
  const deliveryTotal = orders.reduce((total, order) => total + (Array.isArray(order.lines) ? order.lines.length : 0), 0);
  const cocktailTotal = (Array.isArray(snapshot?.kegPlanSnapshot?.items) ? snapshot.kegPlanSnapshot.items : [])
    .filter((item) => item?.actionType === "make").length;
  return { deliveryChecked: 0, deliveryTotal, deliveryExceptions: 0, cocktailCompleted: 0, cocktailTotal };
}

// Historical views use only the selected snapshot, never current dashboard inputs.
export function renderSavedWeeklySnapshot(snapshot, helpers) {
  const { escapeHtml: html, formatNumber: number, money, formatUpdatedAt, dateLabel } = helpers;
  const items = Array.isArray(snapshot.items) ? snapshot.items : [];
  const plan = snapshot.kegPlanSnapshot;
  const taps = Array.isArray(plan?.tapInputs) ? plan.tapInputs : [];
  const orders = (Array.isArray(snapshot.orders) ? snapshot.orders : []).filter(order => order.ordered === true);
  const savedCompletion = normalizeWeeklySnapshotCompletion(snapshot.completion);
  const deliveries = savedCompletion?.deliveries?.length
    ? savedCompletion.deliveries
    : orders.map((order) => ({
        id: order.vendorId,
        vendor: order.vendor,
        items: (order.lines || []).map((line, index) => ({
          id: line.internalId || `${order.vendorId}:${index}`,
          name: line.name,
          quantity: line.requestedCases ?? line.requestedUnits ?? 0,
          receivedQuantity: 0,
          unit: line.requestedCases ? "cases" : "units",
          status: "pending",
          handledBy: "",
          updatedAt: "",
          reason: "",
        })),
      }));
  const cocktails = savedCompletion?.cocktails?.length
    ? savedCompletion.cocktails
    : (Array.isArray(plan?.items) ? plan.items : []).filter((item) => item.actionType === "make").map((item) => ({
        id: item.key,
        name: item.name,
        displayName: item.name,
        quantity: item.orderQty,
        tapNumbers: [item.tapNumber],
        walls: item.wall ? [item.wall] : [],
        completed: false,
        preparedBy: "",
        completedAt: "",
      }));
  const completionSummary = summarizeWeeklySnapshotCompletion({
    generatedAt: plan?.generatedAt || snapshot.savedAt,
    deliveries,
    cocktails,
  });
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
  const lateReason = snapshot.captureMetadata?.outsideMondayReason;
  const openSections = new Set(helpers.openSections || []);
  const deliveryStatus = (item) => ({
    pending: "Not checked",
    received: "Received",
    extra: "Received extra",
    partial: "Partially received",
    "not-received": "Not received",
    rejected: "Rejected",
  })[item.status] || "Not checked";
  const deliveryRows = deliveries.map((delivery) => `
    <tr class="inventory-group-row"><th scope="rowgroup" colspan="5">${html(delivery.vendor)}</th></tr>
    ${delivery.items.map((item) => `<tr><td><strong>${html(item.name)}</strong></td><td>${quantity(item.quantity)}</td><td>${item.status === "pending" ? "Not checked" : quantity(item.receivedQuantity)}</td><td>${html(deliveryStatus(item))}</td><td>${item.handledBy ? `${html(item.handledBy)}<span class="table-note">${html(formatUpdatedAt(item.updatedAt))}</span>` : "Not checked"}</td></tr>`).join("")}`).join("");
  const cocktailRows = cocktails.map((item) => `<tr><td><strong>${html(item.displayName || item.name)}</strong>${item.walls?.length ? `<span class="table-note">${html(item.walls.join(", "))}${item.tapNumbers?.length ? ` · Tap ${html(item.tapNumbers.join(", "))}` : ""}</span>` : ""}</td><td>${quantity(item.quantity)}</td><td>${item.completed ? "Prepared" : "Not checked"}</td><td>${item.completed ? `${html(item.preparedBy)}<span class="table-note">${html(formatUpdatedAt(item.completedAt))}</span>` : "Not checked"}</td></tr>`).join("");

  return `<article class="weekly-snapshot-record" aria-label="Snapshot for ${html(dateLabel)}">
    <header class="weekly-snapshot-record__header">
      <div><h3>Week of ${html(dateLabel)}</h3><p class="muted">Saved ${html(formatUpdatedAt(snapshot.savedAt))}</p></div>
    </header>
    ${lateReason ? `<p class="muted">Late capture: ${html(lateReason)}</p>` : ""}
    <div class="inventory-history-value-summary">
      <div class="inventory-history-value-summary__total"><span>Total beverage inventory</span><strong>${currency(snapshot.summary?.totalBeverageInventoryValue)}</strong></div>
      <div><span>Simple syrup needed for next week</span><strong>${html(helpers.simpleSyrupNeed || "Not recorded")}</strong></div>
    </div>
    <details class="weekly-snapshot-section" data-snapshot-section="counts"${["counts", "kegs", "inventory"].some(key => openSections.has(key)) ? " open" : ""}>
      <summary><span>Saved counts</span><strong>${quantity(taps.length)} taps / ${quantity(items.length)} items</strong></summary>
      <div class="weekly-snapshot-section__body">
      <h4>Keg levels &amp; on hand</h4>
      ${taps.length ? table("Saved keg levels and stock", ["Tap", "Product", "Keg level", "Backup kegs"], tapRows) : '<p class="muted">Keg levels and on-hand kegs were not recorded in this snapshot.</p>'}
      <h4>Inventory on hand</h4>
      ${items.length ? table("Saved cabinet inventory", ["Item", "On hand (units)"], inventoryRows) : '<p class="muted">Inventory counts were not recorded.</p>'}
      </div>
    </details>
    <details class="weekly-snapshot-section" data-snapshot-section="orders"${openSections.has("orders") ? " open" : ""}>
      <summary><span>Placed orders</span><strong>${quantity(orders.length)} orders</strong></summary>
      <div class="weekly-snapshot-section__body">
      ${orders.map(order => `<h4>${html(order.vendor)}</h4><p class="muted">Placed ${html(formatUpdatedAt(order.orderedAt))}${order.orderedBy ? ` by ${html(order.orderedBy)}` : ""}</p>${table("Placed order for " + order.vendor, ["Product", "Units", "Pack", "Saved cost"], (order.lines || []).map(line => `<tr><td>${html(line.name)}</td><td>${quantity(line.requestedUnits)}</td><td>${html(line.packSize || "Each")}</td><td>${currency(line.extendedCost)}</td></tr>`).join(""))}`).join("") || '<p class="muted">No orders marked as placed yet.</p>'}
      </div>
    </details>
    <details class="weekly-snapshot-section" data-snapshot-section="deliveries"${openSections.has("deliveries") ? " open" : ""}>
      <summary><span>Deliveries</span><strong>${quantity(completionSummary.deliveryChecked)} of ${quantity(completionSummary.deliveryTotal)} checked</strong></summary>
      <div class="weekly-snapshot-section__body">
        ${deliveryRows ? table("Saved delivery checkoffs", ["Product", "Ordered", "Received", "Status", "Checked by"], deliveryRows) : '<p class="muted">No placed deliveries were recorded for this week.</p>'}
      </div>
    </details>
    <details class="weekly-snapshot-section" data-snapshot-section="cocktails"${openSections.has("cocktails") ? " open" : ""}>
      <summary><span>Cocktail prep</span><strong>${quantity(completionSummary.cocktailCompleted)} of ${quantity(completionSummary.cocktailTotal)} prepared</strong></summary>
      <div class="weekly-snapshot-section__body">
        ${cocktailRows ? table("Saved cocktail prep checkoffs", ["Cocktail", "Batches", "Status", "Prepared by"], cocktailRows) : '<p class="muted">No cocktail prep was required for this week.</p>'}
      </div>
    </details>
  </article>`;
}
