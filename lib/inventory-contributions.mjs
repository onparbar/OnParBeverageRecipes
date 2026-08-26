import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSharedDashboardState } from "./shared-dashboard-store.mjs";
import { mutateSharedInventoryState, readSharedInventoryState } from "./inventory-shared-store.mjs";

const RECIPE_FILES = ["cocktail-recipes.csv", "new-cocktails.csv"];
const INVENTORY_FILE = "inventory-2026-06-01.csv";

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function number(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function slug(value) {
  return clean(value).toLowerCase().replace(/&/g, "and").replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function identity(value) {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’']/g, "").toLowerCase()
    .replace(/\b(?:vodka|whiskey|bourbon|tequila|rum|gin|cognac)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:l|liter|liters|ml|oz)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    .replace(/\bbulliet\b/g, "bulleit").replace(/\bscrewball\b/g, "skrewball")
    .replace(/\bkettle\b/g, "ketel").replace(/\bcocao\b/g, "cacao")
    .replace(/\bsweet and sour\b/g, "sour mix").replace(/\bcrown apple royal\b/g, "crown apple")
    .replace(/\broyal apple\b/g, "crown apple");
}
function titleIdentity(value) {
  return identity(String(value || "").replace(/\([^)]*\)/g, " ").replace(/\s+[123]\s*$/, ""));
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
    if (character === '"' && quoted && next === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += character;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function getIngredientName(raw, recipeTitle = "") {
  let name = clean(raw).replace(/^\d+(?:\.\d+)?\s*(?:gallons?|oz|cups?)\s+/i, "")
    .replace(/\s*=\s*.*$/, "").replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\b\d+(?:\.\d+)?\s*(?:bottles?|btls?|liter|liters|l|ml|oz|gallons?|cups?|diluted|pitchers|packets|water)\b/gi, "")
    .replace(/\s{2,}/g, " ").trim();
  if (/^flavored schnapps$/i.test(name)) {
    const flavor = clean(recipeTitle).match(/blueberry|strawberry|raspberry|watermelon|peach/i)?.[0];
    if (flavor) name = `${flavor} schnapps`;
  }
  return name;
}
function parseRecipes(rows) {
  const header = rows[0] || [];
  const groups = [];
  for (let index = 0; index < header.length; index += 1) {
    const title = clean(header[index]);
    if (title && clean(header[index + 1]) === "$" && clean(header[index + 2]).toLowerCase() === "oz") groups.push({ title, start: index });
  }
  return groups.map(({ title, start }) => ({
    id: slug(title), title,
    ingredients: rows.slice(2).map((row) => {
      const raw = clean(row[start]);
      if (!raw || /^(?:total|ounces per keg|cost per ounce|percentage)/i.test(raw)) return null;
      return { name: getIngredientName(raw, title), raw, oz: Math.max(0, number(row[start + 2])) };
    }).filter(Boolean),
  }));
}
function normalizeSharedRecipe(recipe) {
  const title = clean(recipe?.title || recipe?.sourceTitle);
  if (!title) return null;
  return {
    ...recipe, id: clean(recipe?.id) || slug(title), title,
    ingredients: Array.isArray(recipe?.ingredients) ? recipe.ingredients.map((ingredient) => ({
      ...ingredient,
      name: clean(ingredient?.name) || getIngredientName(ingredient?.raw, title),
      raw: clean(ingredient?.raw || ingredient?.name),
      oz: Math.max(0, number(ingredient?.oz ?? ingredient?.quantity)),
    })).filter((ingredient) => ingredient.name) : [],
  };
}
function baseInventoryRows(rows) {
  const items = [];
  let section = "Liquor";
  rows.forEach((row) => {
    const first = clean(row[0]);
    const last = clean(row[row.length - 1]);
    if (!first || /^total /i.test(first)) return;
    if (first === last && ["Juices and Mixers", "Bubbly in patio cooler"].includes(first)) { section = first; return; }
    if (/^bottle inventory/i.test(first) || section === "Bubbly in patio cooler") return;
    const packSize = section === "Juices and Mixers" ? Math.max(1, Math.round(number(row[4]) || 1)) : 1;
    const individual = number(row[2]);
    const baseline = section === "Juices and Mixers" ? (individual || number(row[1]) * packSize) : number(row[1]);
    items.push({ id: slug(first), name: first, baseline, group: section, packSize });
  });
  return items;
}
function latestSnapshot(state) {
  return [...(Array.isArray(state?.snapshots) ? state.snapshots : [])]
    .sort((left, right) => new Date(right.savedAt || 0) - new Date(left.savedAt || 0))[0] || null;
}
async function buildInventoryCatalog(state) {
  let base = [];
  try {
    const csv = await readFile(path.join(process.cwd(), "public", "data", INVENTORY_FILE), "utf8");
    base = baseInventoryRows(parseCsv(csv));
  } catch {}
  const snapshotItems = Array.isArray(latestSnapshot(state)?.items) ? latestSnapshot(state).items : [];
  const customItems = Array.isArray(state?.current?.customItems) ? state.current.customItems : [];
  const byId = new Map();
  [...base, ...customItems, ...snapshotItems].forEach((item) => {
    const id = clean(item?.id) || slug(item?.name);
    const name = clean(item?.name);
    if (!id || !name) return;
    const existing = byId.get(id) || {};
    byId.set(id, {
      ...existing, ...item, id, name,
      baseline: Math.max(0, number(item?.onHandDisplay ?? item?.onHand ?? item?.baseline ?? existing.baseline)),
      bottleOz: Math.max(0, number(item?.vendorProduct?.bottleOz ?? existing.bottleOz)),
    });
  });
  return [...byId.values()];
}
function findCatalogItem(catalog, { id = "", name = "" } = {}) {
  const directId = clean(id);
  if (directId) {
    const direct = catalog.find((item) => item.id === directId);
    if (direct) return direct;
  }
  const key = identity(name);
  if (!key) return null;
  const exact = catalog.filter((item) => identity(item.name) === key);
  if (exact.length === 1) return exact[0];
  const aliases = { "svedka blue raspberry": "svedka", "jose cuervo silver": "jose cuervo" };
  const aliased = catalog.filter((item) => identity(item.name) === (aliases[key] || key));
  return aliased.length === 1 ? aliased[0] : null;
}
function packageUnits(ingredient, item) {
  const explicit = number(ingredient?.packageCount);
  if (explicit > 0) return explicit;
  const raw = clean(ingredient?.raw);
  const bottles = raw.match(/(\d+(?:\.\d+)?)\s*(?:\([^)]*\)\s*)?(?:bottles?|btls?)\b/i);
  if (bottles) return number(bottles[1]);
  const gallons = raw.match(/(\d+(?:\.\d+)?)\s*gallons?\b/i);
  if (gallons) return number(gallons[1]);
  const packageSizeOz = number(ingredient?.packageSizeOz) || number(item?.bottleOz);
  return packageSizeOz > 0 && number(ingredient?.oz) > 0 ? number(ingredient.oz) / packageSizeOz : 0;
}
async function loadRecipes() {
  const sourceRecipes = [];
  for (const filename of RECIPE_FILES) {
    try { sourceRecipes.push(...parseRecipes(parseCsv(await readFile(path.join(process.cwd(), "public", "data", filename), "utf8")))); } catch {}
  }
  let shared = {};
  try { shared = (await readSharedDashboardState())?.data?.recipes || {}; } catch {}
  const edits = shared?.editedRecipes && typeof shared.editedRecipes === "object" ? shared.editedRecipes : {};
  const recipes = sourceRecipes.map((recipe) => {
    const edit = normalizeSharedRecipe(edits[recipe.id]);
    return edit ? { ...recipe, ...edit, ingredients: edit.ingredients.length ? edit.ingredients : recipe.ingredients } : recipe;
  });
  (Array.isArray(shared?.customRecipes) ? shared.customRecipes : []).forEach((recipe) => {
    const normalized = normalizeSharedRecipe(recipe);
    if (normalized) recipes.push(normalized);
  });
  return recipes;
}
function findRecipe(recipes, target) {
  const keys = new Set([target?.name, target?.displayName].map(titleIdentity).filter(Boolean));
  const exact = recipes.filter((recipe) => keys.has(titleIdentity(recipe.title)));
  if (exact.length === 1) return exact[0];
  return recipes.find((recipe) => [...keys].some((key) => titleIdentity(recipe.title).startsWith(key) || key.startsWith(titleIdentity(recipe.title)))) || null;
}
async function applySources(sources, role) {
  const state = await mutateSharedInventoryState("apply-contributions", { sources }, role);
  return { appliedItemCount: sources.reduce((total, source) => total + source.contributions.length, 0), revision: state.revision };
}

export async function applyReceiptInventoryContributions(tracking, vendorId, role = "employee") {
  const inventoryState = await readSharedInventoryState();
  const catalog = await buildInventoryCatalog(inventoryState);
  const vendor = tracking?.vendors?.find((entry) => entry.id === vendorId);
  if (!vendor) return { appliedItemCount: 0, unmatched: [] };
  const byItem = new Map();
  const unmatched = [];
  (vendor.items || []).forEach((line) => {
    if (line.status === "pending") return;
    const item = findCatalogItem(catalog, { id: line.inventoryItemId, name: line.name });
    if (!item) { if (!/beer keg/i.test(line.lineType)) unmatched.push(line.name); return; }
    const quantity = Math.max(0, number(line.receivedQuantity)) * Math.max(1, number(line.inventoryUnitsPerReceiptUnit) || 1);
    const current = byItem.get(item.id) || { id: item.id, quantity: 0, baseline: item.baseline };
    current.quantity += quantity;
    byItem.set(item.id, current);
  });
  const result = await applySources([{
    sourceId: `delivery:${clean(tracking.generatedAt)}:${clean(vendorId)}`,
    reason: `${clean(vendor.vendor)} delivery`, contributions: [...byItem.values()],
  }], role);
  return { ...result, unmatched };
}

export async function applyPrepInventoryContributions({ target, generatedAt, completed, actualQuantity, role = "employee" } = {}) {
  const inventoryState = await readSharedInventoryState();
  const catalog = await buildInventoryCatalog(inventoryState);
  if (target?.kind === "liquor-refill") {
    const sourceId = `liquor-refill:${clean(generatedAt)}:${clean(target?.id)}`;
    const reason = `${clean(target?.displayName || target?.name)} added to keg`;
    if (!completed) {
      return { ...(await applySources([{ sourceId, reason, contributions: [] }], role)), unmatched: [] };
    }
    const item = findCatalogItem(catalog, {
      id: target?.inventoryItemId,
      name: target?.displayName || target?.name,
    });
    if (!item) return { appliedItemCount: 0, unmatched: [clean(target?.displayName || target?.name)] };
    const bottles = Math.max(1, number(actualQuantity ?? target?.actualQuantity ?? target?.quantity) || 1);
    const result = await applySources([{
      sourceId,
      reason,
      contributions: [{ id: item.id, quantity: -bottles, baseline: item.baseline }],
    }], role);
    return { ...result, unmatched: [] };
  }
  const sourceId = `cocktail-prep:${clean(generatedAt)}:${clean(target?.id)}`;
  if (!completed) return { ...(await applySources([{ sourceId, reason: `${clean(target?.displayName || target?.name)} prep`, contributions: [] }], role)), unmatched: [] };
  const recipe = findRecipe(await loadRecipes(), target);
  if (!recipe) return { appliedItemCount: 0, unmatched: [clean(target?.displayName || target?.name)] };
  const recipeYieldOz = recipe.ingredients.reduce((total, ingredient) => total + Math.max(0, number(ingredient.oz)), 0);
  const scale = recipeYieldOz > 0 && number(target?.batchSizeOz) > 0 ? number(target.batchSizeOz) / recipeYieldOz : 1;
  const batches = Math.max(1, number(target?.quantity) || 1);
  const byItem = new Map();
  recipe.ingredients.forEach((ingredient) => {
    const item = findCatalogItem(catalog, { name: ingredient.name });
    if (!item) return;
    const units = packageUnits(ingredient, item) * scale * batches;
    if (!(units > 0)) return;
    const current = byItem.get(item.id) || { id: item.id, quantity: 0, baseline: item.baseline };
    current.quantity -= units;
    byItem.set(item.id, current);
  });
  const result = await applySources([{
    sourceId, reason: `${clean(target?.displayName || target?.name)} completed`, contributions: [...byItem.values()],
  }], role);
  return { ...result, unmatched: byItem.size ? [] : [clean(target?.displayName || target?.name)] };
}
