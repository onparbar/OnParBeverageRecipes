const number = value => Math.max(0, Number(value) || 0);
const key = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function isInHousePrepIngredient(item = {}) {
  return [item.id, item.internalId, item.name].some(value => key(value) === "simple syrup");
}

export function buildInHouseIngredientPrep(items = []) {
  return items.filter(isInHousePrepIngredient).flatMap(item => {
    const hold = String(item.orderHoldReason || item.exclusionReason || "").trim();
    const required = number(item.cocktailPrepRequiredBottles);
    const onHand = number(item.onHand);
    const shortage = Object.hasOwn(item, "cocktailPrepRequiredBottles")
      ? Math.max(0, required - onHand)
      : number(item.orderUnits ?? item.quantity);
    if (!shortage && !hold && item.hasCurrentCount !== false) return [];
    // Simple Syrup inventory is counted in gallon containers (128 fl oz).
    const gallons = shortage * (number(item.bottleOz) || 128) / 128;
    return [{
      id: "simple-syrup", name: "Simple Syrup", quantity: gallons, unit: "gallons",
      requiredGallons: required * (number(item.bottleOz) || 128) / 128,
      onHandGallons: onHand * (number(item.bottleOz) || 128) / 128,
      holdReason: hold || (item.hasCurrentCount === false ? "Verify the Simple Syrup count to calculate how much to prep." : ""),
    }];
  });
}

// Old saved plans must follow the same prep-only rule as newly calculated plans.
export function moveInHouseOrdersToPrep(plan = {}) {
  const orders = Object.fromEntries(Object.entries(plan.orders || {}).map(([category, items]) => [
    category, Array.isArray(items) ? items.filter(item => !isInHousePrepIngredient(item)) : items,
  ]));
  const oldLines = Object.values(plan.orders || {}).flat().filter(isInHousePrepIngredient);
  const existing = plan.prep?.ingredients || [];
  const additions = buildInHouseIngredientPrep(oldLines).filter(item => !existing.some(saved => saved.id === item.id));
  return { ...plan, orders, prep: { ...plan.prep, ingredients: [...existing, ...additions] } };
}
