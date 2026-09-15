import { getUncountedInventoryAmount } from "./inventory-count-policy.mjs";

// Validate setup, never interpret a missing inventory link as zero usage.
export function validateRecipeSetup(recipe, { inventory = [], normalize, mappingFor }) {
  const issues = [];
  const ingredients = (recipe.ingredients || []).map(ingredient => ({ ...ingredient }));
  if (!ingredients.length) issues.push("Add at least one ingredient.");
  for (const ingredient of ingredients) {
    const name = String(ingredient.name || "").trim();
    // Operating-assumption ingredients do not require stock or supplier setup.
    if (getUncountedInventoryAmount(ingredient) !== null) continue;
    const explicitId = ingredient.inventoryItemId || ingredient.inventoryId || ingredient.itemId;
    const matches = inventory.filter(item => explicitId
      ? item.id === explicitId
      : normalize(item.name) === normalize(name));
    if (matches.length === 1 && (matches[0].notCounted === true || getUncountedInventoryAmount(matches[0]) !== null)) {
      ingredient.inventoryItemId = matches[0].id;
      continue;
    }
    if (!Number.isFinite(Number(ingredient.oz)) || Number(ingredient.oz) <= 0) {
      issues.push(`${name}: enter a positive ounce quantity.`);
    }
    if (/^(water|ice)$/i.test(name)) continue;
    if (matches.length !== 1) {
      issues.push(`${name}: ${matches.length ? "choose one inventory item; several match" : "add or link its inventory item"}.`);
      continue;
    }
    const item = matches[0];
    ingredient.inventoryItemId = item.id;
    const mapping = mappingFor(ingredient, item);
    if (!(Number(ingredient.packageSizeOz || mapping?.bottleOz) > 0)) {
      issues.push(`${name}: confirm the package size used for inventory deductions.`);
    }
    if (!mapping?.vendor) issues.push(`${name}: select its supplier.`);
    if (!mapping?.orderingSystem) issues.push(`${name}: select its ordering system.`);
    if (mapping?.vendor !== "Bonbright" && !String(mapping?.orderingSku || mapping?.vendorSku || "").trim()) {
      issues.push(`${name}: confirm its supplier ordering code (not just its pricing match).`);
    }
  }
  return { ingredients, issues: [...new Set(issues)] };
}
