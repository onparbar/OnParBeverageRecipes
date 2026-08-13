const DEFAULT_BATCH_LABEL = "12 gallon keg";
const searchInput = document.querySelector("#staff-recipe-search");
const categoryFilter = document.querySelector("#staff-category-filter");
const statusPanel = document.querySelector("#staff-recipe-status");
const statsGrid = document.querySelector("#staff-stats-grid");
const recipeGrid = document.querySelector("#staff-recipe-grid");

let recipes = [];

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
    if (session.role !== "employee") {
      window.location.replace("/");
      return;
    }

    const profileCheck = inspectStaffBrowserProfile();
    if (!profileCheck.safe) {
      lockStaffRecipesForBrowserProfile(profileCheck.storageUnavailable);
      return;
    }

    const [activeCsv, newCsv, sharedResult] = await Promise.all([
      fetchStaffRecipeCsv("active"),
      fetchStaffRecipeCsv("new"),
      fetchSharedRecipeUpdates(),
    ]);
    recipes = buildRecipeCollection(activeCsv, newCsv, sharedResult.recipes);
    populateCategoryFilter();
    bindStaffRecipeEvents();
    renderStaffRecipes();
    statusPanel.textContent = sharedResult.available
      ? "Current shared recipe updates are included."
      : "Core recipes are available. Shared recipe updates could not be checked right now.";
  } catch (error) {
    statusPanel.textContent = error?.message || "Recipes could not be loaded.";
    statusPanel.dataset.state = "error";
    recipeGrid.setAttribute("aria-busy", "false");
    recipeGrid.replaceChildren(createEmptyState("Recipe data is unavailable. Ask a manager to check the dashboard service."));
  }
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
  statusPanel.textContent = storageUnavailable
    ? "Staff recipes are locked because this browser profile's site storage could not be checked. Use a dedicated staff browser profile."
    : "Staff recipes are locked because this browser profile contains owner dashboard data. Use a separate browser profile reserved for staff.";
  recipeGrid.setAttribute("aria-busy", "false");
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

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function buildRecipeCollection(activeCsv, newCsv, sharedRecipes) {
  const byId = new Map();
  [...parseRecipes(parseCsv(activeCsv)), ...parseRecipes(parseCsv(newCsv))].forEach((recipe) => {
    if (!byId.has(recipe.id)) byId.set(recipe.id, recipe);
  });

  const customRecipes = Array.isArray(sharedRecipes?.customRecipes)
    ? sharedRecipes.customRecipes.map(normalizeSharedRecipe).filter(Boolean)
    : [];
  customRecipes.forEach((recipe) => byId.set(recipe.id, recipe));

  const edits = isPlainRecord(sharedRecipes?.editedRecipes)
    ? sharedRecipes.editedRecipes
    : {};
  Object.entries(edits).forEach(([id, rawEdit]) => {
    const current = byId.get(id);
    const edit = normalizeSharedRecipe({ ...(current || {}), ...rawEdit, id });
    if (!edit) return;
    byId.set(id, current ? mergeRecipeEdit(current, edit, rawEdit) : edit);
  });

  const inactiveIds = new Set(
    Array.isArray(sharedRecipes?.inactiveRecipeIds) ? sharedRecipes.inactiveRecipeIds : [],
  );
  return [...byId.values()]
    .filter((recipe) => !inactiveIds.has(recipe.id))
    .sort((left, right) => left.title.localeCompare(right.title));
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
}

function renderStaffRecipes() {
  const search = clean(searchInput.value).toLowerCase();
  const category = categoryFilter.value;
  const visible = recipes.filter((recipe) => {
    if (category !== "all" && recipe.category !== category) return false;
    const searchText = `${recipe.title} ${recipe.batch} ${recipe.category} ${recipe.ingredients.map((item) => `${item.name} ${item.raw}`).join(" ")}`.toLowerCase();
    return searchText.includes(search);
  });

  renderStats(visible.length);
  recipeGrid.replaceChildren();
  visible.forEach((recipe) => recipeGrid.append(createRecipeCard(recipe)));
  if (!visible.length) recipeGrid.append(createEmptyState("No recipes match that search."));
  recipeGrid.setAttribute("aria-busy", "false");
}

function renderStats(visibleCount) {
  const ingredientNames = new Set(recipes.flatMap((recipe) => recipe.ingredients.map((item) => item.name.toLowerCase())));
  const spiritGroups = new Set(recipes.map((recipe) => recipe.category));
  const totalBatchOz = recipes.reduce((total, recipe) => total + getTotalOunces(recipe), 0);
  const stats = [
    [String(recipes.length), "Recipes"],
    [String(spiritGroups.size), "Spirit groups"],
    [String(ingredientNames.size), "Ingredients"],
    [formatNumber(recipes.length ? totalBatchOz / recipes.length : 0), "Avg batch oz"],
  ];
  if (visibleCount !== recipes.length) stats[0] = [String(visibleCount), "Recipes shown"];

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
  header.className = "recipe-card__header";
  const headingGroup = document.createElement("div");
  const batch = document.createElement("p");
  batch.className = "recipe-card__batch";
  batch.textContent = formatBatchLabel(recipe.batch);
  const heading = document.createElement("h2");
  heading.textContent = recipe.title;
  headingGroup.append(batch, heading);
  const category = document.createElement("span");
  category.className = "spirit-pill";
  category.textContent = recipe.category;
  header.append(headingGroup, category);

  const metrics = document.createElement("div");
  metrics.className = "recipe-card__numbers";
  [
    [formatNumber(getTotalOunces(recipe)), "Total oz"],
    [String(recipe.ingredients.length), "Ingredients"],
    [formatBatchLabel(recipe.batch), "Batch"],
  ].forEach(([value, label]) => {
    const item = document.createElement("div");
    item.className = "recipe-number";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    item.append(strong, span);
    metrics.append(item);
  });

  const tableWrap = document.createElement("div");
  tableWrap.className = "recipe-table-wrap";
  const table = document.createElement("table");
  table.className = "recipe-table staff-recipe-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  ["Ingredient", "Prep amount", "Oz"].forEach((label) => {
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
    prep.textContent = getIngredientAddAmount(ingredient.raw) || "—";
    const ounces = document.createElement("td");
    ounces.textContent = formatNumber(ingredient.oz);
    row.append(name, prep, ounces);
    tbody.append(row);
  });
  table.append(thead, tbody);
  tableWrap.append(table);
  article.append(header, metrics, tableWrap);
  return article;
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
