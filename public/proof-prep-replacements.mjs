function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function key(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+[123]$/, "")
    .replace(/\s+(?:main|karaoke|patio)(?: wall)?$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRecipe(cocktail, recipes) {
  const cocktailKey = key(cocktail?.recipeName || cocktail?.name);
  if (!cocktailKey) return null;
  return recipes.find((recipe) => (
    key(recipe?.id) === key(cocktail?.recipeId)
    || key(recipe?.title || recipe?.name) === cocktailKey
  )) || null;
}

function getProofInventoryItem(ingredient, inventoryItems) {
  const ingredientKey = key(ingredient?.inventoryId || ingredient?.name);
  if (!ingredientKey) return null;
  return inventoryItems.find((item) => {
    const vendor = clean(item?.vendor || item?.vendorProduct?.vendor || item?.vendorProduct?.syncVendor);
    if (vendor.toLowerCase() !== "proof") return false;
    return [item?.id, item?.name, item?.vendorProduct?.productName].some((value) => key(value) === ingredientKey);
  }) || null;
}

function getProjectedProofUsage({
  cocktails = [],
  recipes = [],
  inventoryItems = [],
} = {}) {
  const projectedOzById = new Map();
  let unresolvedRecipe = false;
  (Array.isArray(cocktails) ? cocktails : []).forEach((cocktail) => {
    const batches = Math.max(0, Math.floor(number(cocktail?.quantity)));
    const recipe = batches ? getRecipe(cocktail, Array.isArray(recipes) ? recipes : []) : null;
    if (batches && !recipe) unresolvedRecipe = true;
    if (!recipe) return;
    (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).forEach((ingredient) => {
      const ingredientOz = number(ingredient?.oz);
      const item = ingredientOz > 0
        ? getProofInventoryItem(ingredient, Array.isArray(inventoryItems) ? inventoryItems : [])
        : null;
      if (!item) return;
      const id = clean(item.id);
      if (!id) return;
      projectedOzById.set(id, {
        item,
        projectedOz: (projectedOzById.get(id)?.projectedOz || 0) + (ingredientOz * batches),
      });
    });
  });

  return { projectedOzById, unresolvedRecipe };
}

export function buildProofPrepOrderContext(options = {}) {
  const { projectedOzById, unresolvedRecipe } = getProjectedProofUsage(options);
  let unresolvedInventory = false;
  let replacementRequired = false;

  const candidates = [...projectedOzById.values()].flatMap(({ item, projectedOz }) => {
    const bottleOz = number(item?.bottleOz || item?.vendorProduct?.bottleOz);
    const packSize = Math.max(1, Math.floor(number(item?.packSize) || 1));
    const unitCost = number(item?.unitCost) || (number(item?.caseCost) / packSize);
    const vendorSku = clean(item?.vendorSku || item?.matchedSku || item?.vendorProduct?.preferredSku);
    const projectedPrepUseUnits = bottleOz > 0 ? Math.ceil(projectedOz / bottleOz) : 0;
    const rawOnHand = item?.onHandDisplay ?? item?.onHand;
    const rawPar = item?.parDisplay ?? item?.par;
    if (!(projectedPrepUseUnits > 0) || clean(rawOnHand) === "" || clean(rawPar) === "") {
      unresolvedInventory = true;
      return [];
    }
    const replacementNeedUnits = Math.max(0, Math.ceil(number(rawPar) + projectedPrepUseUnits - number(rawOnHand)));
    if (!(replacementNeedUnits > 0)) return [];
    replacementRequired = true;
    if (!item?.casePackaged || !vendorSku || !(unitCost > 0)) return [];
    return [{
      id: clean(item.id),
      name: clean(item.name),
      vendor: "Proof",
      vendorSku,
      vendorProductName: clean(item?.vendorProduct?.productName || item.name),
      casePackaged: true,
      shelfStable: true,
      packSize,
      projectedPrepUseUnits,
      projectedPrepUseOz: projectedOz,
      onHandUnits: number(rawOnHand),
      parUnits: number(rawPar),
      replacementNeedUnits,
      unitCost,
    }];
  });

  return {
    candidates,
    requirement: replacementRequired
      ? "required"
      : unresolvedRecipe || unresolvedInventory ? "unknown" : "not-required",
  };
}

export function buildProofPrepReplacementCandidates(options = {}) {
  return buildProofPrepOrderContext(options).candidates;
}
