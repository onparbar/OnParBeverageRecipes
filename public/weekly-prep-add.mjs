const RETURN_MESSAGE_KEY = "onpar-weekly-prep-added";
const boundPanels = new WeakSet();
let savedMessage = "";

export function renderWeeklyPrepAdder() {
  return `<div class="dashboard-owner-only prep-tap-adder" data-prep-tap-adder>
    <button type="button" class="ghost-button" data-prep-tap-open aria-expanded="false">Add cocktail</button>
    <div data-prep-tap-fields hidden><select aria-label="Cocktail tap to prep" data-prep-tap-select><option value="">Choose tap</option></select>
    <select aria-label="Prep cooler" data-prep-tap-cooler><option value="Main">Main cooler</option><option value="Karaoke">Karaoke cooler</option></select>
    <button type="button" class="primary-button" data-prep-tap-save>Add to this week</button>
    <section data-prep-forecast aria-label="Upcoming cocktail prep"></section></div>
    <p data-prep-tap-status role="status"></p></div>`;
}

function ensureStyles(documentRef) {
  if (!documentRef?.head || documentRef.getElementById("weekly-prep-add-styles")) return;
  const link = documentRef.createElement("link");
  link.id = "weekly-prep-add-styles";
  link.rel = "stylesheet";
  link.href = "/weekly-prep-add.css";
  documentRef.head.append(link);
}

async function requestPrep(payload) {
  const response = await fetch("/api/weekly-prep-additions", {
    method: payload ? "POST" : "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error || "Cocktail prep could not be saved.");
  return result;
}

export function bindWeeklyPrepAdder(root, { documentRef = globalThis.document, onReturnToPlan } = {}) {
  bindTapPrepControls(root, documentRef);
  try {
    const message = globalThis.sessionStorage?.getItem(RETURN_MESSAGE_KEY);
    if (message) {
      savedMessage = message;
      globalThis.sessionStorage.removeItem(RETURN_MESSAGE_KEY);
      queueMicrotask(() => onReturnToPlan?.());
    }
  } catch {
    // Storage is optional; the saved plan remains the source of truth.
  }

  const panel = root?.querySelector?.("[data-order-adjustment-panel]")
    || documentRef?.querySelector?.("[data-order-adjustment-panel]");
  if (!panel || boundPanels.has(panel)) return;
  const action = panel.querySelector("[data-order-adjustment-action]");
  const product = panel.querySelector("[data-prep-adjustment-product]");
  const cooler = panel.querySelector("[data-prep-adjustment-cooler]");
  const quantity = panel.querySelector("[data-prep-adjustment-quantity]");
  const save = panel.querySelector("[data-order-adjustment-save]");
  const status = panel.querySelector("[data-prep-adjustment-status]");
  if (!action || !product || !cooler || !quantity || !save || !status) return;
  boundPanels.add(panel);
  ensureStyles(documentRef);

  let choices = null;
  let loading = false;
  let saving = false;
  let requestKey = "";
  let requestId = "";
  const isPrep = () => action.value === "add-prep";
  const showMessage = (message, error = false) => {
    status.textContent = message;
    status.dataset.error = String(error);
  };
  const syncFields = () => {
    const prep = isPrep();
    panel.querySelectorAll("[data-order-adjustment-only]").forEach((field) => {
      field.hidden = prep || (field.hasAttribute("data-order-adjustment-quantity-field") && action.value === "remove");
    });
    panel.querySelectorAll("[data-prep-adjustment-only]").forEach((field) => { field.hidden = !prep; });
    action.disabled = saving;
    product.disabled = loading || saving || !choices?.cocktails?.length;
    cooler.disabled = loading || saving;
    quantity.disabled = loading || saving;
    save.disabled = prep && (loading || saving || !choices?.cocktails?.length);
    save.textContent = prep ? (saving ? "Adding..." : "Add to prep") : "Save changes";
  };
  const loadChoices = async () => {
    if (choices || loading) return;
    loading = true;
    showMessage("Loading cocktails...");
    syncFields();
    try {
      const result = await requestPrep();
      if (!Array.isArray(result.cocktails)) throw new Error("Cocktail choices could not be loaded.");
      choices = result;
      const placeholder = documentRef.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose cocktail";
      placeholder.disabled = true;
      placeholder.selected = true;
      product.replaceChildren(placeholder);
      for (const cocktail of result.cocktails) {
        const option = documentRef.createElement("option");
        option.value = cocktail.id;
        option.textContent = cocktail.name;
        product.append(option);
      }
      showMessage(result.cocktails.length ? savedMessage : "No cocktails available for prep.");
    } catch (error) {
      showMessage(error?.message || "Cocktail choices could not be loaded.", true);
    } finally {
      loading = false;
      syncFields();
    }
  };
  const syncAction = () => {
    syncFields();
    if (isPrep()) void loadChoices();
  };
  action.addEventListener("change", syncAction);
  panel.addEventListener("toggle", () => {
    if (panel.open && isPrep()) void loadChoices();
  });
  documentRef.querySelectorAll("[data-order-draft-edit-quantities]").forEach((button) => {
    // The existing controller switches back to order editing before this runs.
    button.addEventListener("click", syncFields);
  });
  save.addEventListener("click", async () => {
    if (!isPrep() || saving || loading || !choices) return;
    const count = Number(quantity.value);
    if (!product.value) {
      showMessage("Choose a cocktail.", true);
      product.focus();
      return;
    }
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      showMessage("Enter a keg count from 1 to 20.", true);
      quantity.focus();
      return;
    }
    const payload = {
      cocktailId: product.value,
      cooler: cooler.value,
      quantity: count,
      generatedAt: choices.generatedAt,
      expectedRevision: choices.revision,
    };
    const key = JSON.stringify(payload);
    saving = true;
    showMessage("Saving cocktail prep...");
    syncFields();
    try {
      if (key !== requestKey) {
        requestId = globalThis.crypto.randomUUID();
        requestKey = key;
      }
      const result = await requestPrep({ ...payload, requestId });
      const message = result.message || "Cocktail added to this week's prep.";
      try { globalThis.sessionStorage?.setItem(RETURN_MESSAGE_KEY, message); } catch { /* Optional navigation state. */ }
      globalThis.location.reload();
    } catch (error) {
      showMessage(error?.message || "Cocktail prep could not be saved.", true);
    } finally {
      saving = false;
      syncFields();
    }
  });

  if (savedMessage) {
    action.value = "add-prep";
    panel.open = true;
    showMessage(savedMessage);
  }
  syncAction();
}

function bindTapPrepControls(root, documentRef) {
  const panel = root?.querySelector?.("[data-prep-tap-adder]");
  if (!panel || boundPanels.has(panel)) return;
  boundPanels.add(panel);
  ensureStyles(documentRef);
  const status = panel.querySelector("[data-prep-tap-status]");
  const select = panel.querySelector("[data-prep-tap-select]");
  const cooler = panel.querySelector("[data-prep-tap-cooler]");
  const fields = panel.querySelector("[data-prep-tap-fields]");
  const opener = panel.querySelector("[data-prep-tap-open]");
  const availableChoices = () => [...(choices?.tapCocktails || []), ...(choices?.cocktails || [])];
  const syncCooler = () => {
    const tap = availableChoices().find(item => item.id === select.value);
    if (tap?.wall) cooler.value = tap.wall;
    cooler.hidden = Boolean(tap?.wall);
  };
  select.addEventListener("change", syncCooler);
  let choices = null;
  let busy = false;
  let pending = null;
  const controls = [...panel.querySelectorAll("button, select"), ...root.querySelectorAll("[data-prep-subtract]")];
  const originalDisabled = new Map(controls.map(control => [control, control.disabled]));
  const setBusy = value => { busy = value; controls.forEach(control => { control.disabled = value || originalDisabled.get(control); }); };
  panel.querySelector("[data-prep-tap-open]").addEventListener("click", async () => {
    if (busy) return;
    if (!fields.hidden) {
      fields.hidden = true;
      opener.setAttribute("aria-expanded", "false");
      return;
    }
    setBusy(true);
    status.textContent = "Loading taps...";
    try {
      choices = await requestPrep();
      select.replaceChildren(new Option("Choose cocktail", ""));
      for (const [label, items] of [["Saved cocktail taps", choices.tapCocktails], ["Other recipes", choices.cocktails]]) {
        const group = documentRef.createElement("optgroup");
        group.label = label;
        for (const item of items || []) group.append(new Option(item.name, item.id));
        if (group.children.length) select.append(group);
      }
      syncCooler();
      fields.hidden = false;
      opener.setAttribute("aria-expanded", "true");
      const forecast = panel.querySelector("[data-prep-forecast]");
      forecast.replaceChildren();
      const note = documentRef.createElement("p");
      note.textContent = choices.forecast?.note || "Forecast unavailable.";
      forecast.append(note);
      for (const week of choices.forecast?.weeks || []) {
        const section = documentRef.createElement("section");
        const heading = documentRef.createElement("h4");
        heading.textContent = week.label;
        section.append(heading);
        for (const item of week.items) {
          const line = documentRef.createElement("p");
          line.textContent = `${item.name}: ${item.quantity} keg${item.quantity === 1 ? "" : "s"}`;
          section.append(line);
        }
        if (!week.items.length) {
          const empty = documentRef.createElement("p");
          empty.textContent = choices.forecast.hasTapData ? "No additional prep predicted for taps with available data." : "Saved tap data is needed for this forecast.";
          section.append(empty);
        }
        forecast.append(section);
      }
      if (choices.forecast?.unavailable?.length) {
        const missing = documentRef.createElement("p");
        missing.textContent = `Not estimated (missing stock or usage): ${choices.forecast.unavailable.join(", ")}.`;
        forecast.append(missing);
      }
      status.textContent = availableChoices().length ? "" : "No cocktail recipes are available.";
    } catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  });
  async function save(action, itemId = "") {
    if (busy) return;
    const tap = availableChoices().find(item => item.id === select.value);
    if (action === "add" && !tap) { status.textContent = "Choose a cocktail tap."; return; }
    const key = action + ":" + (itemId || `${tap.id}:${tap.wall || cooler.value}`);
    setBusy(true);
    status.textContent = "Saving prep...";
    try {
      if (!pending || pending.key !== key) {
        const latest = await requestPrep();
        pending = { key, payload: { action, generatedAt: latest.generatedAt, expectedRevision: latest.revision,
          requestId: globalThis.crypto.randomUUID(), ...(action === "subtract" ? { itemId } : { cocktailId: tap.id, cooler: tap.wall || cooler.value, quantity: 1 }) } };
      }
      const result = await requestPrep(pending.payload);
      pending = null;
      try { globalThis.sessionStorage?.setItem(RETURN_MESSAGE_KEY, result.message); } catch { /* Optional. */ }
      globalThis.location.reload();
    } catch (error) { status.textContent = error.message; }
    finally { setBusy(false); }
  }
  panel.querySelector("[data-prep-tap-save]").addEventListener("click", () => save("add"));
  root.querySelectorAll("[data-prep-subtract]").forEach(button => {
    button.addEventListener("click", () => save("subtract", button.dataset.prepSubtract));
  });
}
