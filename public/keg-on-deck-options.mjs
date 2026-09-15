export const STATIC_KEG_ON_DECK_RECIPE_IDS = Object.freeze([
  "bacardi-sunset",
  "whiskey-smash",
  "on-par-tee",
]);

const STATIC_KEG_ON_DECK_RECIPE_TITLES = Object.freeze({
  "bacardi-sunset": "Bacardi Sunset",
});

function clean(value) {
  return String(value ?? "").trim();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeProductIdentityName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\bnb\s+vd\s+rgr\b/g, "voodoo ranger")
    .replace(/\bregular\b/g, "")
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+[123]$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getSelectionId(selection) {
  if (typeof selection === "string") return clean(selection);
  return clean(selection?.id || selection?.comingSoonId);
}

function compareOptions(left, right) {
  return clean(left?.name).localeCompare(clean(right?.name), "en", {
    sensitivity: "base",
  }) || clean(left?.id).localeCompare(clean(right?.id), "en");
}

export function resolveKegOnDeckOption(options = [], selection = null) {
  const selectedId = getSelectionId(selection);
  if (!selectedId) return null;
  const exact = options.find((option) => clean(option?.id) === selectedId);
  if (exact) return exact;
  if (!selection || typeof selection !== "object") return null;
  const matches = options.filter((option) => isKegOnDeckProductInstalled(selection, option));
  return matches.length === 1 ? matches[0] : null;
}

export function normalizeKegOnDeckOverrides({
  overrides = {},
  comingSoonItems = [],
  recipes = [],
} = {}) {
  return Object.fromEntries(Object.entries(overrides || {}).flatMap(([key, saved]) => {
    if (!saved) return [];
    const option = resolveKegOnDeckOption(buildKegOnDeckOptions({
      comingSoonItems,
      recipes,
      selected: saved,
    }), saved);
    if (!option) return [[key, saved]];
    const existing = saved && typeof saved === "object" ? saved : {};
    return [[key, {
      ...existing,
      comingSoonId: option.id,
      name: option.name,
      kind: option.kind,
      plu: positiveNumber(option.plu),
      onHand: clean(existing.onHand),
      onHandUnit: clean(option.kind).toLowerCase() === "liquor" ? "oz" : "keg",
    }]];
  }));
}

export function isKegOnDeckProductInstalled(onDeckProduct, currentProduct) {
  if (!onDeckProduct || !currentProduct) return false;

  const onDeckPlu = positiveNumber(onDeckProduct.plu);
  const currentPlu = positiveNumber(currentProduct.plu);
  if (onDeckPlu && currentPlu && onDeckPlu !== currentPlu) return false;

  const queuedName = clean(onDeckProduct.name || onDeckProduct.brand || onDeckProduct.tapProduct);
  const installedName = clean(currentProduct.name || currentProduct.brand || currentProduct.tapProduct);
  const queuedWall = queuedName.match(/\s+([123])$/)?.[1];
  if (queuedWall && installedName.match(/\s+([123])$/)?.[1] !== queuedWall) return false;

  // A reused PLU alone does not prove that the queued product was connected.
  const currentName = normalizeProductIdentityName(installedName);
  return Boolean(currentName) && [queuedName, onDeckProduct.pmbProductName]
    .filter(Boolean)
    .some((name) => normalizeProductIdentityName(name) === currentName);
}

export function buildKegOnDeckOptions({
  comingSoonItems = [],
  recipes = [],
  selected = null,
  selectedId = "",
} = {}) {
  const resolvedSelectedId = clean(selectedId) || getSelectionId(selected);
  const optionsById = new Map();
  const recipesById = new Map(
    recipes
      .filter((recipe) => clean(recipe?.id))
      .map((recipe) => [clean(recipe.id), recipe]),
  );

  STATIC_KEG_ON_DECK_RECIPE_IDS.forEach((recipeId) => {
    // Legacy recipes are recovery options for existing selections, not a
    // second queue that keeps offering products already connected to taps.
    if (resolvedSelectedId !== `recipe:${recipeId}`) return;
    const recipe = recipesById.get(recipeId);
    const name = clean(recipe?.title) || clean(STATIC_KEG_ON_DECK_RECIPE_TITLES[recipeId]);
    if (!name) return;
    const option = {
      id: `recipe:${recipeId}`,
      recipeId,
      name,
      kind: "recipe",
      plu: 0,
    };
    optionsById.set(option.id, option);
  });

  comingSoonItems.forEach((item) => {
    const id = clean(item?.id);
    const isActive = !item?.replacedAt;
    if (!id || !clean(item?.name) || (!isActive && id !== resolvedSelectedId)) return;

    const existing = optionsById.get(id);
    optionsById.set(id, {
      ...existing,
      ...item,
      id,
      name: clean(item.name),
    });
  });

  if (resolvedSelectedId && !optionsById.has(resolvedSelectedId)
    && selected && typeof selected === "object" && clean(selected.name)) {
    const canonical = resolveKegOnDeckOption([...optionsById.values()], selected);
    if (!canonical) {
      optionsById.set(resolvedSelectedId, { ...selected, id: resolvedSelectedId, name: clean(selected.name) });
    }
  }

  return [...optionsById.values()].sort(compareOptions);
}

export function buildLinkedComingSoonItems({
  comingSoonItems = [],
  onDeckOverrides = {},
  recipes = [],
  currentProducts = [],
  taps = [],
} = {}) {
  const products = new Map(comingSoonItems
    .filter((item) => clean(item?.id) && clean(item?.name))
    .map((item) => [clean(item.id), { ...item }]));
  const waiting = new Map();
  const installed = new Set();

  for (const [tapKey, selected] of Object.entries(onDeckOverrides || {})) {
    const option = resolveKegOnDeckOption(buildKegOnDeckOptions({
      comingSoonItems: [...products.values()], recipes, selected,
    }), selected);
    if (!option) continue;
    if (!products.has(option.id)) products.set(option.id, { ...option });

    const tap = taps.find((item) => clean(item.key) === tapKey);
    const tapNumber = positiveNumber(tap?.tapNumber);
    const current = tapNumber
      ? currentProducts.find((item) => positiveNumber(item.tapNumber) === tapNumber)
      : null;
    if (current && isKegOnDeckProductInstalled(option, current)) {
      installed.add(option.id);
      continue;
    }
    const assignments = waiting.get(option.id) || [];
    assignments.push({ tapKey, tapNumber, wall: clean(tap?.wall) });
    waiting.set(option.id, assignments);
  }

  return [...products.values()].flatMap((item) => {
    const onDeckAssignments = waiting.get(item.id) || [];
    // A copy waiting on its assigned tap must remain visible even if the same
    // drink is already pouring elsewhere. This projection never alters history.
    if (onDeckAssignments.length) return [{ ...item, onDeckAssignments }];
    if (clean(item.replacedAt) || installed.has(item.id)
      || currentProducts.some((current) => isKegOnDeckProductInstalled(item, current))) return [];
    return [{ ...item, onDeckAssignments }];
  }).sort(compareOptions);
}
