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
  return options.find((option) => clean(option?.id) === selectedId) || null;
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
  if (onDeckPlu && currentPlu && onDeckPlu === currentPlu) return true;

  const onDeckName = normalizeProductIdentityName(
    onDeckProduct.name || onDeckProduct.brand || onDeckProduct.tapProduct,
  );
  const currentName = normalizeProductIdentityName(
    currentProduct.name || currentProduct.brand || currentProduct.tapProduct,
  );
  return Boolean(onDeckName && currentName && onDeckName === currentName);
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

  return [...optionsById.values()].sort(compareOptions);
}
