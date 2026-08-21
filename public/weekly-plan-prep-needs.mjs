function finitePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function defaultNormalizeIngredientName(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function calculateWeeklyIngredientPrepNeed({
  plannedItems = [],
  ingredientName,
  resolveRecipe = () => null,
  getRecipeYieldOz = () => 0,
  normalizeIngredientName = defaultNormalizeIngredientName,
  ouncesPerGallon = 128,
} = {}) {
  const normalizedTarget = normalizeIngredientName(ingredientName).toLowerCase();
  const safeOuncesPerGallon = finitePositiveNumber(ouncesPerGallon) || 128;
  let totalOz = 0;
  const unmatched = [];

  (Array.isArray(plannedItems) ? plannedItems : []).forEach((item) => {
    const quantity = finitePositiveNumber(item?.quantity);
    if (!quantity) return;

    const recipe = resolveRecipe(item);
    if (!recipe) {
      unmatched.push(String(item?.name || "Unknown item"));
      return;
    }

    const ingredientOzPerRecipe = (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
      .filter((ingredient) => (
        normalizeIngredientName(ingredient?.name).toLowerCase() === normalizedTarget
      ))
      .reduce((total, ingredient) => total + finitePositiveNumber(ingredient?.oz), 0);
    if (!ingredientOzPerRecipe) return;

    const recipeYieldOz = finitePositiveNumber(getRecipeYieldOz(recipe));
    const plannedBatchOz = finitePositiveNumber(item?.batchSizeOz);
    if (!recipeYieldOz || !plannedBatchOz) {
      unmatched.push(String(item?.name || "Unknown item"));
      return;
    }

    totalOz += ingredientOzPerRecipe * (plannedBatchOz / recipeYieldOz) * quantity;
  });

  return {
    ingredientName: String(ingredientName ?? "").trim(),
    totalOz,
    gallons: totalOz / safeOuncesPerGallon,
    unmatched,
    complete: unmatched.length === 0,
  };
}
