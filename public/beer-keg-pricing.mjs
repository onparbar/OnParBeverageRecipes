export const OUNCES_PER_GALLON = 128;
export const GUINNESS_KEG_GALLONS = 13.2;
export const GUINNESS_KEG_OZ = GUINNESS_KEG_GALLONS * OUNCES_PER_GALLON;
export const GUINNESS_KEG_PRICE = 185;

const KNOWN_BEER_KEG_SIZES_OZ = Object.freeze({
  guinness: GUINNESS_KEG_OZ,
  "stella-artois": 50 * 33.814,
});

const KEG_NAME_ALIASES = Object.freeze({
  "guinness-draught": "guinness",
});

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function slugify(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b1\/2\s*bbl\b/g, " ")
    .replace(/\bdraught\b/g, " draught ")
    .replace(/\s+[123]$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getProductNames(value) {
  if (value && typeof value === "object") {
    return [value.name, value.brand, value.tapProduct, value.matchedBrand, value.templateBrand];
  }
  return [value];
}

export function getKnownBeerKegSizeOz(value) {
  for (const name of getProductNames(value)) {
    const rawKey = slugify(name);
    const key = KEG_NAME_ALIASES[rawKey] || rawKey;
    const size = KNOWN_BEER_KEG_SIZES_OZ[key];
    if (size) return size;
  }
  return 0;
}

export function isBeerTapPosition(item) {
  const tapNumber = Number(item?.tapNumber ?? item?.tapPosition);
  const wall = clean(item?.wall).toLowerCase();
  return (
    (tapNumber >= 21 && tapNumber <= 46)
    || (wall === "karaoke" && tapNumber >= 73 && tapNumber <= 82)
  );
}
