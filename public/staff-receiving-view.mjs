import { kegDestination } from "./keg-destination.mjs";

let selectedVendor = "";
let currentWeek = "";
let saving = false;
let message = "";
let messageError = false;
let historyOpen = false;
let checkedOpen = false;
const draftKey = "onpar-staff-receiving-drafts-v1";
let drafts = {};
try { drafts = JSON.parse(sessionStorage.getItem(draftKey) || "{}"); } catch { drafts = {}; }
if (!drafts || typeof drafts !== "object" || Array.isArray(drafts)) drafts = {};
const clean = (value) => String(value ?? "").trim();
const complete = (item) => ["received", "extra"].includes(item.status);
const quantity = (item) => `${Number(item.quantity) || 0} ${clean(item.unit) || "units"}`;
function remember() {
  try { sessionStorage.setItem(draftKey, JSON.stringify(drafts)); } catch { /* Keep drafts in memory when storage is unavailable. */ }
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, action, secondary = false) {
  const node = element("button", secondary ? "ghost-button" : "primary-button", text);
  node.type = "button";
  node.disabled = saving;
  node.addEventListener("click", action);
  return node;
}

export function renderStaffReceiving({ root, tracking, saveReceipts }) {
  if (currentWeek !== tracking.generatedAt) {
    currentWeek = tracking.generatedAt;
    selectedVendor = "";
    message = "";
  }
  const rerender = () => renderStaffReceiving({ root, tracking, saveReceipts });
  root.replaceChildren();
  root.classList.add("receiving-workspace");
  root.setAttribute("aria-busy", String(saving));
  const feedback = element("p", `receiving-feedback${messageError ? " is-error" : ""}`, message);
  feedback.setAttribute("role", "status");
  feedback.setAttribute("aria-live", "polite");
  root.append(feedback);
  const vendors = tracking.vendors || [];
  const ready = vendors.filter((vendor) => vendor.ordered && vendor.items.some((item) => !complete(item)));
  const finished = vendors.filter((vendor) => vendor.ordered && vendor.items.length && vendor.items.every(complete));
  const awaiting = vendors.filter((vendor) => !vendor.ordered);
  const vendor = vendors.find((entry) => entry.id === selectedVendor && entry.ordered);

  function choose(entry) {
    selectedVendor = entry.id;
    checkedOpen = false;
    rerender();
  }
  function deliveryTile(entry, parent) {
    const pending = entry.items.filter((item) => !complete(item)).length;
    const node = button("", () => choose(entry), true);
    node.classList.add("receiving-delivery-tile");
    node.append(element("strong", "", entry.vendor), element("span", "", pending ? `${pending} items to check` : `${entry.items.length} items received`));
    parent.append(node);
  }
  if (!vendor) {
    root.append(element("h3", "", "Which delivery arrived?"));
    const picker = element("div", "receiving-delivery-picker");
    ready.forEach((entry) => deliveryTile(entry, picker));
    root.append(picker);
    if (!ready.length) root.append(element("p", "", "No outstanding placed deliveries. You're caught up."));
    if (finished.length) {
      const history = element("details", "receiving-history");
      history.open = historyOpen;
      history.addEventListener("toggle", () => { historyOpen = history.open; });
      history.append(element("summary", "", `Received deliveries (${finished.length})`));
      finished.forEach((entry) => deliveryTile(entry, history));
      root.append(history);
    }
    if (awaiting.length) {
      const waiting = element("details", "receiving-history");
      waiting.append(element("summary", "", `Not placed yet (${awaiting.length})`));
      awaiting.forEach((entry) => waiting.append(element("p", "", `${entry.vendor}: waiting for a manager to record the order.`)));
      root.append(waiting);
    }
    return;
  }

  const top = element("header", "receiving-delivery-header");
  top.append(button("All deliveries", () => { selectedVendor = ""; rerender(); }, true));
  const title = element("div");
  title.append(element("h3", "", vendor.vendor));
  const checked = vendor.items.filter(complete).length;
  title.append(element("p", "", `${checked} of ${vendor.items.length} items received`));
  top.append(title);
  root.append(top);
  if (vendor.deliveryNote) root.append(element("p", "receiving-note", vendor.deliveryNote));
  root.append(element("p", "receiving-help", "Check the product and quantity, then tap Received as ordered. Each receipt saves immediately. Keep shorts open for a later delivery."));

  async function save(lines) {
    if (saving) return;
    saving = true;
    message = "Saving delivery...";
    messageError = false;
    rerender();
    try {
      const result = await saveReceipts(vendor, lines);
      const savedVendor = result.tracking.vendors.find((entry) => entry.id === vendor.id);
      for (const line of lines) {
        const saved = savedVendor?.items.find((item) => item.id === line.itemId);
        if (saved && saved.status === line.status && Number(saved.receivedQuantity) === line.receivedQuantity) {
          delete drafts[`${currentWeek}:${line.itemId}`];
        }
      }
      remember();
      tracking = result.tracking;
      message = result.warning || "Saved. Inventory and delivery progress are up to date.";
      messageError = Boolean(result.warning);
    } catch (error) {
      message = `${error.message || "The save could not be confirmed."} Your entries are kept here. Refresh the delivery status before retrying if the connection was interrupted.`;
      messageError = true;
    } finally {
      saving = false;
      renderStaffReceiving({ root, tracking, saveReceipts });
    }
  }
  function fullReceipt(item) {
    return { itemId: item.id, receivedQuantity: Number(item.quantity), status: "received", reason: "" };
  }
  const unchecked = vendor.items.filter((item) => item.status === "pending" && !drafts[`${currentWeek}:${item.id}`]);
  if (unchecked.length) {
    const bulk = button("Everything unchecked arrived as ordered", () => {
      const currentUnchecked = vendor.items.filter((item) => item.status === "pending" && !drafts[`${currentWeek}:${item.id}`]);
      if (!currentUnchecked.length) {
        message = "There are no unchecked items without a difference draft. Save those differences individually.";
        messageError = false;
        rerender();
        return;
      }
      const summary = currentUnchecked.map((item) => `${item.name}: ${quantity(item)}`).join("\n");
      if (window.confirm(`Confirm these ${currentUnchecked.length} unchecked items arrived in full:\n\n${summary}\n\nPreviously received items, saved discrepancies, and unsaved difference drafts will not change.`)) {
        void save(currentUnchecked.map(fullReceipt));
      }
    }, true);
    bulk.classList.add("receiving-bulk");
    root.append(bulk);
  }
  function itemCard(item, parent) {
    const key = `${currentWeek}:${item.id}`;
    const card = element("article", `receiving-item${complete(item) ? " is-received" : ""}`);
    const info = element("div", "receiving-item-info");
    info.append(element("h4", "", item.name));
    const units = Number(item.inventoryUnitsPerReceiptUnit) || 1;
    info.append(element("p", "receiving-quantity", `${quantity(item)}${units > 1 ? ` / ${Number(item.quantity) * units} individual units` : ""}`));
    const destination = kegDestination(item);
    if (destination) info.append(element("p", "receiving-destination", destination));
    if (item.status !== "pending") {
      info.append(element("p", "receiving-saved", `${Number(item.receivedQuantity) || 0} of ${Number(item.quantity)} received${item.handledBy ? ` / ${item.handledBy}` : ""}${item.reason ? ` / ${item.reason}` : ""}`));
    }
    card.append(info);
    const actions = element("div", "receiving-item-actions");
    if (!complete(item)) actions.append(button(item.status === "pending" ? "Received as ordered" : "All remaining arrived", () => { void save([fullReceipt(item)]); }));
    const exception = element("details", "receiving-exception");
    exception.open = Boolean(drafts[key]);
    exception.append(element("summary", "", complete(item) ? "Correct this receipt" : "Something's different"));
    const form = element("form", "receiving-exception-form");
    const reasonLabel = element("label", "", "What happened?");
    const reason = element("select");
    for (const [value, label] of [["short", "Short delivery"], ["missing", "Missing"], ["damaged", "Damaged / rejected"], ["substitution", "Substituted product"], ["extra", "Extra delivered"], ["correction", "Correct a receipt"]]) {
      const option = element("option", "", label); option.value = value; reason.append(option);
    }
    reason.value = drafts[key]?.reason || "short";
    reasonLabel.append(reason);
    const countLabel = element("label", "", `Total accepted so far (${clean(item.unit) || "units"})`);
    const count = element("input");
    count.type = "number"; count.min = "0"; count.max = "9999"; count.step = "1"; count.inputMode = "numeric"; count.required = true;
    count.value = drafts[key]?.quantity ?? (item.status === "pending" ? "" : String(item.receivedQuantity));
    countLabel.append(count);
    const noteLabel = element("label", "", "Note for the manager (optional)");
    const note = element("textarea"); note.rows = 2; note.maxLength = 100;
    note.value = drafts[key]?.note || ""; noteLabel.append(note);
    const help = element("p", "receiving-help", "Enter the total accepted for this order, including earlier deliveries, not just today's extra. Do not count damaged or substituted products as the original item; describe the substitute in the note for manager review.");
    const store = () => { drafts[key] = { reason: reason.value, quantity: count.value, note: note.value }; remember(); };
    [reason, count, note].forEach((input) => { input.disabled = saving; input.addEventListener("input", store); });
    const submit = element("button", "primary-button", "Save difference"); submit.type = "submit"; submit.disabled = saving;
    const error = element("p", "receiving-feedback is-error"); error.setAttribute("role", "status");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const amount = Number(count.value);
      if (!count.value.trim() || !Number.isInteger(amount) || amount < 0 || amount > 9999) { error.textContent = "Enter a whole quantity from 0 to 9,999."; return; }
      if (reason.value === "substitution" && !note.value.trim()) { error.textContent = "Describe the substitute so the manager can review it."; note.focus(); return; }
      store();
      const detail = reason.value === "damaged" && amount === 0 ? "rejected" : `${reason.value}${note.value.trim() ? `: ${note.value.trim()}` : ""}`;
      const status = amount > Number(item.quantity) ? "extra" : detail === "rejected" && amount === 0 ? "rejected" : amount >= Number(item.quantity) ? "received" : amount > 0 ? "partial" : "not-received";
      void save([{ itemId: item.id, receivedQuantity: amount, status, reason: detail }]);
    });
    form.append(reasonLabel, countLabel, noteLabel, help, submit, error);
    exception.append(form); actions.append(exception); card.append(actions); parent.append(card);
  }
  vendor.items.filter((item) => !complete(item)).forEach((item) => itemCard(item, root));
  const completed = vendor.items.filter(complete);
  if (completed.length) {
    const checkedList = element("details", "receiving-history"); checkedList.open = checkedOpen;
    checkedList.addEventListener("toggle", () => { checkedOpen = checkedList.open; });
    checkedList.append(element("summary", "", `Received items (${completed.length})`));
    completed.forEach((item) => itemCard(item, checkedList)); root.append(checkedList);
  }
  root.append(button("Finish receiving", () => {
    const remaining = vendor.items.filter((item) => !complete(item)).length;
    const draftCount = vendor.items.filter((item) => drafts[`${currentWeek}:${item.id}`]).length;
    if (draftCount && !window.confirm(`${draftCount} difference form(s) have entries that are not recorded yet. Keep them as drafts and finish for now?`)) return;
    message = `${vendor.vendor}: ${completed.length} of ${vendor.items.length} items received.${remaining ? ` ${remaining} remain open for follow-up.` : " Delivery complete."}${draftCount ? " Unsaved difference drafts are kept in this tab." : ""}`;
    messageError = false;
    selectedVendor = "";
    rerender();
  }));
}
