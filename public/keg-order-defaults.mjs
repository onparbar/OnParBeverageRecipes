import { GUINNESS_KEG_OZ, GUINNESS_KEG_PRICE } from "./beer-keg-pricing.mjs";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function getKegOrderKey(value) {
  const key = clean(value).replace(/\s+[123]$/, "")
    .replace(/\b1\/2\s*bbl\b/gi, "")
    .replace(/\b1\/2\b/gi, "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return KEG_PRICING_KEY_ALIASES[key] || key;
}

export function getKegOrderDefaults(value) {
  const key = getKegOrderKey(value);
  const product = KEG_VENDOR_PRODUCT_CATALOG[key];
  const vendor = product?.vendor || KEG_VENDOR_MAPPINGS[key];
  if (!vendor) return null;
  return {
    vendor,
    vendorSku: product?.vendorSku || "",
    vendorProductName: product?.productName || clean(value).replace(/\s+[123]$/, ""),
    unitCost: Number(product?.currentPrice ?? DEFAULT_KEG_PRICE_OVERRIDES[key]?.kegPrice) || 0,
  };
}

export function fillMissingKegOrderMetadata(item = {}) {
  const defaults = getKegOrderDefaults(item.name || item.orderProductName);
  if (!defaults) return item;
  const savedVendor = clean(item.vendor);
  // A price or SKU from another distributor is not a safe fallback.
  if (savedVendor && savedVendor.toLowerCase() !== defaults.vendor.toLowerCase()) return item;
  const missingPrice = !(Number(item.unitCost) > 0) && item.hasKnownPrice !== true;
  const resolvedPrice = missingPrice && defaults.unitCost > 0;
  return {
    ...item,
    vendor: savedVendor || defaults.vendor,
    vendors: [...new Set([...(item.vendors || []), savedVendor || defaults.vendor])],
    vendorSku: clean(item.vendorSku) || defaults.vendorSku,
    vendorProductName: clean(item.vendorProductName) || defaults.vendorProductName,
    ...(resolvedPrice ? {
      unitCost: defaults.unitCost,
      estimatedCost: (Number(item.quantity) || 0) * defaults.unitCost,
      hasKnownPrice: true,
    } : {}),
  };
}

export const DEFAULT_KEG_PRICE_OVERRIDES = {
  "michelob-ultra": {
    kegOz: "1984",
    kegPrice: "135",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "busch-light": {
    kegOz: "1984",
    kegPrice: "115",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "bud-light": {
    kegOz: "1984",
    kegPrice: "126",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "cincy-light": {
    kegOz: "1984",
    kegPrice: "130",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "summer-ale": {
    kegOz: "1984",
    kegPrice: "185",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "kona-big-wave": {
    kegOz: "1984",
    kegPrice: "170",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  yuengling: {
    kegOz: "1984",
    kegPrice: "126",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "goose-ipa": {
    kegOz: "1984",
    kegPrice: "150",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  truth: {
    kegOz: "1984",
    kegPrice: "182",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "stella-artois": {
    kegOz: "1690.7",
    kegPrice: "170",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  budweiser: {
    kegOz: "1984",
    kegPrice: "126",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "angry-orchard": {
    kegOz: "1984",
    kegPrice: "182",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "triple-jam-cider": {
    kegOz: "1984",
    kegPrice: "189",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "truly-wild-berry": {
    kegOz: "1984",
    kegPrice: "182",
    updatedAt: "Default Heidelberg Provi pricing",
  },
  "miller-lite": {
    kegOz: "1984",
    kegPrice: "130",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "coors-light": {
    kegOz: "1984",
    kegPrice: "130",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "pabst-blue-ribbon": {
    kegOz: "1984",
    kegPrice: "89",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  modelo: {
    kegOz: "1984",
    kegPrice: "143",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "blue-moon": {
    kegOz: "1984",
    kegPrice: "171",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  guinness: {
    kegOz: String(GUINNESS_KEG_OZ),
    kegPrice: String(GUINNESS_KEG_PRICE),
    updatedAt: "Bonbright manual pricing 2026-08-10",
  },
  "dortmunder-gold-lager": {
    kegOz: "1984",
    kegPrice: "175",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "garage-beer": {
    kegOz: "1984",
    kegPrice: "135",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "garage-beer-lime": {
    kegOz: "1984",
    kegPrice: "135",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "astra-red-cream-soda": {
    kegOz: "1984",
    kegPrice: "96",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "voodoo-ranger-ipa": {
    kegOz: "1984",
    kegPrice: "160",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "voodoo-ranger-juicy-haze": {
    kegOz: "1984",
    kegPrice: "185",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  "two-hearted-ipa": {
    kegOz: "1984",
    kegPrice: "186",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
  corona: {
    kegOz: "1984",
    kegPrice: "143",
    updatedAt: "Bonbright manual pricing 2026-08-15",
  },
};

export const KEG_PRICING_KEY_ALIASES = {
  lite: "miller-lite",
  "miller-light": "miller-lite",
  pabst: "pabst-blue-ribbon",
  pbr: "pabst-blue-ribbon",
  "bm-bl-moon": "blue-moon",
  "blue-moon-belgian-white": "blue-moon",
  "modelo-esp": "modelo",
  "modelo-especial": "modelo",
  "coors-lt": "coors-light",
  "guinness-draught": "guinness",
  "gl-dortmunder": "dortmunder-gold-lager",
  "dortmunder-gold": "dortmunder-gold-lager",
  "garage-lime": "garage-beer-lime",
  "astra-red-cream-seltz": "astra-red-cream-soda",
  "nb-vd-rgr-ipa": "voodoo-ranger-ipa",
  "voodoo-regular-ipa": "voodoo-ranger-ipa",
  "bells-two-hearted-ipa": "two-hearted-ipa",
  "triple-jam": "triple-jam-cider",
};

export const KEG_VENDOR_MAPPINGS = {
  psychopathy: "Bonbright",
  "michelob-ultra": "Heidelberg",
  "busch-light": "Heidelberg",
  "bud-light": "Heidelberg",
  "cincy-light": "Heidelberg",
  "summer-ale": "Heidelberg",
  "kona-big-wave": "Heidelberg",
  truth: "Heidelberg",
  "stella-artois": "Heidelberg",
  "angry-orchard": "Heidelberg",
  "truly-wild-berry": "Heidelberg",
  "goose-ipa": "Heidelberg",
  budweiser: "Heidelberg",
  "triple-jam-cider": "Heidelberg",
  yuengling: "Heidelberg",
  octoberfest: "Heidelberg",
  "miller-lite": "Bonbright",
  "pabst-blue-ribbon": "Bonbright",
  "coors-light": "Bonbright",
  "blue-moon": "Bonbright",
  modelo: "Bonbright",
  "astra-red-cream-soda": "Bonbright",
  "voodoo-ranger-juicy-haze": "Bonbright",
  "two-hearted-ipa": "Bonbright",
  "dortmunder-gold-lager": "Bonbright",
  "garage-beer-lime": "Bonbright",
  corona: "Bonbright",
  "garage-beer": "Bonbright",
  guinness: "Bonbright",
  "voodoo-ranger-ipa": "Bonbright",
};

export const KEG_VENDOR_PRODUCT_CATALOG = {
  "michelob-ultra": { vendor: "Heidelberg", vendorSku: "014676-C", productName: "Michelob Ultra 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 135, currentPrice: 130, promotion: true, priceCheckedAt: "2026-08-14" },
  "busch-light": { vendor: "Heidelberg", vendorSku: "010376-C", productName: "Busch Light 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 115, currentPrice: 115, promotion: false, priceCheckedAt: "2026-08-14" },
  "bud-light": { vendor: "Heidelberg", vendorSku: "011276-C", productName: "Bud Light 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 126, currentPrice: 126, promotion: false, priceCheckedAt: "2026-08-14" },
  "cincy-light": { vendor: "Heidelberg", vendorSku: "057895-C", productName: "Rhinegeist Cincy Light 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 130, currentPrice: 130, promotion: false, priceCheckedAt: "2026-08-14" },
  "summer-ale": { vendor: "Heidelberg", vendorSku: "048166-C", productName: "Samuel Adams Summer Ale 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 182, currentPrice: 182, promotion: false, priceCheckedAt: "2026-08-14" },
  "kona-big-wave": { vendor: "Heidelberg", vendorSku: "011400-C", productName: "Kona Big Wave 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 170, currentPrice: 150, promotion: true, priceCheckedAt: "2026-08-14" },
  truth: { vendor: "Heidelberg", vendorSku: "054519-C", productName: "Rhinegeist Truth 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 182, currentPrice: 182, promotion: false, priceCheckedAt: "2026-08-14" },
  "stella-artois": { vendor: "Heidelberg", vendorSku: "082476-C", productName: "Stella Artois 13.2 gal Keg", packSize: 1, kegOz: 1690.7, listPrice: 170, currentPrice: 150, promotion: true, priceCheckedAt: "2026-08-14" },
  "angry-orchard": { vendor: "Heidelberg", vendorSku: "083700-C", productName: "Angry Orchard Crisp Apple 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 182, currentPrice: 182, promotion: false, priceCheckedAt: "2026-08-14" },
  "truly-wild-berry": { vendor: "Heidelberg", vendorSku: "042517-C", productName: "Truly Wild Berry 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 182, currentPrice: 182, promotion: false, priceCheckedAt: "2026-08-14" },
  "goose-ipa": { vendor: "Heidelberg", vendorSku: "075908-C", productName: "Goose Island IPA 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 150, currentPrice: 122, promotion: true, priceCheckedAt: "2026-08-14" },
  budweiser: { vendor: "Heidelberg", vendorSku: "011176-C", productName: "Budweiser 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 126, currentPrice: 109, promotion: true, priceCheckedAt: "2026-08-14" },
  "triple-jam-cider": { vendor: "Heidelberg", vendorSku: "041189-C", productName: "Blake's Triple Jam 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 189, currentPrice: 189, promotion: false, priceCheckedAt: "2026-08-14" },
  yuengling: { vendor: "Heidelberg", vendorSku: "013476-C", productName: "Yuengling Traditional Lager 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 126, currentPrice: 126, promotion: false, priceCheckedAt: "2026-08-14" },
  octoberfest: { vendor: "Heidelberg", vendorSku: "048110-C", productName: "Samuel Adams Octoberfest 15.5 gal (1/2 bbl) Keg", packSize: 1, kegOz: 1984, listPrice: 182, currentPrice: 182, promotion: false, priceCheckedAt: "2026-08-14" },
};
