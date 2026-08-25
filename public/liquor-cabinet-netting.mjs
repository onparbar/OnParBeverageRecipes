function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(value, { recipe = false } = {}) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(recipe ? /\([^)]*\)/g : /\((?:vodka|tequila|whiskey|bourbon|rum|gin|cognac)\)/g, " ")
    .replace(/\s+[123]$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLiquorInventoryItem(item) {
  return /liquor/i.test(clean(item?.group || item?.category || item?.sourceSection));
}

function findInventoryItem(ingredient, inventoryItems) {
  const ingredientKey = key(ingredient?.inventoryId || ingredient?.name);
  if (!ingredientKey) return null;
  return inventoryItems.find((item) => (
    isLiquorInventoryItem(item)
    && [item?.id, item?.name, item?.linkedIngredientName, item?.vendorProduct?.productName]
      .some((value) => key(value) === ingredientKey)
  )) || null;
}

function findRecipe(recommendation, recipes) {
  const recipeId = clean(
    recommendation?.onDeckProduct?.comingSoonId
    || recommendation?.recipeId,
  ).replace(/^recipe:/, "");
  if (recipeId) {
    const exact = recipes.find((recipe) => key(recipe?.id) === key(recipeId));
    if (exact) return exact;
  }
  const nameKey = key(recommendation?.orderProductName || recommendation?.name, { recipe: true });
  const exact = recipes.find((recipe) => key(recipe?.title || recipe?.name, { recipe: true }) === nameKey);
  if (exact) return exact;
  if (/^(?:strawberry|watermelon|peach|blueberry) margarita$/.test(nameKey)) {
    return recipes.find((recipe) => /strawberry watermelon peach blueberry marg/.test(
      key(recipe?.title || recipe?.name, { recipe: true }),
    )) || null;
  }
  return null;
}

function getProjectedCocktailOz({ recommendations, inventoryItems, recipes }) {
  const projectedOzById = new Map();
  let unresolvedCocktail = false;

  recommendations
    .filter((item) => item?.actionType === "make" && number(item?.orderQty) > 0)
    .forEach((cocktail) => {
      const recipe = findRecipe(cocktail, recipes);
      if (!recipe) {
        unresolvedCocktail = true;
        return;
      }
      const batches = Math.max(0, Math.floor(number(cocktail.orderQty)));
      (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).forEach((ingredient) => {
        const ingredientOz = number(ingredient?.oz);
        const inventoryItem = ingredientOz > 0 ? findInventoryItem(ingredient, inventoryItems) : null;
        if (!inventoryItem) return;
        const id = clean(inventoryItem.id);
        projectedOzById.set(id, (projectedOzById.get(id) || 0) + (ingredientOz * batches));
      });
    });

  return unresolvedCocktail ? null : projectedOzById;
}

export function getLiquorCabinetWeeklyBottleNeeds({
  recommendations = [],
  inventoryItems = [],
  recipes = [],
} = {}) {
  const sourceInventory = Array.isArray(inventoryItems) ? inventoryItems : [];
  const projectedOzById = getProjectedCocktailOz({
    recommendations: Array.isArray(recommendations) ? recommendations : [],
    inventoryItems: sourceInventory,
    recipes: Array.isArray(recipes) ? recipes : [],
  });
  if (!projectedOzById) return null;

  const needs = new Map();
  for (const item of sourceInventory.filter(isLiquorInventoryItem)) {
    const id = clean(item.id);
    const projectedOz = projectedOzById.get(id) || 0;
    const bottleOz = number(item?.bottleOz || item?.vendorProduct?.bottleOz);
    if (projectedOz > 0 && !(bottleOz > 0)) return null;
    needs.set(id, {
      item,
      projectedOz,
      requiredBottles: projectedOz > 0 ? Math.ceil(projectedOz / bottleOz) : 0,
    });
  }
  return needs;
}

export function getLiquorCabinetOrderQuantity({
  parOrderQty = 0,
  onHand = 0,
  requiredBottles = 0,
} = {}) {
  const cabinetParShortage = Math.max(0, Math.floor(number(parOrderQty)));
  const cocktailShortage = Math.max(
    0,
    Math.ceil(number(requiredBottles)) - Math.floor(number(onHand)),
  );
  return Math.max(cabinetParShortage, cocktailShortage);
}

function getCabinetAvailability({ recommendations, inventoryItems, recipes }) {
  const weeklyNeeds = getLiquorCabinetWeeklyBottleNeeds({ recommendations, inventoryItems, recipes });
  if (!weeklyNeeds) return new Map();

  const availability = new Map();
  inventoryItems.filter(isLiquorInventoryItem).forEach((item) => {
    const rawOnHand = item?.onHandDisplay ?? item?.onHand;
    if (clean(rawOnHand) === "") return;
    const reservedBottles = weeklyNeeds.get(clean(item.id))?.requiredBottles || 0;
    const availableBottles = Math.max(0, Math.floor(number(rawOnHand)) - reservedBottles);
    [item.id, item.name, item.linkedIngredientName, item.vendorProduct?.productName].forEach((value) => {
      const identity = key(value);
      if (identity) availability.set(identity, { item, availableBottles, reservedBottles });
    });
  });
  return availability;
}

export function netLiquorTapRecommendations({
  recommendations = [],
  inventoryItems = [],
  recipes = [],
} = {}) {
  const source = Array.isArray(recommendations) ? recommendations : [];
  const availability = getCabinetAvailability({
    recommendations: source,
    inventoryItems: Array.isArray(inventoryItems) ? inventoryItems : [],
    recipes: Array.isArray(recipes) ? recipes : [],
  });
  const remainingByItemId = new Map();

  return source.map((recommendation) => {
    if (!recommendation?.isLiquorTap || recommendation.actionType !== "order" || number(recommendation.orderQty) <= 0) {
      return recommendation;
    }
    const identity = key(recommendation.orderProductName || recommendation.name);
    const match = availability.get(identity);
    if (!match) return recommendation;

    const itemId = clean(match.item.id);
    const remaining = remainingByItemId.has(itemId)
      ? remainingByItemId.get(itemId)
      : match.availableBottles;
    const requested = Math.max(0, Math.floor(number(recommendation.orderQty)));
    const cabinetUsedQty = Math.min(requested, remaining);
    const orderQty = requested - cabinetUsedQty;
    remainingByItemId.set(itemId, remaining - cabinetUsedQty);

    return {
      ...recommendation,
      orderQty,
      suggestedBottleOrderQty: orderQty,
      actionType: orderQty > 0 ? "order" : "none",
      cabinetUsedQty,
      cabinetReservedForCocktails: match.reservedBottles,
      cabinetInventoryId: itemId,
      reason: cabinetUsedQty > 0
        ? `${clean(recommendation.reason)} ${cabinetUsedQty} cabinet bottle${cabinetUsedQty === 1 ? "" : "s"} cover the refill after reserving this week's cocktail ingredients.`.trim()
        : recommendation.reason,
    };
  });
}
