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

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function getQueuedComingSoonProduct(item) {
  const payload = item?.payload && typeof item.payload === "object" ? item.payload : {};
  const name = clean(item?.name || payload.name);
  const kind = clean(item?.kind).toLowerCase();
  if (!["beer", "liquor"].includes(kind) || !name || item?.status === "published") return null;
  return {
    id: `${kind}:${slug(name)}`,
    kind,
    name,
    description: clean(payload.description || payload.notes),
    imageUrl: clean(payload.imageUrl),
    brewery: clean(payload.brewery),
    style: clean(payload.style),
    abvPercent: Number(payload.abvPercent) || 0,
    kegCost: Number(payload.kegCost) || 0,
    kegOz: Number(payload.kegOz) || 0,
    bottleCost: Number(payload.bottleCost) || 0,
    bottleOz: Number(payload.bottleOz) || 0,
    pricePerOz: Number(payload.pricePerOz) || 0,
    targetMargin: Number(payload.targetMargin) || 0,
    untappdId: Number(payload.untappdId) || 0,
    createdAt: clean(item.createdAt || item.updatedAt),
    source: "PMB publishing queue",
  };
}

export function getComingSoonKindLabel(kind, { compact = false } = {}) {
  const normalized = clean(kind).toLowerCase();
  if (normalized === "beer") return compact ? "beer" : "Beer keg";
  if (normalized === "liquor") return compact ? "liquor" : "Liquor tap";
  return compact ? "cocktail" : "Cocktail recipe";
}

export function mergeRequiredComingSoonItems(items = [], pmbPublishQueue = []) {
  const safeItems = Array.isArray(items)
    ? items.filter((item) => item && typeof item === "object" && clean(item.id) && clean(item.name))
    : [];
  const byId = new Map(safeItems.map((item) => [clean(item.id), { ...item }]));

  (Array.isArray(pmbPublishQueue) ? pmbPublishQueue : []).forEach((queuedItem) => {
    const item = getQueuedComingSoonProduct(queuedItem);
    if (!item) return;
    const existing = [...byId.values()].find((entry) => clean(entry.name).toLowerCase() === item.name.toLowerCase());
    byId.set(existing?.id || item.id, existing ? { ...item, ...existing } : item);
  });

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
