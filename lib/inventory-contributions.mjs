import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSharedDashboardState } from "./shared-dashboard-store.mjs";
import { mutateSharedInventoryState, readSharedInventoryState } from "./inventory-shared-store.mjs";

const RECIPE_FILES = ["cocktail-recipes.csv", "new-cocktails.csv"];
const INVENTORY_FILE = "inventory-2026-06-01.csv";

export class InventoryContributionError extends Error {
  constructor(code, message, status = 409, details = {}) {
    super(message);
    this.name = "InventoryContributionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

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
    .replace(/\broyal apple\b/g, "crown apple").replace(/\bjack daniels fire\b/g, "jack fire")
    .replace(/\bvanilia\b/g, "vanilla").replace(/\bvanilla syrup\b/g, "vanilla")
    .replace(/\brasberri\b/g, "raspberry");
}
function titleIdentity(value) {
  return identity(String(value || "").replace(/\([^)]*\)/g, " ").replace(/\s+[123]\s*$/, ""));
}
function packageSizeMl(value, bottleOz = 0) {
  const match = clean(value).match(/\b(\d+(?:\.\d+)?)\s*(ml|l|liters?|oz)\b/i);
  if (match) {
    const amount = number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit === "ml") return Math.round(amount);
    if (unit === "l" || unit.startsWith("liter")) return Math.round(amount * 1000);
    if (unit === "oz") return Math.round(amount * 29.5735);
  }
  return bottleOz > 0 ? Math.round(number(bottleOz) * 29.5735) : 0;
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

const RECIPE_SUMMARY_ROW = /^(?:total(?:\s|$)|price we(?:'|’)re charging|profit per oz|profit margin|cost for\b.*\bliquor\b|how many oz per shot|ounces per keg|cost per ounce|percentage(?:\s|$)|pure alcohol oz|batch abv|oz pour|charge per pour)/i;

export function isInventoryRecipeIngredient(ingredient) {
  const label = clean(ingredient?.raw || ingredient?.name || ingredient)
    .replace(/\s*=\s*.*$/, "")
    .trim();
  return Boolean(label) && !RECIPE_SUMMARY_ROW.test(label);
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
      const ingredient = { name: getIngredientName(raw, title), raw, oz: Math.max(0, number(row[start + 2])) };
      return isInventoryRecipeIngredient(ingredient) ? ingredient : null;
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
    })).filter((ingredient) => ingredient.name && isInventoryRecipeIngredient(ingredient)) : [],
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
export function findCatalogItem(catalog, { id = "", name = "", raw = "" } = {}) {
  const directId = clean(id);
  if (directId) {
    const direct = catalog.find((item) => item.id === directId);
    if (direct) return direct;
  }
  const key = identity(name);
  if (!key) return null;
  const exact = catalog.filter((item) => identity(item.name) === key);
  if (exact.length === 1) return exact[0];
  const requestedPackageSize = packageSizeMl(raw);
  const sized = requestedPackageSize > 0
    ? exact.filter((item) => packageSizeMl(item.name, item.bottleOz) === requestedPackageSize)
    : [];
  if (sized.length === 1) return sized[0];
  const canonical = exact.filter((item) => item.id === slug(name));
  if (canonical.length === 1) return canonical[0];
  const aliases = { "svedka blue raspberry": "svedka", "jose cuervo silver": "jose cuervo" };
  const alias = aliases[key] || key;
  const aliased = catalog.filter((item) => identity(item.name) === alias);
  if (aliased.length === 1) return aliased[0];
  const canonicalAlias = aliased.filter((item) => [slug(name), slug(alias)].includes(item.id));
  return canonicalAlias.length === 1 ? canonicalAlias[0] : null;
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

export function buildRecipeInventoryContributions(recipe, catalog, target = {}) {
  const inventoryIngredients = (Array.isArray(recipe?.ingredients) ? recipe.ingredients : [])
    .filter(isInventoryRecipeIngredient);
  const recipeYieldOz = inventoryIngredients.reduce((total, ingredient) => total + Math.max(0, number(ingredient.oz)), 0);
  const scale = recipeYieldOz > 0 && number(target?.batchSizeOz) > 0 ? number(target.batchSizeOz) / recipeYieldOz : 1;
  const batches = Math.max(1, number(target?.quantity) || 1);
  const byItem = new Map();

  inventoryIngredients.forEach((ingredient) => {
    if (!clean(ingredient?.name) || /^(?:ice|water)$/i.test(clean(ingredient.name))) return;
    const item = findCatalogItem(catalog, {
      id: ingredient.inventoryItemId || ingredient.inventoryId || ingredient.itemId,
      name: ingredient.name,
      raw: ingredient.raw,
    });
    if (!item) return;
    const units = packageUnits(ingredient, item) * scale * batches;
    if (!(units > 0)) return;
    const current = byItem.get(item.id) || { id: item.id, quantity: 0, baseline: item.baseline };
    current.quantity -= units;
    byItem.set(item.id, current);
  });

  return [...byItem.values()];
}
async function loadRecipes() {
  const sourceRecipes = [];
  for (const filename of RECIPE_FILES) {
    try { sourceRecipes.push(...parseRecipes(parseCsv(await readFile(path.join(process.cwd(), "public", "data", filename), "utf8")))); } catch {}
  }
  let shared = {};
  try { shared = (await readSharedDashboardState())?.data?.recipes || {}; } catch {}
  const inactiveRecipeIds = new Set(
    (Array.isArray(shared?.inactiveRecipeIds) ? shared.inactiveRecipeIds : []).map(clean).filter(Boolean),
  );
  const edits = shared?.editedRecipes && typeof shared.editedRecipes === "object" ? shared.editedRecipes : {};
  const recipes = sourceRecipes.map((recipe) => {
    const edit = normalizeSharedRecipe(edits[recipe.id]);
    return edit ? { ...recipe, ...edit, ingredients: edit.ingredients.length ? edit.ingredients : recipe.ingredients } : recipe;
  });
  (Array.isArray(shared?.customRecipes) ? shared.customRecipes : []).forEach((recipe) => {
    const normalized = normalizeSharedRecipe(recipe);
    if (normalized) recipes.push(normalized);
  });
  return recipes.map((recipe) => ({
    ...recipe,
    inactive: recipe?.inactive === true || inactiveRecipeIds.has(recipe.id),
  }));
}
function flavoredMargaritaFlavor(target) {
  const title = clean([target?.name, target?.displayName].filter(Boolean).join(" "));
  if (!/\b(?:margarita|marg)\b/i.test(title)) return "";
  return title.match(/\b(blueberry|strawberry|raspberry|watermelon|peach)\b/i)?.[1]?.toLowerCase() || "";
}

function isFlavoredMargaritaFamilyRecipe(recipe) {
  return /\bstrawberry watermelon peach blueberry marg\b/.test(titleIdentity(recipe?.title));
}

function specializeRecipeForTarget(recipe, target) {
  const flavor = flavoredMargaritaFlavor(target);
  if (!recipe || !flavor || !isFlavoredMargaritaFamilyRecipe(recipe)) return recipe;
  const flavorName = `${flavor[0].toUpperCase()}${flavor.slice(1)} Schnapps`;
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => {
      const isFlavorIngredient = /flavored schnapps/i.test(clean(ingredient?.raw))
        || /^(?:blueberry|strawberry|raspberry|watermelon|peach) schnapps$/i.test(clean(ingredient?.name));
      return isFlavorIngredient ? { ...ingredient, name: flavorName } : ingredient;
    }),
  };
}

function findRecipe(recipes, target) {
  const keys = new Set([target?.name, target?.displayName].map(titleIdentity).filter(Boolean));
  const exact = recipes.filter((recipe) => keys.has(titleIdentity(recipe.title)));
  if (exact.length === 1) return specializeRecipeForTarget(exact[0], target);
  const partial = recipes.find((recipe) => [...keys].some((key) => (
    titleIdentity(recipe.title).startsWith(key) || key.startsWith(titleIdentity(recipe.title))
  )));
  if (partial) return specializeRecipeForTarget(partial, target);
  if (flavoredMargaritaFlavor(target)) {
    const family = recipes.filter(isFlavoredMargaritaFamilyRecipe);
    if (family.length === 1) return specializeRecipeForTarget(family[0], target);
  }
  return null;
}

function inventoryIdentityCandidates(item = {}) {
  return new Set([
    item?.inventoryItemId,
    item?.inventoryId,
    item?.itemId,
    item?.name,
    item?.displayName,
  ].flatMap((value) => [identity(value), titleIdentity(value)]).filter(Boolean));
}

function activeRecipeUsesLiquor(recipes, target) {
  const targetKeys = inventoryIdentityCandidates(target);
  if (!targetKeys.size) return false;
  return (Array.isArray(recipes) ? recipes : []).some((recipe) => (
    recipe?.inactive !== true
      && (Array.isArray(recipe?.ingredients) ? recipe.ingredients : [])
        .filter(isInventoryRecipeIngredient)
        .some((ingredient) => {
          const ingredientKeys = inventoryIdentityCandidates(ingredient);
          return [...ingredientKeys].some((key) => targetKeys.has(key));
        })
  ));
}

export function classifyLiquorInventoryPolicy({ catalog = [], recipes = [], target = {} } = {}) {
  const item = findCatalogItem(catalog, {
    id: target?.inventoryItemId,
    name: target?.displayName || target?.name,
  });
  if (item) return { policy: "cabinet-backed", item, usedByActiveRecipe: true };
  const usedByActiveRecipe = activeRecipeUsesLiquor(recipes, target);
  return {
    policy: usedByActiveRecipe ? "cabinet-review" : "direct-to-keg",
    item: null,
    usedByActiveRecipe,
  };
}

async function applySources(sources, role) {
  const state = await mutateSharedInventoryState("apply-contributions", { sources }, role);
  return { appliedItemCount: sources.reduce((total, source) => total + source.contributions.length, 0), revision: state.revision };
}

function unmatchedEntry(item, reason = "Inventory identity is not mapped.") {
  return {
    id: clean(item?.id || item?.itemId),
    name: clean(item?.displayName || item?.name) || "Unknown product",
    reason: clean(reason),
  };
}

function normalizePlan(plan = {}) {
  return {
    sources: Array.isArray(plan.sources) ? plan.sources : [],
    unmatched: Array.isArray(plan.unmatched) ? plan.unmatched.map((entry) => (
      typeof entry === "string" ? unmatchedEntry({ name: entry }) : unmatchedEntry(entry, entry?.reason)
    )) : [],
  };
}

export function assertInventoryContributionPlan(plan) {
  const normalized = normalizePlan(plan);
  if (!normalized.unmatched.length) return normalized;
  const names = [...new Set(normalized.unmatched.map((entry) => entry.name).filter(Boolean))];
  throw new InventoryContributionError(
    "INVENTORY_IDENTITY_REVIEW_REQUIRED",
    `Review the inventory match for: ${names.join(", ")}.`,
    409,
    { unmatched: normalized.unmatched },
  );
}

export async function applyInventoryContributionPlan(plan, role = "employee") {
  const normalized = assertInventoryContributionPlan(plan);
  if (!normalized.sources.length) return { appliedItemCount: 0, revision: null, unmatched: [] };
  return { ...(await applySources(normalized.sources, role)), unmatched: [] };
}

export async function planReceiptInventoryContributions(tracking, vendorId) {
  const inventoryState = await readSharedInventoryState();
  const catalog = await buildInventoryCatalog(inventoryState);
  const vendor = tracking?.vendors?.find((entry) => entry.id === vendorId);
  if (!vendor) {
    return normalizePlan({
      sources: [],
      unmatched: [unmatchedEntry({ id: vendorId, name: "Vendor delivery" }, "The vendor delivery could not be identified.")],
    });
  }
  const byItem = new Map();
  const unmatched = [];
  for (const line of vendor.items || []) {
    if (line.status === "pending") continue;
    const quantity = Math.max(0, number(line.receivedQuantity)) * Math.max(1, number(line.inventoryUnitsPerReceiptUnit) || 1);
    if (!(quantity > 0)) continue;
    const item = findCatalogItem(catalog, { id: line.inventoryItemId, name: line.name });
    if (!item) {
      if (/beer keg/i.test(line.lineType)) continue;
      if (clean(line.lineType).toLowerCase() === "liquor tap bottle") continue;
      unmatched.push(unmatchedEntry(line));
      continue;
    }
    const current = byItem.get(item.id) || { id: item.id, quantity: 0, baseline: item.baseline };
    current.quantity += quantity;
    byItem.set(item.id, current);
  }
  return normalizePlan({
    sources: [{
      sourceId: `delivery:${clean(tracking.generatedAt)}:${clean(vendorId)}`,
      reason: `${clean(vendor.vendor)} delivery`,
      contributions: [...byItem.values()],
    }],
    unmatched,
  });
}

export async function applyReceiptInventoryContributions(tracking, vendorId, role = "employee") {
  return applyInventoryContributionPlan(await planReceiptInventoryContributions(tracking, vendorId), role);
}

export async function planPrepInventoryContributions({ target, generatedAt, completed, actualQuantity } = {}) {
  const inventoryState = await readSharedInventoryState();
  const catalog = await buildInventoryCatalog(inventoryState);
  if (target?.kind === "liquor-refill") {
    const sourceId = `liquor-refill:${clean(generatedAt)}:${clean(target?.id)}`;
    const reason = `${clean(target?.displayName || target?.name)} added to keg`;
    if (!completed) {
      return normalizePlan({ sources: [{ sourceId, reason, contributions: [] }], unmatched: [] });
    }
    const directItem = findCatalogItem(catalog, {
      id: target?.inventoryItemId,
      name: target?.displayName || target?.name,
    });
    const classification = directItem
      ? { policy: "cabinet-backed", item: directItem }
      : classifyLiquorInventoryPolicy({ catalog, recipes: await loadRecipes(), target });
    if (!classification.item) {
      if (classification.policy === "cabinet-review") {
        return normalizePlan({
          sources: [],
          unmatched: [unmatchedEntry(
            target,
            "This liquor is used by an active cocktail but is not mapped to cabinet inventory.",
          )],
        });
      }
      return normalizePlan({ sources: [], unmatched: [] });
    }
    const item = classification.item;
    const bottles = Math.max(1, number(actualQuantity ?? target?.actualQuantity ?? target?.quantity) || 1);
    return normalizePlan({
      sources: [{
        sourceId,
        reason,
        contributions: [{ id: item.id, quantity: -bottles, baseline: item.baseline }],
      }],
      unmatched: [],
    });
  }
  const sourceId = `cocktail-prep:${clean(generatedAt)}:${clean(target?.id)}`;
  const reason = `${clean(target?.displayName || target?.name)} prep`;
  if (!completed) return normalizePlan({ sources: [{ sourceId, reason, contributions: [] }], unmatched: [] });
  const recipe = findRecipe(await loadRecipes(), target);
  if (!recipe) return normalizePlan({ sources: [], unmatched: [unmatchedEntry(target, "The cocktail recipe could not be identified.")] });
  return normalizePlan({
    sources: [{
      sourceId,
      reason: `${clean(target?.displayName || target?.name)} completed`,
      contributions: buildRecipeInventoryContributions(recipe, catalog, target),
    }],
    unmatched: [],
  });
}

export async function applyPrepInventoryContributions(options = {}) {
  return applyInventoryContributionPlan(await planPrepInventoryContributions(options), options.role || "employee");
}
