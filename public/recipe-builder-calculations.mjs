export const GALLON_OZ = 128;
export const LEGACY_GALLON_PACKAGE_OZ = 2304;

function toPositiveNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function ingredientKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatQuantity(value) {
  return String(Math.round(value * 100) / 100);
}

export function getRecipeBuilderPackageSizeOz({
  isGallon = false,
  overrideBottleOz = 0,
  mappedBottleOz = 0,
} = {}) {
  if (isGallon) return GALLON_OZ;
  return toPositiveNumber(overrideBottleOz) || toPositiveNumber(mappedBottleOz);
}

export function repairLegacyGallonRecipeIngredients(editedIngredients = [], sourceIngredients = []) {
  const sourceByName = new Map(
    sourceIngredients.map((ingredient) => [ingredientKey(ingredient?.name), ingredient]),
  );
  let repaired = false;

  const ingredients = editedIngredients.map((ingredient) => {
    const packageUnit = String(ingredient?.packageUnit || "").toLowerCase();
    const packageSizeOz = toPositiveNumber(ingredient?.packageSizeOz);
    if (!packageUnit.startsWith("gallon") || packageSizeOz !== LEGACY_GALLON_PACKAGE_OZ) {
      return ingredient;
    }

    const source = sourceByName.get(ingredientKey(ingredient?.name));
    const sourceOz = toPositiveNumber(source?.oz);
    if (!sourceOz) return ingredient;

    const packageCount = sourceOz / GALLON_OZ;
    repaired = true;
    return {
      ...ingredient,
      raw: source.raw || ingredient.raw,
      oz: sourceOz,
      packageCount: formatQuantity(packageCount),
      packageUnit: "gallons",
      packageSizeOz: GALLON_OZ,
    };
  });

  return { ingredients, repaired };
}
