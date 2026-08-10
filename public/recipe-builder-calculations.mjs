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

function normalizeRaw(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function roughlyEqual(left, right) {
  return Math.abs(toPositiveNumber(left) - toPositiveNumber(right)) < 0.011;
}

const KNOWN_RECIPE_FORMULA_REPAIRS = Object.freeze({
  "whiskey-smash": Object.freeze({
    lemonade: Object.freeze({
      legacy: Object.freeze([
        Object.freeze({ raw: "Lemonade = 2.5 gallons", oz: 270 }),
        Object.freeze({ raw: "Lemonade 2.11 gallons", oz: 270.08 }),
      ]),
      packageCount: "2.5",
      packageUnit: "gallons",
      packageSizeOz: GALLON_OZ,
    }),
    water: Object.freeze({
      legacy: Object.freeze([
        Object.freeze({ raw: "Water= 4.5 gallons", oz: 256 }),
        Object.freeze({ raw: "Water", oz: 256 }),
      ]),
      packageCount: "4.5",
      packageUnit: "gallons",
      packageSizeOz: GALLON_OZ,
    }),
  }),
  "on-par-tee": Object.freeze({
    "peach-schnapps": Object.freeze({
      legacy: Object.freeze([
        Object.freeze({ raw: "Peach Schnapps 7.99 bottles", oz: 270.14 }),
      ]),
      packageCount: "8",
      packageUnit: "bottles",
      packageSizeOz: 33.81,
    }),
    "sour-mix": Object.freeze({
      legacy: Object.freeze([
        Object.freeze({ raw: "Sour Mix= 2 bottles (128 oz)", oz: 128 }),
        Object.freeze({ raw: "Sour Mix 1 bottle", oz: 128 }),
        Object.freeze({ raw: "Sour Mix= 1 gallon", oz: 128 }),
        Object.freeze({ raw: "Sour Mix 1 gallon", oz: 128 }),
        Object.freeze({ raw: "Sour Mix", oz: 128 }),
      ]),
      packageCount: "2",
      packageUnit: "gallons",
      packageSizeOz: GALLON_OZ,
    }),
    lemonade: Object.freeze({
      legacy: Object.freeze([
        Object.freeze({ raw: "Lemonade= 2 gallons", oz: 256 }),
        Object.freeze({ raw: "Lemonade 2 gallons", oz: 256 }),
        Object.freeze({ raw: "Lemonade= 3 gallons", oz: 384 }),
        Object.freeze({ raw: "Lemonade 3 gallons", oz: 384 }),
      ]),
      packageCount: "2.5",
      packageUnit: "gallons",
      packageSizeOz: GALLON_OZ,
    }),
    water: Object.freeze({
      legacy: Object.freeze([
        Object.freeze({ raw: "Water= 2.5 gallons", oz: 320 }),
        Object.freeze({ raw: "Water", oz: 320 }),
      ]),
      packageCount: "1.5",
      packageUnit: "gallons",
      packageSizeOz: GALLON_OZ,
    }),
  }),
});

export function getRecipeBuilderPackageSizeOz({
  isGallon = false,
  overrideBottleOz = 0,
  mappedBottleOz = 0,
} = {}) {
  if (isGallon) return GALLON_OZ;
  return toPositiveNumber(overrideBottleOz) || toPositiveNumber(mappedBottleOz);
}

export function getRecipeBuilderPackageUnitHint(ingredient = {}) {
  const {
    raw = "",
    packageUnit = "",
  } = ingredient;
  const savedUnit = String(packageUnit || "").trim().toLowerCase();
  if (savedUnit.startsWith("gallon")) return "gallons";
  if (savedUnit.startsWith("bottle")) return "bottles";
  if (savedUnit === "ounces" || savedUnit === "oz") return "ounces";
  if (
    Object.prototype.hasOwnProperty.call(ingredient, "oz")
    && !toPositiveNumber(ingredient.oz)
  ) {
    return "ounces";
  }

  const rawText = String(raw || "");
  if (/\bgallons?\b/i.test(rawText)) return "gallons";
  if (/\b(?:bottles?|btls?)\b/i.test(rawText)) return "bottles";
  if (/\d+(?:\.\d+)?\s*(?:fl(?:uid)?\s*)?oz\b|\b(?:fl(?:uid)?\s*)?oz\b|\bounces?\b/i.test(rawText)) {
    return "ounces";
  }
  return "";
}

export function getRecipeBuilderPackageQuantity({
  packageCount = "",
  raw = "",
  oz = 0,
  packageSizeOz = 0,
  packageUnit = "",
} = {}) {
  const explicitCount = String(packageCount ?? "").trim();
  if (toPositiveNumber(explicitCount)) return explicitCount;

  const unit = String(packageUnit || "").toLowerCase();
  const rawText = String(raw || "");
  const rawMatch = unit.startsWith("gallon")
    ? rawText.match(/(\d+(?:\.\d+)?)\s*gallons?\b/i)
    : rawText.match(/(\d+(?:\.\d+)?)\s*(?:\([^)]*\)\s*)?(?:bottles?|btls?)\b/i);
  const rawCount = toPositiveNumber(rawMatch?.[1]);
  if (rawCount) return formatQuantity(rawCount);

  const ounces = toPositiveNumber(oz);
  const sizeOz = toPositiveNumber(packageSizeOz);
  return ounces && sizeOz ? formatQuantity(ounces / sizeOz) : "";
}

export function repairKnownRecipeFormulaEdits(
  recipeId,
  editedIngredients = [],
  sourceIngredients = [],
) {
  const repairs = KNOWN_RECIPE_FORMULA_REPAIRS[String(recipeId || "").trim()];
  if (!repairs) return { ingredients: editedIngredients, repaired: false };

  const sourceByName = new Map(
    sourceIngredients.map((ingredient) => [ingredientKey(ingredient?.name), ingredient]),
  );
  let repaired = false;

  const ingredients = editedIngredients.map((ingredient) => {
    const key = ingredientKey(ingredient?.name);
    const repair = repairs[key];
    const source = sourceByName.get(key);
    if (!repair || !source) return ingredient;

    const raw = normalizeRaw(ingredient?.raw);
    const isKnownLegacyValue = repair.legacy.some((signature) => (
      normalizeRaw(signature.raw) === raw
      && roughlyEqual(ingredient?.oz, signature.oz)
    ));
    if (!isKnownLegacyValue) return ingredient;

    repaired = true;
    return {
      ...ingredient,
      raw: source.raw || ingredient.raw,
      cost: ingredient.manualCost ? ingredient.cost : source.cost,
      oz: source.oz,
      packageCount: repair.packageCount,
      packageUnit: repair.packageUnit,
      packageSizeOz: repair.packageSizeOz,
    };
  });

  return { ingredients, repaired };
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
