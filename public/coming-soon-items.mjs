export const REQUIRED_COMING_SOON_ITEMS = Object.freeze([
  Object.freeze({
    id: "recipe:on-par-tee",
    kind: "recipe",
    recipeId: "on-par-tee",
    name: "On Par Tee (Crown Royal) 1",
    imageUrl: "/images/products/on-par-tee-classic.png",
  }),
  Object.freeze({
    id: "recipe:whiskey-smash",
    kind: "recipe",
    recipeId: "whiskey-smash",
    name: "Whiskey Smash (Jim Beam) 1",
    imageUrl: "/images/products/whiskey-smash-classic.png",
  }),
  Object.freeze({
    id: "beer:triple-jam-2",
    kind: "beer",
    name: "Triple Jam Cider 2",
    cloneSourceName: "TRIPLE JAM CIDER 1",
    imageUrl: "/images/products/triple-jam-cider-2.png",
  }),
  Object.freeze({
    id: "recipe:vodka-cran-2",
    kind: "recipe",
    recipeId: "vodka-cran-tito-s",
    name: "Vodka Cran (Tito's) 2",
    cloneSourceName: "VODKA CRAN (TITO'S) 1",
    imageUrl: "/images/products/vodka-cran-2.png",
  }),
  Object.freeze({
    id: "liquor:makers-mark",
    kind: "liquor",
    name: "Maker's Mark 3",
    producer: "Maker's Mark",
    brewery: "Maker's Mark",
    style: "Kentucky Straight Bourbon",
    abvPercent: 45,
    description: "Kentucky straight bourbon with vanilla, caramel, bright fruit and soft spice, followed by a smooth, creamy finish.",
    imageUrl: "/images/products/makers-mark.webp",
    bottleCost: 49.99,
    bottleOz: 59.1745,
    bottleSizeLabel: "1.75 L",
    bottleCostStatus: "verified",
    bottleCostSource: "OHLQ largest bottle · 6060D",
    bottleCostCheckedAt: "2026-11-02",
    bottleCostSourceUrl: "https://www.ohlq.com/liquor/whiskey/american/bourbon/makers-mark?sku=6060d",
    pricePerOz: 5.34,
    servingOz: 1.5,
    targetMargin: 82,
    portions: Object.freeze([
      Object.freeze({ name: "Single", quantityOz: 1.5, price: 8 }),
      Object.freeze({ name: "Double", quantityOz: 2, price: 10 }),
    ]),
    priceStatus: "approved",
  }),
  Object.freeze({
    id: "liquor:ciroc-pineapple",
    kind: "liquor",
    name: "Ciroc Pineapple 3",
    producer: "Cîroc",
    brewery: "Cîroc",
    style: "Pineapple Vodka",
    abvPercent: 35,
    description: "French grape-based vodka distilled five times and infused with pineapple and other natural flavors for a smooth tropical taste.",
    imageUrl: "/images/products/ciroc-pineapple.webp",
    bottleCost: 38.99,
    bottleOz: 33.814,
    bottleSizeLabel: "1 L",
    bottleCostStatus: "verified",
    bottleCostSource: "OHLQ largest bottle · 2056L",
    bottleCostCheckedAt: "2026-11-02",
    bottleCostSourceUrl: "https://www.ohlq.com/liquor/vodka/flavored/ciroc-pineapple?sku=2056l",
    pricePerOz: 8,
    servingOz: 1.5,
    targetMargin: 82,
    portions: Object.freeze([
      Object.freeze({ name: "Single", quantityOz: 1.5, price: 12 }),
      Object.freeze({ name: "Double", quantityOz: 2, price: 16 }),
    ]),
    priceStatus: "approved",
  }),
]);

// Repair only the exact cost baselines previously seeded by this dashboard.
// User-entered costs and completed products retain their original data.
const PREVIOUS_LIQUOR_BOTTLE_BASELINES = {
  "liquor:makers-mark": { bottleCost: 47, bottleOz: 59.1745, bottleCostSource: "Saved supplier price", bottleCostCheckedAt: "2026-09-10" },
  "liquor:ciroc-pineapple": { bottleCost: 24.99, bottleOz: 25.3605, bottleCostSource: "OHLQ retail estimate", bottleCostCheckedAt: "2026-11-02", bottleCostStatus: "estimate" },
};

const RETIRED_COMING_SOON_IDS = new Set([
  "beer:octoberfest",
  "recipe:bacardi-sunset",
  "liquor:captain-morgan",
  "liquor:don-julio-blanco-2",
  "liquor:woodford-reserve",
]);

const REQUIRED_COMING_SOON_LEGACY_IDS = Object.freeze({
  "recipe:vodka-cran-2": Object.freeze(["recipe:vodka-cran-tito-s"]),
});

// These two unnumbered drafts were renamed for wall 3. Do not treat other
// numbered wall copies as aliases of the requested products.
const REQUIRED_LIQUOR_NAME_ALIASES = new Map([
  [slug("Maker's Mark"), slug("Maker's Mark 3")],
  [slug("Ciroc Pineapple"), slug("Ciroc Pineapple 3")],
]);

function clean(value) {
  return String(value ?? "").trim();
}

function slug(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hasText(value) {
  return typeof value === "string" && Boolean(clean(value)) && clean(value) !== "0";
}

function mergeRequiredLiquorItem(required, existing = {}) {
  // The owner approved new whole-dollar Maker's portions with the OHLQ cost.
  // Only replace the exact previous draft prices, never a custom or live price.
  if (required.id === "liquor:makers-mark" && !existing.replacedAt && !existing.pmbActiveAt && !positiveNumber(existing.plu)
      && existing.priceStatus === "approved" && Number(existing.pricePerOz) === 4.67 && !positiveNumber(existing.chargePerOz)
      && ["Saved supplier price", "OHLQ largest bottle · 6060D"].includes(existing.bottleCostSource)
      && Array.isArray(existing.portions) && existing.portions.length === 2
      && existing.portions.some(portion => portion.name === "Single" && Number(portion.quantityOz) === 1.5 && Number(portion.price) === 7)
      && existing.portions.some(portion => portion.name === "Double" && Number(portion.quantityOz) === 2 && Number(portion.price) === 9)) {
    existing = { ...existing, pricePerOz: required.pricePerOz, portions: required.portions.map(portion => ({ ...portion })) };
  }
  const merged = { ...existing, id: required.id, kind: required.kind, name: required.name };
  const previousBottle = PREVIOUS_LIQUOR_BOTTLE_BASELINES[required.id];
  if (!existing.replacedAt && !existing.pmbActiveAt && !positiveNumber(existing.plu)
      && previousBottle && Object.entries(previousBottle).every(([field, value]) => existing[field] === value)) {
    for (const field of ["bottleCost", "bottleOz", "bottleSizeLabel", "bottleCostStatus", "bottleCostSource", "bottleCostCheckedAt", "bottleCostSourceUrl"]) {
      merged[field] = required[field];
    }
  }
  for (const field of ["producer", "brewery", "style", "description", "imageUrl"]) {
    if (!hasText(merged[field])) merged[field] = required[field];
  }
  const savedPortions = Array.isArray(existing.portions) && existing.portions.length
    ? existing.portions : null;
  const savedSingle = savedPortions?.find(portion => /single/i.test(clean(portion?.name))) || savedPortions?.[0];
  const savedPortionOz = positiveNumber(savedSingle?.quantityOz) || positiveNumber(savedSingle?.servingOz);
  const portionRate = savedPortionOz && positiveNumber(savedSingle?.price)
    ? Number(savedSingle.price) / savedPortionOz : 0;
  const savedPrice = positiveNumber(existing.chargePerOz) || positiveNumber(existing.pricePerOz) || portionRate;
  const savedServing = positiveNumber(existing.pourOz) || positiveNumber(existing.servingOz);

  const positiveFallbacks = {
    abvPercent: required.abvPercent,
    bottleCost: positiveNumber(existing.kegCost) || required.bottleCost,
    bottleOz: positiveNumber(existing.kegOz) || required.bottleOz,
    pricePerOz: savedPrice || required.pricePerOz,
    servingOz: savedServing || required.servingOz,
    targetMargin: required.targetMargin,
  };
  for (const [field, fallback] of Object.entries(positiveFallbacks)) {
    if (!positiveNumber(merged[field])) merged[field] = fallback;
  }

  // Cost provenance describes this exact bottle/price, not any saved supplier cost.
  const defaultBottleSize = Number(merged.bottleOz) === required.bottleOz;
  if (defaultBottleSize && !hasText(merged.bottleSizeLabel)) merged.bottleSizeLabel = required.bottleSizeLabel;
  if (defaultBottleSize && Number(merged.bottleCost) === required.bottleCost) {
    for (const field of ["bottleCostStatus", "bottleCostSource", "bottleCostCheckedAt", "bottleCostSourceUrl"]) {
      if (!hasText(merged[field]) && hasText(required[field])) merged[field] = required[field];
    }
  }

  const defaultPrice = !savedPrice || Math.abs(savedPrice - required.pricePerOz) < 0.000001;
  const defaultServing = !savedServing || savedServing === required.servingOz;
  if (!savedPortions && defaultPrice && defaultServing) {
    merged.portions = required.portions.map(portion => ({ ...portion }));
  }
  // A matching number alone cannot establish that an older saved price was approved.
  if (!hasText(merged.priceStatus) && !savedPrice && !savedPortions && defaultServing) {
    merged.priceStatus = required.priceStatus;
  }
  return merged;
}

function isSameComingSoonProduct(left, right) {
  if (clean(left.id) === clean(right.id)) return true;
  if (clean(left.kind).toLowerCase() !== clean(right.kind).toLowerCase()) return false;
  // Separate wall copies and reused PLUs must not collapse into one queue item.
  const identityName = (item) => {
    const name = slug(item.name);
    return clean(item.kind).toLowerCase() === "liquor"
      ? REQUIRED_LIQUOR_NAME_ALIASES.get(name) || name : name;
  };
  if (!identityName(left) || identityName(left) !== identityName(right)) return false;
  const leftPlu = Number(left.plu) || 0;
  const rightPlu = Number(right.plu) || 0;
  if (leftPlu > 0 && rightPlu > 0) return leftPlu === rightPlu;
  return true;
}

export function consolidateComingSoonItems(items = []) {
  const result = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object" || !clean(item.id) || !clean(item.name)) continue;
    if (RETIRED_COMING_SOON_IDS.has(clean(item.id))) continue;
    const existing = result.find((entry) => isSameComingSoonProduct(entry, item));
    if (!existing) {
      result.push({ ...item });
      continue;
    }
    const preserved = {
      id: existing.id,
      createdAt: existing.createdAt || item.createdAt,
      replacedAt: existing.replacedAt || item.replacedAt,
      replaceTapKey: existing.replaceTapKey || item.replaceTapKey,
      pmbActiveAt: existing.pmbActiveAt || item.pmbActiveAt,
      plu: Number(item.plu) > 0 ? item.plu : existing.plu,
    };
    for (const [key, value] of Object.entries(item)) {
      if (value !== undefined && value !== null && value !== "") existing[key] = value;
    }
    Object.assign(existing, preserved);
  }
  return result;
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

export function getActiveComingSoonItems(items = []) {
  return consolidateComingSoonItems(items).filter((item) => !clean(item.replacedAt));
}

export function mergeRequiredComingSoonItems(items = [], pmbPublishQueue = []) {
  const safeItems = Array.isArray(items)
    ? items.map((item) => {
        const required = REQUIRED_COMING_SOON_ITEMS.find(entry => entry.id === clean(item?.id));
        return required && !hasText(item.name) ? { ...item, name: required.name } : item;
      }).filter((item) => (
        item
        && typeof item === "object"
        && clean(item.id)
        && clean(item.name)
        && !RETIRED_COMING_SOON_IDS.has(clean(item.id))
      ))
    : [];
  const byId = new Map(consolidateComingSoonItems(safeItems).map((item) => [clean(item.id), { ...item }]));

  (Array.isArray(pmbPublishQueue) ? pmbPublishQueue : []).forEach((queuedItem) => {
    const item = getQueuedComingSoonProduct(queuedItem);
    if (!item || RETIRED_COMING_SOON_IDS.has(item.id)) return;
    const existing = [...byId.values()].find((entry) => isSameComingSoonProduct(entry, item));
    byId.set(existing?.id || item.id, existing ? { ...item, ...existing } : item);
  });

  REQUIRED_COMING_SOON_ITEMS.forEach((required) => {
    (REQUIRED_COMING_SOON_LEGACY_IDS[required.id] || []).forEach((legacyId) => {
      byId.delete(legacyId);
    });
    const existing = byId.get(required.id)
      || (required.kind === "liquor" && [...byId.values()].find(item => isSameComingSoonProduct(item, required)));
    if (required.kind === "liquor") {
      const merged = mergeRequiredLiquorItem(required, existing || {});
      // Publishing may have assigned a numeric or older slug ID. Keep that
      // selection stable while enriching its saved values instead of duplicating it.
      merged.id = existing?.id || required.id;
      byId.set(merged.id, merged);
      return;
    }
    byId.set(required.id, existing
      ? {
          ...required,
          ...existing,
          id: required.id,
          name: required.name,
          cloneSourceName: required.cloneSourceName || existing.cloneSourceName,
          imageUrl: required.imageUrl || existing.imageUrl,
          untappdQuery: required.untappdQuery || existing.untappdQuery,
        }
      : { ...required });
  });

  return consolidateComingSoonItems([...byId.values()]);
}
