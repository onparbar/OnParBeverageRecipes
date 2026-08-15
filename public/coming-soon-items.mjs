export const REQUIRED_COMING_SOON_ITEMS = Object.freeze([
  Object.freeze({
    id: "recipe:bacardi-sunset",
    kind: "recipe",
    recipeId: "bacardi-sunset",
    name: "Bacardi Sunset",
  }),
  Object.freeze({
    id: "recipe:on-par-tee",
    kind: "recipe",
    recipeId: "on-par-tee",
    name: "On Par Tee (Crown Royal) 1",
  }),
  Object.freeze({
    id: "recipe:whiskey-smash",
    kind: "recipe",
    recipeId: "whiskey-smash",
    name: "Whiskey Smash (Jim Beam) 1",
  }),
  Object.freeze({
    id: "liquor:woodford-reserve",
    kind: "liquor",
    name: "Woodford Reserve",
    untappdQuery: "Woodford Reserve Bourbon",
  }),
  Object.freeze({
    id: "liquor:captain-morgan",
    kind: "liquor",
    name: "Captain Morgan",
    untappdQuery: "Captain Morgan Original Spiced Rum",
  }),
]);

function clean(value) {
  return String(value ?? "").trim();
}

export function getComingSoonKindLabel(kind, { compact = false } = {}) {
  const normalized = clean(kind).toLowerCase();
  if (normalized === "beer") return compact ? "beer" : "Beer keg";
  if (normalized === "liquor") return compact ? "liquor" : "Liquor tap";
  return compact ? "cocktail" : "Cocktail recipe";
}

export function mergeRequiredComingSoonItems(items = []) {
  const safeItems = Array.isArray(items)
    ? items.filter((item) => item && typeof item === "object" && clean(item.id) && clean(item.name))
    : [];
  const byId = new Map(safeItems.map((item) => [clean(item.id), { ...item }]));

  REQUIRED_COMING_SOON_ITEMS.forEach((required) => {
    const existing = byId.get(required.id);
    byId.set(required.id, existing
      ? {
          ...required,
          ...existing,
          id: required.id,
          name: required.name,
          untappdQuery: required.untappdQuery || existing.untappdQuery,
        }
      : { ...required });
  });

  return [...byId.values()];
}
