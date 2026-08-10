export const STATIC_KEG_ON_DECK_RECIPE_IDS = Object.freeze([
  "whiskey-smash",
  "on-par-tee",
]);

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
    if (!recipe || !clean(recipe.title)) return;
    const option = {
      id: `recipe:${recipeId}`,
      recipeId,
      name: clean(recipe.title),
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
