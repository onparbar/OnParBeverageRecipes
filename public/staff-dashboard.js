import { parseSmartReceivingTranscript } from "./smart-receiving.mjs";

const DEFAULT_BATCH_LABEL = "12 gallon keg";
const STAFF_MENU_ORDER = [
  ["GIN & JUICE (BOMBAY)", "Ginny from the Block (Gin)"],
  ["CAPTAIN QUENCHER (CAPTAIN MORGAN)", "Captain Quencher (Rum)"],
  ["BLUEBERRY MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["HOUSE MARGARITA (JOSE CUERVO)", "House Margarita (Tequilla)"],
  ["PEACH MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["RASPBERRY MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["STRAWBERRY MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["WATERMELON MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["STRAWBERRY SENORITA (JOSE CUERVO)", "Strawberry Senorita (Tequilla)"],
  ["APPLETINI (TITO'S)", "Apple-tini(Vodka)"],
  ["BLUE DOT (SVEDKA)", "Blue Dot (Vodka)"],
  ["BOOZY CUCUMBER LEMONADE (KETEL ONE)", "Boozy Cucumber Lemonade (Vodka)"],
  ["ESPRESSO MARTINI (TITO'S)", "Espresso Martini"],
  ["LEMON DROP MARTINI (ABSOLUT CITRON)", "Lemon Drop Martini(Vodka)"],
  ["POMEGRANATE MARTINI (TITO'S)", "Pomegranate Martini(Tito's)"],
  ["SPIKED ARNOLD PALMER (TITO'S)", "Spiked Arnold Palmer (Vodka)"],
  ["SPIKED CRANBERRY LEMONADE (TITO'S)", "Spiked Cranberry Lemonade (Vodka)"],
  ["SPIKED PINK LEMONADE (TITO'S)", "Spiked Strawberry Lemonade (Vodka)"],
  ["SPIKED STRAWBERRY LEMONADE (TITO'S)", "Spiked Strawberry Lemonade (Vodka)"],
  ["VODKA CRAN (TITO'S)", "Vodka Cran(Vodka)"],
  ["CROWN APPLE 'RITA", "Crown Apple 'rita(Whiskey)"],
  ["JACKED UP STRAWBERRY LEMONADE (JACK DANIELS)", "Jacked Up Strawberry Lemonade (Whiskey)"],
  ["OLD FASHIONED (BULLEIT)", "Old fashioned (Whiskey)"],
  ["JACK & LEMONADE", "Jack and Lemonade (Whiskey)"],
  ["WASHINGTON APPLE (CROWN ROYAL APPLE)", "Washington Apple (Whiskey)"],
  ["WHISKEY SOUR (JACK DANIELS)", "Whiskey Sour (Whiskey)"],
];
const STAFF_NEW_RECIPE_ORDER = [
  ["Bacardi Sunset", "Bacardi Sunset"],
  ["Whiskey Smash", "Whiskey Smash"],
  ["APPLE JACK (WHISKEY)", "Apple Jack (Whiskey)"],
  ["On Par Tee", "On Par Tee"],
];
const searchInput = document.querySelector("#staff-recipe-search");
const categoryFilter = document.querySelector("#staff-category-filter");
const statusPanel = document.querySelector("#staff-recipe-status");
const statsGrid = document.querySelector("#staff-stats-grid");
const recipeGrid = document.querySelector("#staff-recipe-grid");
const prepStatusPanel = document.querySelector("#staff-prep-status");
const prepSummary = document.querySelector("#staff-prep-summary");
const prepList = document.querySelector("#staff-prep-list");
const orderStatusPanel = document.querySelector("#staff-order-status");
const orderSummary = document.querySelector("#staff-order-summary");
const orderList = document.querySelector("#staff-order-list");
const smartReceivingTranscript = document.querySelector("#smart-receiving-transcript");
const smartReceivingName = document.querySelector("#smart-receiving-name");
const smartReceivingSpeak = document.querySelector("#smart-receiving-speak");
const smartReceivingReview = document.querySelector("#smart-receiving-review");
const smartReceivingApply = document.querySelector("#smart-receiving-apply");
const smartReceivingStatus = document.querySelector("#smart-receiving-status");
const smartReceivingReviewList = document.querySelector("#smart-receiving-review-list");
const tapSheetStatus = document.querySelector("#staff-tap-sheet-status");
const tapPrintWorkspace = document.querySelector("#staff-tap-print-workspace");
const recipeViewButtons = [...document.querySelectorAll("[data-staff-recipe-view]")];
const currentRecipeCount = document.querySelector("#staff-current-recipe-count");
const inactiveRecipeCount = document.querySelector("#staff-inactive-recipe-count");
const sectionTabButtons = [...document.querySelectorAll("[data-staff-section-tab]")];
const sectionPanels = [...document.querySelectorAll("main > [role='tabpanel']")];
const overviewTargets = [...document.querySelectorAll("[data-staff-section-target]")];
const overviewWeek = document.querySelector("#staff-overview-week");
const overviewPrepValue = document.querySelector("#staff-overview-prep-value");
const overviewPrepDetail = document.querySelector("#staff-overview-prep-detail");
const overviewOrderValue = document.querySelector("#staff-overview-order-value");
const overviewOrderDetail = document.querySelector("#staff-overview-order-detail");
const overviewRecipeValue = document.querySelector("#staff-overview-recipe-value");
const overviewRecipeDetail = document.querySelector("#staff-overview-recipe-detail");

let recipes = [];
let activeRecipeView = "current";
let prepPlan = {
  available: false,
  generatedAt: "",
  items: [],
  liquorRefills: [],
  completedCount: 0,
  totalCount: 0,
  liquorRefillCompletedCount: 0,
  liquorRefillTotalCount: 0,
};
let orderTracking = { available: false, generatedAt: "", vendors: [], itemCount: 0, receivedCount: 0, notReceivedCount: 0 };
let tapSheets = { available: false, updatedAt: "", onDeckAvailable: false, walls: [] };
let activeTapSheetWall = "main";
let smartReceivingProposal = null;
let smartReceivingRecognition = null;

initStaffRecipes();

async function initStaffRecipes() {
  try {
    const sessionResponse = await fetch("/api/session", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const session = await parseJsonResponse(sessionResponse);
    if (!sessionResponse.ok) {
      window.location.replace("/login?next=/staff");
      return;
    }
    const isOwnerPreview = session.role === "owner";
    if (!["employee", "owner"].includes(session.role)) {
      window.location.replace("/");
      return;
    }

    bindStaffSectionEvents();

    const profileCheck = inspectStaffBrowserProfile();
    if (!isOwnerPreview && !profileCheck.safe && !isLocalStaffPreview()) {
      lockStaffRecipesForBrowserProfile(profileCheck.storageUnavailable);
      return;
    }

    const [activeCsv, newCsv, sharedResult, prepResult, orderResult, tapSheetResult] = await Promise.all([
      fetchStaffRecipeCsv("active"),
      fetchStaffRecipeCsv("new"),
      fetchSharedRecipeUpdates(),
      fetchStaffPrepPlan(),
      fetchWeeklyOrderTracking(),
      fetchStaffTapSheets(),
    ]);
    recipes = buildRecipeCollection(activeCsv, newCsv, sharedResult.recipes);
    prepPlan = prepResult;
    orderTracking = orderResult;
    tapSheets = tapSheetResult;
    populateCategoryFilter();
    bindStaffRecipeEvents();
    renderStaffPrepPlan();
    renderWeeklyOrderTracking();
    renderStaffTapSheets();
    renderStaffRecipes();
    renderStaffOverview();
    statusPanel.textContent = sharedResult.available
      ? "Current shared recipe updates are included."
      : "Core recipes are available. Shared recipe updates could not be checked right now.";
  } catch (error) {
    statusPanel.textContent = error?.message || "Recipes could not be loaded.";
    statusPanel.dataset.state = "error";
    prepStatusPanel.dataset.state = "error";
    prepStatusPanel.textContent = "The weekly prep checklist could not be loaded.";
    prepList.setAttribute("aria-busy", "false");
    prepList.replaceChildren(createEmptyState("Ask a manager to check the dashboard service."));
    orderStatusPanel.dataset.state = "error";
    orderStatusPanel.textContent = "The weekly delivery checklist could not be loaded.";
    if (tapSheetStatus) {
      tapSheetStatus.dataset.state = "error";
      tapSheetStatus.textContent = "Tap sheets could not be loaded.";
    }
    orderList.setAttribute("aria-busy", "false");
    orderList.replaceChildren(createEmptyState("Ask a manager to check the dashboard service."));
    recipeGrid.setAttribute("aria-busy", "false");
    recipeGrid.replaceChildren(createEmptyState("Recipe data is unavailable. Ask a manager to check the dashboard service."));
  }
}

function isLocalStaffPreview() {
  const hostname = clean(window.location.hostname).toLowerCase();
  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  return isLoopback && new URLSearchParams(window.location.search).get("preview") === "1";
}

function inspectStaffBrowserProfile() {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) || "";
      if (key.startsWith("cocktail-dashboard-")) {
        return { safe: false, storageUnavailable: false };
      }
    }
    return { safe: true, storageUnavailable: false };
  } catch {
    return { safe: false, storageUnavailable: true };
  }
}

function lockStaffRecipesForBrowserProfile(storageUnavailable) {
  statusPanel.dataset.state = "error";
  prepStatusPanel.dataset.state = "error";
  prepStatusPanel.textContent = "The staff prep checklist is locked in this browser profile.";
  orderStatusPanel.dataset.state = "error";
  orderStatusPanel.textContent = "The delivery checklist is locked in this browser profile.";
  statusPanel.textContent = storageUnavailable
    ? "Staff recipes are locked because this browser profile's site storage could not be checked. Use a dedicated staff browser profile."
    : "Staff recipes are locked because this browser profile contains owner dashboard data. Use a separate browser profile reserved for staff.";
  recipeGrid.setAttribute("aria-busy", "false");
  prepList.setAttribute("aria-busy", "false");
  orderList.setAttribute("aria-busy", "false");
  prepList.replaceChildren(createEmptyState(
    "Open the staff page in a new, dedicated staff browser profile.",
  ));
  orderList.replaceChildren(createEmptyState(
    "Open the staff page in a new, dedicated staff browser profile.",
  ));
  recipeGrid.replaceChildren(createEmptyState(
    "Do not clear this profile's site data; it may contain unsynced owner edits. Open the staff page in a new, dedicated staff browser profile instead.",
  ));
}

async function fetchStaffRecipeCsv(set) {
  const response = await fetch(`/api/recipe-data?set=${encodeURIComponent(set)}`, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "text/csv" },
  });
  if (!response.ok) throw new Error("Recipe data could not be loaded.");
  return response.text();
}

async function fetchSharedRecipeUpdates() {
  try {
    const response = await fetch("/api/recipe-data?set=shared", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || !result?.recipes) return { available: false, recipes: null };
    return { available: true, recipes: result.recipes };
  } catch {
    return { available: false, recipes: null };
  }
}

async function fetchStaffPrepPlan() {
  try {
    const response = await fetch("/api/staff-prep-plan", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "The weekly prep checklist is unavailable.");
    return {
      available: result?.available === true,
      generatedAt: clean(result?.generatedAt),
      items: Array.isArray(result?.items) ? result.items : [],
      liquorRefills: Array.isArray(result?.liquorRefills) ? result.liquorRefills : [],
      completedCount: number(result?.completedCount),
      totalCount: number(result?.totalCount),
      liquorRefillCompletedCount: number(result?.liquorRefillCompletedCount),
      liquorRefillTotalCount: number(result?.liquorRefillTotalCount),
      message: clean(result?.message),
    };
  } catch (error) {
    return {
      available: false,
      generatedAt: "",
      items: [],
      liquorRefills: [],
      completedCount: 0,
      totalCount: 0,
      liquorRefillCompletedCount: 0,
      liquorRefillTotalCount: 0,
      message: error?.message || "The weekly prep checklist is unavailable.",
    };
  }
}

async function fetchWeeklyOrderTracking() {
  try {
    const response = await fetch("/api/weekly-order-tracking", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "The delivery checklist is unavailable.");
    return normalizeOrderTracking(result);
  } catch (error) {
    return {
      available: false,
      generatedAt: "",
      vendors: [],
      itemCount: 0,
      receivedCount: 0,
      notReceivedCount: 0,
      message: error?.message || "The delivery checklist is unavailable.",
    };
  }
}

async function fetchStaffTapSheets() {
  try {
    const response = await fetch("/api/staff-tap-sheets", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "Tap sheets are unavailable.");
    return {
      available: result?.available === true,
      updatedAt: clean(result?.updatedAt),
      onDeckAvailable: result?.onDeckAvailable === true,
      walls: Array.isArray(result?.walls) ? result.walls : [],
      message: clean(result?.message),
    };
  } catch (error) {
    return { available: false, updatedAt: "", onDeckAvailable: false, walls: [], message: error?.message || "Tap sheets are unavailable." };
  }
}

function escapeTapSheetHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStaffTapSheetPage(wall) {
  return `
    <article class="tap-sheet-page${wall.key === activeTapSheetWall ? " is-print-target" : ""}" data-staff-tap-sheet="${escapeTapSheetHtml(wall.key)}"${wall.key === activeTapSheetWall ? "" : " hidden"}>
      <header class="tap-sheet-header">
        <div><span>On Par</span><h2>${escapeTapSheetHtml(wall.label)} Wall Taps</h2></div>
        <strong>${wall.items.length} taps</strong>
      </header>
      <div class="tap-sheet-column-headings" aria-hidden="true"><span>Tap</span><span>Current</span><span>On Deck</span><span>Tap</span><span>Current</span><span>On Deck</span></div>
      <div class="tap-sheet-grid">
        ${wall.items.map((item) => `<div class="tap-sheet-row"><strong>${item.tapNumber}</strong><span>${escapeTapSheetHtml(item.product)}</span><span>${item.onDeck === null ? "Unavailable" : (escapeTapSheetHtml(item.onDeck) || "—")}</span></div>`).join("")}
      </div>
      <footer>Current and On Deck tap list · ${escapeTapSheetHtml(new Date().toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }))}</footer>
    </article>
  `;
}

function renderStaffTapSheets() {
  if (!tapPrintWorkspace || !tapSheetStatus) return;
  if (!tapSheets.available || !tapSheets.walls.length) {
    tapSheetStatus.textContent = tapSheets.message || "Tap sheets are unavailable.";
    tapPrintWorkspace.replaceChildren();
    tapPrintWorkspace.setAttribute("aria-busy", "false");
    return;
  }
  if (!tapSheets.walls.some((wall) => wall.key === activeTapSheetWall)) activeTapSheetWall = tapSheets.walls[0].key;
  tapSheetStatus.textContent = tapSheets.updatedAt ? `Updated ${new Date(tapSheets.updatedAt).toLocaleString()}` : "Current tap sheets";
  tapPrintWorkspace.innerHTML = `
    <section class="tap-print-workspace">
      <div class="tap-print-toolbar">
        <div class="tap-print-wall-tabs" role="tablist" aria-label="Tap wall">
          ${tapSheets.walls.map((wall) => `<button class="${wall.key === activeTapSheetWall ? "is-active" : ""}" type="button" data-staff-tap-wall="${escapeTapSheetHtml(wall.key)}">${escapeTapSheetHtml(wall.label)}</button>`).join("")}
        </div>
        <button class="primary-button" type="button" data-staff-print-taps>Print</button>
      </div>
      <div class="tap-sheet-preview">${tapSheets.walls.map(renderStaffTapSheetPage).join("")}</div>
    </section>
  `;
  tapPrintWorkspace.setAttribute("aria-busy", "false");
}

function printStaffTapSheet() {
  document.body.classList.add("tap-sheet-printing");
  window.addEventListener("afterprint", () => document.body.classList.remove("tap-sheet-printing"), { once: true });
  window.print();
}

function normalizeOrderTracking(result = {}) {
  return {
    available: result?.available === true,
    generatedAt: clean(result?.generatedAt),
    vendors: Array.isArray(result?.vendors) ? result.vendors : [],
    itemCount: number(result?.itemCount),
    receivedCount: number(result?.receivedCount),
    notReceivedCount: number(result?.notReceivedCount),
    message: clean(result?.message),
  };
}

function renderWeeklyOrderTracking() {
  orderList.replaceChildren();
  orderList.setAttribute("aria-busy", "false");
  if (!orderTracking.available) {
    orderStatusPanel.dataset.state = "error";
    orderStatusPanel.textContent = orderTracking.message || "A manager has not published this week's order plan yet.";
    orderSummary.textContent = "";
    orderList.append(createEmptyState("There are no current delivery assignments."));
    return;
  }

  delete orderStatusPanel.dataset.state;
  orderStatusPanel.textContent = orderTracking.generatedAt
    ? `Showing deliveries for the shared ${formatPlanWeek(orderTracking.generatedAt)} plan.`
    : "Showing the current shared weekly order.";
  orderSummary.textContent = orderTracking.itemCount
    ? `${formatNumber(orderTracking.receivedCount)} fully received · ${formatNumber(orderTracking.notReceivedCount)} short or missing · ${formatNumber(orderTracking.itemCount)} total items`
    : "No vendor deliveries are on this week's plan.";
  if (!orderTracking.vendors.length) {
    orderList.append(createEmptyState("Nothing is scheduled for delivery from the current weekly plan."));
    return;
  }

  orderTracking.vendors.forEach((vendor) => {
    const section = document.createElement("section");
    section.className = "staff-order-vendor";
    const header = document.createElement("header");
    const heading = document.createElement("h3");
    heading.textContent = `${clean(vendor.vendor)} order`;
    const ordered = document.createElement("p");
    ordered.textContent = vendor.ordered
      ? `Ordered by ${clean(vendor.orderedBy)}${vendor.orderedAt ? ` · ${formatCompletionTime(vendor.orderedAt)}` : ""}`
      : "The manager has not recorded who placed this order yet.";
    header.append(heading, ordered);
    section.append(header);
    (vendor.items || []).forEach((item) => section.append(createOrderReceiptItem(item)));
    orderList.append(section);
  });
}

function createOrderReceiptItem(item) {
  const form = document.createElement("form");
  form.className = `staff-order-item staff-order-item--${clean(item.status) || "pending"}`;

  const details = document.createElement("div");
  details.className = "staff-order-item__details";
  const heading = document.createElement("h4");
  heading.textContent = clean(item.name);
  const meta = document.createElement("p");
  const taps = Array.isArray(item.tapNumbers) && item.tapNumbers.length
    ? ` · Tap${item.tapNumbers.length === 1 ? "" : "s"} ${item.tapNumbers.join(", ")}`
    : "";
  meta.textContent = `${formatNumber(item.quantity)} ${clean(item.unit)}${taps}`;
  details.append(heading, meta);
  if (item.status !== "pending" && item.updatedAt) {
    const saved = document.createElement("small");
    const receiptSummary = item.status === "received"
      ? `All ${formatNumber(item.quantity)} received`
      : `${formatNumber(item.receivedQuantity)} of ${formatNumber(item.quantity)} received`;
    saved.textContent = `${receiptSummary} by ${clean(item.handledBy)} · ${formatCompletionTime(item.updatedAt)}`;
    details.append(saved);
  }

  const choices = document.createElement("fieldset");
  choices.className = "staff-order-receipt-choices";
  const legend = document.createElement("legend");
  legend.textContent = "Delivery received";
  choices.append(legend);
  const fullReceiptLabel = document.createElement("label");
  fullReceiptLabel.className = "staff-order-full-receipt";
  const fullReceipt = document.createElement("input");
  fullReceipt.type = "checkbox";
  fullReceipt.checked = item.status === "pending" || item.status === "received";
  const fullReceiptText = document.createElement("span");
  fullReceiptText.textContent = "Received full order";
  fullReceiptLabel.append(fullReceipt, fullReceiptText);
  choices.append(fullReceiptLabel);

  const quantityField = document.createElement("label");
  quantityField.className = "staff-order-quantity-field";
  const quantityLabel = document.createElement("span");
  quantityLabel.textContent = "Quantity received";
  const quantityControls = document.createElement("span");
  const quantityInput = document.createElement("input");
  quantityInput.type = "number";
  quantityInput.min = "0";
  quantityInput.max = String(number(item.quantity));
  quantityInput.step = "1";
  quantityInput.inputMode = "numeric";
  quantityInput.value = String(item.status === "pending" || item.status === "received"
    ? number(item.quantity)
    : number(item.receivedQuantity));
  quantityInput.disabled = fullReceipt.checked;
  const quantityTotal = document.createElement("small");
  quantityTotal.textContent = `of ${formatNumber(item.quantity)} ${clean(item.unit)}`;
  quantityControls.append(quantityInput, quantityTotal);
  quantityField.append(quantityLabel, quantityControls);
  choices.append(quantityField);

  fullReceipt.addEventListener("change", () => {
    quantityInput.disabled = fullReceipt.checked;
    if (fullReceipt.checked) {
      quantityInput.value = String(number(item.quantity));
    } else {
      quantityInput.focus();
      quantityInput.select();
    }
  });

  const nameField = document.createElement("label");
  nameField.className = "staff-prep-name-field";
  const nameLabel = document.createElement("span");
  nameLabel.textContent = "Checked by";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 80;
  nameInput.autoComplete = "name";
  nameInput.placeholder = "Employee name";
  nameInput.value = clean(item.handledBy);
  nameField.append(nameLabel, nameInput);

  const saveButton = document.createElement("button");
  saveButton.className = "primary-button staff-prep-save";
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  const rowStatus = document.createElement("p");
  rowStatus.className = "staff-prep-item__status";
  rowStatus.setAttribute("role", "status");
  rowStatus.setAttribute("aria-live", "polite");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const receivedQuantity = fullReceipt.checked ? number(item.quantity) : Number(quantityInput.value);
    const status = fullReceipt.checked
      ? "received"
      : receivedQuantity > 0 ? "partial" : "not-received";
    const handledBy = clean(nameInput.value);
    if (!Number.isInteger(receivedQuantity) || receivedQuantity < 0 || receivedQuantity > number(item.quantity)) {
      rowStatus.textContent = `Enter a whole quantity from 0 to ${formatNumber(item.quantity)}.`;
      rowStatus.dataset.state = "error";
      quantityInput.focus();
      return;
    }
    if (!handledBy) {
      rowStatus.textContent = "Enter your name before saving the delivery status.";
      rowStatus.dataset.state = "error";
      nameInput.focus();
      return;
    }
    const inputs = [...form.querySelectorAll("input, button")];
    inputs.forEach((input) => { input.disabled = true; });
    saveButton.textContent = "Saving...";
    rowStatus.textContent = "";
    delete rowStatus.dataset.state;
    try {
      const response = await fetch("/api/weekly-order-tracking", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-receipt",
          generatedAt: orderTracking.generatedAt,
          itemId: item.id,
          status,
          receivedQuantity,
          handledBy,
        }),
      });
      const result = await parseJsonResponse(response);
      if (!response.ok) throw new Error(result?.error || "The delivery update could not be saved.");
      orderTracking = normalizeOrderTracking(result);
      renderWeeklyOrderTracking();
      renderStaffOverview();
    } catch (error) {
      inputs.forEach((input) => { input.disabled = false; });
      saveButton.textContent = "Save";
      rowStatus.textContent = error?.message || "The delivery update could not be saved.";
      rowStatus.dataset.state = "error";
    }
  });

  form.append(details, choices, nameField, saveButton, rowStatus);
  return form;
}

function setSmartReceivingStatus(message, state = "") {
  if (!smartReceivingStatus) return;
  smartReceivingStatus.textContent = message;
  if (state) smartReceivingStatus.dataset.state = state;
  else delete smartReceivingStatus.dataset.state;
}

function clearSmartReceivingProposal() {
  smartReceivingProposal = null;
  if (smartReceivingApply) smartReceivingApply.disabled = true;
  smartReceivingReviewList?.replaceChildren();
}

function renderSmartReceivingProposal(proposal) {
  if (!smartReceivingReviewList) return;
  smartReceivingReviewList.replaceChildren();
  const list = document.createElement("ul");
  proposal.lines.forEach((line) => {
    const row = document.createElement("li");
    if (line.status !== "received") row.dataset.state = "short";
    const name = document.createElement("strong");
    name.textContent = line.name;
    const quantity = document.createElement("span");
    quantity.textContent = `${formatNumber(line.receivedQuantity)} of ${formatNumber(line.quantity)} ${clean(line.unit)}`;
    row.append(name, quantity);
    list.append(row);
  });
  smartReceivingReviewList.append(list);
}

function reviewSmartReceivingTranscript() {
  clearSmartReceivingProposal();
  const result = parseSmartReceivingTranscript(smartReceivingTranscript?.value, orderTracking);
  if (result.status !== "ready") {
    setSmartReceivingStatus(result.question, "error");
    return;
  }
  smartReceivingProposal = result.proposal;
  renderSmartReceivingProposal(result.proposal);
  smartReceivingApply.disabled = false;
  const shortCount = result.proposal.lines.filter((line) => line.status !== "received").length;
  setSmartReceivingStatus(`${result.proposal.vendor}: ${formatNumber(result.proposal.lines.length)} lines ready to review${shortCount ? `, ${formatNumber(shortCount)} short or missing` : ""}.`);
}

function updateSmartReceivingSpeakButton(listening) {
  if (!smartReceivingSpeak) return;
  smartReceivingSpeak.textContent = listening ? "Stop" : "Speak";
  smartReceivingSpeak.setAttribute("aria-pressed", listening ? "true" : "false");
}

function startSmartReceivingSpeech() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition || !smartReceivingTranscript) return;
  const recognition = new Recognition();
  const startingText = clean(smartReceivingTranscript.value);
  smartReceivingRecognition = recognition;
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onstart = () => updateSmartReceivingSpeakButton(true);
  recognition.onresult = (event) => {
    const finalPhrases = [];
    const interimPhrases = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const phrase = clean(event.results[index]?.[0]?.transcript);
      if (!phrase) continue;
      if (event.results[index].isFinal) finalPhrases.push(phrase);
      else interimPhrases.push(phrase);
    }
    smartReceivingTranscript.value = [startingText, ...finalPhrases, ...interimPhrases].filter(Boolean).join(" ");
    clearSmartReceivingProposal();
  };
  recognition.onerror = () => {
    smartReceivingRecognition = null;
    updateSmartReceivingSpeakButton(false);
    setSmartReceivingStatus("Speech could not be captured. Type the delivery update instead.", "error");
  };
  recognition.onend = () => {
    smartReceivingRecognition = null;
    updateSmartReceivingSpeakButton(false);
    if (clean(smartReceivingTranscript.value)) reviewSmartReceivingTranscript();
  };
  recognition.start();
}

async function applySmartReceivingProposal() {
  if (!smartReceivingProposal || !smartReceivingApply) return;
  const handledBy = clean(smartReceivingName?.value);
  if (!handledBy) {
    setSmartReceivingStatus("Enter your name before applying the delivery.", "error");
    smartReceivingName?.focus();
    return;
  }
  smartReceivingApply.disabled = true;
  smartReceivingReview.disabled = true;
  smartReceivingSpeak.disabled = true;
  setSmartReceivingStatus("Saving reviewed delivery...");
  try {
    const response = await fetch("/api/weekly-order-tracking", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set-receipts",
        generatedAt: smartReceivingProposal.generatedAt,
        vendorId: smartReceivingProposal.vendorId,
        handledBy,
        confirmed: true,
        receipts: smartReceivingProposal.lines.map((line) => ({
          itemId: line.itemId,
          status: line.status,
          receivedQuantity: line.receivedQuantity,
        })),
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "The reviewed delivery could not be saved.");
    const savedLineCount = smartReceivingProposal.lines.length;
    orderTracking = normalizeOrderTracking(result);
    smartReceivingTranscript.value = "";
    clearSmartReceivingProposal();
    renderWeeklyOrderTracking();
    renderStaffOverview();
    setSmartReceivingStatus(`${formatNumber(savedLineCount)} delivery lines saved.`);
  } catch (error) {
    smartReceivingApply.disabled = false;
    setSmartReceivingStatus(error?.message || "The reviewed delivery could not be saved.", "error");
  } finally {
    smartReceivingReview.disabled = false;
    smartReceivingSpeak.disabled = false;
  }
}

function bindSmartReceivingEvents() {
  if (!smartReceivingTranscript) return;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition && smartReceivingSpeak) {
    smartReceivingSpeak.disabled = true;
    smartReceivingSpeak.title = "Speech recognition is unavailable in this browser.";
  }
  smartReceivingTranscript.addEventListener("input", clearSmartReceivingProposal);
  smartReceivingReview?.addEventListener("click", reviewSmartReceivingTranscript);
  smartReceivingApply?.addEventListener("click", applySmartReceivingProposal);
  smartReceivingSpeak?.addEventListener("click", () => {
    if (smartReceivingRecognition) smartReceivingRecognition.stop();
    else startSmartReceivingSpeech();
  });
}

function renderStaffPrepPlan() {
  prepList.replaceChildren();
  prepList.setAttribute("aria-busy", "false");
  if (!prepPlan.available) {
    prepStatusPanel.dataset.state = "error";
    prepStatusPanel.textContent = prepPlan.message || "A manager has not published this week's cocktail prep plan yet.";
    prepSummary.textContent = "";
    prepList.append(createEmptyState("There are no current cocktail prep assignments to check off."));
    return;
  }

  delete prepStatusPanel.dataset.state;
  prepStatusPanel.textContent = prepPlan.generatedAt
    ? `Showing the shared ${formatPlanWeek(prepPlan.generatedAt)} plan.`
    : "Showing the current shared weekly plan.";
  const liquorRefills = Array.isArray(prepPlan.liquorRefills) ? prepPlan.liquorRefills : [];
  const taskTotal = prepPlan.totalCount + prepPlan.liquorRefillTotalCount;
  const completedTotal = prepPlan.completedCount + prepPlan.liquorRefillCompletedCount;
  prepSummary.textContent = taskTotal
    ? `${formatNumber(completedTotal)} of ${formatNumber(taskTotal)} tasks complete`
    : "No prep tasks this week.";
  if (!prepPlan.items.length && !liquorRefills.length) {
    prepList.append(createEmptyState("Nothing needs to be prepared from the current weekly plan."));
    return;
  }
  if (prepPlan.items.length) prepList.append(createStaffPrepGroupTitle("Make Cocktails"));
  prepPlan.items.forEach((item) => prepList.append(createStaffPrepItem(item)));
  if (liquorRefills.length) prepList.append(createStaffPrepGroupTitle("Add Liquor To Kegs"));
  liquorRefills.forEach((item) => prepList.append(createStaffPrepItem(item)));
}

function createStaffPrepGroupTitle(label) {
  const heading = document.createElement("h3");
  heading.className = "staff-prep-group-title";
  heading.textContent = label;
  return heading;
}

function createStaffPrepItem(item) {
  const form = document.createElement("form");
  form.className = `staff-prep-item${item.completed ? " is-complete" : ""}`;
  const isLiquorRefill = item.kind === "liquor-refill";
  const recipe = isLiquorRefill ? null : findStaffRecipeForPrepItem(item);

  const checkLabel = document.createElement("label");
  checkLabel.className = "staff-prep-check";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = item.completed === true;
  const checkText = document.createElement("span");
  checkText.textContent = item.completed
    ? (isLiquorRefill ? "Added" : "Prepared")
    : (isLiquorRefill ? "Check off when added" : "Check off when prepared");
  checkLabel.append(checkbox, checkText);

  const details = document.createElement("div");
  details.className = "staff-prep-item__details";
  let recipePanel = null;
  if (recipe) {
    const recipePanelId = `staff-prep-recipe-${slugify(item.id)}`;
    const recipeToggle = document.createElement("button");
    recipeToggle.className = "staff-prep-recipe-toggle";
    recipeToggle.type = "button";
    recipeToggle.setAttribute("aria-expanded", "false");
    recipeToggle.setAttribute("aria-controls", recipePanelId);
    const recipeName = document.createElement("strong");
    recipeName.className = "staff-cocktail-name";
    recipeName.textContent = formatStaffCocktailName(clean(item.displayName) || item.name);
    const recipeHint = document.createElement("span");
    recipeHint.textContent = "View recipe +";
    recipeToggle.append(recipeName, recipeHint);
    details.append(recipeToggle);
    recipePanel = createInlineStaffPrepRecipe(recipe, recipePanelId);
    recipeToggle.addEventListener("click", () => {
      const expanded = recipeToggle.getAttribute("aria-expanded") === "true";
      recipeToggle.setAttribute("aria-expanded", String(!expanded));
      recipeHint.textContent = expanded ? "View recipe +" : "Hide recipe −";
      recipePanel.hidden = expanded;
    });
  } else {
    const heading = document.createElement("h3");
    heading.className = "staff-cocktail-name";
    heading.textContent = isLiquorRefill
      ? (clean(item.displayName) || item.name)
      : formatStaffCocktailName(clean(item.displayName) || item.name);
    details.append(heading);
  }
  const meta = document.createElement("p");
  const labelDetails = isLiquorRefill
    ? [
      item.tapNumbers?.length ? `Tap${item.tapNumbers.length === 1 ? "" : "s"} ${item.tapNumbers.join(", ")}` : "",
      `${formatNumber(item.quantity)} bottle${number(item.quantity) === 1 ? "" : "s"}`,
    ].filter(Boolean)
    : [
      item.wall ? `${clean(item.wall)} wall` : "",
      number(item.batchSizeOz) > 0 ? `${formatNumber(item.batchSizeOz)} oz` : "",
      number(item.quantity) > 1 ? `${formatNumber(item.quantity)} labels` : "",
    ].filter(Boolean);
  meta.textContent = labelDetails.join(" · ");
  details.append(meta);
  if (item.completed && item.completedAt) {
    const completion = document.createElement("small");
    completion.textContent = `Completed ${formatCompletionTime(item.completedAt)}`;
    details.append(completion);
  }

  const preparedField = document.createElement("label");
  preparedField.className = "staff-prep-name-field";
  const fieldLabel = document.createElement("span");
  fieldLabel.textContent = isLiquorRefill ? "Added by" : "Prepared by";
  const preparedInput = document.createElement("input");
  preparedInput.type = "text";
  preparedInput.maxLength = 80;
  preparedInput.autoComplete = "name";
  preparedInput.placeholder = "Employee name";
  preparedInput.value = clean(item.preparedBy);
  preparedField.append(fieldLabel, preparedInput);

  const saveButton = document.createElement("button");
  saveButton.className = "primary-button staff-prep-save";
  saveButton.type = "submit";
  saveButton.textContent = "Save";
  const rowStatus = document.createElement("p");
  rowStatus.className = "staff-prep-item__status";
  rowStatus.setAttribute("role", "status");
  rowStatus.setAttribute("aria-live", "polite");

  checkbox.addEventListener("change", () => {
    checkText.textContent = checkbox.checked
      ? (isLiquorRefill ? "Added" : "Prepared")
      : (isLiquorRefill ? "Check off when added" : "Check off when prepared");
    if (checkbox.checked && !clean(preparedInput.value)) preparedInput.focus();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const preparedBy = clean(preparedInput.value);
    if (checkbox.checked && !preparedBy) {
      rowStatus.textContent = isLiquorRefill
        ? "Enter who added the liquor before checking it off."
        : "Enter who prepared this cocktail before checking it off.";
      rowStatus.dataset.state = "error";
      preparedInput.focus();
      return;
    }
    saveButton.disabled = true;
    checkbox.disabled = true;
    preparedInput.disabled = true;
    saveButton.textContent = "Saving...";
    rowStatus.textContent = "";
    delete rowStatus.dataset.state;
    try {
      const response = await fetch("/api/staff-prep-plan", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          generatedAt: prepPlan.generatedAt,
          itemId: item.id,
          completed: checkbox.checked,
          preparedBy,
        }),
      });
      const result = await parseJsonResponse(response);
      if (!response.ok) throw new Error(result?.error || "The checklist update could not be saved.");
      prepPlan = {
        available: result.available === true,
        generatedAt: clean(result.generatedAt),
        items: Array.isArray(result.items) ? result.items : [],
        liquorRefills: Array.isArray(result.liquorRefills) ? result.liquorRefills : [],
        completedCount: number(result.completedCount),
        totalCount: number(result.totalCount),
        liquorRefillCompletedCount: number(result.liquorRefillCompletedCount),
        liquorRefillTotalCount: number(result.liquorRefillTotalCount),
        message: clean(result.message),
      };
      renderStaffPrepPlan();
      renderStaffOverview();
    } catch (error) {
      saveButton.disabled = false;
      checkbox.disabled = false;
      preparedInput.disabled = false;
      saveButton.textContent = "Save";
      rowStatus.textContent = error?.message || "The checklist update could not be saved.";
      rowStatus.dataset.state = "error";
    }
  });

  form.append(checkLabel, details, preparedField, saveButton, rowStatus);
  if (recipePanel) form.append(recipePanel);
  return form;
}

function findStaffRecipeForPrepItem(item) {
  const candidates = [item?.displayName, item?.name]
    .map(getStaffPrepRecipeMatchKey)
    .filter(Boolean);
  const activeRecipes = recipes.filter((recipe) => !recipe.inactive);
  return activeRecipes.find((recipe) => candidates.includes(getStaffPrepRecipeMatchKey(recipe.title))) || null;
}

function getStaffPrepRecipeMatchKey(value) {
  return normalizeTitle(
    clean(value)
      .replace(/\s+\d+\s*$/, "")
      .replace(/\s*\([^)]*\)\s*/g, " "),
  );
}

function createInlineStaffPrepRecipe(recipe, panelId) {
  const panel = document.createElement("section");
  panel.className = "staff-prep-recipe-panel";
  panel.id = panelId;
  panel.hidden = true;

  const header = document.createElement("header");
  const title = document.createElement("h4");
  title.textContent = "Recipe";
  const total = document.createElement("strong");
  total.textContent = `${formatNumber(getTotalOunces(recipe))} total oz`;
  header.append(title, total);

  const table = document.createElement("table");
  table.className = "staff-prep-recipe-table";
  const body = document.createElement("tbody");
  recipe.ingredients.forEach((ingredient) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = ingredient.name;
    const amount = document.createElement("td");
    amount.textContent = getIngredientAddAmount(ingredient.raw) || `${formatNumber(ingredient.oz)} oz`;
    row.append(name, amount);
    body.append(row);
    const progress = getOptionalIngredientProgress(ingredient.raw);
    if (progress) body.append(createOptionalIngredientProgressRow(ingredient.name, progress));
  });
  table.append(body);
  panel.append(header, table);
  return panel;
}

function getOptionalIngredientProgress(rawValue) {
  const amount = getIngredientAddAmount(rawValue);
  const standard = amount.match(/^(\d+)\s*(gallons?|bottles?|btls?|bts|packets?|pitchers?|boxes?|cans?)\b/i);
  const sizedBottles = amount.match(/^(\d+)\s*\([^)]*(?:btls?|bts)\b[^)]*\)/i);
  const match = standard || sizedBottles;
  if (!match) return null;
  const count = Number(match[1]);
  if (!Number.isInteger(count) || count < 1 || count > 20) return null;
  const rawUnit = standard?.[2] || "bottles";
  const unit = /^(?:bottles?|btls?|bts)$/i.test(rawUnit)
    ? (count === 1 ? "bottle" : "bottles")
    : rawUnit.toLowerCase();
  return { count, unit };
}

function createOptionalIngredientProgressRow(ingredientName, progress) {
  const row = document.createElement("tr");
  row.className = "staff-prep-recipe-progress-row";
  const cell = document.createElement("td");
  cell.colSpan = 2;
  const tracker = document.createElement("div");
  tracker.className = "staff-ingredient-progress";
  const header = document.createElement("div");
  const label = document.createElement("span");
  label.textContent = "Optional progress";
  const count = document.createElement("small");
  count.textContent = `0 of ${progress.count} ${progress.unit}`;
  header.append(label, count);
  const checks = document.createElement("div");
  checks.className = "staff-ingredient-progress__checks";
  const inputs = [];
  for (let index = 1; index <= progress.count; index += 1) {
    const checkLabel = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.setAttribute("aria-label", `${ingredientName}: ${progress.unit} ${index} added`);
    const checkNumber = document.createElement("span");
    checkNumber.textContent = String(index);
    checkLabel.append(checkbox, checkNumber);
    checks.append(checkLabel);
    inputs.push(checkbox);
  }
  checks.addEventListener("change", () => {
    const completed = inputs.filter((input) => input.checked).length;
    count.textContent = `${completed} of ${progress.count} ${progress.unit}`;
    tracker.classList.toggle("is-complete", completed === progress.count);
  });
  tracker.append(header, checks);
  cell.append(tracker);
  row.append(cell);
  return row;
}

function formatPlanWeek(value) {
  const generated = new Date(value || "");
  if (Number.isNaN(generated.getTime())) return "current Monday–Sunday";
  const monday = new Date(generated);
  const daysSinceMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - daysSinceMonday);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const start = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const end = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${start}–${end}`;
}

function formatCompletionTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function buildRecipeCollection(activeCsv, newCsv, sharedRecipes) {
  const sourceRecipes = [
    ...applyStaffRecipeOrder(parseRecipes(parseCsv(activeCsv)), STAFF_MENU_ORDER),
    ...applyStaffRecipeOrder(parseRecipes(parseCsv(newCsv)), STAFF_NEW_RECIPE_ORDER),
  ];
  const customRecipes = Array.isArray(sharedRecipes?.customRecipes)
    ? sharedRecipes.customRecipes.map(normalizeSharedRecipe).filter(Boolean)
    : [];
  const edits = isPlainRecord(sharedRecipes?.editedRecipes)
    ? sharedRecipes.editedRecipes
    : {};
  const inactiveIds = new Set(
    Array.isArray(sharedRecipes?.inactiveRecipeIds) ? sharedRecipes.inactiveRecipeIds : [],
  );
  return [...sourceRecipes, ...customRecipes]
    .map((recipe) => {
      const rawEdit = edits[recipe.id];
      const edit = rawEdit ? normalizeSharedRecipe({ ...recipe, ...rawEdit, id: recipe.id }) : null;
      const merged = edit ? mergeRecipeEdit(recipe, edit, rawEdit) : recipe;
      return { ...merged, inactive: inactiveIds.has(recipe.id) };
    })
    .sort((left, right) => left.title.localeCompare(right.title));
}

function applyStaffRecipeOrder(sourceRecipes, order) {
  const byTitle = new Map(sourceRecipes.map((recipe) => [normalizeTitle(recipe.title), recipe]));
  return order.map(([displayTitle, sourceTitle]) => {
    const source = byTitle.get(normalizeTitle(sourceTitle));
    if (!source) return null;
    return {
      ...source,
      id: slugify(displayTitle),
      title: displayTitle,
      ingredients: source.ingredients.map((ingredient) => ({
        ...ingredient,
        name: getIngredientName(ingredient.raw, displayTitle),
      })),
    };
  }).filter(Boolean);
}

function normalizeTitle(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergeRecipeEdit(current, edit, rawEdit) {
  return {
    ...current,
    ...(clean(rawEdit?.title) ? { title: edit.title } : {}),
    ...(clean(rawEdit?.batch) ? { batch: edit.batch } : {}),
    ...(clean(rawEdit?.category) ? { category: edit.category } : {}),
    ...(Array.isArray(rawEdit?.ingredients) ? { ingredients: edit.ingredients } : {}),
  };
}

function normalizeSharedRecipe(value) {
  if (!isPlainRecord(value)) return null;
  const title = clean(value.title || value.sourceTitle);
  if (!title) return null;
  return {
    id: clean(value.id) || slugify(title),
    title,
    batch: clean(value.batch),
    category: clean(value.category) || inferCategory(title),
    ingredients: Array.isArray(value.ingredients)
      ? value.ingredients.map((ingredient) => normalizeIngredient(ingredient, title)).filter(Boolean)
      : [],
  };
}

function parseRecipes(rows) {
  const header = rows[0] || [];
  const batchRow = rows[1] || [];
  const groups = [];

  for (let index = 0; index < header.length; index += 1) {
    const title = clean(header[index]);
    if (title && clean(header[index + 1]) === "$" && clean(header[index + 2]).toLowerCase() === "oz") {
      groups.push({ title, start: index });
    }
  }

  return groups.map(({ title, start }) => ({
    id: slugify(title),
    title,
    batch: clean(batchRow[start]),
    category: inferCategory(title),
    ingredients: rows.slice(2).map((row) => {
      const raw = clean(row[start]);
      if (!raw || isMetricLabel(raw)) return null;
      return normalizeIngredient({ raw, oz: number(row[start + 2]) }, title);
    }).filter(Boolean),
  }));
}

function normalizeIngredient(value, recipeTitle) {
  if (!isPlainRecord(value)) return null;
  const raw = clean(value.raw || value.name);
  const name = clean(value.name) || getIngredientName(raw, recipeTitle);
  if (!name) return null;
  return {
    name,
    raw,
    oz: Math.max(0, number(value.oz ?? value.quantity)),
  };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = String(text || "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function populateCategoryFilter() {
  [...new Set(recipes.map((recipe) => recipe.category).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categoryFilter.append(option);
    });
}

function bindStaffRecipeEvents() {
  searchInput.addEventListener("input", renderStaffRecipes);
  categoryFilter.addEventListener("change", renderStaffRecipes);
  recipeViewButtons.forEach((button) => {
    button.addEventListener("click", () => switchStaffRecipeView(button.dataset.staffRecipeView));
  });
}

function bindStaffSectionEvents() {
  bindSmartReceivingEvents();
  sectionTabButtons.forEach((button) => {
    button.addEventListener("click", () => switchStaffSection(button.dataset.staffSectionTab));
  });
  overviewTargets.forEach((button) => {
    button.addEventListener("click", () => switchStaffSection(button.dataset.staffSectionTarget));
  });
  tapPrintWorkspace?.addEventListener("click", (event) => {
    const wallButton = event.target.closest("[data-staff-tap-wall]");
    if (wallButton) {
      activeTapSheetWall = wallButton.dataset.staffTapWall;
      renderStaffTapSheets();
      return;
    }
    if (event.target.closest("[data-staff-print-taps]")) printStaffTapSheet();
  });
}

function switchStaffSection(section) {
  const nextSection = ["overview", "prep", "recipes", "orders", "taps"].includes(section) ? section : "overview";
  sectionTabButtons.forEach((button) => {
    const selected = button.dataset.staffSectionTab === nextSection;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  sectionPanels.forEach((panel) => {
    const selected = panel.id === `staff-${nextSection === "orders" ? "orders" : nextSection}-panel`;
    panel.classList.toggle("is-active", selected);
    panel.hidden = !selected;
  });
  document.querySelector(".staff-section-tabs")?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderStaffOverview() {
  const currentRecipes = recipes.filter((recipe) => !recipe.inactive);
  const inactiveRecipes = recipes.filter((recipe) => recipe.inactive);
  const planDate = prepPlan.generatedAt || orderTracking.generatedAt;
  overviewWeek.textContent = planDate
    ? formatPlanWeek(planDate)
    : "No Monday plan has been published yet.";

  if (prepPlan.available) {
    const remainingPrep = Math.max(0, prepPlan.totalCount - prepPlan.completedCount);
    overviewPrepValue.textContent = `${formatNumber(remainingPrep)} left`;
    overviewPrepDetail.textContent = `${formatNumber(prepPlan.completedCount)} of ${formatNumber(prepPlan.totalCount)} prepared`;
  } else {
    overviewPrepValue.textContent = "No plan";
    overviewPrepDetail.textContent = "Waiting for the Monday plan";
  }

  if (orderTracking.available) {
    const checkedOrders = orderTracking.receivedCount + orderTracking.notReceivedCount;
    const remainingOrders = Math.max(0, orderTracking.itemCount - checkedOrders);
    overviewOrderValue.textContent = `${formatNumber(remainingOrders)} left`;
    overviewOrderDetail.textContent = orderTracking.notReceivedCount
      ? `${formatNumber(orderTracking.notReceivedCount)} short or missing`
      : `${formatNumber(checkedOrders)} of ${formatNumber(orderTracking.itemCount)} checked`;
  } else {
    overviewOrderValue.textContent = "No plan";
    overviewOrderDetail.textContent = "Waiting for the Monday plan";
  }

  overviewRecipeValue.textContent = `${formatNumber(currentRecipes.length)} current`;
  overviewRecipeDetail.textContent = `${formatNumber(inactiveRecipes.length)} deactivated`;
}

function switchStaffRecipeView(view) {
  activeRecipeView = view === "inactive" ? "inactive" : "current";
  searchInput.value = "";
  categoryFilter.value = "all";
  recipeViewButtons.forEach((button) => {
    const selected = button.dataset.staffRecipeView === activeRecipeView;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  searchInput.placeholder = activeRecipeView === "inactive"
    ? "Search deactivated cocktails..."
    : "Search cocktails, liquor, juice...";
  renderStaffRecipes();
}

function renderStaffRecipes() {
  const search = clean(searchInput.value).toLowerCase();
  const category = categoryFilter.value;
  const currentRecipes = recipes.filter((recipe) => !recipe.inactive);
  const inactiveRecipes = recipes.filter((recipe) => recipe.inactive);
  const selectedRecipes = activeRecipeView === "inactive" ? inactiveRecipes : currentRecipes;
  const visible = selectedRecipes.filter((recipe) => {
    if (category !== "all" && recipe.category !== category) return false;
    const searchText = `${recipe.title} ${recipe.batch} ${recipe.category} ${recipe.ingredients.map((item) => `${item.name} ${item.raw}`).join(" ")}`.toLowerCase();
    return searchText.includes(search);
  });

  currentRecipeCount.textContent = `(${currentRecipes.length})`;
  inactiveRecipeCount.textContent = `(${inactiveRecipes.length})`;
  renderStats(visible.length);
  recipeGrid.replaceChildren();
  visible.forEach((recipe) => recipeGrid.append(createRecipeCard(recipe)));
  if (!visible.length) {
    recipeGrid.append(createEmptyState(
      activeRecipeView === "inactive" && !inactiveRecipes.length
        ? "No deactivated recipes."
        : "No recipes match that search.",
    ));
  }
  renderStaffOverview();
  recipeGrid.setAttribute("aria-busy", "false");
}

function renderStats(visibleCount) {
  const stats = [[
    String(visibleCount),
    visibleCount === recipes.length ? "Recipes" : "Recipes shown",
  ]];

  statsGrid.replaceChildren();
  stats.forEach(([value, label]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    statsGrid.append(card);
  });
}

function createRecipeCard(recipe) {
  const article = document.createElement("article");
  article.className = "recipe-card staff-recipe-card";

  const header = document.createElement("div");
  header.className = "recipe-card__header staff-recipe-card__header";
  const headingGroup = document.createElement("div");
  const heading = document.createElement("h2");
  heading.className = "staff-cocktail-name";
  heading.textContent = getStaffRecipeDisplayTitle(recipe.title);
  headingGroup.append(heading);
  const total = document.createElement("div");
  total.className = "staff-recipe-card__total";
  const totalValue = document.createElement("strong");
  totalValue.textContent = formatNumber(getTotalOunces(recipe));
  const totalLabel = document.createElement("span");
  totalLabel.textContent = "Total oz";
  total.append(totalValue, totalLabel);
  header.append(headingGroup, total);

  const tableWrap = document.createElement("div");
  tableWrap.className = "recipe-table-wrap";
  const table = document.createElement("table");
  table.className = "recipe-table staff-recipe-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Ingredient", "Add"].forEach((label) => {
    const cell = document.createElement("th");
    cell.textContent = label;
    headerRow.append(cell);
  });
  thead.append(headerRow);
  const tbody = document.createElement("tbody");
  recipe.ingredients.forEach((ingredient) => {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    const strong = document.createElement("strong");
    strong.textContent = ingredient.name;
    name.append(strong);
    const prep = document.createElement("td");
    const addAmount = getIngredientAddAmount(ingredient.raw) || `${formatNumber(ingredient.oz)} oz`;
    prep.textContent = addAmount;
    if (/\bbottles?\b/i.test(addAmount) && /\([^)]*(?:l|ml)[^)]*\)/i.test(addAmount)) {
      prep.classList.add("staff-recipe-add--bottle-size");
    }
    row.append(name, prep);
    tbody.append(row);
  });
  table.append(thead, tbody);
  tableWrap.append(table);
  article.append(header, tableWrap);
  return article;
}

function getStaffRecipeDisplayTitle(value) {
  return formatStaffCocktailName(clean(value).replace(/\s*\([^)]*\)\s*$/, "").trim());
}

function formatStaffCocktailName(value) {
  return clean(value)
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s/&'-])([a-z])/g, (_match, separator, letter) => `${separator}${letter.toLocaleUpperCase("en-US")}`)
    .replace(/'S\b/g, "'s")
    .replace(/\b(?:And|Of|The)\b/g, (word) => word.toLocaleLowerCase("en-US"));
}

function createEmptyState(message) {
  const state = document.createElement("div");
  state.className = "empty-state staff-recipe-empty";
  state.textContent = message;
  return state;
}

function getTotalOunces(recipe) {
  return recipe.ingredients.reduce((total, ingredient) => total + number(ingredient.oz), 0);
}

function getIngredientAddAmount(value) {
  const raw = clean(value);
  if (!raw) return "";
  if (raw.includes("=")) return clean(raw.split("=").slice(1).join("="));
  const leading = raw.match(/^(\d+(?:\.\d+)?)\s*(gallons?|oz|cups?|packets?|pitchers?)\b/i);
  if (leading) return clean(leading[0]);
  const quantity = raw.match(/(\d+(?:\.\d+)?)\s*(bottles?|btls?|gallons?|oz|cups?|packets?|pitchers?)(.*)$/i);
  return quantity ? clean(quantity[0]) : "";
}

function getIngredientName(value, recipeTitle = "") {
  let name = clean(value)
    .replace(/^\d+(?:\.\d+)?\s*(?:gallons?|oz|cups?)\s+/i, "")
    .replace(/\s*=\s*.*$/, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:bottles?|btls?|liter|liters|l|ml|oz|gallons?|cups?|diluted|pitchers|packets|water)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (/^flavored schnapps$/i.test(name)) {
    const flavor = clean(recipeTitle).match(/blueberry|strawberry|raspberry|watermelon|peach/i)?.[0];
    if (flavor) name = `${capitalize(flavor.toLowerCase())} Schnapps`;
  }
  return name;
}

function inferCategory(title) {
  const explicit = clean(title).match(/\(([^)]+)\)/)?.[1];
  if (explicit) return clean(explicit).replace(/Tequilla/i, "Tequila").replace(/Tito'?s/i, "Vodka");
  if (/margarita|marg|senorita/i.test(title)) return "Tequila";
  if (/martini|cran|lemonade|palmer|blue dot/i.test(title)) return "Vodka";
  if (/whiskey|jack|old fashioned|apple jack|smash|sour|on par tee/i.test(title)) return "Whiskey";
  if (/rum|captain/i.test(title)) return "Rum";
  if (/gin/i.test(title)) return "Gin";
  return "Other";
}

function isMetricLabel(value) {
  return /^(total price|total oz|total price per oz|price we're charging|profit per oz|profit margin|cost for|how many oz per shot)/i.test(clean(value));
}

function formatBatchLabel(value) {
  const batch = clean(value);
  return !batch || /^12\s*gallons?$/i.test(batch) || /^12\s*gallon\s*keg$/i.test(batch)
    ? DEFAULT_BATCH_LABEL
    : batch;
}

function formatNumber(value) {
  const numeric = number(value);
  return Number.isInteger(numeric)
    ? numeric.toLocaleString("en-US")
    : numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function number(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function capitalize(value) {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : "";
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
