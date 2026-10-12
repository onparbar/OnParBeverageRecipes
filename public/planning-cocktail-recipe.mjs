import { normalizeCocktailRecipeName, getCocktailRecipeSourceTitle } from "./cocktail-recipe-yields.mjs";

const key = value => normalizeCocktailRecipeName(String(value || "").replace(/\s+(?:main|karaoke|patio)(?: wall)?$/i, ""));

// A named flavor must win over the shared formula behind several menu recipes.
// Never select a sibling flavor merely because its sourceTitle is the same.
export function findPlanningCocktailRecipe(target, recipes = [], aliases = {}) {
  const names = [target?.name, target?.displayName, target?.recipeName].map(key).filter(Boolean);
  const unique = matches => matches.length === 1 ? matches[0] : null;
  if (target?.recipeId) {
    const explicit = recipes.filter(recipe => key(recipe.id) === key(target.recipeId));
    if (explicit.length) return specializeFamilyRecipe(unique(explicit), names);
  }
  const exact = recipes.filter(recipe => [recipe.title, recipe.name, recipe.id].some(name => name && names.includes(key(name))));
  if (exact.length) return specializeFamilyRecipe(unique(exact), names);
  const sourceNames = new Set(names);
  for (const [name, title] of Object.entries(aliases)) {
    if (names.includes(key(name))) sourceNames.add(key(title));
  }
  for (const name of [target?.name, target?.displayName, target?.recipeName]) {
    const source = getCocktailRecipeSourceTitle(name);
    if (source) sourceNames.add(key(source));
  }
  const canonical = recipes.filter(recipe => [recipe.title, recipe.name].some(name => name && sourceNames.has(key(name))));
  return specializeFamilyRecipe(unique(canonical), names);
}

function specializeFamilyRecipe(recipe, names) {
  if (!recipe) return null;
  const flavor = names.join(" ").match(/\b(blueberry|strawberry|raspberry|watermelon|peach) margarita\b/)?.[1];
  if (!flavor || key(recipe.title) !== "strawberry watermelon peach blueberry marg") return recipe;
  return {
    ...recipe,
    ingredients: (recipe.ingredients || []).map(ingredient => {
      if (!/flavored schnapps/i.test(ingredient.raw || "") && !/^(blueberry|strawberry|raspberry|watermelon|peach) schnapps$/i.test(ingredient.name || "")) return ingredient;
      const id = `${flavor}-schnapps`;
      return { ...ingredient, id, inventoryId: id, inventoryItemId: id, name: `${flavor[0].toUpperCase()}${flavor.slice(1)} Schnapps` };
    }),
  };
}
