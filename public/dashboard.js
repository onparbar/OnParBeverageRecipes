import {
  convertLegacyCaseCountToUnits,
  getInventoryOnHandUnits,
  getInventoryUnitCost,
  getOrderCaseCount,
  getRoundedOrderUnits,
  normalizePackSize,
} from "./inventory-calculations.mjs";

const CSV_PATH = "./data/cocktail-recipes.csv";
const NEW_COCKTAILS_CSV_PATH = "./data/new-cocktails.csv";
const INVENTORY_CSV_PATH = "./data/inventory-2026-06-01.csv";
const KEG_LEVELS_CSV_PATH = "./data/keg-levels-template.csv";
const WEEKLY_USAGE_CSV_PATH = "./data/weekly-usage-history.csv";
const WEEKLY_USAGE_EXTRA_CSV_PATH = "./data/weekly-usage-history-extra.csv";
const WEEKLY_USAGE_CHANGEOVERS_CSV_PATH = "./data/weekly-usage-changeovers.csv";
const STORAGE_KEY = "cocktail-dashboard-ingredient-prices";
const CHARGE_STORAGE_KEY = "cocktail-dashboard-charge-prices";
const CUSTOM_RECIPE_STORAGE_KEY = "cocktail-dashboard-custom-recipes";
const INACTIVE_RECIPE_STORAGE_KEY = "cocktail-dashboard-inactive-recipes";
const EDITED_RECIPE_STORAGE_KEY = "cocktail-dashboard-edited-recipes";
const INVENTORY_ON_HAND_STORAGE_KEY = "cocktail-dashboard-inventory-on-hand";
const INVENTORY_PAR_STORAGE_KEY = "cocktail-dashboard-inventory-par";
const INVENTORY_HISTORY_STORAGE_KEY = "cocktail-dashboard-inventory-history";
const CUSTOM_INVENTORY_STORAGE_KEY = "cocktail-dashboard-custom-inventory";
const INVENTORY_UNIT_MODEL_STORAGE_KEY = "cocktail-dashboard-inventory-unit-model";
const INVENTORY_UNIT_MODEL_VERSION = "2";
const KEG_ON_HAND_STORAGE_KEY = "cocktail-dashboard-keg-on-hand";
const KEG_PAR_STORAGE_KEY = "cocktail-dashboard-keg-par";
const KEG_ON_DECK_STORAGE_KEY = "cocktail-dashboard-keg-on-deck";
const KEG_PRICE_STORAGE_KEY = "cocktail-dashboard-keg-prices";
const CUSTOM_BEER_KEG_STORAGE_KEY = "cocktail-dashboard-custom-beer-kegs";
const CUSTOM_LIQUOR_TAP_STORAGE_KEY = "cocktail-dashboard-custom-liquor-taps";
const COMING_SOON_STORAGE_KEY = "cocktail-dashboard-coming-soon";
const TAP_REPLACEMENT_STORAGE_KEY = "cocktail-dashboard-tap-replacements";
const WEEKLY_USAGE_CURRENT_STORAGE_KEY = "cocktail-dashboard-weekly-usage-current";
const WEEKLY_USAGE_HISTORY_STORAGE_KEY = "cocktail-dashboard-weekly-usage-history";
const WEEKLY_USAGE_ARCHIVE_STORAGE_KEY = "cocktail-dashboard-weekly-usage-archive";
const WEEKLY_USAGE_SYNC_LOOKBACK_WEEKS = 12;
const STANDARD_BEER_KEG_OZ = 15.5 * 128;
const STANDARD_COCKTAIL_KEG_OZ = 12 * 128;
const DEFAULT_BEER_TARGET_MARGIN = 82;
const KEG_SIZE_OVERRIDES = {
  "stella-artois": 50 * 33.814,
};
const DEFAULT_PRICE_OVERRIDES = {
  "1800-reposado": {
    bottleOz: "59.1745",
    bottlePrice: "44.18",
    updatedAt: "Default OHLQ pricing",
  },
  "absolut-raspberri": {
    bottleOz: "33.814",
    bottlePrice: "25.38",
    updatedAt: "Default OHLQ pricing",
  },
  "absolut-vanilia": {
    bottleOz: "33.814",
    bottlePrice: "25.38",
    updatedAt: "Default OHLQ pricing",
  },
  "bacardi-superior": {
    bottleOz: "59.1745",
    bottlePrice: "24.44",
    updatedAt: "Default OHLQ pricing",
  },
  "blue-dot-juice": {
    bottleOz: "128",
    bottlePrice: "1",
    updatedAt: "Default pricing",
  },
  "cold-brew-coffee": {
    bottleOz: "384",
    bottlePrice: "51.67",
    updatedAt: "Default pricing",
  },
  "cranberry-juice": {
    bottleOz: "2304",
    bottlePrice: "85",
    updatedAt: "Default pricing",
  },
  "crown-royal-peach": {
    bottleOz: "59.1745",
    bottlePrice: "49.82",
    updatedAt: "Default OHLQ pricing",
  },
  "don-julio-blanco": {
    bottleOz: "25.3605",
    bottlePrice: "47",
    updatedAt: "Default OHLQ pricing",
  },
  "grey-goose": {
    bottleOz: "59.1745",
    bottlePrice: "42.3",
    updatedAt: "Default OHLQ pricing",
  },
  hennessy: {
    bottleOz: "59.1745",
    bottlePrice: "75.2",
    updatedAt: "Default OHLQ pricing",
  },
  jameson: {
    bottleOz: "59.1745",
    bottlePrice: "51.7",
    updatedAt: "Default OHLQ pricing",
  },
  "jose-cuervo-gold": {
    bottleOz: "59.1745",
    bottlePrice: "32.9",
    updatedAt: "Default OHLQ pricing",
  },
  lemonade: {
    bottleOz: "2304",
    bottlePrice: "52",
    updatedAt: "Default pricing",
  },
  "patron-silver": {
    bottleOz: "59.1745",
    bottlePrice: "98.7",
    updatedAt: "Default OHLQ pricing",
  },
  "pink-whitney": {
    bottleOz: "59.1745",
    bottlePrice: "20.68",
    updatedAt: "Default OHLQ pricing",
  },
  "simple-syrup": {
    bottleOz: "128",
    bottlePrice: "3.84",
    updatedAt: "Default pricing",
  },
  screwball: {
    bottleOz: "25.3605",
    bottlePrice: "21.62",
    updatedAt: "Default OHLQ pricing",
  },
  "sour-mix": {
    bottleOz: "128",
    bottlePrice: "10.24",
    updatedAt: "Default pricing",
  },
  "strawberry-lemonade": {
    bottleOz: "2304",
    bottlePrice: "85",
    updatedAt: "Default pricing",
  },
  "sweet-tea": {
    bottleOz: "2304",
    bottlePrice: "85",
    updatedAt: "Default pricing",
  },
  vanilla: {
    bottleOz: "1",
    bottlePrice: "0.31",
    updatedAt: "Default pricing",
  },
};
const DEFAULT_KEG_PRICE_OVERRIDES = {
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
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "coors-light": {
    kegOz: "1984",
    kegPrice: "130",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "pabst-blue-ribbon": {
    kegOz: "1984",
    kegPrice: "89",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  modelo: {
    kegOz: "1984",
    kegPrice: "143",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "blue-moon": {
    kegOz: "1984",
    kegPrice: "171",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  guinness: {
    kegOz: "1984",
    kegPrice: "185",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "dortmunder-gold-lager": {
    kegOz: "1984",
    kegPrice: "175",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "garage-beer": {
    kegOz: "1984",
    kegPrice: "135",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "garage-beer-lime": {
    kegOz: "1984",
    kegPrice: "135",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "astra-red-cream-soda": {
    kegOz: "1984",
    kegPrice: "96",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "voodoo-ranger-ipa": {
    kegOz: "1984",
    kegPrice: "160",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "voodoo-ranger-juicy-haze": {
    kegOz: "1984",
    kegPrice: "185",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  "two-hearted-ipa": {
    kegOz: "1984",
    kegPrice: "186",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
  corona: {
    kegOz: "1984",
    kegPrice: "143",
    updatedAt: "Bonbright manual pricing 2026-07-24",
  },
};
const KEG_PRICING_KEY_ALIASES = {
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
};
const BONBRIGHT_KEG_ALIASES = {
  "miller-lite": ["Lite 1/2 BBL", "Lite", "Miller Light"],
  "blue-moon": ["BM BL MOON", "BM BL MOON 1/2 BBL"],
  "pabst-blue-ribbon": ["PABST 1/2 BBL", "PABST", "PBR"],
  modelo: ["MODELO ESP 1/2 BBL", "Modelo ESP", "Modelo Especial"],
  "coors-light": ["COORS LT 1/2 BBL", "Coors LT"],
  guinness: ["GUINNESS 1/2 BBL", "Guinness Draught"],
  "dortmunder-gold-lager": ["GL DORTMUNDER 1/2 BBL", "GL Dortmunder", "Dortmunder Gold"],
  "garage-beer": ["GARAGE BEER 1/2", "Garage Beer"],
  "garage-beer-lime": ["GARAGE LIME 1/2", "Garage Lime"],
  "astra-red-cream-soda": ["ASTRA RED CREAM SELTZ 1/2 BBL", "Astra Red Cream Seltz"],
  "voodoo-ranger-ipa": ["NB VD RGR IPA", "NB VD RGR IPA 1/2 BBL", "Voodoo Ranger IPA"],
  "voodoo-ranger-juicy-haze": ["Voodoo Ranger Juicy Haze", "VD RGR JUICY HAZE", "Juicy Haze"],
  "two-hearted-ipa": ["Two Hearted IPA", "Bell's Two Hearted IPA"],
};
const KEG_VENDOR_MAPPINGS = {
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
  "breakfast-stout": "Bonbright",
  "garage-beer": "Bonbright",
  guinness: "Bonbright",
  "voodoo-ranger-ipa": "Bonbright",
};
const KEG_PROVI_DISTRIBUTOR_HINTS = {
  Heidelberg: ["Heidelberg", "Heidelberg Distributing", "Heidelberg Distributing Company"],
  Bonbright: ["Bonbright", "Bonbright Distributors", "Bonbright Distributing"],
};
const INVENTORY_CABINET_ORDER = [
  "Bulleit Bourbon",
  "Crown Royal",
  "Svedka Blue Raspberry Vodka",
  "Jose Cuervo Silver",
  "Tito's",
  "Ketel One Cucumber Vodka",
  "Absolut Citron",
  "Crown Apple",
  "Captain Morgan",
  "Bombay Sapphire",
  "Jack Daniel's",
  "Blue Rasp Powder",
  "Bitters",
  "Lemon Juice",
  "Raspberry Schnapps",
  "Pomegranate Schnapps",
  "Strawberry Schnapps",
  "Triple Sec",
  "Peach Schnapps",
  "Blueberry Schnapps",
  "Lime Juice",
  "Watermelon Schnapps",
  "Apple Schnapps",
  "Creme de Cacao",
  "Kahlua",
  "Cold Brew",
  "Sour Mix",
];
const DEFAULT_BATCH_LABEL = "12 gallon keg";
const PROOF_MAPPINGS = {
  "apple-pucker": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Sour Apple Schnapps Pucker 30 1L", bottleOz: 33.81, searchAliases: ["Apple Pucker", "Pucker Sour Apple", "DeKuyper Pucker Sour Apple Schnapps"] },
  "apple-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "Llord's Apple Schnapps 1L", bottleOz: 33.81 },
  bitters: { vendor: "Proof", syncVendor: "Provi", productName: "Angostura Bitters Aromatic 16oz", bottleOz: 16 },
  "blueberry-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Blueberry Schnapps 30 1L", bottleOz: 33.81, searchAliases: ["Blueberry Schnapps", "DeKuyper Blueberry Schnapps"] },
  "creme-de-cacao": { vendor: "Proof", syncVendor: "Provi", productName: "Llords Creme De Cacao 30 1L", bottleOz: 33.81, searchAliases: ["Llord's Creme De Cacao White", "Creme De Cacao White"] },
  "lemon-juice": { vendor: "Proof", syncVendor: "Provi", productName: "Finest Call Single Pressed Lemon Juice 1L", bottleOz: 33.81 },
  "lime-juice": { vendor: "Proof", syncVendor: "Provi", productName: "Finest Call Lime Juice 1L", bottleOz: 33.81 },
  mint: { vendor: "Proof", syncVendor: "Provi", productName: "Master of Mixes Cocktail Mixer - Other Mint Syrup Cocktail Essentials 375mL", bottleOz: 12.68, searchAliases: ["Master of Mixes Mint Syrup", "Mint Syrup"] },
  "peach-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Peach Schnapps Peachtree 30 1L", bottleOz: 33.81, searchAliases: ["Peachtree", "DeKuyper Peachtree Schnapps"] },
  "pomegranate-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Pomegranate Schnapps Pomegranate Pleasure 30 1L", bottleOz: 33.81, searchAliases: ["Pomegranate Schnapps", "DeKuyper Pomegranate Schnapps"] },
  "raspberry-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Raspberry Schnapps 33 1L", bottleOz: 33.81, searchAliases: ["DeKuyper Razzmatazz Schnapps", "Razzmatazz"] },
  "strawberry-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Sour Strawberry Schnapps Pucker 30 1L", bottleOz: 33.81, searchAliases: ["Strawberry Pucker", "DeKuyper Pucker Strawberry Schnapps"] },
  "triple-sec": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Triple Sec 30 1L", bottleOz: 33.81 },
  "watermelon-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Sour Watermelon Schnapps Pucker 30 1L", bottleOz: 33.81, searchAliases: ["Watermelon Pucker", "DeKuyper Pucker Watermelon Schnapps"] },
};
const OHLQ_MAPPINGS = {
  "1800-reposado": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "1800 Reposado Tequila 1.75L", bottleOz: 59.1745 },
  "absolut-raspberri": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Absolut Raspberri Vodka 1L", bottleOz: 33.814 },
  "absolut-vanilia": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Absolut Vanilia Vodka 1L", bottleOz: 33.814 },
  "absolut-citron": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Absolut Citron Vodka 1.75L", bottleOz: 59.17 },
  "bacardi-superior": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Bacardi Superior White Rum 1.75L", bottleOz: 59.1745 },
  "bombay-sapphire": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Bombay Sapphire Gin 1.75L", bottleOz: 59.17 },
  "bulleit-bourbon": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Bulleit Bourbon 1.75L", bottleOz: 59.17 },
  "captain-morgan": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Captain Morgan Original Spiced Rum 1.75L", bottleOz: 59.17 },
  "crown-apple": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Crown Royal Regal Apple 1.75L", bottleOz: 59.17 },
  "crown-royal-peach": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Crown Royal Peach Whisky 1.75L", bottleOz: 59.1745 },
  "crown-royal": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Crown Royal Canadian Whisky 1.75L", bottleOz: 59.17 },
  "don-julio-blanco": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Don Julio Blanco Tequila 750mL", bottleOz: 25.3605 },
  "grey-goose": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Grey Goose Vodka 1.75L", bottleOz: 59.1745 },
  hennessy: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Hennessy VS Cognac 1.75L", bottleOz: 59.1745 },
  "jack-daniel-s": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jack Daniel's Old No. 7 1.75L", bottleOz: 59.17 },
  "jack-daniel-s-fire": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jack Daniel's Tennessee Fire 1.75L", bottleOz: 59.17 },
  "fireball-cinnamon-whisky": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Fireball Cinnamon Whisky 1.75L", bottleOz: 59.17 },
  jameson: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jameson Irish Whiskey 1.75L", bottleOz: 59.1745 },
  "jim-beam": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jim Beam Bourbon 1.75L", bottleOz: 59.17 },
  "jose-cuervo-gold": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jose Cuervo Especial Gold 1.75L", bottleOz: 59.1745 },
  "jose-cuervo-silver": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jose Cuervo Especial Silver 1.75L", bottleOz: 59.17 },
  kahlua: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Kahlua Coffee Liqueur 1L", bottleOz: 33.81 },
  "ketel-one-cucumber-vodka": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Ketel One Botanical Cucumber & Mint 1L", bottleOz: 33.81 },
  "patron-silver": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Patron Silver Tequila 1.75L", bottleOz: 59.1745 },
  "pink-whitney": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "New Amsterdam Pink Whitney Vodka 1.75L", bottleOz: 59.1745 },
  screwball: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Skrewball Peanut Butter Whiskey 750mL", bottleOz: 25.3605 },
  "svedka-blue-raspberry-vodka": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Svedka Blue Raspberry Vodka 750mL", bottleOz: 25.36 },
  "tito-s": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Tito's Handmade Vodka 1.75L", bottleOz: 59.17 },
};
const INGREDIENT_ABV_PERCENT = {
  "1800-reposado": 40,
  "absolut-citron": 40,
  "absolut-raspberri": 40,
  "absolut-vanilia": 40,
  "apple-pucker": 15,
  "apple-schnapps": 15,
  "bacardi-superior": 40,
  bitters: 44.7,
  "blueberry-schnapps": 15,
  "bombay-sapphire": 47,
  "bulleit-bourbon": 45,
  "captain-morgan": 35,
  "creme-de-cacao": 15,
  "crown-apple": 35,
  "crown-royal-peach": 35,
  "crown-royal": 40,
  "don-julio-blanco": 40,
  "grey-goose": 40,
  hennessy: 40,
  "jack-daniel-s": 40,
  "jack-daniel-s-fire": 35,
  "fireball-cinnamon-whisky": 33,
  jameson: 40,
  "jim-beam": 40,
  "jose-cuervo-gold": 40,
  "jose-cuervo-silver": 40,
  kahlua: 20,
  "ketel-one-cucumber-vodka": 30,
  "patron-silver": 40,
  "peach-schnapps": 15,
  "pink-whitney": 30,
  "pomegranate-schnapps": 15,
  "raspberry-schnapps": 16.5,
  screwball: 35,
  "strawberry-schnapps": 15,
  "svedka-blue-raspberry-vodka": 35,
  "tito-s": 40,
  "triple-sec": 15,
  "watermelon-schnapps": 15,
};
const MENU_ORDER = [
  ["GIN & JUICE (BOMBAY)", "Ginny from the Block (Gin)"],
  ["CAPTAIN QUENCHER (CAPTAIN MORGAN)", "Captain Quencher (Rum)"],
  ["BLUEBERRY MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["HOUSE MARGARITA (JOSE CUERVO)", "House Margarita (Tequilla)"],
  ["PEACH MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["RASPBERRY MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["STRAWBERRY MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["WATERMELON MARGARITA (JOSE CUERVO)", "Strawberry/Watermelon/Peach/Blueberry Marg (Tequilla)"],
  ["STRAWBERRY SENORITA (JOSE CUERVO)", "Strawberry Senorita (Tequilla)"],
  ["APPLETINI (TITO'S)", "Apple-tini(Vodka)"],
  ["BLUE DOT (SVEDKA)", "Blue Dot (Vodka)"],
  ["BOOZY CUCUMBER LEMONADE (KETEL ONE)", "Boozy Cucumber Lemonade (Vodka)"],
  ["ESPRESSO MARTINI (TITO'S)", "Espresso Martini"],
  ["LEMON DROP MARTINI (ABSOLUT CITRON)", "Lemon Drop Martini(Vodka)"],
  ["POMEGRANATE MARTINI (TITO'S)", "Pomegranate Martini(Tito's)"],
  ["SPIKED ARNOLD PALMER (TITO'S)", "Spiked Arnold Palmer (Vodka)"],
  ["SPIKED CRANBERRY LEMONADE (TITO'S)", "Spiked Cranberry Lemonade (Vodka)"],
  ["SPIKED PINK LEMONADE (TITO'S)", "Spiked Strawberry Lemonade (Vodka)"],
  ["SPIKED STRAWBERRY LEMONADE (TITO'S)", "Spiked Strawberry Lemonade (Vodka)"],
  ["VODKA CRAN (TITO'S)", "Vodka Cran(Vodka)"],
  ["CROWN APPLE 'RITA", "Crown Apple 'rita(Whiskey)"],
  ["JACKED UP STRAWBERRY LEMONADE (JACK DANIELS)", "Jacked Up Strawberry Lemonade (Whiskey)"],
  ["OLD FASHIONED (BULLEIT)", "Old fashioned (Whiskey)"],
  ["JACK & LEMONADE", "Jack and Lemonade (Whiskey)"],
  ["WASHINGTON APPLE (CROWN ROYAL APPLE)", "Washington Apple (Whiskey)"],
  ["WHISKEY SOUR (JACK DANIELS)", "Whiskey Sour (Whiskey)"],
];
const OPERATION_TAB_NAMES = ["keg-levels", "pricing", "ingredients", "inventory"];
const NEW_RECIPE_ORDER = [
  ["WHISKEY SMASH", "Whiskey Smash"],
  ["APPLE JACK (WHISKEY)", "Apple Jack (Whiskey)"],
  ["ON PAR TEE", "On Par Tee"],
];
const STRAIGHT_LIQUOR_TAP_INGREDIENTS = [
  "1800 Reposado",
  "Absolut Raspberri",
  "Absolut Vanilia",
  "Bacardi Superior",
  "Crown Royal Peach",
  "Don Julio Blanco",
  "Grey Goose",
  "Hennessy",
  "Jameson",
  "Jose Cuervo Gold",
  "Patron Silver",
  "Pink Whitney",
  "Screwball",
];
const dashboardShell = document.querySelector(".shell");
const dashboardRole = dashboardShell?.dataset.dashboardRole || "owner";
const isEmployeeDashboard = dashboardRole === "employee";
const recipeGrid = document.querySelector("#recipe-grid");
const oldRecipeGrid = document.querySelector("#old-recipe-grid");
const statsGrid = document.querySelector("#stats-grid");
const categoryFilter = document.querySelector("#category-filter");
const recipeSearch = document.querySelector("#recipe-search");
const oldSearch = document.querySelector("#old-search");
const pricingSearch = document.querySelector("#pricing-search");
const pricingTable = document.querySelector("#pricing-table");
const pricingSummary = document.querySelector("#pricing-summary");
const ingredientSearch = document.querySelector("#ingredient-search");
const ingredientTable = document.querySelector("#ingredient-table");
const kegPricingTable = document.querySelector("#keg-pricing-table");
const ingredientSummary = document.querySelector("#ingredient-summary");
const inventorySearch = document.querySelector("#inventory-search");
const customInventoryForm = document.querySelector("#custom-inventory-form");
const customInventoryNameInput = document.querySelector("#custom-inventory-name");
const customInventoryGroupInput = document.querySelector("#custom-inventory-group");
const customInventoryOnHandInput = document.querySelector("#custom-inventory-on-hand");
const customInventoryParInput = document.querySelector("#custom-inventory-par");
const customInventoryUnitCostInput = document.querySelector("#custom-inventory-unit-cost");
const customInventoryPackSizeInput = document.querySelector("#custom-inventory-pack-size");
const inventoryTable = document.querySelector("#inventory-table");
const inventoryOrderTable = document.querySelector("#inventory-order-table");
const inventorySummary = document.querySelector("#inventory-summary");
const inventoryHistoryList = document.querySelector("#inventory-history-list");
const kegSummary = document.querySelector("#keg-summary");
const kegWalls = document.querySelector("#keg-walls");
const weeklyUsageSearch = document.querySelector("#weekly-usage-search");
const weeklyUsageHead = document.querySelector("#weekly-usage-head");
const pullPmbWeeklyUsageButton = document.querySelector("#pull-pmb-weekly-usage");
const weeklyUsageSummary = document.querySelector("#weekly-usage-summary");
const weeklyUsageTable = document.querySelector("#weekly-usage-table");
const clearPricesButton = document.querySelector("#clear-prices");
const clearKegPricesButton = document.querySelector("#clear-keg-prices");
const clearChargesButton = document.querySelector("#clear-charges");
const recipeForm = document.querySelector("#recipe-form");
const recipeFormTitle = document.querySelector("#recipe-form-title");
const recipeSubmitButton = document.querySelector("#recipe-submit-button");
const cancelEditButton = document.querySelector("#cancel-edit");
const addIngredientRowButton = document.querySelector("#add-ingredient-row");
const newIngredientRows = document.querySelector("#new-ingredient-rows");
const newRecipeTitleInput = document.querySelector("#new-recipe-title");
const newRecipeCategoryInput = document.querySelector("#new-recipe-category");
const newRecipeDescriptionInput = document.querySelector("#new-recipe-description");
const newRecipeImageInput = document.querySelector("#new-recipe-image");
const newRecipeImagePreview = document.querySelector("#new-recipe-image-preview");
const shuffleRecipeImageButton = document.querySelector("#shuffle-recipe-image");
const shuffleRecipeDescriptionButton = document.querySelector("#shuffle-recipe-description");
const recipeGeneratedSummary = document.querySelector("#recipe-generated-summary");
const pmbProductForm = document.querySelector("#pmb-product-form");
const pmbProductKind = document.querySelector("#pmb-product-kind");
const pmbProductNameInput = document.querySelector("#pmb-product-name");
const pmbProductBreweryInput = document.querySelector("#pmb-product-brewery");
const pmbProductStyleInput = document.querySelector("#pmb-product-style");
const pmbProductPriceInput = document.querySelector("#pmb-product-price");
const pmbProductServingInput = document.querySelector("#pmb-product-serving");
const pmbProductAbvInput = document.querySelector("#pmb-product-abv");
const pmbProductIbuInput = document.querySelector("#pmb-product-ibu");
const pmbProductKegOzInput = document.querySelector("#pmb-product-keg-oz");
const pmbProductKegCostInput = document.querySelector("#pmb-product-keg-cost");
const pmbProductMarginInput = document.querySelector("#pmb-product-margin");
const pmbProductNotesInput = document.querySelector("#pmb-product-notes");
const pmbProductImageInput = document.querySelector("#pmb-product-image");
const pmbProductImagePreview = document.querySelector("#pmb-product-image-preview");
const pmbGeneratedSummary = document.querySelector("#pmb-generated-summary");
const pmbProductSubmitButton = document.querySelector("#pmb-product-submit");
const pmbProductStatus = document.querySelector("#pmb-product-status");
const shufflePmbProductImageButton = document.querySelector("#shuffle-pmb-product-image");
const shufflePmbProductDescriptionButton = document.querySelector("#shuffle-pmb-product-description");
const liquorProductForm = document.querySelector("#liquor-product-form");
const liquorProductNameInput = document.querySelector("#liquor-product-name");
const liquorProductPriceInput = document.querySelector("#liquor-product-price");
const liquorProductServingInput = document.querySelector("#liquor-product-serving");
const liquorProductAbvInput = document.querySelector("#liquor-product-abv");
const liquorProductBottleCostInput = document.querySelector("#liquor-product-bottle-cost");
const liquorProductBottleOzInput = document.querySelector("#liquor-product-bottle-oz");
const liquorProductNotesInput = document.querySelector("#liquor-product-notes");
const liquorProductSubmitButton = document.querySelector("#liquor-product-submit");
const liquorProductStatus = document.querySelector("#liquor-product-status");
const cardTemplate = document.querySelector("#recipe-card-template");

let recipes = [];
let ingredients = [];
let inventoryItems = [];
let kegWallItems = [];
let weeklyUsageItems = [];
let weeklyUsageChangeovers = [];
let weeklyUsageCurrentOverrides = loadWeeklyUsageCurrentOverrides();
let weeklyUsageHistoryOverrides = loadWeeklyUsageHistoryOverrides();
let weeklyUsageArchivedItems = loadWeeklyUsageArchivedItems();
let weeklyUsageSyncLoading = false;
let weeklyUsageSyncMessage = "Pull missing completed Monday-Sunday volume reports from Pour My Beer.";
let kegPricingItems = [];
let priceOverrides = loadOverrides();
let kegPriceOverrides = loadKegPriceOverrides();
let chargeOverrides = loadChargeOverrides();
let customBeerKegs = loadCustomBeerKegs();
let customLiquorTaps = loadCustomLiquorTaps();
let comingSoonItems = loadComingSoonItems();
let tapReplacementOverrides = loadTapReplacementOverrides();
let customRecipes = loadCustomRecipes();
let inactiveRecipeIds = loadInactiveRecipeIds();
let editedRecipes = loadEditedRecipes();
let customInventoryItems = loadCustomInventoryItems();
let inventoryOnHandOverrides = loadInventoryOnHandOverrides();
let inventoryParOverrides = loadInventoryParOverrides();
let inventoryHistory = loadInventoryHistory();
let inventorySourceRows = [];
let inventorySharedUpdatedAt = "";
let inventorySharedMessage = "Loading shared inventory...";
let inventorySharedSaving = false;
const inventoryFieldSyncTimers = new Map();
let inventoryFieldSyncQueue = Promise.resolve();
let kegOnHandOverrides = loadKegOnHandOverrides();
let kegParOverrides = loadKegParOverrides();
let kegOnDeckOverrides = loadKegOnDeckOverrides();
let inventoryParEditState = {};
let editingRecipeId = null;
let vendorSyncScope = "all";
let vendorSyncMessage = "Press sync to check mapped vendors automatically. Vendors without a supported connection will report what is still needed.";
let vendorSyncRunning = false;
let kegLiveLevels = new Map();
let kegSyncMessage = "Refresh keg levels to pull current percentages from Pour My Beer.";
let kegSyncLoading = false;
let kegUpdatedAt = "";
let kegConfigUpdateRunning = false;
let kegDeviceLevels = new Map();
let kegTemplateAssignments = new Map();
let parAgentState = null;
let parAgentRunning = false;
let parAgentMessage = "Weekly par agent has not run yet.";
let parAgentStateSyncTimer = null;
let activeKegAdjustKey = "";
let pmbProductSaving = false;
let liquorProductSaving = false;
let recipeImageShuffleIndex = 1;
let pmbProductImageShuffleIndex = 1;
let lastGeneratedRecipeDescription = "";
let lastGeneratedRecipeImage = "";
let lastGeneratedPmbProductDescription = "";
let lastGeneratedPmbProductImage = "";
let recipeLookupItems = [];
let recipeLookupImageIndex = 0;
let recipeLookupTimer = null;
let recipeLookupRequestId = 0;
let beerLookupItems = [];
let beerLookupImageIndex = 0;
let beerLookupDescriptionIndex = 0;
let beerLookupTimer = null;
let beerLookupRequestId = 0;
let liveTapPrices = new Map();
let liveTapPriceItems = [];
let liveTapPricingMessage = "Checking Pour My Beer for current tap prices...";
let liveTapPricingUpdatedAt = "";
let activeOperationsTab = "keg-levels";

init();

async function init() {
  if (isEmployeeDashboard) {
    const [csv, newCocktailsCsv] = await Promise.all([
      fetchCsv(CSV_PATH),
      fetchCsv(NEW_COCKTAILS_CSV_PATH),
    ]);

    recipes = [
      ...applyMenuOrder(parseRecipes(parseCsv(csv))),
      ...applyRecipeOrder(parseRecipes(parseCsv(newCocktailsCsv)), NEW_RECIPE_ORDER),
      ...customRecipes,
    ].map(applyRecipeEdits);
    ingredients = buildIngredientCatalog(getActiveRecipes());
    hydrateCategoryFilter(recipes);
    bindEvents();
    renderEmployeeDashboard();
    return;
  }

  const [csv, newCocktailsCsv, inventoryCsv, kegLevelsCsv, weeklyUsageCsv, weeklyUsageExtraCsv, weeklyUsageChangeoversCsv] = await Promise.all([
    fetchCsv(CSV_PATH),
    fetchCsv(NEW_COCKTAILS_CSV_PATH),
    fetchCsv(INVENTORY_CSV_PATH),
    fetchOptionalCsv(KEG_LEVELS_CSV_PATH),
    fetchOptionalCsv(WEEKLY_USAGE_CSV_PATH),
    fetchOptionalCsv(WEEKLY_USAGE_EXTRA_CSV_PATH),
    fetchOptionalCsv(WEEKLY_USAGE_CHANGEOVERS_CSV_PATH),
  ]);

  recipes = [
    ...applyMenuOrder(parseRecipes(parseCsv(csv))),
    ...applyRecipeOrder(parseRecipes(parseCsv(newCocktailsCsv)), NEW_RECIPE_ORDER),
    ...customRecipes,
  ].map(applyRecipeEdits);
  ingredients = buildIngredientCatalog(getActiveRecipes());
  inventorySourceRows = parseCsv(inventoryCsv);
  migrateInventoryOnHandOverrides(inventorySourceRows);
  inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
  await loadSharedInventoryState();
  inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
  kegWallItems = kegLevelsCsv ? parseKegLevels(parseCsv(kegLevelsCsv)) : [];
  kegPricingItems = buildKegPricingCatalog(kegWallItems);
  weeklyUsageItems = weeklyUsageCsv ? parseWeeklyUsage(parseCsv(weeklyUsageCsv)) : [];
  if (weeklyUsageExtraCsv) {
    weeklyUsageItems = mergeWeeklyUsageExtraHistory(weeklyUsageItems, parseWeeklyUsageExtraHistory(parseCsv(weeklyUsageExtraCsv)));
  }
  weeklyUsageChangeovers = weeklyUsageChangeoversCsv ? parseWeeklyUsageChangeovers(parseCsv(weeklyUsageChangeoversCsv)) : [];
  applyWeeklyUsageProductChangeovers();
  await loadParAgentState();
  hydrateCategoryFilter(recipes);
  bindEvents();
  addIngredientRow();
  addIngredientRow();
  addIngredientRow();
  syncPmbProductDefaults();
  syncRecipeCreativeDefaults();
  syncRecipeBuilderSummary();
  clearBeerLookupResult();
  render();
  runKegLevelSync();
  runTapPricingSync();
}

function bindEvents() {
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });
  document.querySelectorAll(".operation-tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.operationTab));
  });

  recipeSearch.addEventListener("input", renderRecipes);
  categoryFilter.addEventListener("change", renderRecipes);

  if (isEmployeeDashboard) return;

  oldSearch.addEventListener("input", renderOldRecipes);
  pricingSearch.addEventListener("input", renderPricing);
  ingredientSearch.addEventListener("input", renderIngredients);
  inventorySearch.addEventListener("input", renderInventory);
  customInventoryForm?.addEventListener("submit", addCustomInventoryItem);
  weeklyUsageSearch?.addEventListener("input", renderWeeklyUsage);
  pullPmbWeeklyUsageButton?.addEventListener("click", runPmbWeeklyUsageSync);
  recipeForm.addEventListener("submit", addCustomRecipe);
  addIngredientRowButton.addEventListener("click", addIngredientRow);
  cancelEditButton.addEventListener("click", resetRecipeForm);
  newRecipeTitleInput?.addEventListener("input", () => {
    syncRecipeCreativeDefaults({ preserveDescription: true, preserveImage: true });
    scheduleRecipeImageLookup();
    syncRecipeBuilderSummary();
  });
  newRecipeCategoryInput?.addEventListener("change", () => {
    syncRecipeCreativeDefaults({ preserveDescription: true, preserveImage: true });
    syncRecipeBuilderSummary();
  });
  document.querySelector("#new-recipe-charge")?.addEventListener("input", syncRecipeBuilderSummary);
  shuffleRecipeImageButton?.addEventListener("click", () => {
    shuffleRecipeLookupImage();
  });
  shuffleRecipeDescriptionButton?.addEventListener("click", () => {
    syncRecipeCreativeDefaults({ forceDescription: true, preserveImage: true });
  });
  pmbProductForm?.addEventListener("submit", addPmbProduct);
  pmbProductKind?.addEventListener("change", syncPmbProductDefaults);
  pmbProductNameInput?.addEventListener("input", () => {
    syncPmbProductDefaults();
    scheduleBeerProductLookup();
  });
  pmbProductKegCostInput?.addEventListener("input", () => syncPmbProductDefaults());
  pmbProductMarginInput?.addEventListener("input", () => syncPmbProductDefaults());
  liquorProductForm?.addEventListener("submit", addLiquorProduct);
  shufflePmbProductImageButton?.addEventListener("click", () => {
    shuffleBeerLookupImage();
  });
  shufflePmbProductDescriptionButton?.addEventListener("click", () => {
    shuffleBeerLookupDescription();
  });
  clearPricesButton.addEventListener("click", () => {
    priceOverrides = {};
    saveOverrides();
    render();
  });
  clearKegPricesButton?.addEventListener("click", () => {
    kegPriceOverrides = {};
    saveKegPriceOverrides();
    render();
  });
  clearChargesButton.addEventListener("click", () => {
    chargeOverrides = {};
    saveChargeOverrides();
    render();
  });

  document.addEventListener("keydown", handleEnterKeyNavigation);
}

function switchTab(tabName) {
  const requestedTab = tabName === "operations" ? activeOperationsTab : tabName;
  const isOperationTab = OPERATION_TAB_NAMES.includes(requestedTab);
  if (isOperationTab) {
    activeOperationsTab = requestedTab;
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    const isActive = isOperationTab ? button.dataset.tab === "operations" : button.dataset.tab === requestedTab;
    button.classList.toggle("is-active", isActive);
  });

  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `${requestedTab}-panel`);
  });

  document.querySelectorAll(".operation-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.operationTab === activeOperationsTab);
  });
}

function render() {
  ingredients = buildIngredientCatalog(getActiveRecipes());
  kegPricingItems = buildKegPricingCatalog(kegWallItems);
  syncInventoryItemCatalogLinks();
  renderStats();
  renderRecipes();
  renderPricing();
  renderIngredients();
  renderInventory();
  renderKegLevels();
  renderWeeklyUsage();
  renderOldRecipes();
}

function renderEmployeeDashboard() {
  ingredients = buildIngredientCatalog(getActiveRecipes());
  renderStats();
  renderRecipes();
}

function renderStats() {
  const activeRecipes = getActiveRecipes();
  const totals = activeRecipes.map(getRecipeTotals);
  const recipeCount = activeRecipes.length;
  const totalCost = sum(totals.map((total) => total.cost));
  const totalOz = sum(totals.map((total) => total.oz));
  const avgCostPerOz = totalOz ? totalCost / totalOz : 0;
  const totalRevenue = sum(activeRecipes.map((recipe) => getRecipePricing(recipe).revenue));
  const avgMargin = totalRevenue ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
  const overrideCount = Object.keys(priceOverrides).filter((key) => {
    const override = priceOverrides[key];
    return toNumber(override?.bottleOz) && toNumber(override?.bottlePrice);
  }).length;
  const stats = isEmployeeDashboard
    ? [
        ["Recipes", recipeCount.toLocaleString()],
        ["Spirit groups", new Set(activeRecipes.map((recipe) => recipe.category)).size.toLocaleString()],
        ["Ingredients", ingredients.filter((ingredient) => ingredient.id !== "water").length.toLocaleString()],
        ["Avg batch oz", formatNumber(recipeCount ? totalOz / recipeCount : 0)],
      ]
    : [
        ["Recipes", recipeCount.toLocaleString()],
        ["Total batch cost", money(totalCost)],
        ["Avg cost per oz", money(avgCostPerOz)],
        ["Avg profit margin", `${formatNumber(avgMargin)}%`],
        ["Live ingredient prices", overrideCount.toLocaleString()],
      ];

  statsGrid.innerHTML = "";
  stats.forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    statsGrid.append(card);
  });
}

function renderRecipes() {
  const searchTerm = recipeSearch.value.trim().toLowerCase();
  const category = categoryFilter.value;
  const visibleRecipes = getActiveRecipes().filter((recipe) => {
    const matchesCategory = category === "all" || recipe.category === category;
    const haystack = `${recipe.title} ${recipe.batch} ${recipe.ingredients.map((item) => item.name).join(" ")}`.toLowerCase();
    return matchesCategory && haystack.includes(searchTerm);
  });

  recipeGrid.innerHTML = "";

  visibleRecipes.forEach((recipe) => {
    const card = createRecipeCard(recipe, "active");
    recipeGrid.append(card);
  });
}

function renderOldRecipes() {
  const searchTerm = oldSearch.value.trim().toLowerCase();
  const oldRecipes = getInactiveRecipes().filter((recipe) => {
    const haystack = `${recipe.title} ${recipe.batch} ${recipe.ingredients.map((item) => item.name).join(" ")}`.toLowerCase();
    return haystack.includes(searchTerm);
  });

  oldRecipeGrid.innerHTML = "";
  if (!oldRecipes.length) {
    oldRecipeGrid.innerHTML = `<div class="empty-state">No old recipes yet.</div>`;
    return;
  }

  oldRecipes.forEach((recipe) => {
    oldRecipeGrid.append(createRecipeCard(recipe, "inactive"));
  });
}

function createRecipeCard(recipe, state) {
  const totals = getRecipeTotals(recipe);
  const pricing = getRecipePricing(recipe);
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector("h2").textContent = recipe.title;
  card.querySelector(".recipe-card__batch").textContent = formatBatchLabel(recipe.batch);
  card.querySelector(".spirit-pill").textContent = recipe.category;
  const actions = card.querySelector(".recipe-card__actions");
  if (isEmployeeDashboard) {
    actions.remove();
  } else {
    actions.innerHTML = `
      <button class="mini-button" data-action="edit" type="button">Edit</button>
      <button class="mini-button" data-action="toggle" type="button">${state === "active" ? "Deactivate" : "Reactivate"}</button>
      ${state === "inactive" && recipe.isCustom ? '<button class="mini-button mini-button--danger" data-action="delete" type="button">Delete custom</button>' : ""}
    `;
    actions.querySelector('[data-action="edit"]').addEventListener("click", () => startEditingRecipe(recipe.id));
    actions.querySelector('[data-action="toggle"]').addEventListener("click", () => {
      if (state === "active") {
        deactivateRecipe(recipe.id);
      } else {
        reactivateRecipe(recipe.id);
      }
    });
    const deleteButton = actions.querySelector('[data-action="delete"]');
    if (deleteButton) {
      deleteButton.addEventListener("click", () => deleteCustomRecipe(recipe.id));
    }
  }
  const summaryNumbers = isEmployeeDashboard
    ? [
        ["Total oz", formatNumber(totals.oz)],
        ["ABV", `${formatNumber(totals.abvPercent)}%`],
        ["Batch", formatBatchLabel(recipe.batch)],
      ]
    : [
        ["Total cost", money(totals.cost)],
        ["Total oz", formatNumber(totals.oz)],
        ["ABV", `${formatNumber(totals.abvPercent)}%`],
        ["Profit margin", `${formatNumber(pricing.margin)}%`],
      ];
  card.querySelector(".recipe-card__numbers").innerHTML = summaryNumbers
    .map(([label, value]) => `<div class="recipe-number"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");

  if (isEmployeeDashboard) {
    card.querySelector("thead").innerHTML = `
      <tr>
        <th>Ingredient</th>
        <th>Oz</th>
      </tr>
    `;
  }

  const tbody = card.querySelector("tbody");
  recipe.ingredients.forEach((ingredient) => {
    const liveCost = getIngredientCost(ingredient);
    const addAmount = getRecipeCardAddAmount(ingredient);
    const row = document.createElement("tr");
    row.innerHTML = isEmployeeDashboard
      ? `
        <td><strong>${escapeHtml(ingredient.name)}</strong>${addAmount ? `<span class="table-note">${escapeHtml(addAmount)}</span>` : ""}</td>
        <td>${formatNumber(ingredient.oz)}</td>
      `
      : `
        <td><strong>${escapeHtml(ingredient.name)}</strong>${addAmount ? `<span class="table-note">${escapeHtml(addAmount)}</span>` : ""}</td>
        <td class="${liveCost.source === "override" ? "updated-cost" : ""}">${money(liveCost.cost)}</td>
        <td>${formatNumber(ingredient.oz)}</td>
      `;
    tbody.append(row);
  });

  if (isEmployeeDashboard) return card;

  const detailMetrics = getCalculatedMetrics(recipe, totals, pricing);
  const details = document.createElement("details");
  details.className = "recipe-card__details";
  details.innerHTML = `
    <summary class="recipe-card__details-summary">Show more</summary>
    <div class="recipe-card__details-body"></div>
  `;

  const detailsBody = details.querySelector(".recipe-card__details-body");
  const metricsTableWrap = document.createElement("div");
  metricsTableWrap.className = "recipe-table-wrap recipe-table-wrap--details";
  metricsTableWrap.innerHTML = `
    <table class="recipe-table recipe-table--details">
      <tbody>
        ${detailMetrics
          .map(
            (metric) => `
              <tr class="muted">
                <td>${escapeHtml(metric.label)}</td>
                <td>${metric.value}</td>
              </tr>`,
          )
          .join("")}
      </tbody>
    </table>
  `;
  detailsBody.append(metricsTableWrap);
  card.append(details);

  return card;
}

function renderPricing() {
  const searchTerm = pricingSearch.value.trim().toLowerCase();
  const visibleTapRows = getLiveTapPricingRows(searchTerm);

  renderPricingSummary(visibleTapRows);
  pricingTable.innerHTML = "";

  visibleTapRows.forEach((tapRow) => {
    pricingTable.append(renderTapPricingRow(tapRow));
  });
}

function renderTapPricingRow({ livePrice, recipe, kegItem }) {
  if (recipe) return renderRecipeTapPricingRow(livePrice, recipe);
  if (kegItem) return renderKegTapPricingRow(livePrice, kegItem);
  if (livePrice?.ingredient) return renderIngredientTapPricingRow(livePrice, livePrice.ingredient);
  return renderUnmappedTapPricingRow(livePrice);
}

function renderRecipeTapPricingRow(livePrice, recipe) {
  const override = chargeOverrides[recipe.id];
  const chargePerOz = toNumber(override) || livePrice?.chargePerOz || recipe.defaultChargePerOz || 0;
  const pricing = calculateRecipePricing(recipe, chargePerOz);
  const sourceLabel = override ? "Manual override" : livePrice ? `PMB live: ${livePrice.name}` : "CSV fallback";
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${formatTapCell(livePrice)}</td>
    <td>
      <strong>${escapeHtml(livePrice?.name || recipe.title)}</strong>
      <span class="table-note">${escapeHtml(sourceLabel)}</span>
    </td>
    <td data-pricing-cell="cost">${money(pricing.costPerOz)}</td>
    <td><input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(override ?? "")}" placeholder="${formatNumber(livePrice?.chargePerOz || recipe.defaultChargePerOz)}" aria-label="Charge per ounce for ${escapeHtml(recipe.title)}"></td>
    <td data-pricing-cell="margin">${formatNumber(pricing.margin)}%</td>
  `;

  const chargeInput = row.querySelector("input");
  chargeInput.addEventListener("input", () => {
    setChargeOverride(recipe.id, chargeInput.value);
    updateRecipeTapPricingRow(row, recipe, livePrice);
  });

  return row;
}

function renderKegTapPricingRow(livePrice, kegItem) {
  const costPerOz = getKegCatalogUnitCost(kegItem);
  const chargePerOz = livePrice?.chargePerOz || 0;
  const profitPerOz = chargePerOz && costPerOz ? chargePerOz - costPerOz : 0;
  const margin = chargePerOz ? (profitPerOz / chargePerOz) * 100 : 0;
  const locationLabel = getLiveTapLocationLabel(livePrice, kegItem);
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${formatTapCell(livePrice)}</td>
    <td>
      <strong>${escapeHtml(livePrice?.name || kegItem.name)}</strong>
      <span class="table-note">${escapeHtml(locationLabel)}</span>
    </td>
    <td>${costPerOz ? money(costPerOz) : "-"}</td>
    <td>${chargePerOz ? money(chargePerOz) : "-"}</td>
    <td>${chargePerOz && costPerOz ? `${formatNumber(margin)}%` : "-"}</td>
  `;
  return row;
}

function getLiveTapLocationLabel(livePrice, kegItem) {
  if (livePrice?.wall && livePrice?.tapPosition) {
    return `${livePrice.wall} ${formatNumber(livePrice.tapPosition)}`;
  }
  return kegItem?.tapSummary || "Beer tap";
}

function renderIngredientTapPricingRow(livePrice, ingredient) {
  const costPerOz = getCatalogUnitCost(ingredient);
  const chargePerOz = livePrice?.chargePerOz || 0;
  const portions = getLiveTapPortions(livePrice);
  const profitPerOz = chargePerOz && costPerOz ? chargePerOz - costPerOz : 0;
  const margin = chargePerOz ? (profitPerOz / chargePerOz) * 100 : 0;
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${formatTapCell(livePrice)}</td>
    <td>
      <strong>${escapeHtml(livePrice.name)}</strong>
      <span class="table-note">PMB live: ${escapeHtml(ingredient.name)} cost</span>
    </td>
    <td>${costPerOz ? money(costPerOz) : "-"}</td>
    <td>${portions.length ? renderPortionList(portions) : chargePerOz ? money(chargePerOz) : "-"}</td>
    <td>${portions.length && costPerOz ? renderPortionMarginList(portions, costPerOz) : chargePerOz && costPerOz ? `${formatNumber(margin)}%` : "-"}</td>
  `;
  return row;
}

function renderUnmappedTapPricingRow(livePrice) {
  const portions = getLiveTapPortions(livePrice);
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${formatTapCell(livePrice)}</td>
    <td>
      <strong>${escapeHtml(livePrice.name)}</strong>
      <span class="table-note">PMB live</span>
    </td>
    <td>-</td>
    <td>${portions.length ? renderPortionList(portions) : livePrice.chargePerOz ? money(livePrice.chargePerOz) : "-"}</td>
    <td>-</td>
  `;
  return row;
}

function getLiveTapPortions(livePrice) {
  return Array.isArray(livePrice?.portions) ? livePrice.portions.filter((portion) => portion?.name && toNumber(portion.price) > 0) : [];
}

function renderPortionList(portions) {
  return `<div class="portion-list">${portions.map((portion) => `
    <span><b>${escapeHtml(portion.name)}</b> ${money(toNumber(portion.price))}</span>
  `).join("")}</div>`;
}

function renderPortionProfitList(portions, costPerOz) {
  return `<div class="portion-list">${portions.map((portion) => {
    const servingOz = getPortionServingOz(portion);
    const profit = toNumber(portion.price) - (costPerOz * servingOz);
    return `<span><b>${escapeHtml(portion.name)}</b> ${money(profit)}</span>`;
  }).join("")}</div>`;
}

function renderPortionMarginList(portions, costPerOz) {
  return `<div class="portion-list">${portions.map((portion) => {
    const price = toNumber(portion.price);
    const servingOz = getPortionServingOz(portion);
    const profit = price - (costPerOz * servingOz);
    const margin = price ? (profit / price) * 100 : 0;
    return `<span><b>${escapeHtml(portion.name)}</b> ${formatNumber(margin)}%</span>`;
  }).join("")}</div>`;
}

function getPortionServingOz(portion) {
  return /double/i.test(portion?.name || "") ? 3 : 1.5;
}

function formatTapCell(livePrice) {
  return livePrice?.tapPosition ? `<strong>${formatNumber(livePrice.tapPosition)}</strong>` : "-";
}

function updatePricingRow(row, recipe) {
  const pricing = getRecipePricing(recipe);
  row.querySelector('[data-pricing-cell="cost"]').textContent = money(pricing.costPerOz);
  row.querySelector('[data-pricing-cell="margin"]').textContent = `${formatNumber(pricing.margin)}%`;
}

function updateRecipeTapPricingRow(row, recipe, livePrice) {
  const chargePerOz = toNumber(chargeOverrides[recipe.id]) || livePrice?.chargePerOz || recipe.defaultChargePerOz || 0;
  const pricing = calculateRecipePricing(recipe, chargePerOz);
  row.querySelector('[data-pricing-cell="cost"]').textContent = money(pricing.costPerOz);
  row.querySelector('[data-pricing-cell="margin"]').textContent = `${formatNumber(pricing.margin)}%`;
}

function renderPricingSummary(visibleTapRows = getLiveTapPricingRows(pricingSearch.value.trim().toLowerCase())) {
  const activeRecipes = getActiveRecipes();
  const pricing = activeRecipes.map(getRecipePricing);
  const revenue = sum(pricing.map((item) => item.revenue));
  const cost = sum(pricing.map((item) => item.cost));
  const profit = revenue - cost;
  const margin = revenue ? (profit / revenue) * 100 : 0;
  const liveStatus = liveTapPricingUpdatedAt ? `${visibleTapRows.length} current taps` : liveTapPricingMessage;

  pricingSummary.innerHTML = `
    <h2>Charge pricing</h2>
    <div class="summary-line"><span>Cocktail recipes</span><strong>${activeRecipes.length}</strong></div>
    <div class="summary-line"><span>Current PMB taps</span><strong>${liveTapPriceItems.length || visibleTapRows.length}</strong></div>
    <div class="summary-line"><span>Charge overrides</span><strong>${countChargeOverrides()}</strong></div>
    <div class="summary-line"><span>PMB live prices</span><strong>${escapeHtml(liveStatus)}</strong></div>
    <div class="summary-line"><span>Projected batch revenue</span><strong>${money(revenue)}</strong></div>
    <div class="summary-line"><span>Projected batch profit</span><strong>${money(profit)}</strong></div>
    <div class="summary-line"><span>Projected margin</span><strong>${formatNumber(margin)}%</strong></div>
  `;
}

function renderIngredients() {
  const searchTerm = ingredientSearch.value.trim().toLowerCase();
  const visibleIngredients = ingredients.filter((ingredient) => {
    if (ingredient.id === "water") return false;
    if (isHiddenPricingIngredient(ingredient)) return false;
    const haystack = `${ingredient.name} ${ingredient.recipes.join(" ")}`.toLowerCase();
    return haystack.includes(searchTerm);
  });
  const visibleKegs = kegPricingItems.filter((item) => {
    const haystack = `${item.name} ${item.wall} ${item.tapNumber} ${item.tapSummary} ${item.vendor}`.toLowerCase();
    return haystack.includes(searchTerm);
  });
  const groupedIngredients = groupIngredientsForDisplay(visibleIngredients);
  const groupedKegs = groupKegPricingItemsForDisplay(visibleKegs);

  renderIngredientSummary(visibleIngredients, visibleKegs);
  ingredientTable.innerHTML = "";
  if (kegPricingTable) kegPricingTable.innerHTML = "";

  groupedIngredients.forEach(([groupName, items]) => {
    const groupRow = document.createElement("tr");
    groupRow.className = "ingredient-group-row";
    groupRow.innerHTML = `<td colspan="6">${escapeHtml(groupName)}</td>`;
    ingredientTable.append(groupRow);

    items.forEach((ingredient) => {
      const override = priceOverrides[ingredient.id] || {};
      const currentUnitCost = getCatalogUnitCost(ingredient);
      const mappedBottleOz = ingredient.vendorProduct?.bottleOz ? formatNumber(ingredient.vendorProduct.bottleOz) : "";
      const previousPriceNote = getPreviousPriceNote(override);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <strong>${escapeHtml(ingredient.name)}</strong>
          ${ingredient.vendorProduct ? `<span class="table-note table-note--accent">${escapeHtml(ingredient.vendorProduct.vendor)} mapped</span><span class="table-note">${escapeHtml(ingredient.vendorProduct.productName)}</span>` : ""}
        </td>
        <td>${money(currentUnitCost)}</td>
        <td><input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(override.bottleOz ?? "")}" placeholder="${escapeHtml(mappedBottleOz)}" aria-label="Bottle ounces for ${escapeHtml(ingredient.name)}"></td>
        <td><input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(override.bottlePrice ?? "")}" aria-label="Bottle price for ${escapeHtml(ingredient.name)}"></td>
        <td class="muted">${formatUpdatedAt(override.updatedAt)}${previousPriceNote ? `<span class="table-note">${escapeHtml(previousPriceNote)}</span>` : ""}</td>
        <td><button class="mini-button" type="button">Update</button></td>
      `;

      const [bottleOzInput, bottlePriceInput] = row.querySelectorAll("input");
      const updateButton = row.querySelector("button");
      updateButton.addEventListener("click", () => saveIngredientOverride(ingredient.id, bottleOzInput.value, bottlePriceInput.value));
      ingredientTable.append(row);
    });
  });

  groupedKegs.forEach(([vendorName, items]) => {
    const groupRow = document.createElement("tr");
    groupRow.className = "ingredient-group-row";
    groupRow.innerHTML = `<td colspan="7">${escapeHtml(vendorName)}</td>`;
    kegPricingTable?.append(groupRow);

    items.forEach((item) => {
      const override = kegPriceOverrides[item.id] || {};
      const currentUnitCost = getKegCatalogUnitCost(item);
      const previousPriceNote = getPreviousPriceNote(override);
      const staleSmallKegOverride = isStaleSmallBeerKegOverride(item, override);
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="table-note table-note--accent">${escapeHtml(item.tapSummary)}</span>
          ${item.vendorProduct ? `<span class="table-note table-note--accent">Provi mapped</span><span class="table-note">${escapeHtml(item.vendorProduct.productName)}</span>` : ""}
        </td>
        <td>${vendorName === "Needs mapping" ? `<span class="table-note">${escapeHtml(vendorName)}</span>` : `${escapeHtml(vendorName)}<span class="table-note">via Provi</span>`}</td>
        <td>${money(currentUnitCost)}</td>
        <td><input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(getKegOverrideDisplayOz(item, override))}" placeholder="${escapeHtml(formatNumber(item.kegOz))}" aria-label="Keg ounces for ${escapeHtml(item.name)}"></td>
        <td><input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(staleSmallKegOverride ? "" : override.kegPrice ?? "")}" aria-label="Keg price for ${escapeHtml(item.name)}"></td>
        <td class="muted">${staleSmallKegOverride ? '<span class="table-note">Ignored old small-keg price</span>' : formatUpdatedAt(override.updatedAt)}${previousPriceNote && !staleSmallKegOverride ? `<span class="table-note">${escapeHtml(previousPriceNote)}</span>` : ""}</td>
        <td><button class="mini-button" type="button">Update</button></td>
      `;

      const [kegOzInput, kegPriceInput] = row.querySelectorAll("input");
      const updateButton = row.querySelector("button");
      updateButton.addEventListener("click", () => saveKegPriceOverride(item.id, kegOzInput.value, kegPriceInput.value, item));
      kegPricingTable?.append(row);
    });
  });
}

function renderIngredientSummary(visibleIngredientsInput = ingredients.filter((ingredient) => ingredient.id !== "water"), visibleKegsInput = kegPricingItems) {
  const visibleIngredients = visibleIngredientsInput.filter((ingredient) => ingredient.id !== "water");
  const visibleKegs = visibleKegsInput;
  const proofCount = countVendorMappingsByName(visibleIngredients, "Proof");
  const ohlqCount = countVendorMappingsByName(visibleIngredients, "OHLQ");
  const proviKegCount = visibleKegs.filter((item) => item.vendorProduct?.syncVendor === "Provi").length;
  const kegOverrides = countKegPriceOverrides();
  const kegTrackedValue = sum(visibleKegs.map((item) => getKegPrice(item)));

  ingredientSummary.innerHTML = `
    <h2>Pricing</h2>
    <div class="sync-panel">
      <h3>Vendor Sync</h3>
      <p class="sync-copy">Updates mapped ingredients and beer kegs through the available vendor connections.</p>
      <label class="sync-field">
        <span>Vendor scope</span>
        <select id="vendor-sync-scope">
          <option value="all"${vendorSyncScope === "all" ? " selected" : ""}>All mapped vendors</option>
          <option value="Provi"${vendorSyncScope === "Provi" ? " selected" : ""}>Provi</option>
          <option value="OHLQ"${vendorSyncScope === "OHLQ" ? " selected" : ""}>OHLQ</option>
        </select>
      </label>
      <div class="sync-actions">
        <button class="primary-button" id="run-vendor-sync" type="button"${vendorSyncRunning ? " disabled" : ""}>${vendorSyncRunning ? "Syncing..." : "Sync Prices"}</button>
      </div>
      <p class="sync-status">${escapeHtml(vendorSyncMessage)}</p>
    </div>
    <div class="summary-line"><span>Unique ingredients</span><strong>${visibleIngredients.length}</strong></div>
    <div class="summary-line"><span>With bottle overrides</span><strong>${countOverrides()}</strong></div>
    <div class="summary-line"><span>Mapped to vendors</span><strong>${countVendorMappings(visibleIngredients)}</strong></div>
    <div class="summary-line"><span>Proof mapped</span><strong>${proofCount}</strong></div>
    <div class="summary-line"><span>OHLQ mapped</span><strong>${ohlqCount}</strong></div>
    <div class="summary-line"><span>Beer kegs tracked</span><strong>${visibleKegs.length}</strong></div>
    <div class="summary-line"><span>Kegs via Provi</span><strong>${proviKegCount}</strong></div>
    <div class="summary-line"><span>Keg overrides</span><strong>${kegOverrides}</strong></div>
    <div class="summary-line"><span>Keg catalog value</span><strong>${money(kegTrackedValue)}</strong></div>
    <div class="summary-line"><span>Total ounces tracked</span><strong>${formatNumber(sum(visibleIngredients.map((item) => item.totalOz)))}</strong></div>
    <div class="summary-line"><span>Estimated catalog cost</span><strong>${money(sum(visibleIngredients.map((item) => getCatalogCost(item))))}</strong></div>
  `;

  bindIngredientSummaryEvents();
}

function renderInventory() {
  const visibleItems = getVisibleInventoryItems();
  const groupedItems = groupInventoryForDisplay(visibleItems);
  const reorderItems = getInventoryReorderItems(visibleItems);

  renderInventorySummary(visibleItems, reorderItems);
  renderInventoryStockTable(groupedItems);
  renderInventoryOrderTable(reorderItems);
  renderInventoryHistory();
}

function renderKegLevels() {
  if (!kegSummary || !kegWalls) return;

  const wallNames = ["Patio", "Main", "Karaoke"];
  const totalTaps = kegWallItems.length;
  const cocktailCount = kegWallItems.filter((item) => normalizeTitle(item.type) === "cocktail").length;
  const shotCount = kegWallItems.filter((item) => normalizeTitle(item.type) === "shots").length;
  const liveCount = kegWallItems.filter((item) => getKegLiveRow(item)).length;
  const reorderCount = kegWallItems.filter((item) => getKegNeed(item) > 0).length;
  const currentInventoryValue = sum(kegWallItems.map((item) => getKegCurrentValue(item, getKegLiveRow(item))));

  kegSummary.innerHTML = `
    <h2>Keg Levels</h2>
    <div class="sync-panel sync-panel--keg-actions">
      <div class="sync-actions sync-actions--keg-primary">
        <button class="primary-button" id="run-keg-vendor-sync" type="button"${vendorSyncRunning ? " disabled" : ""}>${vendorSyncRunning ? "Syncing..." : "Sync Prices"}</button>
        <button class="primary-button" id="refresh-keg-levels" type="button"${kegSyncLoading || kegConfigUpdateRunning ? " disabled" : ""}>${kegSyncLoading ? "Refreshing..." : "Refresh keg levels"}</button>
        <button class="ghost-button" id="send-keg-config-update" type="button"${kegSyncLoading || kegConfigUpdateRunning ? " disabled" : ""}>${kegConfigUpdateRunning ? "Sending..." : "Send config update"}</button>
      </div>
      <p class="sync-status">${escapeHtml(kegSyncMessage)}${kegUpdatedAt ? ` Last updated ${escapeHtml(formatUpdatedAt(kegUpdatedAt))}.` : ""}</p>
      <p class="sync-status">${escapeHtml(vendorSyncMessage)}</p>
    </div>
    <div class="keg-summary-stats">
      <div class="summary-line"><span>Total taps</span><strong>${totalTaps}</strong></div>
      <div class="summary-line"><span>Walls tracked</span><strong>${wallNames.length}</strong></div>
      <div class="summary-line"><span>Cocktail taps</span><strong>${cocktailCount}</strong></div>
      <div class="summary-line"><span>Shot lines</span><strong>${shotCount}</strong></div>
      <div class="summary-line"><span>Live levels found</span><strong>${liveCount}</strong></div>
      <div class="summary-line"><span>Kegs below par</span><strong>${reorderCount}</strong></div>
      <div class="summary-line"><span>Current line value</span><strong>${money(currentInventoryValue)}</strong></div>
    </div>
    ${renderParAgentPanel()}
    ${renderCocktailsToMakePanel()}
  `;

  kegWalls.innerHTML = wallNames
    .map((wallName) => renderKegWallBlock(wallName, kegWallItems.filter((item) => item.wall === wallName)))
    .join("") + renderComingSoonBlock();

  bindKegLevelEvents();
}

function renderComingSoonBlock() {
  const activeItems = comingSoonItems.filter((item) => !item.replacedAt);
  const archivedItems = comingSoonItems.filter((item) => item.replacedAt).slice(-5);
  const items = [...activeItems, ...archivedItems];

  return `
    <section class="keg-wall-card coming-soon-card">
      <div class="keg-wall-card__header">
        <div>
          <p class="eyebrow">Next up</p>
          <h2>Coming Soon</h2>
        </div>
        <div class="keg-wall-card__meta">
          <strong>${activeItems.length} waiting</strong>
          <span class="keg-wall-card__badge">${archivedItems.length} replaced</span>
        </div>
      </div>
      ${items.length ? `
        <div class="coming-soon-list">
          ${items.map(renderComingSoonItem).join("")}
        </div>
      ` : '<div class="empty-state">New beer products and recipes will appear here.</div>'}
    </section>
  `;
}

function renderComingSoonItem(item) {
  const isBeer = item.kind === "beer";
  const isRecipe = item.kind === "recipe";
  const currentMargin = toNumber(item.targetMargin) || DEFAULT_BEER_TARGET_MARGIN;
  const currentPrice = getGeneratedBeerChargePerOz(item.kegCost, currentMargin);
  const replacement = item.replaceTapKey ? tapReplacementOverrides[item.replaceTapKey] : null;
  return `
    <article class="coming-soon-item" data-coming-soon-id="${escapeHtml(item.id)}">
      ${item.imageUrl ? `<img class="coming-soon-item__image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ""}
      <div class="coming-soon-item__body">
        <div class="coming-soon-item__title">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${isBeer ? "Beer keg" : "Cocktail recipe"}</span>
        </div>
        ${item.description ? `<p>${escapeHtml(item.description)}</p>` : ""}
        ${isRecipe ? renderComingSoonRecipeStats(item) : ""}
        ${isBeer ? `
          <div class="coming-soon-controls">
            <label>
              <span>Margin %</span>
              <input class="inventory-input coming-soon-margin" type="text" inputmode="decimal" value="${escapeHtml(formatNumber(currentMargin))}">
            </label>
            <span class="generated-beer-summary">${currentPrice ? `${money(currentPrice)}/oz generated` : "Add keg cost"}</span>
            <button class="mini-button update-coming-soon-margin" type="button"${item.plu ? "" : " disabled"}>Update PMB pricing</button>
          </div>
        ` : ""}
        ${isRecipe ? `
          <div class="coming-soon-controls">
            <button class="mini-button send-coming-soon-pmb" type="button">${item.plu ? "Update PMB product" : "Create PMB product"}</button>
            ${item.plu ? `<span class="table-note table-note--accent">PMB PLU ${escapeHtml(item.plu)}</span>` : ""}
          </div>
        ` : ""}
        <div class="coming-soon-controls">
          <label>
            <span>Replace tap</span>
            <select class="coming-soon-replace-select"${item.replacedAt ? " disabled" : ""}>
              <option value="">Choose current wall product</option>
              ${getReplaceableTapOptions(item.replaceTapKey)}
            </select>
          </label>
          <button class="primary-button replace-coming-soon" type="button"${item.replacedAt ? " disabled" : ""}>Replace wall product</button>
          ${item.replacedAt ? `<span class="table-note table-note--accent">Replaced ${escapeHtml(replacement?.oldBrand || "wall product")} on ${escapeHtml(replacement?.tapLabel || "tap")}.</span>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderComingSoonRecipeStats(item) {
  return `
    <div class="coming-soon-stats">
      <span><b>${money(item.chargePerOz)}</b> / oz</span>
      <span><b>${money(item.costPerOz)}</b> cost / oz</span>
      <span><b>${formatNumber(item.abvPercent)}%</b> ABV</span>
      <span><b>${formatNumber(item.margin)}%</b> margin</span>
      <span><b>${item.pourOz ? formatNumber(item.pourOz) : "-"}</b> oz pour</span>
      <span><b>${item.chargePerPour ? money(item.chargePerPour) : "-"}</b> / pour</span>
    </div>
  `;
}

function getReplaceableTapOptions(selectedKey = "") {
  return kegWallItems
    .map((item) => {
      const key = getKegItemKey(item);
      const label = `${item.wall} ${item.tapNumber} - ${item.brand}`;
      return `<option value="${escapeHtml(key)}"${key === selectedKey ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function getPmbSyncWeekStarts() {
  const existingTimes = getSavedWeeklyUsageStartTimes();
  const weekStarts = getCompletedMondayWeekStarts(WEEKLY_USAGE_SYNC_LOOKBACK_WEEKS);
  const missing = weekStarts.filter((start) => !existingTimes.has(start.getTime()));
  const latest = weekStarts[weekStarts.length - 1];
  if (latest && !missing.some((start) => start.getTime() === latest.getTime())) {
    missing.push(latest);
  }
  return missing.sort((a, b) => a.getTime() - b.getTime());
}

function getSavedWeeklyUsageStartTimes() {
  const counts = new Map();
  [...weeklyUsageItems, ...weeklyUsageArchivedItems].forEach((item) => {
    (item.history || []).forEach((entry) => {
      const time = getWeeklyUsageLabelTime(entry.label);
      if (time) counts.set(time, (counts.get(time) || 0) + 1);
    });
  });
  const minimumCoverage = Math.max(8, Math.floor(Math.max(weeklyUsageItems.length, 1) * 0.1));
  return new Set([...counts.entries()]
    .filter(([, count]) => count >= minimumCoverage)
    .map(([time]) => time));
}

function getCompletedMondayWeekStarts(lookbackWeeks = 12) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = today.getDay();
  const diffToThisMonday = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + diffToThisMonday);
  const latestCompletedMonday = new Date(thisMonday);
  latestCompletedMonday.setDate(thisMonday.getDate() - 7);

  return Array.from({ length: lookbackWeeks }, (_, index) => {
    const start = new Date(latestCompletedMonday);
    start.setDate(latestCompletedMonday.getDate() - ((lookbackWeeks - 1 - index) * 7));
    return start;
  });
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function syncWeeklyUsageWithCurrentPmbTaps(rawTaps = []) {
  const assignments = rawTaps
    .map(normalizeCurrentTapAssignment)
    .filter((tap) => tap.tapNumber && tap.name)
    .sort((a, b) => a.tapNumber - b.tapNumber || a.name.localeCompare(b.name));

  if (!assignments.length || !weeklyUsageItems.length) return { changed: 0, archived: 0 };

  const sourceItems = [
    ...weeklyUsageItems.map((item) => ({ ...item, sourceBucket: "active" })),
    ...weeklyUsageArchivedItems.map((item) => ({ ...item, sourceBucket: "archive" })),
  ];
  const usedSourceIds = new Set();
  const restoredArchiveIds = new Set();
  const nextItems = [];
  let changed = 0;

  assignments.forEach((assignment) => {
    const matches = sourceItems
      .filter((item) => !usedSourceIds.has(getWeeklyUsageSourceId(item)))
      .filter((item) => isWeeklyUsageAssignmentReusableMatch(item, assignment))
      .sort((a, b) => scoreWeeklyUsageAssignmentMatch(b, assignment) - scoreWeeklyUsageAssignmentMatch(a, assignment));

    matches.forEach((item) => {
      usedSourceIds.add(getWeeklyUsageSourceId(item));
      if (item.sourceBucket === "archive") restoredArchiveIds.add(item.archiveId || item.id);
    });

    const nextItem = buildWeeklyUsageItemFromAssignment(assignment, matches);
    if (nextItem) {
      nextItems.push(nextItem);
    }
  });

  let archived = 0;
  sourceItems
    .filter((item) => item.sourceBucket === "active")
    .filter((item) => !usedSourceIds.has(getWeeklyUsageSourceId(item)))
    .forEach((item) => {
      if (!(item.history || []).length) return;
      archiveWeeklyUsageItem(item, {
        replacedBy: getReplacementNameForArchivedWeeklyUsageItem(item, assignments),
        replacedAt: new Date().toISOString(),
      });
      delete weeklyUsageCurrentOverrides[item.id];
      archived += 1;
    });

  const previousSignature = JSON.stringify(weeklyUsageItems.map((item) => ({
    id: item.id,
    tapNumber: item.tapNumber,
    name: item.name,
    history: (item.history || []).map((entry) => entry.label),
  })));
  const nextSignature = JSON.stringify(nextItems.map((item) => ({
    id: item.id,
    tapNumber: item.tapNumber,
    name: item.name,
    history: (item.history || []).map((entry) => entry.label),
  })));
  changed = previousSignature === nextSignature ? 0 : nextItems.length;

  weeklyUsageArchivedItems = weeklyUsageArchivedItems.filter((item) => !restoredArchiveIds.has(item.archiveId || item.id));
  weeklyUsageItems = nextItems.sort((a, b) => toNumber(a.tapNumber) - toNumber(b.tapNumber));
  const prunedOverrides = pruneInactiveWeeklyUsageOverrides(weeklyUsageItems);

  if (archived || restoredArchiveIds.size) saveWeeklyUsageArchivedItems();
  if (changed || prunedOverrides) {
    saveWeeklyUsageCurrentOverrides();
    saveWeeklyUsageHistoryOverrides();
  }

  return { changed, archived };
}

function getWeeklyUsageSourceId(item) {
  return `${item.sourceBucket || "active"}:${item.archiveId || item.id || slugify(`${item.tapNumber}-${item.name}`)}`;
}

function pruneInactiveWeeklyUsageOverrides(activeItems = []) {
  const activeIds = new Set(activeItems.map((item) => item.id).filter(Boolean));
  let pruned = false;

  [weeklyUsageCurrentOverrides, weeklyUsageHistoryOverrides].forEach((overrideMap) => {
    Object.keys(overrideMap).forEach((id) => {
      if (activeIds.has(id)) return;
      delete overrideMap[id];
      pruned = true;
    });
  });

  return pruned;
}

function isWeeklyUsageAssignmentReusableMatch(item, assignment) {
  const sameTap = toNumber(item.tapNumber) === toNumber(assignment.tapNumber);
  if (hasExactWeeklyUsageProductNameMatch(item.name, assignment.name)) return true;
  return sameTap && isSameWeeklyUsageProductName(item.name, assignment.name);
}

function buildWeeklyUsageItemFromAssignment(assignment, matches = []) {
  const currentName = clean(assignment.name);
  if (!currentName) return null;

  const nextId = slugify(`${assignment.tapNumber}-${currentName}`);
  const best = matches[0] || {};
  const displayUnit = getWeeklyUsageDisplayUnitForTap(assignment, best);
  const history = mergeWeeklyUsageHistory([
    ...(weeklyUsageHistoryOverrides[nextId] || []),
    ...matches.flatMap((item) => item.history || []),
  ]);
  const normalizedHistory = pruneWeeklyUsageCurrentHistory(normalizeWeeklyUsageHistoryForDisplayUnit(history, {
    tapNumber: toNumber(assignment.tapNumber),
    type: assignment.type || best.type,
    displayUnit,
  }), {
    tapNumber: toNumber(assignment.tapNumber),
    name: currentName,
  });
  const currentSource = matches.find((item) => clean(weeklyUsageCurrentOverrides[item.id] || item.currentDisplayValue));
  const currentDisplayValue = currentSource ? getWeeklyUsageCurrentDisplay(currentSource) : "";
  const oldIds = matches.map((item) => item.id).filter(Boolean);
  oldIds.forEach((id) => {
    if (id !== nextId) delete weeklyUsageCurrentOverrides[id];
  });

  weeklyUsageHistoryOverrides[nextId] = normalizedHistory;

  return {
    ...best,
    id: nextId,
    tapNumber: toNumber(assignment.tapNumber),
    name: currentName,
    wall: assignment.wall || best.wall || "",
    type: assignment.type || best.type || "",
    plu: toNumber(assignment.plu) || toNumber(best.plu),
    templateBrand: assignment.templateBrand || best.templateBrand || "",
    displayUnit,
    isLiquorShot: displayUnit === "oz",
    rawOz: 0,
    currentEquivalent: 0,
    currentDisplayValue,
    sourceBucket: undefined,
    archiveId: undefined,
    hidden: false,
    replacedBy: "",
    replacedAt: "",
    history: normalizedHistory,
    average: calculateAverage(normalizedHistory.map((entry) => entry.value)),
  };
}

function scoreWeeklyUsageAssignmentMatch(item, assignment) {
  let score = 0;
  if (toNumber(item.tapNumber) === toNumber(assignment.tapNumber)) score += 80;
  if (normalizeWeeklyUsageName(item.name, { stripWallNumber: false }) === normalizeWeeklyUsageName(assignment.name, { stripWallNumber: false })) score += 50;
  if (item.sourceBucket === "active") score += 15;
  score += Math.min(20, (item.history || []).length);
  return score;
}

function getWeeklyUsageCurrentChangeover(item) {
  const tapNumber = toNumber(item?.tapNumber);
  if (!tapNumber) return null;
  return weeklyUsageChangeovers.find((changeover) => (
    toNumber(changeover.tapNumber) === tapNumber
    && isSameWeeklyUsageProductName(item?.name, changeover.currentName)
  )) || null;
}

function isWeeklyUsageEntryCurrentForChangeover(entry, changeover) {
  const entryTime = getWeeklyUsageLabelTime(entry?.label);
  const boundaryTime = getWeeklyUsageChangeoverBoundaryTime(changeover?.effectiveDate);
  if (!entryTime || !boundaryTime) return true;
  return changeover.splitWeek === "previous" ? entryTime > boundaryTime : entryTime >= boundaryTime;
}

function isWeeklyUsageItemActiveForLabel(item, label) {
  const changeover = getWeeklyUsageCurrentChangeover(item);
  if (!changeover) return true;
  return isWeeklyUsageEntryCurrentForChangeover({ label }, changeover);
}

function pruneWeeklyUsageCurrentHistory(history, item) {
  const changeover = getWeeklyUsageCurrentChangeover(item);
  if (!changeover) return history;
  return mergeWeeklyUsageHistory((history || []).filter((entry) => isWeeklyUsageEntryCurrentForChangeover(entry, changeover)));
}

function hasWeeklyUsageKnownActiveHistory(item, label) {
  if (getWeeklyUsageCurrentChangeover(item)) return true;
  return (item?.history || []).some((entry) => entry.label !== label);
}

function shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label) {
  if (!isWeeklyUsageItemActiveForLabel(item, label)) return false;
  const isCurrentTapZero = reportItem?.isCurrentTap && toNumber(reportItem?.volumeOz) === 0;
  if (isCurrentTapZero && !hasWeeklyUsageKnownActiveHistory(item, label)) return false;
  return true;
}

function getReplacementNameForArchivedWeeklyUsageItem(item, assignments) {
  const sameTap = assignments.find((assignment) => toNumber(assignment.tapNumber) === toNumber(item.tapNumber));
  return clean(sameTap?.name);
}

function normalizeCurrentTapAssignment(source) {
  const tapNumber = toNumber(source?.tapNumber || source?.tapPosition);
  return {
    tapNumber,
    plu: toNumber(source?.plu),
    name: clean(source?.name || source?.brand || source?.product),
    wall: clean(source?.wall),
    type: clean(source?.type),
    templateBrand: clean(source?.templateBrand || source?.matchedBrand),
  };
}

function getWeeklyUsageDisplayUnitForTap(assignment, fallback = null) {
  if (isLiquorOunceTap(toNumber(assignment?.tapNumber)) || normalizeTitle(assignment?.type) === "shots") return "oz";
  if (!assignment?.tapNumber && normalizeTitle(fallback?.type) === "shots") return "oz";
  return "kegs";
}

function archiveWeeklyUsageItem(item, details = {}) {
  const id = item.archiveId || item.id || slugify(`${item.tapNumber || "pmb"}-${item.name}`);
  const archivedItem = {
    ...item,
    id,
    archiveId: id,
    hidden: true,
    replacedBy: clean(details.replacedBy || item.replacedBy),
    replacedAt: details.replacedAt || item.replacedAt || new Date().toISOString(),
    history: mergeWeeklyUsageHistory(item.history || []),
  };
  archivedItem.average = calculateAverage(archivedItem.history.map((entry) => entry.value));
  upsertWeeklyUsageArchive(archivedItem);
}

function applyWeeklyUsageProductChangeovers() {
  if (!weeklyUsageChangeovers.length || !weeklyUsageItems.length) return { changed: 0, archived: 0 };

  let changed = 0;
  let archived = 0;

  weeklyUsageChangeovers.forEach((changeover) => {
    const item = findWeeklyUsageChangeoverItem(changeover);
    const boundaryTime = getWeeklyUsageChangeoverBoundaryTime(changeover.effectiveDate);
    if (!item || !boundaryTime) return;

    const currentHistory = [];
    const previousHistory = [];
    (item.history || []).forEach((entry) => {
      const entryTime = getWeeklyUsageLabelTime(entry.label);
      if (!entryTime) {
        currentHistory.push(entry);
        return;
      }

      const belongsToPrevious = changeover.splitWeek === "previous"
        ? entryTime <= boundaryTime
        : entryTime < boundaryTime;
      if (belongsToPrevious) {
        previousHistory.push(entry);
      } else {
        currentHistory.push(entry);
      }
    });

    if (!previousHistory.length) return;

    const currentMerged = mergeWeeklyUsageHistory(currentHistory);
    const previousMerged = mergeWeeklyUsageHistory(previousHistory);
    const archiveId = slugify(`${changeover.tapNumber}-${changeover.previousName}`);
    upsertWeeklyUsageArchive({
      id: archiveId,
      archiveId,
      tapNumber: changeover.tapNumber,
      name: changeover.previousName,
      wall: item.wall,
      type: item.type,
      displayUnit: item.displayUnit,
      isLiquorShot: item.isLiquorShot,
      hidden: true,
      replacedBy: item.name,
      replacedAt: `${changeover.effectiveDate}T00:00:00`,
      history: previousMerged,
      average: calculateAverage(previousMerged.map((entry) => entry.value)),
    });
    pruneWeeklyUsageArchiveHistory(archiveId, (entry) => {
      const entryTime = getWeeklyUsageLabelTime(entry.label);
      if (!entryTime) return true;
      return changeover.splitWeek === "previous" ? entryTime <= boundaryTime : entryTime < boundaryTime;
    });

    item.history = currentMerged;
    item.average = calculateAverage(currentMerged.map((entry) => entry.value));
    weeklyUsageHistoryOverrides[item.id] = currentMerged;
    changed += 1;
    archived += 1;
  });

  if (changed) saveWeeklyUsageHistoryOverrides();
  if (archived) saveWeeklyUsageArchivedItems();
  return { changed, archived };
}

function findWeeklyUsageChangeoverItem(changeover) {
  const sameTap = weeklyUsageItems.filter((item) => toNumber(item.tapNumber) === toNumber(changeover.tapNumber));
  return sameTap.find((item) => isSameWeeklyUsageProductName(item.name, changeover.currentName)) || null;
}

function getWeeklyUsageChangeoverBoundaryTime(effectiveDate) {
  const date = parseWeeklyUsageLocalDate(effectiveDate);
  if (!date) return 0;

  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diffToMonday);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function parseWeeklyUsageLocalDate(value) {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(date.getTime()) ? date : null;
}

function pruneWeeklyUsageArchiveHistory(archiveId, shouldKeep) {
  const index = weeklyUsageArchivedItems.findIndex((item) => (item.archiveId || item.id) === archiveId);
  if (index === -1) return;

  const item = weeklyUsageArchivedItems[index];
  const history = mergeWeeklyUsageHistory((item.history || []).filter(shouldKeep));
  weeklyUsageArchivedItems[index] = {
    ...item,
    history,
    average: calculateAverage(history.map((entry) => entry.value)),
  };
}

function upsertWeeklyUsageArchive(item) {
  const id = item.archiveId || item.id;
  if (!id) return;
  const existingIndex = weeklyUsageArchivedItems.findIndex((entry) => (entry.archiveId || entry.id) === id);
  if (existingIndex === -1) {
    weeklyUsageArchivedItems.push(item);
    return;
  }

  const existing = weeklyUsageArchivedItems[existingIndex];
  const history = mergeWeeklyUsageHistory([...(item.history || []), ...(existing.history || [])]);
  weeklyUsageArchivedItems[existingIndex] = {
    ...existing,
    ...item,
    history,
    average: calculateAverage(history.map((entry) => entry.value)),
  };
}

function renderWeeklyUsageArchiveSummary() {
  const archived = weeklyUsageArchivedItems
    .filter((item) => (item.history || []).length)
    .sort((a, b) => toNumber(a.tapNumber) - toNumber(b.tapNumber) || a.name.localeCompare(b.name));

  if (!archived.length) {
    return "";
  }

  return `
    <details class="weekly-usage-archive">
      <summary>
        <span>Replaced product history</span>
        <strong>${archived.length}</strong>
      </summary>
      <div class="weekly-usage-archive__list">
        ${archived.map((item) => `
          <div class="weekly-usage-archive__item">
            <span>${escapeHtml(item.tapNumber ? `Tap ${item.tapNumber}` : "PMB")}</span>
            <strong>${escapeHtml(item.name)}</strong>
            <small>${item.replacedBy ? `Now ${escapeHtml(item.replacedBy)}` : "Archived"} | ${escapeHtml(formatUsageDisplay(item.average, item.displayUnit))} avg | ${(item.history || []).length} weeks</small>
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function renderWeeklyUsage() {
  if (!weeklyUsageSummary || !weeklyUsageTable || !weeklyUsageHead) return;

  const searchTerm = clean(weeklyUsageSearch?.value).toLowerCase();
  const visibleActiveItems = weeklyUsageItems
    .filter((item) => !searchTerm || weeklyUsageItemMatchesSearch(item, searchTerm))
    .map((item) => ({ ...item, isArchivedSearchResult: false }));
  const visibleArchivedItems = searchTerm
    ? weeklyUsageArchivedItems
      .filter((item) => (item.history || []).length)
      .filter((item) => weeklyUsageItemMatchesSearch(item, searchTerm))
      .map((item) => ({ ...item, isArchivedSearchResult: true }))
    : [];
  const visibleItems = [...visibleActiveItems, ...visibleArchivedItems]
    .sort((a, b) => (
      Number(a.isArchivedSearchResult) - Number(b.isArchivedSearchResult)
      || toNumber(a.tapNumber) - toNumber(b.tapNumber)
      || clean(a.name).localeCompare(clean(b.name))
    ));

  const latestLabel = weeklyUsageItems[0]?.history?.[0]?.label || "Latest week";
  const trackedWeeks = visibleItems.map((item) => item.history.length).filter(Boolean);
  const activeRows = visibleItems.filter((item) => !item.isArchivedSearchResult).length;
  const searchArchiveRows = visibleItems.filter((item) => item.isArchivedSearchResult).length;
  const averageWeeks = trackedWeeks.length ? sum(trackedWeeks) / trackedWeeks.length : 0;
  const historyHeaders = getWeeklyUsageHistoryHeaders(visibleItems);
  const weeklyUsageTableElement = weeklyUsageHead.closest("table");
  if (weeklyUsageTableElement) {
    const tableWidth = `${530 + (historyHeaders.length * 112)}px`;
    weeklyUsageTableElement.style.width = tableWidth;
    weeklyUsageTableElement.style.minWidth = tableWidth;
    weeklyUsageTableElement.querySelector("colgroup")?.remove();
    weeklyUsageTableElement.insertAdjacentHTML("afterbegin", `
      <colgroup>
        <col style="width: 70px;">
        <col style="width: 340px;">
        <col style="width: 120px;">
        ${historyHeaders.map(() => '<col style="width: 112px;">').join("")}
      </colgroup>
    `);
  }

  if (pullPmbWeeklyUsageButton) {
    pullPmbWeeklyUsageButton.textContent = weeklyUsageSyncLoading ? "Pulling..." : "Pull PMB report";
    pullPmbWeeklyUsageButton.disabled = weeklyUsageSyncLoading;
  }

  const archivedCount = weeklyUsageArchivedItems.filter((item) => (item.history || []).length).length;

  weeklyUsageSummary.innerHTML = `
    <h2>Weekly Usage</h2>
    <div class="weekly-usage-summary__hero">
      <span>Latest history week</span>
      <strong>${escapeHtml(latestLabel)}</strong>
    </div>
    <div class="weekly-usage-summary__grid">
      <div><strong>${visibleItems.length}</strong><span>Rows</span></div>
      <div><strong>${activeRows}</strong><span>Current taps</span></div>
      <div><strong>${searchArchiveRows}</strong><span>Search history</span></div>
    </div>
    <div class="summary-line"><span>Avg weeks tracked</span><strong>${trackedWeeks.length ? formatNumber(averageWeeks) : "0"}</strong></div>
    <div class="summary-line"><span>Replaced histories</span><strong>${formatNumber(archivedCount)}</strong></div>
    <div class="sync-panel sync-panel--weekly-usage">
      <p class="sync-copy">Pulls missing completed Monday-Sunday PMB Reporting volume and saves each week into this tracker.</p>
      <p class="sync-status">${escapeHtml(weeklyUsageSyncMessage)}</p>
    </div>
    ${renderWeeklyUsageArchiveSummary()}
  `;

  weeklyUsageHead.innerHTML = `
    <tr>
      <th>Tap #</th>
      <th>Product</th>
      <th class="weekly-usage-average">Avg weekly</th>
      ${historyHeaders.map((label) => `<th class="weekly-usage-week">${formatWeeklyUsageHeader(label)}</th>`).join("")}
    </tr>
  `;

  weeklyUsageTable.innerHTML = visibleItems
    .map((item) => {
      const rowClass = [
        item.isLiquorShot ? "weekly-usage-row--shot" : "weekly-usage-row--pour",
        item.isArchivedSearchResult ? "weekly-usage-row--archived" : "",
      ].filter(Boolean).join(" ");
      const wallLabel = item.isArchivedSearchResult
        ? `Historical - no longer on wall${item.replacedBy ? ` | Current tap: ${item.replacedBy}` : ""}`
        : clean(item.wall) || "Unassigned";
      const historyCells = historyHeaders
        .map((label) => {
          const match = item.history.find((entry) => entry.label === label);
          return `<td class="weekly-usage-week">${escapeHtml(formatUsageDisplay(match?.value, item.displayUnit))}</td>`;
        })
        .join("");
      const averageDisplay = item.history.length ? formatUsageDisplay(item.average, item.displayUnit) : "—";
      return `
        <tr class="${rowClass}">
          <td class="weekly-usage-tap"><span>${item.tapNumber || "-"}</span></td>
          <td class="weekly-usage-product">
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(wallLabel)}</span>
          </td>
          <td class="weekly-usage-average"><strong>${escapeHtml(averageDisplay)}</strong></td>
          ${historyCells}
        </tr>
      `;
    })
    .join("") || `<tr><td colspan="${3 + historyHeaders.length}" class="empty-state">No weekly usage rows match that search.</td></tr>`;
}

function weeklyUsageItemMatchesSearch(item, rawSearchTerm) {
  const searchTerm = clean(rawSearchTerm).toLowerCase();
  if (!searchTerm) return true;

  const fields = [
    item.tapNumber ? `tap ${item.tapNumber}` : "",
    item.tapNumber,
    item.wall,
    item.type,
    item.name,
    item.replacedBy,
  ];
  const haystack = fields.map(clean).filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes(searchTerm)) return true;

  const normalizedHaystack = getWeeklyUsageNameKeys(haystack, { stripWallNumber: false }).join(" ");
  const normalizedSearch = normalizeWeeklyUsageName(searchTerm, { stripWallNumber: false });
  if (normalizedSearch && normalizedHaystack.includes(normalizedSearch)) return true;

  const tokens = normalizeWeeklyUsageName(searchTerm, { stripWallNumber: false }).split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => normalizedHaystack.includes(token));
}

function getWeeklyUsageHistoryHeaders(sourceItems) {
  const labels = [];
  sourceItems.forEach((item) => {
    item.history.forEach((entry) => {
      if (!labels.includes(entry.label)) labels.push(entry.label);
    });
  });
  return sortWeeklyUsageHistory(labels.map((label) => ({ label, value: 0 }))).map((entry) => entry.label);
}

function formatWeeklyUsageHeader(label) {
  const cleaned = clean(label).replace(/\s+/g, " ");
  const parts = cleaned.split(/\s*-\s*/);
  if (parts.length >= 2) {
    return `<span class="weekly-usage-week-label"><span>${escapeHtml(parts[0])}</span><span>- ${escapeHtml(parts.slice(1).join(" - "))}</span></span>`;
  }
  return `<span class="weekly-usage-week-label"><span>${escapeHtml(cleaned)}</span></span>`;
}

function getWeeklyUsageCurrentDisplay(item) {
  if (!item) return "";
  return clean(weeklyUsageCurrentOverrides[item.id] ?? item.currentDisplayValue ?? "");
}

async function runPmbWeeklyUsageSync() {
  if (weeklyUsageSyncLoading) return;

  const weekStarts = getPmbSyncWeekStarts();
  if (!weekStarts.length) {
    weeklyUsageSyncMessage = "All recent completed Monday-Sunday weeks are already saved.";
    renderWeeklyUsage();
    return;
  }

  weeklyUsageSyncLoading = true;
  weeklyUsageSyncMessage = `Pulling ${weekStarts.length} completed PMB week${weekStarts.length === 1 ? "" : "s"}...`;
  renderWeeklyUsage();

  try {
    const params = new URLSearchParams({
      weeks: weekStarts.map(formatIsoDate).join(","),
    });
    const response = await fetch(`/api/pmb-weekly-usage?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
      },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Could not pull PMB weekly usage.");
    }

    const applied = applyPmbWeeklyUsageSync(result);
    weeklyUsageSyncMessage = applied.matched
      ? `Saved ${applied.matched} PMB row${applied.matched === 1 ? "" : "s"} across ${applied.reports} week${applied.reports === 1 ? "" : "s"}. ${applied.archived ? `${applied.archived} old/replaced product row${applied.archived === 1 ? "" : "s"} went to hidden history.` : ""}`
      : `PMB returned ${applied.reportItems} product row${applied.reportItems === 1 ? "" : "s"} across ${applied.reports} week${applied.reports === 1 ? "" : "s"}, but none matched the active tracker.`;
  } catch (error) {
    weeklyUsageSyncMessage = error.message || "Could not pull PMB weekly usage.";
  } finally {
    weeklyUsageSyncLoading = false;
    renderWeeklyUsage();
    renderKegLevels();
  }
}

function applyPmbWeeklyUsageSync(result) {
  syncWeeklyUsageWithCurrentPmbTaps(result.currentTaps || []);
  const reports = Array.isArray(result.reports) && result.reports.length ? result.reports : [result];
  const totals = reports.reduce((memo, report) => {
    const applied = applyPmbWeeklyUsageReport(report);
    memo.reports += 1;
    memo.matched += applied.matched;
    memo.archived += applied.archived;
    memo.unmatched += applied.unmatched;
    memo.reportItems += Array.isArray(report.items) ? report.items.length : 0;
    return memo;
  }, {
    reports: 0,
    matched: 0,
    archived: 0,
    unmatched: 0,
    reportItems: 0,
  });
  const changeovers = applyWeeklyUsageProductChangeovers();
  totals.archived += changeovers.archived;
  return totals;
}

function applyPmbWeeklyUsageReport(report) {
  const reportItems = Array.isArray(report?.items) ? report.items : [];
  const label = clean(report?.label) || buildWeeklyUsageSaveLabel();
  const usedReportIds = new Set();
  let matched = 0;
  let archived = 0;

  weeklyUsageItems = weeklyUsageItems.map((item) => {
    const match = getPmbWeeklyUsageMatch(item, reportItems, usedReportIds, label);
    if (!match) return item;

    const value = getWeeklyUsageReportValue(item, match.volumeOz);
    if (!Number.isFinite(value) || value < 0) return item;

    const normalizedValue = roundWeeklyUsageValue(value, item.displayUnit);
    const historyEntry = {
      label,
      value: normalizedValue,
      hasValue: true,
      source: "PMB",
      volumeOz: Math.round(toNumber(match.volumeOz) * 100) / 100,
    };
    const mergedHistory = mergeWeeklyUsageHistory([
      historyEntry,
      ...item.history.filter((entry) => entry.label !== label),
    ]);

    weeklyUsageHistoryOverrides[item.id] = mergedHistory;
    delete weeklyUsageCurrentOverrides[item.id];
    usedReportIds.add(getPmbWeeklyUsageReportId(match));
    matched += 1;

    return {
      ...item,
      history: mergedHistory,
      average: calculateAverage(mergedHistory.map((entry) => entry.value)),
      currentDisplayValue: "",
    };
  });

  matched += applyCurrentTapZeroUsageRows(label, reportItems, usedReportIds);

  reportItems.forEach((reportItem) => {
    const reportId = getPmbWeeklyUsageReportId(reportItem);
    if (usedReportIds.has(reportId) || toNumber(reportItem.volumeOz) < 0) return;
    if (reportItem?.isCurrentTap && toNumber(reportItem.volumeOz) === 0) return;
    if (archivePmbWeeklyUsageReportItem(reportItem, label)) {
      usedReportIds.add(reportId);
      archived += 1;
    }
  });

  saveWeeklyUsageCurrentOverrides();
  saveWeeklyUsageHistoryOverrides();
  if (archived) saveWeeklyUsageArchivedItems();

  return {
    matched,
    archived,
    unmatched: reportItems.filter((item) => toNumber(item.volumeOz) > 0 && !usedReportIds.has(getPmbWeeklyUsageReportId(item))).length,
  };
}

function getPmbWeeklyUsageMatch(item, reportItems, usedReportIds = new Set(), label = "") {
  const plu = toNumber(item.plu);
  if (plu) {
    const pluMatch = reportItems.find((reportItem) => (
      !usedReportIds.has(getPmbWeeklyUsageReportId(reportItem))
      && toNumber(reportItem.plu) === plu
      && toNumber(reportItem.volumeOz) >= 0
      && shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label)
    ));
    if (pluMatch) return pluMatch;
  }

  const tapMatch = reportItems.find((reportItem) => (
    !usedReportIds.has(getPmbWeeklyUsageReportId(reportItem))
    && toNumber(reportItem.tapNumber) === toNumber(item.tapNumber)
    && toNumber(reportItem.volumeOz) >= 0
    && shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label)
    && getWeeklyUsageNameKeys(reportItem.name || reportItem.brand, { stripWallNumber: false })
      .some((key) => getWeeklyUsageNameKeys(item.name, { stripWallNumber: false }).includes(key))
  ));
  if (tapMatch) return tapMatch;

  const exactKeys = getWeeklyUsageNameKeys(item.name, { stripWallNumber: false });
  const exactMatch = reportItems.find((reportItem) => (
    !usedReportIds.has(getPmbWeeklyUsageReportId(reportItem))
    && toNumber(reportItem.volumeOz) > 0
    && shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label)
    && getWeeklyUsageNameKeys(reportItem.name || reportItem.brand, { stripWallNumber: false }).some((key) => exactKeys.includes(key))
  ));
  if (exactMatch) return exactMatch;

  const looseKeys = getWeeklyUsageNameKeys(item.name, { stripWallNumber: true });
  return reportItems.find((reportItem) => (
    !usedReportIds.has(getPmbWeeklyUsageReportId(reportItem))
    && toNumber(reportItem.volumeOz) > 0
    && shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label)
    && canLooseMatchWeeklyUsageNames(item.name, reportItem.name || reportItem.brand)
    && getWeeklyUsageNameKeys(reportItem.name || reportItem.brand, { stripWallNumber: true }).some((key) => looseKeys.includes(key))
  )) || null;
}

function applyCurrentTapZeroUsageRows(label, reportItems, usedReportIds) {
  const zeroReportItems = reportItems.filter((reportItem) => (
    reportItem?.isCurrentTap
    && toNumber(reportItem.tapNumber)
    && toNumber(reportItem.volumeOz) === 0
  ));
  if (!zeroReportItems.length) return 0;

  let matched = 0;
  weeklyUsageItems = weeklyUsageItems.map((item) => {
    if ((item.history || []).some((entry) => entry.label === label)) return item;

    const reportItem = zeroReportItems.find((candidate) => (
      toNumber(candidate.tapNumber) === toNumber(item.tapNumber)
      && shouldApplyWeeklyUsageReportItemToItem(item, candidate, label)
      && (
        (toNumber(item.plu) && toNumber(candidate.plu) === toNumber(item.plu))
        || isSameWeeklyUsageProductName(item.name, candidate.name || candidate.brand)
      )
    ));
    if (!reportItem) return item;

    const historyEntry = {
      label,
      value: 0,
      hasValue: true,
      source: "PMB",
      volumeOz: 0,
    };
    const mergedHistory = mergeWeeklyUsageHistory([
      historyEntry,
      ...item.history.filter((entry) => entry.label !== label),
    ]);
    weeklyUsageHistoryOverrides[item.id] = mergedHistory;
    delete weeklyUsageCurrentOverrides[item.id];

    const reportId = getPmbWeeklyUsageReportId(reportItem);
    if (!usedReportIds.has(reportId)) {
      usedReportIds.add(reportId);
      matched += 1;
    }

    return {
      ...item,
      history: mergedHistory,
      average: calculateAverage(mergedHistory.map((entry) => entry.value)),
      currentDisplayValue: "",
    };
  });

  return matched;
}

function getPmbWeeklyUsageReportId(item) {
  return `${toNumber(item?.plu) || 0}:${toNumber(item?.tapNumber) || 0}:${normalizeWeeklyUsageName(item?.name || item?.brand || "")}`;
}

function hasExactWeeklyUsageProductNameMatch(a, b) {
  const exactA = getWeeklyUsageNameKeys(a, { stripWallNumber: false });
  const exactB = getWeeklyUsageNameKeys(b, { stripWallNumber: false });
  return exactA.some((key) => exactB.includes(key));
}

function isSameWeeklyUsageProductName(a, b) {
  if (hasExactWeeklyUsageProductNameMatch(a, b)) return true;

  if (!canLooseMatchWeeklyUsageNames(a, b)) return false;
  const looseA = getWeeklyUsageNameKeys(a, { stripWallNumber: true });
  const looseB = getWeeklyUsageNameKeys(b, { stripWallNumber: true });
  return looseA.some((key) => looseB.includes(key));
}

function archivePmbWeeklyUsageReportItem(reportItem, label) {
  const name = clean(reportItem?.name || reportItem?.brand);
  const volumeOz = toNumber(reportItem?.volumeOz);
  if (!name || !volumeOz) return false;

  const tapNumber = toNumber(reportItem.tapNumber);
  const id = slugify(`${tapNumber || "pmb"}-${name}`);
  const displayUnit = getWeeklyUsageDisplayUnitForTap({
    tapNumber,
    type: reportItem.type,
    name,
  }, null);
  const value = getWeeklyUsageReportValue({
    tapNumber,
    type: reportItem.type,
    name,
    displayUnit,
  }, volumeOz);
  if (!Number.isFinite(value) || value <= 0) return false;

  const existing = weeklyUsageArchivedItems.find((item) => (item.archiveId || item.id) === id);
  const historyEntry = {
    label,
    value: roundWeeklyUsageValue(value, displayUnit),
    hasValue: true,
    source: "PMB",
    volumeOz: Math.round(volumeOz * 100) / 100,
  };
  const history = mergeWeeklyUsageHistory([
    historyEntry,
    ...((existing?.history || []).filter((entry) => entry.label !== label)),
  ]);

  upsertWeeklyUsageArchive({
    ...(existing || {}),
    id,
    archiveId: id,
    tapNumber,
    name,
    wall: clean(reportItem.wall),
    type: clean(reportItem.type),
    plu: toNumber(reportItem.plu),
    displayUnit,
    isLiquorShot: displayUnit === "oz",
    hidden: true,
    replacedBy: existing?.replacedBy || "",
    replacedAt: existing?.replacedAt || new Date().toISOString(),
    history,
    average: calculateAverage(history.map((entry) => entry.value)),
  });
  return true;
}

function getWeeklyUsageNameKeys(value, { stripWallNumber = false } = {}) {
  const cleaned = clean(value);
  return [...new Set(getWeeklyUsageAliasVariants(cleaned)
    .flatMap((variant) => [
      normalizeWeeklyUsageName(variant, { stripWallNumber }),
      normalizeWeeklyUsageName(variant.replace(/\(([^)]*)\)/g, " $1 "), { stripWallNumber }),
      normalizeWeeklyUsageName(variant.replace(/\([^)]*\)/g, " "), { stripWallNumber }),
    ])
    .filter(Boolean))];
}

function getWeeklyUsageAliasVariants(value) {
  const text = clean(value);
  const variants = new Set([text]);
  const add = (variant) => {
    const cleaned = clean(variant);
    if (cleaned) variants.add(cleaned);
  };

  add(text.replace(/\b\d+(?:\.\d+)?\s*(?:ml|l|liter|litre)\b/gi, " "));
  add(text.replace(/\bvanilla\b/gi, "Vanilia"));
  add(text.replace(/\bvanilia\b/gi, "Vanilla"));
  add(text.replace(/\bMiller Light\b/gi, "Miller Lite"));
  add(text.replace(/\bMiller Lite\b/gi, "Miller Light"));
  add(text.replace(/\bCrown Royal Apple\b/gi, "Crown Apple"));
  add(text.replace(/\bCrown Apple\b/gi, "Crown Royal Apple"));
  add(text.replace(/\bCrown Royal Peach\b/gi, "Crown Peach"));
  add(text.replace(/\bCrown Peach\b/gi, "Crown Royal Peach"));
  add(text.replace(/\bPatron Silver\b/gi, "Patron"));
  add(text.replace(/\bJameson Irish\b/gi, "Jameson"));
  add(text.replace(/\bStella Artois\b/gi, "Stella"));
  add(text.replace(/\bDortmunder Gold Lager\b/gi, "Dortmunder Gold"));
  add(text.replace(/\bNB\s+VD\s+RGR\s+IPA\b/gi, "Voodoo Ranger IPA"));
  add(text.replace(/\bVoodoo Ranger IPA\b/gi, "NB VD RGR IPA"));
  add(text.replace(/\bGarage Beer Lime\b/gi, "Garage Beer"));
  add(text.replace(/\bGinny From The Block\b/gi, "Gin & Juice"));
  add(text.replace(/\bBombay Sapphire\b/gi, "Bombay"));

  return [...variants];
}

function canLooseMatchWeeklyUsageNames(itemName, reportName) {
  const itemWallNumber = getWeeklyUsageWallNumber(itemName);
  const reportWallNumber = getWeeklyUsageWallNumber(reportName);
  return !itemWallNumber || !reportWallNumber || itemWallNumber === reportWallNumber;
}

function getWeeklyUsageWallNumber(value) {
  const match = clean(value).match(/\s+([123])\s*$/);
  return match ? toNumber(match[1]) : 0;
}

function getWeeklyUsageReportValue(item, volumeOz) {
  const ounces = toNumber(volumeOz);
  if (!ounces) return 0;
  if (item.displayUnit === "oz") return ounces;
  const fullOunces = getWeeklyUsageFullOunces(item);
  return fullOunces ? ounces / fullOunces : 0;
}

function normalizeWeeklyUsageHistoryForDisplayUnit(history, item) {
  return mergeWeeklyUsageHistory((history || []).map((entry) => {
    if (!Object.prototype.hasOwnProperty.call(entry, "volumeOz")) return entry;

    const value = getWeeklyUsageReportValue(item, entry.volumeOz);
    if (!Number.isFinite(value)) return entry;

    return {
      ...entry,
      value: roundWeeklyUsageValue(value, item.displayUnit),
    };
  }));
}

function getWeeklyUsageFullOunces(item) {
  const kegItem = kegWallItems.find((entry) => toNumber(entry.tapNumber) === toNumber(item.tapNumber));
  if (!kegItem) return item.displayUnit === "kegs" ? STANDARD_BEER_KEG_OZ : 0;
  if (normalizeTitle(kegItem.type) === "cocktail") return STANDARD_COCKTAIL_KEG_OZ;
  return getDefaultKegSizeOz(kegItem);
}

function roundWeeklyUsageValue(value, unit) {
  const places = unit === "oz" ? 10 : 100;
  return Math.round(toNumber(value) * places) / places;
}

function buildWeeklyUsageSaveLabel() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `${monday.getMonth() + 1}/${monday.getDate()}/${String(monday.getFullYear()).slice(-2)} - ${sunday.getMonth() + 1}/${sunday.getDate()}/${String(sunday.getFullYear()).slice(-2)}`;
}

function renderKegWallBlock(wallName, items) {
  const belowParCount = items.filter((item) => getKegNeed(item) > 0).length;
  return `
    <section class="keg-wall-card">
      <div class="keg-wall-card__header">
        <div>
          <p class="eyebrow">Tap wall</p>
          <h2>${escapeHtml(wallName)}</h2>
        </div>
        <div class="keg-wall-card__meta">
          <strong>${items.length} taps</strong>
          <span class="keg-wall-card__badge">${belowParCount} below par</span>
        </div>
      </div>
      <div class="inventory-table-wrap">
        <table class="inventory-table keg-table">
          <thead>
            <tr>
              <th>Tap #</th>
              <th>Product</th>
              <th>Current level</th>
              <th>Current value</th>
              <th>Tap price</th>
              <th>Avg weekly</th>
              <th>On hand</th>
              <th>Need</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map((item) => {
                const liveRow = getKegLiveRow(item);
                const itemKey = getKegItemKey(item);
                const replacement = tapReplacementOverrides[itemKey];
                const displayBrand = getKegDisplayBrand(item, liveRow);
                const pmbChangedBrand = !replacement && clean(displayBrand) && normalizeWeeklyUsageName(displayBrand, { stripWallNumber: false }) !== normalizeWeeklyUsageName(item.brand, { stripWallNumber: false });
                const onHand = getKegOnHandDisplay(item);
                const need = getKegNeed(item);
                const currentValue = getKegCurrentValue(item, liveRow);
                const pricing = getKegWallPricing(item, displayBrand);
                const rowTypeClass = getKegRowTypeClass(item);
                const onDeck = getKegOnDeckItem(item);
                const mainRow = `
                  <tr class="${rowTypeClass}" data-keg-row-key="${escapeHtml(itemKey)}">
                    <td>${item.tapNumber}</td>
                    <td class="keg-product-cell">
                      ${replacement ? `<span class="table-note">Replacing ${escapeHtml(replacement.oldBrand)}</span>` : ""}
                      ${pmbChangedBrand ? `<span class="table-note table-note--accent">PMB current tap</span>` : ""}
                      ${onDeck ? `<span class="table-note table-note--accent">On deck: ${escapeHtml(onDeck.name)}</span>` : ""}
                      ${renderTapChangeControls(item, liveRow, displayBrand)}
                    </td>
                    <td class="keg-level-cell ${getKegLevelClass(liveRow?.fillLevelPercent)}">
                      <span class="keg-level-display">${formatKegCurrentLevel(item, liveRow)}</span>
                    </td>
                    <td class="keg-value-cell">${currentValue > 0 ? money(currentValue) : '<span class="inventory-order-zero">-</span>'}</td>
                    <td class="keg-pricing-cell">${pricing.chargeHtml}</td>
                    <td class="keg-usage-cell">${formatKegWeeklyUsageAverage(item, displayBrand)}</td>
                    <td><input class="inventory-input keg-input" data-keg-field="onHand" data-keg-key="${escapeHtml(itemKey)}" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(onHand)}" placeholder="0"></td>
                    <td class="keg-need-cell">${renderKegNeedCell(item, need)}</td>
                  </tr>`;
                return `${mainRow}${activeKegAdjustKey === itemKey ? renderKegLevelAdjustRow(item, liveRow, displayBrand) : ""}`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function getKegDisplayBrand(item, liveRow = null) {
  const replacement = tapReplacementOverrides[getKegItemKey(item)];
  if (replacement?.newBrand) return replacement.newBrand;
  const livePrice = getLiveTapPriceForKegWallItem(item, item?.brand);
  return clean(liveRow?.name || liveRow?.tapProduct || livePrice?.name || item?.brand);
}

function renderTapChangeControls(item, liveRow, displayBrand = item.brand) {
  const itemKey = getKegItemKey(item);
  const replacement = tapReplacementOverrides[itemKey];
  const selectedValue = replacement?.sourceValue || (replacement?.comingSoonId ? `coming-soon:${replacement.comingSoonId}` : "");
  const options = getTapReplacementProductOptions(item, replacement);
  const hasOptions = /<option/.test(options);
  const selectDisabled = !hasOptions || kegConfigUpdateRunning;
  const changeDisabled = !selectedValue;
  const adjustDisabled = kegConfigUpdateRunning;
  const currentLabel = replacement ? `${displayBrand} (current replacement)` : displayBrand;
  const isEditing = activeKegAdjustKey === itemKey;
  return `
    <div class="tap-product-current">
      <strong>${escapeHtml(displayBrand || item.brand)}</strong>
      ${replacement ? `<span class="table-note">Current replacement</span>` : ""}
    </div>
    <div class="tap-change-controls">
      <button class="mini-button toggle-keg-adjust" data-keg-key="${escapeHtml(itemKey)}" type="button"${adjustDisabled ? " disabled" : ""}>${activeKegAdjustKey === itemKey ? "Hide" : "Edit"}</button>
      ${isEditing ? `
        <select class="tap-change-select" data-keg-key="${escapeHtml(itemKey)}" aria-label="Replacement product for ${escapeHtml(item.brand)}"${selectDisabled ? " disabled" : ""}>
          <option value="">${hasOptions ? `Current: ${escapeHtml(currentLabel)}` : "No beverages loaded"}</option>
          ${options}
        </select>
        <button class="mini-button change-tap-product" data-keg-key="${escapeHtml(itemKey)}" type="button"${changeDisabled || kegConfigUpdateRunning ? " disabled" : ""}>${kegConfigUpdateRunning ? "Updating..." : "Change"}</button>
      ` : ""}
    </div>
  `;
}

function getKegWallPricing(item, displayBrand = item?.brand) {
  const livePrice = getLiveTapPriceForKegWallItem(item, displayBrand);
  const portions = getLiveTapPortions(livePrice);
  const itemType = normalizeTitle(item?.type);
  const replacement = tapReplacementOverrides[getKegItemKey(item)];
  const comingSoonItem = replacement?.comingSoonId
    ? comingSoonItems.find((entry) => entry.id === replacement.comingSoonId)
    : null;
  const productKind = normalizeTitle(comingSoonItem?.kind === "recipe" ? "cocktail" : comingSoonItem?.kind || replacement?.newKind || item?.type);

  if (livePrice?.ingredient || itemType === "shots" || isLiquorOunceTap(toNumber(item?.tapNumber))) {
    const ingredient = livePrice?.ingredient || getIngredientForKegWallItem(displayBrand || item?.brand, livePrice);
    const costPerOz = ingredient ? getCatalogUnitCost(ingredient) : 0;
    return {
      livePrice,
      costPerOz,
      chargeHtml: portions.length ? renderPortionList(portions) : livePrice?.chargePerOz ? money(livePrice.chargePerOz) : '<span class="inventory-order-zero">-</span>',
      marginHtml: portions.length && costPerOz
        ? renderPortionMarginList(portions, costPerOz)
        : livePrice?.chargePerOz && costPerOz
          ? `${formatNumber(((livePrice.chargePerOz - costPerOz) / livePrice.chargePerOz) * 100)}%`
          : '<span class="inventory-order-zero">-</span>',
    };
  }

  if (productKind === "cocktail") {
    const recipe = getRecipeFromCostContext(comingSoonItem, displayBrand || item?.brand, livePrice, item);
    if (!recipe) {
      return getUnmappedKegWallPricing(livePrice);
    }
    const chargePerOz = toNumber(chargeOverrides[recipe.id]) || livePrice?.chargePerOz || recipe.defaultChargePerOz || 0;
    const pricing = calculateRecipePricing(recipe, chargePerOz);
    return {
      livePrice,
      costPerOz: pricing.costPerOz,
      chargeHtml: chargePerOz ? money(chargePerOz) : '<span class="inventory-order-zero">-</span>',
      marginHtml: chargePerOz ? `${formatNumber(pricing.margin)}%` : '<span class="inventory-order-zero">-</span>',
    };
  }

  const kegItem = livePrice ? getKegPricingItemForLiveTapPrice(livePrice) : null;
  const pricingItem = livePrice
    ? kegItem
    : findKegPricingItem(displayBrand || item?.brand) || getKegEditorItemFromComingSoon(comingSoonItem);
  const costPerOz = pricingItem ? getKegCatalogUnitCost(pricingItem) : 0;
  const chargePerOz = livePrice?.chargePerOz || toNumber(replacement?.newChargePerOz || comingSoonItem?.chargePerOz || comingSoonItem?.pricePerOz);
  const margin = chargePerOz && costPerOz ? ((chargePerOz - costPerOz) / chargePerOz) * 100 : 0;

  return {
    livePrice,
    costPerOz,
    chargeHtml: chargePerOz ? money(chargePerOz) : '<span class="inventory-order-zero">-</span>',
    marginHtml: chargePerOz && costPerOz ? `${formatNumber(margin)}%` : '<span class="inventory-order-zero">-</span>',
  };
}

function getUnmappedKegWallPricing(livePrice) {
  const portions = getLiveTapPortions(livePrice);
  return {
    livePrice,
    costPerOz: 0,
    chargeHtml: portions.length ? renderPortionList(portions) : livePrice?.chargePerOz ? money(livePrice.chargePerOz) : '<span class="inventory-order-zero">-</span>',
    marginHtml: '<span class="inventory-order-zero">-</span>',
  };
}

function formatKegWeeklyUsageAverage(item, displayBrand = item?.brand) {
  const usage = getWeeklyUsageForKegItem(item, displayBrand);
  if (!usage || !Number.isFinite(usage.average) || usage.average <= 0) {
    return '<span class="inventory-order-zero">-</span>';
  }
  return `${formatNumber(usage.average)} ${escapeHtml(usage.displayUnit || "")}`;
}

function getWeeklyUsageForKegItem(item, displayBrand = item?.brand) {
  const tapNumber = toNumber(item?.tapNumber);
  const tapMatch = weeklyUsageItems.find((entry) => toNumber(entry.tapNumber) === tapNumber);
  if (tapMatch) return tapMatch;

  const exactKeys = getWeeklyUsageNameKeys(displayBrand || item?.brand, { stripWallNumber: false });
  const exactMatch = weeklyUsageItems.find((entry) => (
    getWeeklyUsageNameKeys(entry.name, { stripWallNumber: false }).some((key) => exactKeys.includes(key))
  ));
  if (exactMatch) return exactMatch;

  const looseKeys = getWeeklyUsageNameKeys(displayBrand || item?.brand, { stripWallNumber: true });
  return weeklyUsageItems.find((entry) => (
    getWeeklyUsageNameKeys(entry.name, { stripWallNumber: true }).some((key) => looseKeys.includes(key))
  )) || null;
}

function getLiveTapPriceForKegWallItem(item, displayBrand = item?.brand) {
  if (!item) return null;
  const tapNumber = toNumber(item.tapNumber);
  const wall = normalizeTitle(item.wall);
  const exactWallMatch = liveTapPriceItems.find((livePrice) => (
    toNumber(livePrice.tapPosition) === tapNumber
    && normalizeTitle(livePrice.wall) === wall
  ));
  if (exactWallMatch) return exactWallMatch;

  const exactTapMatch = liveTapPriceItems.find((livePrice) => (
    toNumber(livePrice.tapPosition) === tapNumber
    && !clean(livePrice.wall)
  ));
  if (exactTapMatch) return exactTapMatch;

  const aliases = getTapPriceAliases(displayBrand || item.brand);
  return liveTapPriceItems.find((livePrice) => {
    const liveAliases = getTapPriceAliases(livePrice.name);
    return aliases.some((alias) => liveAliases.includes(alias));
  }) || null;
}

function getRecipeForKegWallItem(name, livePrice = null, fallbackNames = []) {
  if (livePrice) {
    const recipe = getRecipeForLiveTapPrice(livePrice);
    if (recipe) return recipe;
  }
  const candidateNames = [name, ...fallbackNames, livePrice?.name]
    .map(clean)
    .filter(Boolean);
  for (const candidate of candidateNames) {
    const aliases = getTapPriceAliases(candidate);
    const match = getActiveRecipes().find((recipe) => {
      const recipeAliases = getTapPriceAliases(recipe.title);
      return aliases.some((alias) => recipeAliases.includes(alias));
    });
    if (match) return match;
  }
  return null;
}

function getIngredientForKegWallItem(name, livePrice = null) {
  if (livePrice) {
    const ingredient = getIngredientForLiveTapPrice(livePrice);
    if (ingredient) return ingredient;
  }
  const candidates = getTapPriceAliases(name)
    .map((alias) => normalizeIngredientAlias(alias))
    .filter(Boolean);
  return ingredients.find((ingredient) => {
    const ingredientAliases = [
      normalizeTapPriceKey(ingredient.name),
      normalizeTapPriceKey(normalizeIngredientAlias(ingredient.name)),
    ].filter(Boolean);
    return candidates.some((candidate) => ingredientAliases.includes(normalizeTapPriceKey(candidate)));
  }) || null;
}

function getTapReplacementProductOptions(item, replacement = null) {
  const selectedValue = replacement?.sourceValue || (replacement?.comingSoonId ? `coming-soon:${replacement.comingSoonId}` : "");
  const currentTapKey = getKegItemKey(item);
  const groups = [
    ["PMB beverages", getPmbReplacementOptions()],
    ["Wall list", getWallReplacementOptions(currentTapKey)],
    ["Coming Soon", getComingSoonReplacementOptions()],
  ].filter(([, options]) => options.length);

  return groups
    .map(([label, options]) => `
      <optgroup label="${escapeHtml(label)}">
        ${options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === selectedValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
      </optgroup>
    `)
    .join("");
}

function getPmbReplacementOptions() {
  const byValue = new Map();
  liveTapPriceItems.forEach((item) => {
    const plu = toNumber(item.plu);
    const name = clean(item.name);
    if (!name) return;
    const value = `pmb:${plu || slugify(name)}`;
    if (!byValue.has(value)) {
      byValue.set(value, {
        value,
        label: `${name}${plu ? ` - PLU ${plu}` : ""}`,
        name,
        plu,
        chargePerOz: toNumber(item.chargePerOz),
      });
    }
  });

  kegLiveLevels.forEach((item) => {
    const plu = toNumber(item.plu);
    const name = clean(item.name);
    if (!name) return;
    const value = `pmb:${plu || slugify(name)}`;
    if (!byValue.has(value)) {
      byValue.set(value, {
        value,
        label: `${name}${plu ? ` - PLU ${plu}` : ""}`,
        name,
        plu,
        chargePerOz: 0,
      });
    }
  });

  return [...byValue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getWallReplacementOptions(excludeTapKey = "") {
  const byValue = new Map();
  kegWallItems.forEach((item) => {
    if (excludeTapKey && getKegItemKey(item) === excludeTapKey) return;
    const name = clean(item.brand);
    if (!name) return;
    const value = `wall:${getKegItemKey(item)}`;
    if (!byValue.has(value)) {
      byValue.set(value, {
        value,
        label: `${name} - ${item.wall} ${item.tapNumber}`,
        name,
        tapKey: getKegItemKey(item),
      });
    }
  });
  return [...byValue.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getComingSoonReplacementOptions() {
  return comingSoonItems
    .filter((item) => !item.replacedAt)
    .map((item) => ({
      value: `coming-soon:${item.id}`,
      label: `${item.name} (${item.kind === "beer" ? "beer" : "cocktail"})`,
      name: item.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getReplacementOptionDetails(value) {
  const [source, ...rest] = String(value || "").split(":");
  const id = rest.join(":");
  if (source === "coming-soon") {
    const item = comingSoonItems.find((entry) => entry.id === id);
    if (!item) return null;
    return {
      source,
      id,
      item,
      name: item.name,
      kind: item.kind,
      plu: toNumber(item.plu),
      chargePerOz: toNumber(item.chargePerOz || item.pricePerOz),
    };
  }
  if (source === "pmb") {
    const plu = toNumber(id);
    const item = liveTapPriceItems.find((entry) => toNumber(entry.plu) === plu)
      || [...kegLiveLevels.values()].find((entry) => toNumber(entry.plu) === plu)
      || liveTapPriceItems.find((entry) => slugify(entry.name) === id)
      || [...kegLiveLevels.values()].find((entry) => slugify(entry.name) === id);
    if (!item) return null;
    return {
      source,
      id,
      item,
      name: item.name,
      kind: item.type || "PMB beverage",
      plu: toNumber(item.plu),
      chargePerOz: toNumber(item.chargePerOz),
    };
  }
  if (source === "wall") {
    const item = kegWallItems.find((entry) => getKegItemKey(entry) === id);
    if (!item) return null;
    return {
      source,
      id,
      item,
      name: item.brand,
      kind: item.type,
      plu: 0,
      chargePerOz: 0,
    };
  }
  return null;
}

function getKegCostContext(item, displayBrand = item?.brand) {
  const replacement = tapReplacementOverrides[getKegItemKey(item)];
  const comingSoonItem = replacement?.comingSoonId
    ? comingSoonItems.find((entry) => entry.id === replacement.comingSoonId)
    : null;
  const livePrice = getLiveTapPriceForKegWallItem(item, displayBrand);
  const itemType = normalizeTitle(item?.type);
  const replacementKind = normalizeTitle(comingSoonItem?.kind === "recipe" ? "cocktail" : comingSoonItem?.kind || replacement?.newKind || "");

  if (livePrice?.ingredient || itemType === "shots" || isLiquorOunceTap(toNumber(item?.tapNumber))) {
    const ingredient = livePrice?.ingredient || getIngredientForKegWallItem(displayBrand || item?.brand, livePrice);
    return {
      kind: "liquor",
      title: ingredient?.name || clean(livePrice?.name) || displayBrand || item?.brand || "Liquor tap",
      livePrice,
      ingredient,
    };
  }

  if (itemType === "cocktail" || replacementKind === "cocktail") {
    const recipe = getRecipeFromCostContext(comingSoonItem, displayBrand, livePrice, item);
    return {
      kind: "cocktail",
      title: recipe?.title || displayBrand || item?.brand || "Cocktail",
      livePrice,
      recipe,
    };
  }

  const kegItem = livePrice ? getKegPricingItemForLiveTapPrice(livePrice) : null;
  return {
    kind: "beer",
    title: clean(livePrice?.name) || displayBrand || item?.brand || "Beer keg",
    livePrice,
    kegItem: livePrice
      ? kegItem
      : findKegPricingItem(displayBrand || item?.brand) || getKegEditorItemFromComingSoon(comingSoonItem),
  };
}

function getRecipeFromCostContext(comingSoonItem, displayBrand, livePrice, item = null) {
  if (livePrice) {
    return getRecipeForLiveTapPrice(livePrice);
  }
  if (comingSoonItem?.recipeId) {
    const recipe = recipes.find((item) => item.id === comingSoonItem.recipeId);
    if (recipe) return recipe;
  }
  return getRecipeForKegWallItem(displayBrand, livePrice, [
    item?.brand,
    item?.templateBrand,
  ]);
}

function getKegEditorItemFromComingSoon(item) {
  if (!item || item.kind !== "beer") return null;
  const name = getKegDisplayName(item.name);
  if (!name) return null;
  const id = getKegPricingKey(name);
  return {
    id,
    name,
    tapNumber: 0,
    wall: "Coming Soon",
    type: "Beer",
    priceType: "keg",
    kegOz: toNumber(item.kegOz) || STANDARD_BEER_KEG_OZ,
    vendor: "Manual",
    sourceNames: [name],
    sourceTaps: ["Coming Soon"],
    sourceTypes: ["Beer"],
    vendorProduct: null,
  };
}

function renderKegProductCostEditor(item, displayBrand = item?.brand) {
  const context = getKegCostContext(item, displayBrand);
  const pricing = getKegWallPricing(item, displayBrand);
  const status = [
    pricing.costPerOz ? `${money(pricing.costPerOz)} cost/oz` : "No cost/oz yet",
    clean(pricing.marginHtml.replace(/<[^>]*>/g, " ")) || "No margin yet",
  ].join(" | ");

  if (context.kind === "cocktail") {
    return `
      <div class="keg-cost-editor__header">
        <div>
          <p class="eyebrow">Product costs</p>
          <h3>${escapeHtml(context.title)}</h3>
        </div>
        <span>${escapeHtml(status)}</span>
      </div>
      ${context.recipe ? renderCocktailCostEditor(context.recipe) : renderKegCostEmptyState("No matching cocktail recipe was found for this tap yet.")}
    `;
  }

  if (context.kind === "liquor") {
    return `
      <div class="keg-cost-editor__header">
        <div>
          <p class="eyebrow">Product costs</p>
          <h3>${escapeHtml(context.title)}</h3>
        </div>
        <span>${escapeHtml(status)}</span>
      </div>
      ${context.ingredient ? renderIngredientCostEditor([context.ingredient]) : renderKegCostEmptyState("No mapped bottle cost was found for this liquor tap yet.")}
    `;
  }

  return `
    <div class="keg-cost-editor__header">
      <div>
        <p class="eyebrow">Product costs</p>
        <h3>${escapeHtml(context.title)}</h3>
      </div>
      <span>${escapeHtml(status)}</span>
    </div>
    ${context.kegItem ? renderBeerKegCostEditor(context.kegItem) : renderKegCostEmptyState("No keg pricing record was found for this product yet.")}
  `;
}

function renderCocktailCostEditor(recipe) {
  const costIngredients = getRecipeCostEditorIngredients(recipe);
  const totals = getRecipeTotals(recipe);
  const pricing = getRecipePricing(recipe);
  return `
    <div class="keg-cost-metrics">
      <span><b>${money(totals.cost)}</b> batch cost</span>
      <span><b>${money(totals.costPerOz)}</b> cost / oz</span>
      <span><b>${formatNumber(totals.abvPercent)}%</b> ABV</span>
      <span><b>${formatNumber(pricing.margin)}%</b> margin</span>
    </div>
    ${renderIngredientCostEditor(costIngredients)}
  `;
}

function getRecipeCostEditorIngredients(recipe) {
  const byId = new Map();
  recipe.ingredients.forEach((ingredient) => {
    const id = getResolvedIngredientId(ingredient);
    if (!id || id === "water") return;
    const catalogIngredient = ingredients.find((item) => item.id === id);
    const existing = byId.get(id);
    const nextIngredient = catalogIngredient || {
      id,
      name: normalizeIngredientAlias(ingredient.name) || ingredient.name,
      vendorProduct: getVendorMapping(id),
      totalCost: toNumber(ingredient.cost),
      totalOz: toNumber(ingredient.oz),
      recipes: [recipe.title],
    };

    if (existing) {
      existing.recipeOz += toNumber(ingredient.oz);
      return;
    }

    byId.set(id, {
      ...nextIngredient,
      recipeOz: toNumber(ingredient.oz),
    });
  });

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderIngredientCostEditor(costIngredients) {
  if (!costIngredients.length) {
    return renderKegCostEmptyState("No editable product costs are attached to this drink.");
  }

  return `
    <div class="keg-cost-table-wrap">
      <table class="keg-cost-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Current $/oz</th>
            <th>Bottle oz</th>
            <th>Bottle price</th>
            <th>Last updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${costIngredients.map(renderIngredientCostEditorRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderIngredientCostEditorRow(ingredient) {
  const override = priceOverrides[ingredient.id] || {};
  const currentUnitCost = getCatalogUnitCost(ingredient);
  const mappedBottleOz = ingredient.vendorProduct?.bottleOz ? formatNumber(ingredient.vendorProduct.bottleOz) : "";
  const previousPriceNote = getPreviousPriceNote(override);
  return `
    <tr>
      <td>
        <strong>${escapeHtml(ingredient.name)}</strong>
        ${ingredient.recipeOz ? `<span class="table-note">${formatNumber(ingredient.recipeOz)} oz in recipe</span>` : ""}
        ${ingredient.vendorProduct ? `<span class="table-note table-note--accent">${escapeHtml(ingredient.vendorProduct.vendor)} mapped</span><span class="table-note">${escapeHtml(ingredient.vendorProduct.productName)}</span>` : ""}
      </td>
      <td>${currentUnitCost ? money(currentUnitCost) : '<span class="inventory-order-zero">-</span>'}</td>
      <td><input class="inventory-input keg-cost-bottle-oz" data-ingredient-id="${escapeHtml(ingredient.id)}" type="text" inputmode="decimal" value="${escapeHtml(override.bottleOz ?? "")}" placeholder="${escapeHtml(mappedBottleOz)}" aria-label="Bottle ounces for ${escapeHtml(ingredient.name)}"></td>
      <td><input class="inventory-input keg-cost-bottle-price" data-ingredient-id="${escapeHtml(ingredient.id)}" type="text" inputmode="decimal" value="${escapeHtml(override.bottlePrice ?? "")}" aria-label="Bottle price for ${escapeHtml(ingredient.name)}"></td>
      <td class="muted">${formatUpdatedAt(override.updatedAt)}${previousPriceNote ? `<span class="table-note">${escapeHtml(previousPriceNote)}</span>` : ""}</td>
      <td><button class="mini-button save-keg-ingredient-cost" data-ingredient-id="${escapeHtml(ingredient.id)}" type="button">Save</button></td>
    </tr>
  `;
}

function renderBeerKegCostEditor(kegItem) {
  const override = kegPriceOverrides[kegItem.id] || {};
  const currentUnitCost = getKegCatalogUnitCost(kegItem);
  const previousPriceNote = getPreviousPriceNote(override);
  const staleSmallKegOverride = isStaleSmallBeerKegOverride(kegItem, override);
  const kegOzValue = getKegOverrideDisplayOz(kegItem, override);
  const kegPriceValue = staleSmallKegOverride ? "" : override.kegPrice ?? "";
  const kegOzPlaceholder = formatNumber(kegItem.kegOz || getKegPricingOz(kegItem));
  return `
    <div class="keg-cost-table-wrap">
      <table class="keg-cost-table keg-cost-table--beer">
        <thead>
          <tr>
            <th>Keg</th>
            <th>Current $/oz</th>
            <th>Keg oz</th>
            <th>Keg price</th>
            <th>Last updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <strong>${escapeHtml(kegItem.name)}</strong>
              <span class="table-note table-note--accent">${escapeHtml(kegItem.tapSummary || kegItem.sourceTaps?.join(", ") || "Keg pricing")}</span>
              ${kegItem.vendorProduct ? `<span class="table-note table-note--accent">Provi mapped</span><span class="table-note">${escapeHtml(kegItem.vendorProduct.productName)}</span>` : ""}
            </td>
            <td>${currentUnitCost ? money(currentUnitCost) : '<span class="inventory-order-zero">-</span>'}</td>
            <td><input class="inventory-input keg-cost-keg-oz" data-keg-price-id="${escapeHtml(kegItem.id)}" type="text" inputmode="decimal" value="${escapeHtml(kegOzValue)}" placeholder="${escapeHtml(kegOzPlaceholder)}" aria-label="Keg ounces for ${escapeHtml(kegItem.name)}"></td>
            <td><input class="inventory-input keg-cost-keg-price" data-keg-price-id="${escapeHtml(kegItem.id)}" type="text" inputmode="decimal" value="${escapeHtml(kegPriceValue)}" aria-label="Keg price for ${escapeHtml(kegItem.name)}"></td>
            <td class="muted">${staleSmallKegOverride ? '<span class="table-note">Ignored old small-keg price</span>' : formatUpdatedAt(override.updatedAt)}${previousPriceNote && !staleSmallKegOverride ? `<span class="table-note">${escapeHtml(previousPriceNote)}</span>` : ""}</td>
            <td><button class="mini-button save-keg-product-cost" data-keg-price-id="${escapeHtml(kegItem.id)}" type="button">Save</button></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function renderKegCostEmptyState(message) {
  return `<div class="empty-state keg-cost-empty">${escapeHtml(message)}</div>`;
}

function renderKegEditFinancialPanel(item, displayBrand = item?.brand) {
  const itemKey = getKegItemKey(item);
  const pricing = getKegWallPricing(item, displayBrand);
  const par = getKegParDisplay(item);
  return `
    <section class="keg-edit-section keg-edit-section--finance">
      <div class="keg-edit-metrics">
        <div>
          <span>Tap price</span>
          <strong>${pricing.chargeHtml}</strong>
        </div>
        <div>
          <span>Cost / oz</span>
          <strong>${pricing.costPerOz ? money(pricing.costPerOz) : '<span class="inventory-order-zero">-</span>'}</strong>
        </div>
        <div>
          <span>Margin</span>
          <strong>${pricing.marginHtml}</strong>
        </div>
        <label class="keg-adjust-field keg-adjust-field--par">
          <span>Par</span>
          <input class="inventory-input keg-input keg-input--par" data-keg-field="par" data-keg-key="${escapeHtml(itemKey)}" type="number" min="0" step="0.01" inputmode="decimal" value="${escapeHtml(par)}" placeholder="0">
        </label>
      </div>
      ${renderKegOnDeckControl(item)}
    </section>
  `;
}

function renderKegOnDeckControl(item) {
  const itemKey = getKegItemKey(item);
  const onDeck = getKegOnDeckItem(item);
  const activeItems = comingSoonItems.filter((entry) => !entry.replacedAt);
  const selectedId = onDeck?.comingSoonId || "";
  const selectedArchived = selectedId && !activeItems.some((entry) => entry.id === selectedId)
    ? comingSoonItems.find((entry) => entry.id === selectedId)
    : null;
  const options = [...activeItems, selectedArchived].filter(Boolean);
  return `
    <label class="keg-on-deck-control">
      <span>On Deck product</span>
      <select class="keg-on-deck-select" data-keg-key="${escapeHtml(itemKey)}"${options.length ? "" : " disabled"}>
        <option value="">No On Deck product</option>
        ${options.map((entry) => `
          <option value="${escapeHtml(entry.id)}"${entry.id === selectedId ? " selected" : ""}>
            ${escapeHtml(entry.name)} (${escapeHtml(entry.kind === "beer" ? "beer" : "cocktail")})
          </option>
        `).join("")}
      </select>
      ${onDeck ? `<small>If this tap needs an order, the par agent will say to order ${escapeHtml(onDeck.name)} instead.</small>` : ""}
    </label>
  `;
}

function renderKegLevelAdjustRow(item, liveRow, displayBrand = item.brand) {
  const itemKey = getKegItemKey(item);
  const disabled = !liveRow?.deviceId || !liveRow?.lineNum;
  const targetPercent = liveRow?.fillLevelPercent == null ? "" : formatNumber(liveRow.fillLevelPercent);
  const currentOz = getKegCurrentLevelOz(liveRow, item);
  const fullOunces = getKegFullOunces(liveRow, item);
  const currentText = currentOz == null
    ? "PMB has not reported ounces for this tap."
    : `${formatNumber(currentOz)} oz of ${formatNumber(fullOunces)} oz`;
  const pmbText = liveRow?.deviceId && liveRow?.lineNum
    ? `PMB PLU ${liveRow.plu || "-"} | device ${liveRow.deviceId} | line ${liveRow.lineNum}`
    : "Refresh keg levels before adjusting this tap.";
  return `
    <tr class="keg-adjust-row">
      <td colspan="8">
        <div class="keg-adjust-panel keg-edit-panel">
          <section class="keg-edit-section keg-edit-section--level">
            <div class="keg-adjust-panel__summary">
              <strong>${escapeHtml(displayBrand || item.brand)}</strong>
              <span>${escapeHtml(currentText)}</span>
              <small>${escapeHtml(pmbText)}</small>
            </div>
            <div class="keg-level-edit-grid">
              <label class="keg-adjust-field">
                <span>Ounces +/-</span>
                <input class="inventory-input keg-adjust-oz" data-keg-key="${escapeHtml(itemKey)}" type="text" inputmode="decimal" placeholder="-1" aria-label="Ounces to add or remove for ${escapeHtml(item.brand)}"${disabled ? " disabled" : ""}>
              </label>
              <label class="keg-adjust-field">
                <span>Target %</span>
                <input class="inventory-input keg-adjust-percent" data-keg-key="${escapeHtml(itemKey)}" type="text" inputmode="decimal" value="${escapeHtml(targetPercent)}" aria-label="Target keg level percent for ${escapeHtml(item.brand)}"${disabled ? " disabled" : ""}>
              </label>
              <button class="primary-button push-keg-level-adjust" data-keg-key="${escapeHtml(itemKey)}" type="button"${disabled || kegConfigUpdateRunning ? " disabled" : ""}>Push to tap</button>
              <button class="mini-button close-keg-adjust" data-keg-key="${escapeHtml(itemKey)}" type="button">Close</button>
            </div>
          </section>
          ${renderKegEditFinancialPanel(item, displayBrand)}
          <section class="keg-edit-section keg-edit-section--costs">
            ${renderKegProductCostEditor(item, displayBrand)}
          </section>
        </div>
      </td>
    </tr>
  `;
}

function syncKegAdjustPercentInput(key) {
  const item = getKegWallItemByKey(key);
  const liveRow = item ? getKegLiveRow(item) : null;
  if (!item || !liveRow) return;

  const ozInput = document.querySelector(`.keg-adjust-oz[data-keg-key="${cssEscape(key)}"]`);
  const percentInput = document.querySelector(`.keg-adjust-percent[data-keg-key="${cssEscape(key)}"]`);
  if (!ozInput || !percentInput) return;

  const deltaOunces = toNumber(ozInput.value);
  if (!deltaOunces && clean(ozInput.value) !== "0") {
    percentInput.value = liveRow.fillLevelPercent == null ? "" : formatNumber(liveRow.fillLevelPercent);
    return;
  }

  const currentOunces = getKegCurrentLevelOz(liveRow);
  const fullOunces = getKegFullOunces(liveRow, item);
  if (!Number.isFinite(currentOunces) || !fullOunces) return;

  const targetOunces = Math.min(fullOunces, Math.max(0, currentOunces + deltaOunces));
  const targetPercent = (targetOunces / fullOunces) * 100;
  percentInput.value = formatNumber(Math.round(targetPercent * 10) / 10);
}

async function pushKegLevelAdjustment(key) {
  const item = getKegWallItemByKey(key);
  const liveRow = item ? getKegLiveRow(item) : null;
  if (!item || !liveRow?.deviceId || !liveRow?.lineNum) {
    kegSyncMessage = "That tap does not have a live PMB device/line yet. Refresh keg levels first.";
    renderKegLevels();
    return;
  }

  const ozInput = document.querySelector(`.keg-adjust-oz[data-keg-key="${cssEscape(key)}"]`);
  const percentInput = document.querySelector(`.keg-adjust-percent[data-keg-key="${cssEscape(key)}"]`);
  const deltaOunces = clean(ozInput?.value || "");
  const targetPercent = clean(percentInput?.value || "");
  if (!deltaOunces && !targetPercent) {
    kegSyncMessage = "Enter ounces to add/remove or a target percent before pushing.";
    renderKegLevels();
    return;
  }

  kegConfigUpdateRunning = true;
  kegSyncMessage = `Pushing ${item.brand} level change to PMB device ${liveRow.deviceId}, line ${liveRow.lineNum}...`;
  renderKegLevels();

  try {
    const response = await fetch("/api/keg-level-adjust", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        plu: toNumber(liveRow.plu),
        deviceId: toNumber(liveRow.deviceId),
        lineNum: toNumber(liveRow.lineNum),
        deltaOunces,
        targetPercent,
        sendConfigUpdate: true,
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      const meaningfulAttempt = Array.isArray(result?.attempts)
        ? result.attempts.find((attempt) => toNumber(attempt.status) > 0) || result.attempts[result.attempts.length - 1]
        : null;
      const detail = meaningfulAttempt
        ? ` PMB response: ${meaningfulAttempt.status}. No config update was sent.`
        : "";
      throw new Error(`${result?.error || "PMB keg level update failed."}${detail}`);
    }

    kegSyncMessage = result.message || `${item.brand} level update sent.`;
    await runKegLevelSync();
  } catch (error) {
    kegSyncMessage = error.message || "Could not push keg level adjustment.";
  } finally {
    kegConfigUpdateRunning = false;
    renderKegLevels();
  }
}

function bindKegLevelEvents() {
  document.querySelector("#refresh-keg-levels")?.addEventListener("click", () => {
    runKegLevelSync();
  });
  document.querySelector("#send-keg-config-update")?.addEventListener("click", () => {
    runKegConfigUpdate();
  });
  document.querySelector("#run-keg-vendor-sync")?.addEventListener("click", () => {
    vendorSyncScope = "all";
    runVendorSync();
  });
  document.querySelector("#run-par-agent")?.addEventListener("click", () => {
    runKegParAgent();
  });
  document.querySelector("#par-agent-cooler-capacity")?.addEventListener("input", (event) => {
    parAgentState = {
      ...(parAgentState || {}),
      settings: {
        ...(parAgentState?.settings || {}),
        coolerCapacityKegs: event.currentTarget.value,
      },
    };
    parAgentMessage = getParAgentStatusMessage();
    scheduleParAgentStateSync();
  });

  document.querySelectorAll(".toggle-keg-adjust").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.kegKey;
      activeKegAdjustKey = activeKegAdjustKey === key ? "" : key;
      renderKegLevels();
    });
  });

  document.querySelectorAll(".close-keg-adjust").forEach((button) => {
    button.addEventListener("click", () => {
      if (activeKegAdjustKey === button.dataset.kegKey) {
        activeKegAdjustKey = "";
        renderKegLevels();
      }
    });
  });

  document.querySelectorAll(".keg-input").forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget;
      const key = target.dataset.kegKey;
      const field = target.dataset.kegField;
      if (!key || !field) return;

      const nextValue = target.value;
      if (field === "onHand") {
        if (nextValue) {
          kegOnHandOverrides[key] = nextValue;
        } else {
          delete kegOnHandOverrides[key];
        }
        saveKegOnHandOverrides();
        scheduleParAgentStateSync();
        updateKegNeedCell(key, target);
        return;
      }

      if (field === "par") {
        if (nextValue) {
          kegParOverrides[key] = nextValue;
        } else {
          delete kegParOverrides[key];
        }
        saveKegParOverrides();
        scheduleParAgentStateSync();
      }

      renderKegLevels();
    });
  });

  document.querySelectorAll(".keg-on-deck-select").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.kegKey;
      if (!key) return;
      setKegOnDeckItem(key, select.value);
      saveKegOnDeckOverrides();
      scheduleParAgentStateSync();
      renderKegLevels();
    });
  });

  document.querySelectorAll(".tap-change-select").forEach((select) => {
    select.addEventListener("change", () => {
      const controls = select.closest(".tap-change-controls");
      const button = controls?.querySelector(".change-tap-product");
      if (button) {
        button.disabled = !select.value || kegConfigUpdateRunning;
      }
    });
  });

  document.querySelectorAll(".change-tap-product").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.kegKey;
      const select = document.querySelector(`.tap-change-select[data-keg-key="${cssEscape(key)}"]`);
      const replacementValue = select?.value;
      if (!key || !replacementValue) {
        kegSyncMessage = "Choose a beverage for that tap.";
        renderKegLevels();
        return;
      }
      replaceTapWithProduct(replacementValue, key);
    });
  });

  document.querySelectorAll(".keg-adjust-oz").forEach((input) => {
    input.addEventListener("focus", () => input.select());
    input.addEventListener("input", () => {
      syncKegAdjustPercentInput(input.dataset.kegKey);
    });
  });

  document.querySelectorAll(".keg-adjust-percent").forEach((input) => {
    input.addEventListener("focus", () => input.select());
  });

  document.querySelectorAll(".push-keg-level-adjust").forEach((button) => {
    button.addEventListener("click", () => {
      pushKegLevelAdjustment(button.dataset.kegKey);
    });
  });

  document.querySelectorAll(".keg-cost-table input").forEach((input) => {
    input.addEventListener("focus", () => input.select());
  });

  document.querySelectorAll(".save-keg-ingredient-cost").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.ingredientId;
      if (!id) return;
      const bottleOzInput = document.querySelector(`.keg-cost-bottle-oz[data-ingredient-id="${cssEscape(id)}"]`);
      const bottlePriceInput = document.querySelector(`.keg-cost-bottle-price[data-ingredient-id="${cssEscape(id)}"]`);
      saveIngredientOverride(id, bottleOzInput?.value || "", bottlePriceInput?.value || "");
    });
  });

  document.querySelectorAll(".save-keg-product-cost").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.kegPriceId;
      if (!id) return;
      const kegOzInput = document.querySelector(`.keg-cost-keg-oz[data-keg-price-id="${cssEscape(id)}"]`);
      const kegPriceInput = document.querySelector(`.keg-cost-keg-price[data-keg-price-id="${cssEscape(id)}"]`);
      saveKegPriceOverride(id, kegOzInput?.value || "", kegPriceInput?.value || "", getKegPricingItem(id));
    });
  });

  document.querySelectorAll(".coming-soon-item").forEach((card) => {
    const id = card.dataset.comingSoonId;
    const marginInput = card.querySelector(".coming-soon-margin");
    card.querySelector(".update-coming-soon-margin")?.addEventListener("click", () => {
      updateComingSoonMargin(id, marginInput?.value);
    });
    card.querySelector(".send-coming-soon-pmb")?.addEventListener("click", () => {
      sendComingSoonItemToPmb(id);
    });
    card.querySelector(".replace-coming-soon")?.addEventListener("click", () => {
      const tapKey = card.querySelector(".coming-soon-replace-select")?.value;
      replaceTapWithComingSoonItem(id, tapKey);
    });
  });
}

function updateKegNeedCell(key, input = null) {
  const item = getKegWallItemByKey(key);
  if (!item) return;

  const row = input?.closest(`[data-keg-row-key="${cssEscape(key)}"]`)
    || document.querySelector(`[data-keg-row-key="${cssEscape(key)}"]`);
  const cell = row?.querySelector(".keg-need-cell");
  if (!cell) return;

  cell.innerHTML = renderKegNeedCell(item, getKegNeed(item));
}

async function updateComingSoonMargin(id, marginValue) {
  const item = comingSoonItems.find((entry) => entry.id === id);
  if (!item || item.kind !== "beer") return;

  const targetMargin = getBeerTargetMargin(marginValue);
  const pricePerOz = getGeneratedBeerChargePerOz(item.kegCost, targetMargin);
  if (!item.plu || !pricePerOz) {
    kegSyncMessage = "That beer is missing a PMB product id or keg cost, so pricing was not updated.";
    renderKegLevels();
    return;
  }

  kegSyncMessage = `Updating ${item.name} to ${money(pricePerOz)}/oz in Pour My Beer...`;
  renderKegLevels();

  try {
    const response = await fetch("/api/pmb-products", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        productKind: "beer",
        plu: item.plu,
        name: item.name,
        pricePerOz,
        servingOz: "16",
        brewery: inferBeerBrewery(item.name),
        style: inferBeerStyle(item.name),
        ibu: "0",
        kegOz: item.kegOz || STANDARD_BEER_KEG_OZ,
        kegCost: item.kegCost,
        targetMargin,
        notes: item.description,
        imageUrl: "",
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "PMB price update failed.");

    comingSoonItems = comingSoonItems.map((entry) => (entry.id === id ? { ...entry, targetMargin, pricePerOz, updatedAt: new Date().toISOString() } : entry));
    saveComingSoonItems();
    saveCustomBeerMargin(id, targetMargin, pricePerOz);
    kegSyncMessage = `${item.name} pricing updated to ${money(pricePerOz)}/oz at ${formatNumber(targetMargin)}% margin.`;
  } catch (error) {
    kegSyncMessage = error.message || "Could not update PMB pricing.";
  }

  renderKegLevels();
  runTapPricingSync();
}

async function sendComingSoonItemToPmb(id) {
  const item = comingSoonItems.find((entry) => entry.id === id);
  if (!item) return null;
  if (item.kind === "beer") return item;

  const payload = buildPmbPayloadFromComingSoonItem(item);
  if (!payload.pricePerOz) {
    kegSyncMessage = `${item.name} needs a tap wall price before PMB product creation.`;
    renderKegLevels();
    return null;
  }

  kegSyncMessage = `${item.plu ? "Updating" : "Creating"} ${item.name} in Pour My Beer...`;
  renderKegLevels();

  try {
    const response = await fetch("/api/pmb-products", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "PMB product save failed.");

    const updatedItem = {
      ...item,
      plu: toNumber(result.product?.plu || item.plu),
      pmbProductName: result.product?.name || item.name,
      pmbUpdatedAt: new Date().toISOString(),
    };
    comingSoonItems = comingSoonItems.map((entry) => (entry.id === id ? updatedItem : entry));
    saveComingSoonItems();
    kegSyncMessage = result.message || `${item.name} was saved in Pour My Beer.`;
    render();
    runTapPricingSync();
    return updatedItem;
  } catch (error) {
    kegSyncMessage = error.message || "Could not save the PMB product.";
    renderKegLevels();
    return null;
  }
}

function buildPmbPayloadFromComingSoonItem(item) {
  return {
    productKind: item.kind === "beer" ? "beer" : "cocktail",
    plu: toNumber(item.plu) || "",
    name: item.name,
    pricePerOz: toNumber(item.chargePerOz || item.pricePerOz),
    servingOz: toNumber(item.pourOz) || 5.8,
    brewery: "On Par Entertainment",
    style: item.kind === "beer" ? "Beer" : "Draft Cocktail",
    abvPercent: toNumber(item.abvPercent),
    ibu: "0",
    kegOz: item.kind === "beer" ? toNumber(item.kegOz) || STANDARD_BEER_KEG_OZ : STANDARD_COCKTAIL_KEG_OZ,
    kegCost: toNumber(item.kegCost || item.batchCost),
    targetMargin: toNumber(item.targetMargin),
    notes: item.description,
    imageUrl: item.imageUrl,
  };
}

function saveCustomBeerMargin(comingSoonId, targetMargin, pricePerOz) {
  const item = comingSoonItems.find((entry) => entry.id === comingSoonId);
  if (!item) return;
  const id = getKegPricingKey(item.name);
  customBeerKegs = customBeerKegs.map((entry) => (entry.id === id ? { ...entry, targetMargin, pricePerOz } : entry));
  saveCustomBeerKegs();
}

async function replaceTapWithComingSoonItem(id, tapKey) {
  return replaceTapWithProduct(`coming-soon:${id}`, tapKey);
}

function buildTapReplacementTarget(details, item, replacementValue) {
  if (details.source === "coming-soon") {
    return {
      ...buildPmbPayloadFromComingSoonItem(item),
      source: details.source,
      sourceValue: replacementValue,
      kind: item.kind,
      name: item.name,
      description: item.description,
      chargePerOz: toNumber(item.chargePerOz || item.pricePerOz),
      pricePerOz: toNumber(item.chargePerOz || item.pricePerOz),
    };
  }

  if (details.source === "pmb") {
    return {
      source: details.source,
      sourceValue: replacementValue,
      plu: toNumber(details.plu || item.plu),
      name: details.name || item.name,
      kind: details.kind || item.type || "PMB beverage",
      pricePerOz: toNumber(details.chargePerOz || item.chargePerOz),
      chargePerOz: toNumber(details.chargePerOz || item.chargePerOz),
    };
  }

  return {
    source: details.source,
    sourceValue: replacementValue,
    name: item.brand || details.name,
    kind: item.type || details.kind,
    productKind: normalizeTitle(item.type) === "beer" ? "beer" : "cocktail",
    pricePerOz: toNumber(details.chargePerOz),
    chargePerOz: toNumber(details.chargePerOz),
  };
}

async function replaceTapWithProduct(replacementValue, tapKey) {
  const details = getReplacementOptionDetails(replacementValue);
  const tap = kegWallItems.find((entry) => getKegItemKey(entry) === tapKey);
  if (!details || !tap) {
    kegSyncMessage = "Choose a current wall product to replace.";
    renderKegLevels();
    return;
  }

  let item = details.item;
  const tapLabel = `${tap.wall} ${tap.tapNumber}`;
  const target = buildTapReplacementTarget(details, item, replacementValue);
  kegConfigUpdateRunning = true;
  kegSyncMessage = `Changing ${tapLabel} from ${tap.brand} to ${target.name} in Pour My Beer...`;
  renderKegLevels();

  try {
    const response = await fetch("/api/pmb-tap-product", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        tapKey,
        tapNumber: tap.tapNumber,
        wall: tap.wall,
        currentBrand: tap.brand,
        target,
        sendConfigUpdate: true,
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "PMB tap product change failed.");

    const replacedAt = new Date().toISOString();
    const savedProduct = result.product || {};
    const newBrand = savedProduct.name || target.name;
    const newPlu = toNumber(savedProduct.plu || result.slot?.plu || details.plu || item.plu);

    if (details.source === "coming-soon") {
      item = {
        ...item,
        plu: newPlu || toNumber(item.plu),
        pmbProductName: newBrand,
        pmbUpdatedAt: replacedAt,
      };
    }

    tapReplacementOverrides[tapKey] = {
      comingSoonId: details.source === "coming-soon" ? details.id : "",
      source: details.source,
      sourceValue: replacementValue,
      tapLabel,
      oldBrand: tap.brand,
      newBrand,
      newKind: details.kind,
      newPlu,
      newChargePerOz: toNumber(target.chargePerOz || target.pricePerOz || details.chargePerOz || item.chargePerOz || item.pricePerOz),
      deviceId: toNumber(result.slot?.deviceId),
      lineNum: toNumber(result.slot?.lineNum),
      configUpdateSent: Boolean(result.configUpdateSent),
      replacedAt,
    };

    if (details.source === "coming-soon") {
      comingSoonItems = comingSoonItems.map((entry) => (
        entry.id === details.id
          ? { ...entry, ...item, replaceTapKey: tapKey, replacedAt }
          : entry
      ));
    }

    saveTapReplacementOverrides();
    saveComingSoonItems();
    kegSyncMessage = `${newBrand} was pushed to PMB on ${tapLabel}${result.configUpdateSent ? " and the affected tap wall was updated." : "."}`;
    await runTapPricingSync();
    await runKegLevelSync();
    kegSyncMessage = `${newBrand} was pushed to PMB on ${tapLabel}${result.configUpdateSent ? " and the affected tap wall was updated." : "."}`;
  } catch (error) {
    kegSyncMessage = error.message || "Could not change the PMB tap product.";
  } finally {
    kegConfigUpdateRunning = false;
    render();
  }
}

function handleEnterKeyNavigation(event) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;

  const active = event.target;
  if (!(active instanceof HTMLElement)) return;
  if (!isNavigableEditable(active)) return;

  event.preventDefault();

  const nextInTable = getNextEditableInTable(active);
  if (nextInTable) {
    focusEditable(nextInTable);
    return;
  }

  const nextGlobal = getNextEditableInScope(active);
  if (nextGlobal) {
    focusEditable(nextGlobal);
  }
}

function isNavigableEditable(element) {
  if (!element.matches("input, select, textarea")) return false;
  if (element.matches('[type="hidden"], [type="search"]')) return false;
  if (element.hasAttribute("disabled") || element.hasAttribute("readonly")) return false;
  return element.offsetParent !== null;
}

function getEditableElements(scope) {
  return [...scope.querySelectorAll('input:not([type="hidden"]):not([type="search"]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled]):not([readonly])')]
    .filter((element) => element.offsetParent !== null);
}

function getNextEditableInTable(active) {
  const cell = active.closest("td, th");
  const row = active.closest("tr");
  const table = active.closest("table");
  if (!cell || !row || !table) return null;

  const cellIndex = [...row.children].indexOf(cell);
  if (cellIndex < 0) return null;

  const rows = [...table.querySelectorAll("tbody tr")];
  const rowIndex = rows.indexOf(row);
  if (rowIndex < 0) return null;

  for (let index = rowIndex + 1; index < rows.length; index += 1) {
    const nextRow = rows[index];
    const nextCell = nextRow.children[cellIndex];
    if (!nextCell) continue;
    const nextEditable = getEditableElements(nextCell)[0];
    if (nextEditable) return nextEditable;
  }

  return null;
}

function getNextEditableInScope(active) {
  const scope = active.closest("form, .panel, body") || document.body;
  const editables = getEditableElements(scope);
  const currentIndex = editables.indexOf(active);
  if (currentIndex < 0) return null;
  return editables[currentIndex + 1] || null;
}

function focusEditable(element) {
  element.focus();
  if (typeof element.select === "function" && element.matches('input:not([type="number"]), textarea')) {
    element.select();
  }
}

async function loadParAgentState() {
  try {
    const response = await fetch("/api/keg-par-agent", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || "Could not load par agent state.");
    }
    applyParAgentState(result, { hydrate: true });
  } catch (error) {
    parAgentMessage = error.message || "Could not load weekly par agent.";
  }
}

function applyParAgentState(state, { hydrate = false } = {}) {
  parAgentState = state || {};
  const serverOnHand = parAgentState.onHandOverrides || {};
  const serverPars = parAgentState.parOverrides || {};
  const serverOnDeck = parAgentState.onDeckOverrides || {};
  const hasServerInventory = Object.keys(serverOnHand).length || Object.keys(serverPars).length || Object.keys(serverOnDeck).length;

  if (hasServerInventory) {
    kegOnHandOverrides = { ...serverOnHand };
    kegParOverrides = { ...serverPars };
    kegOnDeckOverrides = { ...serverOnDeck };
    saveKegOnHandOverrides();
    saveKegParOverrides();
    saveKegOnDeckOverrides();
  } else if (hydrate && (Object.keys(kegOnHandOverrides).length || Object.keys(kegParOverrides).length || Object.keys(kegOnDeckOverrides).length)) {
    scheduleParAgentStateSync();
  }

  parAgentMessage = getParAgentStatusMessage();
}

function getParAgentStatusMessage() {
  const recommendations = parAgentState?.recommendations;
  if (!recommendations?.generatedAt) {
    return "Weekly par agent has not run yet. Set cooler capacity if you want capacity-aware trimming.";
  }

  const summary = recommendations.summary || {};
  if (summary.inventoryStateMissing) {
    return `Last run ${formatUpdatedAt(recommendations.generatedAt)} was held: backup/on-hand counts have not synced to the server yet. Open Keg Levels once with the current counts, then run the agent again.`;
  }
  const cocktailMakeText = summary.cocktailMakeCount ? ` ${formatNumber(summary.cocktailMakeCount)} cocktail${toNumber(summary.cocktailMakeCount) === 1 ? "" : "s"} to make.` : "";
  const orderText = `${formatNumber(summary.orderTotal || 0)} keg${toNumber(summary.orderTotal) === 1 ? "" : "s"}`;
  const capacityText = summary.capacityEnabled
    ? ` Cooler capacity ${formatNumber(summary.currentBackupKegs || 0)}/${formatNumber(summary.coolerCapacityKegs || 0)} backups; ${formatNumber(summary.suppressedByCapacity || 0)} held by capacity.`
    : " Cooler capacity is not set.";
  return `Last run ${formatUpdatedAt(recommendations.generatedAt)}. Agent recommends ${orderText} across ${formatNumber(summary.orderItemCount || 0)} taps.${cocktailMakeText}${capacityText}`;
}

function getParAgentSettings() {
  return {
    ...(parAgentState?.settings || {}),
  };
}

function renderParAgentPanel() {
  const settings = getParAgentSettings();
  const capacity = clean(settings.coolerCapacityKegs);
  return `
    <div class="sync-panel sync-panel--par-agent">
      <div class="sync-actions par-agent-actions">
        <button class="primary-button" id="run-par-agent" type="button"${parAgentRunning ? " disabled" : ""}>${parAgentRunning ? "Running..." : "Run par agent"}</button>
        <label class="par-agent-capacity">
          <span>Cooler capacity</span>
          <input id="par-agent-cooler-capacity" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(capacity)}" placeholder="Optional">
        </label>
      </div>
      <p class="sync-copy">Sets weekly par from PMB usage, current keg level, backup kegs on hand, and cooler capacity. Capacity limits trim lower-priority orders instead of blindly filling every formula gap.</p>
      <p class="sync-status">${escapeHtml(parAgentMessage)}</p>
    </div>
  `;
}

function getCocktailsToMake() {
  return (parAgentState?.recommendations?.items || [])
    .filter((item) => item.actionType === "make" && toNumber(item.orderQty) > 0)
    .sort((a, b) => b.priority - a.priority || a.tapNumber - b.tapNumber);
}

function renderCocktailsToMakePanel() {
  const items = getCocktailsToMake();
  return `
    <div class="sync-panel cocktails-to-make-panel">
      <div class="cocktails-to-make-panel__header">
        <h3>Cocktails to Make</h3>
        <strong>${formatNumber(items.length)}</strong>
      </div>
      ${items.length ? `
        <div class="cocktails-to-make-list">
          ${items.map((item) => `
            <div class="cocktails-to-make-item">
              <strong>${escapeHtml(item.orderProductName || item.name)}</strong>
              <span>Tap ${formatNumber(item.tapNumber)} | ${formatNumber(item.currentStockKegs)} in stock | ${formatNumber(item.avgWeeklyKegs)} avg/week</span>
            </div>
          `).join("")}
        </div>
      ` : '<p class="sync-status">No cocktails need to be made from the current par-agent run.</p>'}
    </div>
  `;
}

function getParAgentRecommendation(item) {
  const key = getKegItemKey(item);
  const recommendations = parAgentState?.recommendations?.items || [];
  return recommendations.find((entry) => entry.key === key)
    || recommendations.find((entry) => toNumber(entry.tapNumber) === toNumber(item.tapNumber))
    || null;
}

function scheduleParAgentStateSync() {
  clearTimeout(parAgentStateSyncTimer);
  parAgentStateSyncTimer = setTimeout(() => {
    syncParAgentState({ silent: true });
  }, 600);
}

async function syncParAgentState({ silent = false } = {}) {
  const settings = getParAgentSettings();
  try {
    const response = await fetch("/api/keg-par-agent", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: "sync-state",
        onHandOverrides: kegOnHandOverrides,
        parOverrides: kegParOverrides,
        onDeckOverrides: kegOnDeckOverrides,
        settings,
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "Could not save par agent state.");
    applyParAgentState(result);
  } catch (error) {
    if (!silent) {
      parAgentMessage = error.message || "Could not save par agent state.";
      renderKegLevels();
    }
  }
}

async function runKegParAgent() {
  if (parAgentRunning) return;
  parAgentRunning = true;
  parAgentMessage = "Pulling PMB levels and recent Monday-Sunday usage for par recommendations...";
  renderKegLevels();

  try {
    const response = await fetch("/api/keg-par-agent", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        action: "run",
        onHandOverrides: kegOnHandOverrides,
        parOverrides: kegParOverrides,
        onDeckOverrides: kegOnDeckOverrides,
        settings: getParAgentSettings(),
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "Could not run par agent.");

    applyParAgentState(result);
    parAgentMessage = getParAgentStatusMessage();
  } catch (error) {
    parAgentMessage = error.message || "Could not run par agent.";
  } finally {
    parAgentRunning = false;
    renderKegLevels();
  }
}

async function runKegLevelSync() {
  kegSyncLoading = true;
  kegSyncMessage = "Checking Pour My Beer for live keg levels...";
  renderKegLevels();

  try {
    const response = await fetch("/api/keg-levels");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || "Could not load keg levels.");
    }

    kegLiveLevels = buildKegLiveLevelMap(result.items || []);
    kegDeviceLevels = buildKegDeviceLevelsMap(result.deviceLevels || {});
    kegTemplateAssignments = buildKegTemplateAssignments();
    kegUpdatedAt = result.updatedAt || new Date().toISOString();
    kegSyncMessage = `Found live levels for ${result.items?.length || 0} products.`;
  } catch (error) {
    kegSyncMessage = error.message || "Could not load live keg levels.";
  } finally {
    kegSyncLoading = false;
    renderKegLevels();
  }
}

async function runTapPricingSync() {
  liveTapPricingMessage = "Checking Pour My Beer for current tap prices...";
  renderPricingSummary();

  try {
    const response = await fetch("/api/tap-pricing");
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || "Could not load tap pricing.");
    }

    liveTapPriceItems = result.items || [];
    liveTapPrices = buildLiveTapPriceMap(liveTapPriceItems);
    liveTapPricingUpdatedAt = result.updatedAt || new Date().toISOString();
    syncWeeklyUsageWithCurrentPmbTaps(liveTapPriceItems);
    const matchedCount = getActiveRecipes().filter((recipe) => getLiveTapPrice(recipe)).length;
    liveTapPricingMessage = `Matched ${matchedCount} recipes from Pour My Beer.`;
    renderPricing();
    renderKegLevels();
    renderWeeklyUsage();
    renderRecipes();
    renderOldRecipes();
    renderStats();
  } catch (error) {
    liveTapPrices = new Map();
    liveTapPriceItems = [];
    liveTapPricingUpdatedAt = "";
    liveTapPricingMessage = error.message || "Could not load current tap pricing.";
    renderPricingSummary();
    renderKegLevels();
  }
}

async function runKegConfigUpdate() {
  kegConfigUpdateRunning = true;
  kegSyncMessage = "Sending config update to Pour My Beer...";
  renderKegLevels();

  try {
    const response = await fetch("/api/keg-config-update", {
      method: "POST",
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || "Could not send config update.");
    }

    kegSyncMessage = result.message || "Configuration update sent.";
  } catch (error) {
    kegSyncMessage = error.message || "Could not send config update.";
  } finally {
    kegConfigUpdateRunning = false;
    renderKegLevels();
  }
}

function getKegItemKey(item) {
  return item.id || slugify(`${item.wall}-${item.tapNumber}-${item.brand}`);
}

function getKegWallItemByKey(key) {
  return kegWallItems.find((item) => getKegItemKey(item) === key) || null;
}

function getKegOnHandDisplay(item) {
  return String(kegOnHandOverrides[getKegItemKey(item)] ?? "");
}

function getKegParDisplay(item) {
  return String(kegParOverrides[getKegItemKey(item)] ?? "");
}

function getKegOnDeckItem(itemOrKey) {
  const key = typeof itemOrKey === "string" ? itemOrKey : getKegItemKey(itemOrKey);
  const saved = kegOnDeckOverrides[key];
  if (!saved) return null;
  const comingSoonId = typeof saved === "string" ? saved : saved.comingSoonId;
  const comingSoonItem = comingSoonItems.find((entry) => entry.id === comingSoonId);
  if (comingSoonItem) {
    return {
      comingSoonId: comingSoonItem.id,
      name: comingSoonItem.name,
      kind: comingSoonItem.kind,
      plu: toNumber(comingSoonItem.plu),
    };
  }
  return typeof saved === "object" && clean(saved.name)
    ? saved
    : null;
}

function setKegOnDeckItem(key, comingSoonId) {
  const item = comingSoonItems.find((entry) => entry.id === comingSoonId);
  if (!key) return;
  if (!item) {
    delete kegOnDeckOverrides[key];
    return;
  }
  kegOnDeckOverrides[key] = {
    comingSoonId: item.id,
    name: item.name,
    kind: item.kind,
    plu: toNumber(item.plu),
    updatedAt: new Date().toISOString(),
  };
}

function getKegNeed(item) {
  const recommendation = getParAgentRecommendation(item);
  if (recommendation && Number.isFinite(toNumber(recommendation.orderQty))) {
    return Math.max(0, Math.round(toNumber(recommendation.orderQty)));
  }

  const onHand = toNumber(getKegOnHandDisplay(item));
  const par = toNumber(getKegParDisplay(item));
  if (!par) return 0;
  const liveFraction = isLiquorOunceTap(toNumber(item?.tapNumber)) ? 0 : getKegCurrentFraction(item, getKegLiveRow(item));
  return Math.max(0, Math.ceil(par - (onHand + liveFraction)));
}

function renderKegNeedCell(item, need) {
  const recommendation = getParAgentRecommendation(item);
  const valueHtml = need > 0
    ? `<span class="inventory-order-value">${formatNumber(need)}</span>`
    : `<span class="inventory-order-zero">0</span>`;
  if (!recommendation) {
    const onDeck = getKegOnDeckItem(item);
    if (!onDeck || need <= 0) return valueHtml;
    return `
      <div class="keg-need-agent">
        ${valueHtml}
        <span class="table-note table-note--accent">Order ${escapeHtml(onDeck.name)}</span>
      </div>
    `;
  }

  const reason = clean(recommendation.reason);
  const orderProductName = clean(recommendation.orderProductName);
  const actionLabel = recommendation.actionType === "make" ? "Make" : "Order";
  const stockText = recommendation.isKegTap
    ? `${formatNumber(recommendation.currentStockKegs)} in stock | ${formatNumber(recommendation.avgWeeklyKegs)} avg`
    : "Bottle inventory";
  return `
    <div class="keg-need-agent">
      ${valueHtml}
      ${orderProductName && need > 0 ? `<span class="table-note table-note--accent">${escapeHtml(actionLabel)} ${escapeHtml(orderProductName)}</span>` : ""}
      <span class="table-note">${escapeHtml(stockText)}</span>
      ${reason ? `<span class="table-note">${escapeHtml(reason)}</span>` : ""}
    </div>
  `;
}

function getKegLiveRow(item) {
  return kegTemplateAssignments.get(getKegItemKey(item)) || null;
}

function getDefaultKegLevelSize(item) {
  if (isLiquorOunceTap(toNumber(item?.tapNumber))) return 500;
  if (normalizeTitle(item?.type) === "cocktail") return STANDARD_COCKTAIL_KEG_OZ;
  return getDefaultKegSizeOz(item);
}

function normalizeKegProductName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\)\s*(\d)\s*$/g, " $1")
    .replace(/([A-Za-z])(\d)$/g, "$1 $2")
    .replace(/[()]/g, " ")
    .replace(/\b(cognac|rum|tequila|vodka|whiskey|bourbon|beer|lager|blonde|ipa|wheat|import|stout|sour|cider|seltzer|seasonal|strong ale|shots|cocktail)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildKegLiveLevelMap(items) {
  const map = new Map();

  items.forEach((item) => {
    const tapNumber = toNumber(item.tapNumber);
    if (tapNumber) {
      map.set(`tap:${tapNumber}`, item);
    }
    const aliases = getKegNameAliases(item.name);
    aliases.forEach((alias) => {
      if (alias && !map.has(alias)) {
        map.set(alias, item);
      }
    });
  });

  return map;
}

function buildKegDeviceLevelsMap(rawDeviceLevels) {
  return new Map(
    Object.entries(rawDeviceLevels).map(([deviceId, levels]) => [
      String(deviceId),
      Array.isArray(levels) ? levels.slice().sort((a, b) => a.lineNum - b.lineNum) : [],
    ]),
  );
}

function buildKegTemplateAssignments() {
  const assignments = new Map();
  kegWallItems.forEach((item) => {
    const matchedProduct = getNamedKegProduct(item);
    if (!matchedProduct) return;
    assignments.set(getKegItemKey(item), matchedProduct);
  });

  return assignments;
}

function getNamedKegProduct(item) {
  const tapMatch = kegLiveLevels.get(`tap:${toNumber(item.tapNumber)}`);
  if (tapMatch) return tapMatch;
  const normalized = normalizeKegProductName(item.brand);
  return kegLiveLevels.get(normalized) || null;
}

function getKegNameAliases(name) {
  const raw = clean(name);
  const aliases = new Set();
  const normalized = normalizeKegProductName(raw);
  if (normalized) aliases.add(normalized);

  const withoutWallNumber = raw.replace(/\s+\d+$/, "").trim();
  const normalizedWithoutWall = normalizeKegProductName(withoutWallNumber);
  if (normalizedWithoutWall) aliases.add(normalizedWithoutWall);

  const withoutParenthetical = raw.replace(/\(([^)]+)\)/g, " $1 ").trim();
  const normalizedWithoutParen = normalizeKegProductName(withoutParenthetical);
  if (normalizedWithoutParen) aliases.add(normalizedWithoutParen);

  const compact = normalizeKegProductName(
    raw.replace(/\(([^)]+)\)/g, " ").replace(/\s+\d+$/, "").trim(),
  );
  if (compact) aliases.add(compact);

  if (/gin\s*&?\s*juice/i.test(raw) && /bombay sapphire/i.test(raw)) {
    aliases.add(normalizeKegProductName(raw.replace(/bombay sapphire/gi, "bombay")));
  }

  if (/gin\s*&?\s*juice/i.test(raw) && /\bbombay\b/i.test(raw)) {
    aliases.add(normalizeKegProductName(raw.replace(/\bbombay\b/gi, "bombay sapphire")));
  }

  return [...aliases];
}

function isLiquorOunceTap(tapNumber) {
  return (tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92);
}

function getKegFullOunces(liveRow, item = null) {
  if (!liveRow) return null;
  const rawKegSize = toNumber(liveRow.rawKegSize);
  if (rawKegSize) {
    const decimalPlaces = Math.max(0, Math.round(toNumber(liveRow.rawKegSizeDp)));
    return decimalPlaces ? rawKegSize / (10 ** decimalPlaces) : rawKegSize;
  }
  return item ? getDefaultKegLevelSize(item) : null;
}

function getKegCurrentLevelOz(liveRow, item = null) {
  if (!liveRow) return null;
  const rawPercent = toNumber(liveRow.rawPercent);
  const fullOunces = getKegFullOunces(liveRow, item);
  if (!rawPercent || !fullOunces) return null;

  const currentOunces = (rawPercent / 10000) * fullOunces;
  return Number.isFinite(currentOunces) ? currentOunces : null;
}

function formatKegCurrentLevel(item, liveRow) {
  if (!liveRow) return "—";
  if (isLiquorOunceTap(toNumber(item?.tapNumber))) {
    const currentOunces = getKegCurrentLevelOz(liveRow, item);
    return Number.isFinite(currentOunces) ? `${formatNumber(currentOunces)} oz` : "—";
  }
  return formatKegLevelPercent(liveRow.fillLevelPercent);
}

function getKegCurrentFraction(item, liveRow) {
  if (!liveRow) return 0;
  if (isLiquorOunceTap(toNumber(item?.tapNumber))) {
    const currentOunces = getKegCurrentLevelOz(liveRow, item);
    const fullOunces = getKegFullOunces(liveRow, item);
    return currentOunces && fullOunces ? currentOunces / fullOunces : 0;
  }
  const percent = toNumber(liveRow.fillLevelPercent);
  return percent > 0 ? percent / 100 : 0;
}

function getKegCurrentValue(item, liveRow) {
  const replacement = tapReplacementOverrides[getKegItemKey(item)];
  const onHandKegs = toNumber(getKegOnHandDisplay(item));
  if (replacement?.comingSoonId) {
    const comingSoonItem = comingSoonItems.find((entry) => entry.id === replacement.comingSoonId);
    const replacementCost = toNumber(comingSoonItem?.batchCost || comingSoonItem?.kegCost);
    const fraction = getKegCurrentFraction(item, liveRow);
    if (replacementCost) return (replacementCost * (fraction || 0)) + (replacementCost * onHandKegs);
  }

  const displayBrand = getKegDisplayBrand(item, liveRow);
  const currentOunces = getKegCurrentLevelOz(liveRow, item);
  const fullOunces = getKegFullOunces(liveRow, item) || getDefaultKegLevelSize(item);
  const costPerOz = getKegWallPricing(item, displayBrand).costPerOz;
  if (!costPerOz) return 0;
  const liveValue = Number.isFinite(currentOunces) && currentOunces ? currentOunces * costPerOz : 0;
  const onHandValue = onHandKegs && fullOunces ? onHandKegs * fullOunces * costPerOz : 0;
  return liveValue + onHandValue;
}

function findKegPricingItem(name) {
  const key = getKegPricingKey(name);
  return kegPricingItems.find((entry) => entry.id === key) || null;
}

function getKegPricingItem(idOrName) {
  const key = String(idOrName || "").trim();
  if (!key) return null;
  return kegPricingItems.find((entry) => entry.id === key) || findKegPricingItem(key);
}

function getKegRowTypeClass(item) {
  if (isLiquorOunceTap(toNumber(item.tapNumber))) return "keg-row--liquor";
  if (normalizeTitle(item.type) === "cocktail") return "keg-row--cocktail";
  return "keg-row--beer";
}

function formatKegLevelPercent(value) {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumber(value)}%`;
}

function getKegLevelClass(value) {
  if (!Number.isFinite(value)) return "keg-level-unknown";
  if (value <= 15) return "keg-level-critical";
  if (value <= 30) return "keg-level-low";
  return "keg-level-ok";
}

async function requestSharedInventory(body = null) {
  const response = await fetch("/api/inventory-state", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Shared inventory request failed (${response.status}).`);
  }
  return result;
}

async function loadSharedInventoryState() {
  try {
    let state = await requestSharedInventory();
    const hasLocalInventoryState = Object.keys(inventoryOnHandOverrides).length
      || Object.keys(inventoryParOverrides).length
      || customInventoryItems.length
      || inventoryHistory.length;
    if (!state.initialized && hasLocalInventoryState) {
      state = await requestSharedInventory({
        action: "hydrate",
        onHandOverrides: inventoryOnHandOverrides,
        parOverrides: inventoryParOverrides,
        customItems: customInventoryItems,
        snapshots: getMigratedInventoryHistory(),
      });
    }
    if (state.initialized) {
      applySharedInventoryState(state);
      inventorySharedMessage = "Shared inventory is available on all signed-in manager devices.";
    } else {
      inventorySharedMessage = "Shared inventory is ready and will start with the first manager edit or Monday snapshot.";
    }
  } catch (error) {
    inventorySharedMessage = `Shared inventory unavailable. Changes are saved on this device only: ${error.message}`;
  }
}

function getMigratedInventoryHistory() {
  return inventoryHistory.map((snapshot) => {
    const isCurrentUnitModel = Number(snapshot.unitModelVersion) === Number(INVENTORY_UNIT_MODEL_VERSION);
    return {
      ...snapshot,
      unitModelVersion: Number(INVENTORY_UNIT_MODEL_VERSION),
      items: (snapshot.items || []).map((snapshotItem) => {
        const id = snapshotItem.id || slugify(snapshotItem.name);
        const currentItem = findInventoryItem(id);
        const onHandDisplay = isCurrentUnitModel || !currentItem?.casePackaged
          ? clean(snapshotItem.onHandDisplay)
          : String(convertLegacyCaseCountToUnits(snapshotItem.onHandDisplay, currentItem.legacyPackSize));
        const onHand = toNumber(onHandDisplay);
        const par = toNumber(snapshotItem.parDisplay);
        const shortage = Math.max(0, par - onHand);
        const orderUnits = currentItem
          ? getRoundedOrderUnits(shortage, currentItem.packSize, currentItem.casePackaged)
          : shortage;
        return {
          ...snapshotItem,
          id,
          onHandDisplay,
          shortageDisplay: String(shortage),
          orderDisplay: String(orderUnits),
          totalValue: onHand * toNumber(snapshotItem.unitCost),
        };
      }),
    };
  });
}

function applySharedInventoryState(state, { rebuild = false } = {}) {
  inventoryOnHandOverrides = { ...(state.current?.onHandOverrides || {}) };
  inventoryParOverrides = { ...(state.current?.parOverrides || {}) };
  customInventoryItems = Array.isArray(state.current?.customItems) ? state.current.customItems : [];
  inventoryHistory = Array.isArray(state.snapshots) ? state.snapshots : [];
  inventorySharedUpdatedAt = state.current?.updatedAt || "";
  saveInventoryOnHandOverrides();
  saveInventoryParOverrides();
  saveCustomInventoryItems();
  saveInventoryHistory();

  if (rebuild && inventorySourceRows.length) {
    inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
    syncInventoryItemCatalogLinks();
  }
}

function setInventorySharedStatus(message, saving = false) {
  inventorySharedMessage = message;
  inventorySharedSaving = saving;
  renderInventoryPanels();
}

async function runSharedInventoryAction(body, {
  successMessage = "Shared inventory saved.",
  applyState = true,
  rebuild = false,
  flushFields = true,
} = {}) {
  if (flushFields) await flushPendingInventoryFieldSyncs();
  setInventorySharedStatus("Saving shared inventory...", true);
  try {
    const state = await requestSharedInventory(body);
    if (applyState) applySharedInventoryState(state, { rebuild });
    else inventorySharedUpdatedAt = state.current?.updatedAt || inventorySharedUpdatedAt;
    inventorySharedMessage = successMessage;
    inventorySharedSaving = false;
    return state;
  } catch (error) {
    inventorySharedMessage = `Could not save shared inventory. This device still has your change: ${error.message}`;
    inventorySharedSaving = false;
    return null;
  } finally {
    renderInventoryPanels();
  }
}

function scheduleInventoryFieldSync(id, field, value) {
  const key = `${id}:${field}`;
  clearTimeout(inventoryFieldSyncTimers.get(key)?.timer);
  inventorySharedMessage = "Saving shared inventory...";
  inventorySharedSaving = true;
  const payload = { action: "update-field", id, field, value };
  const timer = setTimeout(() => {
    inventoryFieldSyncTimers.delete(key);
    inventoryFieldSyncQueue = inventoryFieldSyncQueue.then(() =>
      runSharedInventoryAction(
        payload,
        { successMessage: "Shared inventory saved.", applyState: false, flushFields: false },
      ),
    );
  }, 500);
  inventoryFieldSyncTimers.set(key, { timer, payload });
}

async function flushPendingInventoryFieldSyncs() {
  const pending = [...inventoryFieldSyncTimers.values()];
  inventoryFieldSyncTimers.clear();
  pending.forEach(({ timer }) => clearTimeout(timer));
  pending.forEach(({ payload }) => {
    inventoryFieldSyncQueue = inventoryFieldSyncQueue.then(() =>
      runSharedInventoryAction(
        payload,
        { successMessage: "Shared inventory saved.", applyState: false, flushFields: false },
      ),
    );
  });
  await inventoryFieldSyncQueue;
}

function renderInventorySummary(visibleItems, reorderItems) {
  const totalValue = sum(visibleItems.filter((item) => !item.excludeFromInventoryValue).map((item) => item.totalValue));
  const reorderCost = sum(reorderItems.filter((item) => !item.excludeFromInventoryValue).map((item) => getInventoryRoundedOrderQuantity(item) * item.unitCost));
  const reorderUnits = sum(reorderItems.map((item) => getInventoryRoundedOrderQuantity(item)));
  const latestSnapshot = inventoryHistory[0];

  inventorySummary.innerHTML = `
    <h2>Inventory Snapshot</h2>
    <div class="summary-line"><span>Tracked items</span><strong>${visibleItems.length}</strong></div>
    <div class="summary-line"><span>Current bottle inventory $</span><strong>${money(totalValue)}</strong></div>
    <div class="summary-line"><span>Items to reorder</span><strong>${reorderItems.length}</strong></div>
    <div class="summary-line"><span>Total units to order</span><strong>${formatNumber(reorderUnits)}</strong></div>
    <div class="summary-line"><span>Estimated reorder cost</span><strong>${money(reorderCost)}</strong></div>
    <div class="sync-panel inventory-actions-panel">
      <button class="primary-button" id="save-inventory-snapshot" type="button"${inventorySharedSaving ? " disabled" : ""}>${inventorySharedSaving ? "Saving..." : "Save Monday Snapshot"}</button>
      <p class="sync-copy">Counts, pars, custom items, and Monday snapshots are shared across signed-in manager devices.</p>
      <p class="sync-status">${escapeHtml(inventorySharedMessage)}${inventorySharedUpdatedAt ? ` Last synced ${escapeHtml(formatUpdatedAt(inventorySharedUpdatedAt))}.` : ""}</p>
      <p class="sync-status">${latestSnapshot ? `Latest Monday snapshot: ${escapeHtml(formatInventorySnapshotLabel(getInventorySnapshotDate(latestSnapshot)))}` : "No Monday snapshots saved yet."}</p>
    </div>
  `;

  bindInventorySummaryEvents();
}

function bindInventorySummaryEvents() {
  document.querySelector("#save-inventory-snapshot")?.addEventListener("click", saveInventorySnapshot);
}

function renderInventoryStockTable(groupedItems) {
  inventoryTable.innerHTML = "";
  const allVisibleItems = groupedItems.flatMap(([, items]) => items);
  const totalValue = sum(allVisibleItems.filter((item) => !item.excludeFromInventoryValue).map((item) => item.totalValue));

  groupedItems.forEach(([groupName, items]) => {
    inventoryTable.append(createInventoryGroupRow(groupName));
    items.forEach((item) => inventoryTable.append(createInventoryRow(item, "stock")));
  });

  inventoryTable.append(createInventoryTotalRow("Current bottle inventory total", money(totalValue)));
}

async function addCustomInventoryItem(event) {
  event.preventDefault();
  const name = normalizeInventoryName(customInventoryNameInput?.value || "");
  if (!name) return;

  const id = slugify(name);
  const existing = findInventoryItem(id);
  const group = clean(customInventoryGroupInput?.value) || getInventoryGroup(name, "Custom Inventory");
  const onHandDisplay = normalizeInventoryInputValue(customInventoryOnHandInput?.value || "", false);
  const parDisplay = normalizeInventoryInputValue(customInventoryParInput?.value || "", false);
  const packSize = normalizePackSize(customInventoryPackSizeInput?.value || 1);
  const casePackaged = packSize > 1;
  const caseCost = toNumber(customInventoryUnitCostInput?.value);
  const unitCost = getInventoryUnitCost(caseCost, packSize);

  if (existing && !existing.isCustomInventory) {
    if (onHandDisplay) inventoryOnHandOverrides[id] = onHandDisplay;
    if (parDisplay) inventoryParOverrides[id] = parDisplay;
    saveInventoryOnHandOverrides();
    saveInventoryParOverrides();
    existing.onHandDisplay = inventoryOnHandOverrides[id] ?? existing.onHandDisplay;
    existing.parDisplay = inventoryParOverrides[id] ?? existing.parDisplay;
    recalculateInventoryItem(existing);
    if (onHandDisplay) scheduleInventoryFieldSync(id, "onHand", onHandDisplay);
    if (parDisplay) scheduleInventoryFieldSync(id, "par", parDisplay);
  } else {
    const nextItem = {
      id,
      name,
      group,
      onHandDisplay,
      parDisplay,
      packSize,
      casePackaged,
      caseCost,
      unitCost,
      updatedAt: new Date().toISOString(),
    };
    customInventoryItems = [
      ...customInventoryItems.filter((item) => item.id !== id),
      nextItem,
    ];
    saveCustomInventoryItems();
    if (onHandDisplay) inventoryOnHandOverrides[id] = onHandDisplay;
    if (parDisplay) inventoryParOverrides[id] = parDisplay;
    saveInventoryOnHandOverrides();
    saveInventoryParOverrides();
    inventoryItems = mergeCustomInventoryItems(inventoryItems.filter((item) => !item.isCustomInventory));
    await runSharedInventoryAction(
      { action: "upsert-custom", item: nextItem },
      { successMessage: `${name} was added to shared inventory.` },
    );
  }

  customInventoryForm?.reset();
  renderInventory();
}

function mergeCustomInventoryItems(baseItems) {
  const byId = new Map(baseItems.map((item) => [item.id, item]));

  customInventoryItems.forEach((item) => {
    const normalized = normalizeCustomInventoryItem(item);
    if (!normalized || byId.has(normalized.id)) return;
    byId.set(normalized.id, normalized);
  });

  return [...byId.values()];
}

function normalizeCustomInventoryItem(item) {
  const name = normalizeInventoryName(item?.name || "");
  if (!name) return null;
  const id = item.id || slugify(name);
  const group = clean(item.group) || getInventoryGroup(name, "Custom Inventory");
  const onHandDisplay = inventoryOnHandOverrides[id] ?? clean(item.onHandDisplay);
  const parDisplay = inventoryParOverrides[id] ?? clean(item.parDisplay);
  const packSize = normalizePackSize(item.packSize || 1);
  const casePackaged = Boolean(item.casePackaged) || packSize > 1;
  const caseCost = toNumber(item.caseCost) || (toNumber(item.unitCost) * packSize);
  const unitCost = getInventoryUnitCost(caseCost, packSize);
  const normalized = {
    id,
    name,
    group,
    allowsDecimal: false,
    sourceSection: "Custom Inventory",
    onHandDisplay,
    casePackaged,
    packSize,
    legacyPackSize: 1,
    caseCost,
    baseUnitCost: unitCost,
    unitCost,
    parDisplay,
    note: "Custom item",
    isCustomInventory: true,
  };
  recalculateInventoryItem(normalized);
  return normalized;
}

async function deleteCustomInventoryItem(id) {
  customInventoryItems = customInventoryItems.filter((item) => item.id !== id);
  delete inventoryOnHandOverrides[id];
  delete inventoryParOverrides[id];
  saveCustomInventoryItems();
  saveInventoryOnHandOverrides();
  saveInventoryParOverrides();
  inventoryItems = inventoryItems.filter((item) => item.id !== id);
  renderInventory();
  await runSharedInventoryAction(
    { action: "delete-custom", id },
    { successMessage: "The custom item was removed from shared inventory." },
  );
}

function renderInventoryOrderTable(reorderItems) {
  inventoryOrderTable.innerHTML = "";

  if (!reorderItems.length) {
    inventoryOrderTable.innerHTML = `<tr><td colspan="7" class="muted">Nothing needs to be ordered right now.</td></tr>`;
    return;
  }

  groupInventoryForDisplay(reorderItems).forEach(([groupName, items]) => {
    inventoryOrderTable.append(createInventoryGroupRow(groupName));
    items.forEach((item) => inventoryOrderTable.append(createInventoryRow(item, "order")));
  });

  const vendorTotals = getInventoryVendorTotals(reorderItems);
  ["OHLQ", "Proof"].forEach((vendorName) => {
    const total = vendorTotals.get(vendorName) || 0;
    inventoryOrderTable.append(createInventoryTotalRow(`${vendorName} reorder total`, money(total), "inventory-subtotal-row"));
  });

  const reorderCost = sum(reorderItems.filter((item) => !item.excludeFromInventoryValue).map((item) => getInventoryRoundedOrderQuantity(item) * item.unitCost));
  inventoryOrderTable.append(createInventoryTotalRow("Estimated reorder total", money(reorderCost)));
}

function createInventoryGroupRow(groupName) {
  const row = document.createElement("tr");
  row.className = "inventory-group-row";
  row.innerHTML = `<td colspan="7">${escapeHtml(groupName)}</td>`;
  return row;
}

function createInventoryTotalRow(label, value, className = "inventory-total-row") {
  const row = document.createElement("tr");
  row.className = className;
  row.innerHTML = `
    <td colspan="6"><strong>${escapeHtml(label)}</strong></td>
    <td><strong>${escapeHtml(value)}</strong></td>
  `;
  return row;
}

function getInventoryVendorTotals(items) {
  const totals = new Map();

  items.forEach((item) => {
    if (item.excludeFromInventoryValue) return;
    const vendorName = item.vendorProduct?.vendor || "Other";
    const currentTotal = totals.get(vendorName) || 0;
    totals.set(vendorName, currentTotal + getInventoryRoundedOrderQuantity(item) * item.unitCost);
  });

  return totals;
}

function createInventoryRow(item, mode) {
  const row = document.createElement("tr");
  const orderQuantityForMode = mode === "order" ? getInventoryRoundedOrderQuantity(item) : item.orderQuantity;
  const costCell = mode === "order" ? money(orderQuantityForMode * item.unitCost) : money(item.totalValue);
  const orderCell = mode === "order"
    ? getInventoryOrderCell(item, orderQuantityForMode)
    : formatInventoryQuantity(item.orderDisplay);
  const packLabel = item.casePackaged ? `${formatNumber(item.packSize)} / case` : "Each";
  row.className = mode === "order" && item.orderQuantity > 0 ? "inventory-row--order" : "";
  const inputMode = item.allowsDecimal ? "decimal" : "numeric";
  const isParEditable = Boolean(inventoryParEditState[item.id]);
  const linkedNotes = [];
  if (item.isCustomInventory && mode === "stock") linkedNotes.push(`<button class="mini-button mini-button--danger custom-inventory-delete" data-custom-inventory-id="${escapeHtml(item.id)}" type="button">Remove</button>`);
  row.innerHTML = `
    <td><strong>${escapeHtml(item.name)}</strong>${item.note ? `<span class="table-note">${escapeHtml(item.note)}</span>` : ""}${linkedNotes.join("")}</td>
    <td>${mode === "stock" ? `<input class="inventory-input" data-field="onHand" type="text" inputmode="${inputMode}" value="${escapeHtml(item.onHandDisplay)}" aria-label="On hand for ${escapeHtml(item.name)}">` : formatInventoryQuantity(item.onHandDisplay)}</td>
    <td>${mode === "stock" ? `<div class="inventory-par-cell"><input class="inventory-input inventory-input--par ${isParEditable ? "is-editing" : "is-locked"}" data-field="par" type="text" inputmode="${inputMode}" value="${escapeHtml(item.parDisplay)}" aria-label="Par for ${escapeHtml(item.name)}" ${isParEditable ? "" : "readonly"}><button class="mini-button inventory-par-toggle" data-par-toggle="${escapeHtml(item.id)}" type="button">${isParEditable ? "Done" : "Edit"}</button></div>` : formatInventoryQuantity(item.parDisplay)}</td>
    <td data-cell="order" class="${item.orderQuantity > 0 ? "inventory-order-flag" : "muted"}">${orderCell}</td>
    <td>${escapeHtml(packLabel)}</td>
    <td>${money(item.unitCost)}</td>
    <td data-cell="cost">${costCell}</td>
  `;
  if (mode === "stock") {
    row.querySelectorAll("input").forEach((input) => {
      const field = input.dataset.field;
      input.addEventListener("focus", () => input.select());
      input.addEventListener("input", () => previewInventoryValue(item.id, field, input.value, row));
      input.addEventListener("change", () => commitInventoryValue(item.id, field, input.value));
      input.addEventListener("blur", () => {
        commitInventoryValue(item.id, field, input.value);
        input.value = getInventoryDisplayValue(findInventoryItem(item.id), field);
        syncInventoryRowCells(row, findInventoryItem(item.id));
        renderInventoryPanels();
      });
    });
    row.querySelector('[data-par-toggle]')?.addEventListener("click", () => toggleInventoryParEdit(item.id));
    row.querySelector(".custom-inventory-delete")?.addEventListener("click", () => deleteCustomInventoryItem(item.id));
  }
  return row;
}

function getInventoryRoundedOrderQuantity(item) {
  if (!item) return 0;
  return getRoundedOrderUnits(item.orderQuantity, item.packSize, item.casePackaged);
}

function getInventoryOrderCell(item, orderUnits) {
  const unitLabel = `${formatInventoryQuantity(orderUnits)} unit${orderUnits === 1 ? "" : "s"}`;
  if (!item.casePackaged) return escapeHtml(unitLabel);

  const caseCount = getOrderCaseCount(orderUnits, item.packSize);
  const caseLabel = `${formatNumber(caseCount)} case${caseCount === 1 ? "" : "s"}`;
  return `<strong>${escapeHtml(unitLabel)}</strong><span class="table-note">${escapeHtml(caseLabel)}</span>`;
}

function previewInventoryValue(id, field, value, row) {
  const item = findInventoryItem(id);
  if (!item) return;

  setInventoryItemDisplayValue(item, field, value);
  syncInventoryRowCells(row, item);
  persistInventoryField(id, field, value);
  renderInventoryPanels();
}

function commitInventoryValue(id, field, value) {
  const item = findInventoryItem(id);
  if (!item) return;

  const normalized = normalizeInventoryInputValue(value, item.allowsDecimal);
  setInventoryItemDisplayValue(item, field, normalized);
  persistInventoryField(id, field, normalized);
}

function syncInventoryRowCells(row, item) {
  const orderCell = row.querySelector('[data-cell="order"]');
  const costCell = row.querySelector('[data-cell="cost"]');
  if (orderCell) {
    orderCell.textContent = formatInventoryQuantity(item.orderDisplay);
    orderCell.className = item.orderQuantity > 0 ? "inventory-order-flag" : "muted";
  }
  if (costCell) {
    costCell.textContent = money(item.totalValue);
  }
}

function renderInventoryPanels() {
  const visibleItems = getVisibleInventoryItems();
  const reorderItems = getInventoryReorderItems(visibleItems);
  renderInventorySummary(visibleItems, reorderItems);
  renderInventoryOrderTable(reorderItems);
}

function getInventoryReorderItems(sourceItems) {
  return sourceItems.filter((item) => item.orderQuantity > 0 && !item.excludeFromOrderList);
}

function syncInventoryItemCatalogLinks() {
  const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

  inventoryItems.forEach((item) => {
    const ingredient = ingredientById.get(item.id) || null;
    item.linkedIngredientName = ingredient?.name || item.name;
    item.vendorProduct = ingredient?.vendorProduct || getVendorMapping(item.id) || null;
    item.unitCost = getInventoryBottleCost(item, ingredient);
    recalculateInventoryItem(item);
  });
}

function getInventoryBottleCost(item, ingredient) {
  const override = priceOverrides[item.id];
  const overrideBottlePrice = toNumber(override?.bottlePrice);
  if (overrideBottlePrice > 0) return overrideBottlePrice;

  if (ingredient) {
    const catalogBottleCost = getIngredientBottleCost(ingredient);
    if (catalogBottleCost > 0) return catalogBottleCost;
  }

  return item.baseUnitCost || item.unitCost || 0;
}

function getVisibleInventoryItems() {
  const searchTerm = inventorySearch.value.trim().toLowerCase();
  return inventoryItems.filter((item) => {
    const haystack = `${item.name} ${item.group} ${item.sourceSection}`.toLowerCase();
    return haystack.includes(searchTerm);
  });
}

function findInventoryItem(id) {
  return inventoryItems.find((item) => item.id === id) || null;
}

function setInventoryItemDisplayValue(item, field, value) {
  if (field === "par") {
    item.parDisplay = clean(value);
  } else {
    item.onHandDisplay = clean(value);
  }
  recalculateInventoryItem(item);
}

function getInventoryDisplayValue(item, field) {
  if (!item) return "";
  return field === "par" ? item.parDisplay : item.onHandDisplay;
}

function persistInventoryField(id, field, value) {
  if (field === "par") {
    persistInventoryOverride(inventoryParOverrides, saveInventoryParOverrides, id, value);
  } else {
    persistInventoryOverride(inventoryOnHandOverrides, saveInventoryOnHandOverrides, id, value);
  }
  scheduleInventoryFieldSync(id, field, clean(value));
}

function persistInventoryOverride(store, saveFn, id, value) {
  const normalized = clean(value);
  if (!normalized) {
    delete store[id];
  } else {
    store[id] = normalized;
  }
  saveFn();
}

function normalizeInventoryInputValue(value, allowsDecimal) {
  const normalized = clean(value);
  if (!normalized) return "";

  const number = toNumber(normalized);
  if (!Number.isFinite(number)) return "";
  if (allowsDecimal) return String(number);
  return String(Math.round(number));
}

function recalculateInventoryItem(item) {
  item.onHand = toNumber(item.onHandDisplay);
  item.par = toNumber(item.parDisplay);
  item.totalValue = item.onHand * item.unitCost;
  item.orderQuantity = item.par > item.onHand ? item.par - item.onHand : 0;
  item.orderDisplay = item.orderQuantity > 0 ? String(item.orderQuantity) : "0";
}

function toggleInventoryParEdit(id) {
  inventoryParEditState[id] = !inventoryParEditState[id];
  renderInventory();
}

async function saveInventorySnapshot() {
  const state = await runSharedInventoryAction(
    { action: "save-snapshot", items: getInventorySnapshotItems() },
    { successMessage: "This week's Monday snapshot is saved for all managers." },
  );
  if (state) renderInventoryHistory();
}

function getInventorySnapshotItems() {
  return groupInventoryForDisplay([...inventoryItems]).flatMap(([, items]) => items).map((item) => ({
    id: item.id,
    name: item.name,
    group: item.group,
    onHandDisplay: item.onHandDisplay,
    parDisplay: item.parDisplay,
    orderDisplay: String(getInventoryRoundedOrderQuantity(item)),
    shortageDisplay: item.orderDisplay,
    packSize: item.packSize,
    casePackaged: item.casePackaged,
    unitCost: item.unitCost,
    totalValue: item.totalValue,
    note: item.note,
  }));
}

function renderInventoryHistory() {
  if (!inventoryHistoryList) return;

  if (!inventoryHistory.length) {
    inventoryHistoryList.innerHTML = `<div class="empty-state">Save a Monday snapshot to create a shared week-by-week inventory history for managers.</div>`;
    return;
  }

  inventoryHistoryList.innerHTML = inventoryHistory.map((snapshot, index) => {
    const reorderItems = snapshot.items.filter((item) => toNumber(item.orderDisplay) > 0);
    const totalValue = sum(snapshot.items.map((item) => item.totalValue));
    const reorderCost = sum(reorderItems.map((item) => toNumber(item.orderDisplay) * item.unitCost));

    return `
      <details class="inventory-history-card"${index === 0 ? " open" : ""}>
        <summary>
          <div class="inventory-history-heading">
            <strong>Week of ${escapeHtml(formatInventorySnapshotLabel(getInventorySnapshotDate(snapshot)))}</strong>
            <span>Saved ${escapeHtml(formatUpdatedAt(snapshot.savedAt))}</span>
            <span>Shared manager snapshot</span>
            <span>${snapshot.items.length} items saved</span>
          </div>
          <div class="inventory-history-stats">
            <span>${money(totalValue)} on hand</span>
            <span>${money(reorderCost)} to reorder</span>
          </div>
        </summary>
        <div class="inventory-history-card__body">
          <div class="inventory-history-actions">
            <button class="ghost-button inventory-history-restore" data-snapshot-id="${escapeHtml(snapshot.id)}" type="button">Recall Snapshot</button>
            <button class="ghost-button inventory-history-delete" data-snapshot-id="${escapeHtml(snapshot.id)}" type="button">Delete snapshot</button>
          </div>
          <div class="inventory-table-wrap">
            <table class="inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>On hand</th>
                  <th>Par</th>
                  <th>Order</th>
                  <th>Unit cost</th>
                  <th>Total value</th>
                </tr>
              </thead>
              <tbody>
                ${renderInventoryHistoryRows(snapshot.items)}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    `;
  }).join("");

  inventoryHistoryList.querySelectorAll(".inventory-history-restore").forEach((button) => {
    button.addEventListener("click", () => restoreInventorySnapshot(button.dataset.snapshotId));
  });
  inventoryHistoryList.querySelectorAll(".inventory-history-delete").forEach((button) => {
    button.addEventListener("click", () => deleteInventorySnapshot(button.dataset.snapshotId));
  });
}

function renderInventoryHistoryRows(items) {
  const grouped = groupInventorySnapshotItems(items);
  return grouped.map(([groupName, groupItems]) => `
    <tr class="inventory-group-row"><td colspan="6">${escapeHtml(groupName)}</td></tr>
    ${groupItems.map((item) => `
      <tr>
        <td><strong>${escapeHtml(item.name)}</strong>${item.note ? `<span class="table-note">${escapeHtml(item.note)}</span>` : ""}</td>
        <td>${formatInventoryQuantity(item.onHandDisplay)}</td>
        <td>${formatInventoryQuantity(item.parDisplay)}</td>
        <td class="${toNumber(item.orderDisplay) > 0 ? "inventory-order-flag" : "muted"}">${formatInventoryQuantity(item.orderDisplay)}</td>
        <td>${money(item.unitCost)}</td>
        <td>${money(item.totalValue)}</td>
      </tr>
    `).join("")}
  `).join("");
}

function groupInventorySnapshotItems(sourceItems) {
  const grouped = new Map();

  sourceItems.forEach((item) => {
    if (!grouped.has(item.group)) {
      grouped.set(item.group, []);
    }
    grouped.get(item.group).push(item);
  });

  const preferredGroups = ["Liquor Cabinet", "Mixer Cabinet"];
  const remainingGroups = [...grouped.keys()]
    .filter((groupName) => !preferredGroups.includes(groupName))
    .sort((a, b) => a.localeCompare(b));
  return [...preferredGroups, ...remainingGroups]
    .map((groupName) => [
      groupName,
      (grouped.get(groupName) || []).sort((a, b) => getInventorySortKey(a).localeCompare(getInventorySortKey(b))),
    ])
    .filter(([, items]) => items.length);
}

async function deleteInventorySnapshot(snapshotId) {
  const state = await runSharedInventoryAction(
    { action: "delete-snapshot", id: snapshotId },
    { successMessage: "The shared Monday snapshot was deleted." },
  );
  if (state) renderInventoryHistory();
}

async function restoreInventorySnapshot(snapshotId) {
  const snapshot = inventoryHistory.find((entry) => entry.id === snapshotId);
  if (!snapshot) return;
  const state = await runSharedInventoryAction(
    { action: "restore-snapshot", id: snapshotId },
    {
      successMessage: `Restored the shared inventory from ${formatInventorySnapshotLabel(getInventorySnapshotDate(snapshot))}.`,
      rebuild: true,
    },
  );
  if (state) renderInventory();
}

function saveIngredientOverride(id, bottleOz, bottlePrice) {
  const nextOverride = {
    ...(priceOverrides[id] || {}),
    bottleOz,
    bottlePrice,
    updatedAt: new Date().toISOString(),
  };

  delete nextOverride.previousBottlePrice;
  delete nextOverride.previousUpdatedAt;

  if (!nextOverride.bottleOz && !nextOverride.bottlePrice) {
    delete priceOverrides[id];
  } else {
    priceOverrides[id] = nextOverride;
  }
  saveOverrides();
  render();
}

function saveKegPriceOverride(id, kegOz, kegPrice, item = null) {
  const existingOverride = kegPriceOverrides[id] || {};
  const nextKegOz = item && isBeerPricingTap(item) ? String(getExpectedBeerKegOz(item)) : kegOz;
  const nextKegPrice = toNumber(kegPrice);
  const previousKegPrice = toNumber(existingOverride.kegPrice);
  const didPriceChange = nextKegPrice > 0 && previousKegPrice > 0 && Math.abs(nextKegPrice - previousKegPrice) > 0.001;
  const nextOverride = {
    ...existingOverride,
    kegOz: nextKegOz,
    kegPrice,
    updatedAt: new Date().toISOString(),
    previousKegPrice: didPriceChange ? String(previousKegPrice) : existingOverride.previousKegPrice || "",
    previousUpdatedAt: didPriceChange ? existingOverride.updatedAt || "" : existingOverride.previousUpdatedAt || "",
  };

  if (!nextOverride.kegOz && !nextOverride.kegPrice) {
    delete kegPriceOverrides[id];
  } else {
    kegPriceOverrides[id] = nextOverride;
  }

  saveKegPriceOverrides();
  render();
}

function setChargeOverride(id, value) {
  if (value) {
    chargeOverrides[id] = value;
  } else {
    delete chargeOverrides[id];
  }
  saveChargeOverrides();
  renderStats();
  renderRecipes();
  renderPricingSummary();
}

async function addCustomRecipe(event) {
  event.preventDefault();
  const title = clean(document.querySelector("#new-recipe-title").value);
  if (!title) return;
  syncRecipeCreativeDefaults();
  if (!clean(newRecipeImageInput?.value)) {
    await ensureRecipeImageLookup({ force: true });
  }
  syncRecipeCreativeDefaults({ preserveImage: true });

  const ingredientsForRecipe = getRecipeBuilderIngredientsFromRows();

  const recipe = {
    id: editingRecipeId || `custom-${Date.now()}-${slugify(title)}`,
    title,
    batch: DEFAULT_BATCH_LABEL,
    category: clean(document.querySelector("#new-recipe-category").value) || "Other",
    defaultChargePerOz: toNumber(document.querySelector("#new-recipe-charge").value),
    description: clean(newRecipeDescriptionInput?.value),
    imageUrl: clean(newRecipeImageInput?.value),
    ingredients: ingredientsForRecipe,
    metrics: [],
    isCustom: editingRecipeId ? recipes.find((item) => item.id === editingRecipeId)?.isCustom === true : true,
  };

  if (editingRecipeId) {
    const existingRecipe = recipes.find((item) => item.id === editingRecipeId);
    recipe.sourceTitle = existingRecipe?.sourceTitle;
    recipes = recipes.map((item) => (item.id === editingRecipeId ? recipe : item));

    if (recipe.isCustom) {
      customRecipes = customRecipes.map((item) => (item.id === editingRecipeId ? recipe : item));
      saveCustomRecipes();
    } else {
      editedRecipes[recipe.id] = {
        title: recipe.title,
        batch: recipe.batch,
        category: recipe.category,
        defaultChargePerOz: recipe.defaultChargePerOz,
        description: recipe.description,
        imageUrl: recipe.imageUrl,
        ingredients: recipe.ingredients,
      };
      saveEditedRecipes();
    }
  } else {
    customRecipes.push(recipe);
    recipes.push(recipe);
    saveCustomRecipes();
  }

  if (recipe.isCustom) {
    addComingSoonItemFromRecipe(recipe);
  }

  resetRecipeForm();
  switchTab("recipes");
  render();
}

async function addPmbProduct(event) {
  event.preventDefault();
  if (pmbProductSaving) return;
  syncPmbProductDefaults();

  const productKind = clean(document.querySelector("#pmb-product-kind")?.value) || "cocktail";
  const name = clean(document.querySelector("#pmb-product-name")?.value);
  const kegCost = toNumber(pmbProductKegCostInput?.value);
  const targetMargin = getBeerTargetMargin();
  const pricePerOz = getGeneratedBeerChargePerOz(kegCost, targetMargin);
  if (!name || !kegCost) {
    setPmbProductStatus("Add a beer name and keg cost before sending to PMB.", "error");
    return;
  }

  if (!clean(pmbProductNotesInput?.value) || !clean(pmbProductImageInput?.value)) {
    await ensureBeerProductLookup({ force: true });
  }

  if (!clean(pmbProductNotesInput?.value) || !clean(pmbProductImageInput?.value)) {
    setPmbProductStatus("I could not find both an internet description and image for that beer yet. Try the full beer name or click Shuffle image after lookup.", "error");
    return;
  }

  pmbProductSaving = true;
  if (pmbProductSubmitButton) pmbProductSubmitButton.textContent = "Sending...";
  if (pmbProductSubmitButton) pmbProductSubmitButton.disabled = true;
  setPmbProductStatus("Sending product to Pour My Beer...", "loading");

  const localImageUrl = clean(document.querySelector("#pmb-product-image")?.value);
  const payload = {
    productKind,
    name,
    pricePerOz,
    servingOz: document.querySelector("#pmb-product-serving")?.value,
    brewery: document.querySelector("#pmb-product-brewery")?.value,
    style: document.querySelector("#pmb-product-style")?.value,
    abvPercent: document.querySelector("#pmb-product-abv")?.value,
    ibu: document.querySelector("#pmb-product-ibu")?.value,
    kegOz: document.querySelector("#pmb-product-keg-oz")?.value,
    kegCost,
    targetMargin,
    notes: document.querySelector("#pmb-product-notes")?.value,
    imageUrl: localImageUrl,
  };
  try {
    const response = await fetch("/api/pmb-products", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
      const attemptSummary = (result.attempts || [])
        .map((attempt) => {
          const responseText = clean(attempt.response);
          return `${attempt.path}: ${attempt.status || "failed"}${responseText ? ` (${responseText.slice(0, 120)})` : ""}`;
        })
        .join(", ");
      throw new Error(`${result.error || "PMB product add failed."}${attemptSummary ? ` Tried ${attemptSummary}.` : ""}`);
    }

    if (productKind === "beer") {
      saveCustomBeerKegFromPmbProduct(payload, result.product);
      addComingSoonItemFromPmbProduct(payload, result.product);
    }

    setPmbProductStatus(result.message || `${name} was sent to Pour My Beer.`, "success");
    pmbProductForm.reset();
    syncPmbProductDefaults();
    clearBeerLookupResult();
    render();
    runTapPricingSync();
  } catch (error) {
    setPmbProductStatus(error.message || "Could not send product to Pour My Beer.", "error");
  } finally {
    pmbProductSaving = false;
    if (pmbProductSubmitButton) pmbProductSubmitButton.textContent = "Send to PMB";
    if (pmbProductSubmitButton) pmbProductSubmitButton.disabled = false;
  }
}

async function addLiquorProduct(event) {
  event.preventDefault();
  if (liquorProductSaving) return;

  const name = normalizeIngredientAlias(clean(liquorProductNameInput?.value));
  const pricePerOz = toNumber(liquorProductPriceInput?.value);
  const servingOz = toNumber(liquorProductServingInput?.value) || 1.5;
  const bottleCost = toNumber(liquorProductBottleCostInput?.value);
  const bottleOz = toNumber(liquorProductBottleOzInput?.value) || 59.1745;
  const abvPercent = toNumber(liquorProductAbvInput?.value) || 40;
  const notes = clean(liquorProductNotesInput?.value) || `${name || "This liquor"} is available as a straight liquor tap on the tap wall.`;

  if (!name || !pricePerOz) {
    setLiquorProductStatus("Add a liquor name and charge per oz before sending to PMB.", "error");
    return;
  }

  liquorProductSaving = true;
  if (liquorProductSubmitButton) liquorProductSubmitButton.textContent = "Sending...";
  if (liquorProductSubmitButton) liquorProductSubmitButton.disabled = true;
  setLiquorProductStatus("Sending liquor tap to Pour My Beer...", "loading");

  const payload = {
    productKind: "liquor",
    name,
    pricePerOz,
    servingOz,
    brewery: "On Par Entertainment",
    style: "Liquor",
    abvPercent,
    ibu: 0,
    kegOz: bottleOz,
    notes,
  };

  try {
    const response = await fetch("/api/pmb-products", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
      const attemptSummary = (result.attempts || [])
        .map((attempt) => {
          const responseText = clean(attempt.response);
          return `${attempt.path}: ${attempt.status || "failed"}${responseText ? ` (${responseText.slice(0, 120)})` : ""}`;
        })
        .join(", ");
      throw new Error(`${result.error || "PMB liquor tap add failed."}${attemptSummary ? ` Tried ${attemptSummary}.` : ""}`);
    }

    saveCustomLiquorTapFromPmbProduct({
      ...payload,
      bottleCost,
      bottleOz,
    }, result.product);
    if (bottleCost && bottleOz) {
      saveIngredientOverride(slugify(name), String(bottleOz), String(bottleCost));
    }

    setLiquorProductStatus(result.message || `${name} was sent to Pour My Beer.`, "success");
    liquorProductForm.reset();
    ingredients = buildIngredientCatalog(getActiveRecipes());
    render();
    runTapPricingSync();
  } catch (error) {
    setLiquorProductStatus(error.message || "Could not send liquor tap to Pour My Beer.", "error");
  } finally {
    liquorProductSaving = false;
    if (liquorProductSubmitButton) liquorProductSubmitButton.textContent = "Send to PMB";
    if (liquorProductSubmitButton) liquorProductSubmitButton.disabled = false;
  }
}

function saveCustomBeerKegFromPmbProduct(payload, product = null) {
  const name = getKegDisplayName(payload.name);
  if (!name) return;

  const id = getKegPricingKey(name);
  const kegOz = toNumber(payload.kegOz) || STANDARD_BEER_KEG_OZ;
  const kegCost = toNumber(payload.kegCost);
  const existing = customBeerKegs.find((item) => item.id === id);
  const nextItem = {
    id,
    name,
    tapNumber: 0,
    wall: "New keg",
    type: "Beer",
    kegOz,
    vendor: clean(payload.brewery) || "Manual",
    sourceNames: [name],
    sourceTaps: ["New keg"],
    sourceTypes: ["Beer"],
    description: clean(payload.notes),
    imageUrl: clean(payload.imageUrl),
    plu: toNumber(product?.plu || payload.plu),
    pricePerOz: toNumber(payload.pricePerOz),
    targetMargin: toNumber(payload.targetMargin) || DEFAULT_BEER_TARGET_MARGIN,
    isCustomBeerKeg: true,
  };

  if (existing) {
    customBeerKegs = customBeerKegs.map((item) => (item.id === id ? { ...item, ...nextItem } : item));
  } else {
    customBeerKegs.push(nextItem);
  }

  if (kegCost) {
    const existingOverride = kegPriceOverrides[id] || {};
    kegPriceOverrides[id] = {
      ...existingOverride,
      kegOz: String(kegOz),
      kegPrice: String(kegCost),
      updatedAt: new Date().toISOString(),
    };
    saveKegPriceOverrides();
  }

  saveCustomBeerKegs();
}

function saveCustomLiquorTapFromPmbProduct(payload, product = null) {
  const name = normalizeIngredientAlias(clean(payload.name));
  if (!name) return;

  const id = slugify(name);
  const existing = customLiquorTaps.find((item) => item.id === id);
  const nextItem = {
    id,
    name,
    bottleOz: toNumber(payload.bottleOz) || 59.1745,
    bottleCost: toNumber(payload.bottleCost),
    pricePerOz: toNumber(payload.pricePerOz),
    servingOz: toNumber(payload.servingOz) || 1.5,
    abvPercent: toNumber(payload.abvPercent) || 40,
    notes: clean(payload.notes),
    plu: toNumber(product?.plu || payload.plu),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  if (existing) {
    customLiquorTaps = customLiquorTaps.map((item) => (item.id === id ? { ...item, ...nextItem } : item));
  } else {
    customLiquorTaps.push(nextItem);
  }

  saveCustomLiquorTaps();
}

function addComingSoonItemFromRecipe(recipe) {
  const totals = getRecipeTotals(recipe);
  const pricing = getRecipePricing(recipe);
  upsertComingSoonItem({
    id: `recipe:${recipe.id}`,
    kind: "recipe",
    recipeId: recipe.id,
    name: recipe.title,
    description: clean(recipe.description),
    imageUrl: clean(recipe.imageUrl),
    chargePerOz: toNumber(pricing.chargePerOz),
    costPerOz: toNumber(totals.costPerOz),
    batchCost: toNumber(totals.cost),
    batchOz: toNumber(totals.oz),
    abvPercent: toNumber(totals.abvPercent),
    pourOz: toNumber(pricing.pourOz),
    chargePerPour: toNumber(pricing.chargePerPour),
    margin: toNumber(pricing.margin),
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      cost: toNumber(getIngredientCost(ingredient).cost),
      oz: toNumber(ingredient.oz),
      manualCost: Boolean(ingredient.manualCost),
      manualAbvPercent: ingredient.manualAbvPercent === "" || ingredient.manualAbvPercent == null ? "" : toNumber(ingredient.manualAbvPercent),
    })),
    createdAt: new Date().toISOString(),
  });
}

function addComingSoonItemFromPmbProduct(payload, product = null) {
  const id = `beer:${toNumber(product?.plu || payload.plu) || slugify(payload.name)}`;
  upsertComingSoonItem({
    id,
    kind: "beer",
    name: clean(payload.name),
    description: clean(payload.notes),
    imageUrl: clean(payload.imageUrl),
    kegCost: toNumber(payload.kegCost),
    kegOz: toNumber(payload.kegOz) || STANDARD_BEER_KEG_OZ,
    pricePerOz: toNumber(payload.pricePerOz),
    targetMargin: toNumber(payload.targetMargin) || DEFAULT_BEER_TARGET_MARGIN,
    plu: toNumber(product?.plu || payload.plu),
    createdAt: new Date().toISOString(),
  });
}

function upsertComingSoonItem(item) {
  if (!item?.id || !item.name) return;
  const existing = comingSoonItems.find((entry) => entry.id === item.id);
  if (existing) {
    comingSoonItems = comingSoonItems.map((entry) => (entry.id === item.id ? { ...entry, ...item, createdAt: entry.createdAt || item.createdAt } : entry));
  } else {
    comingSoonItems.push(item);
  }
  saveComingSoonItems();
}

function syncRecipeCreativeDefaults({ preserveDescription = false, preserveImage = false, forceImage = false, forceDescription = false } = {}) {
  const title = clean(newRecipeTitleInput?.value) || "New Cocktail";
  const category = clean(newRecipeCategoryInput?.value) || "Other";
  const nextDescription = buildRecipeDescription(title, category, getRecipeBuilderIngredientsFromRows());

  if (
    newRecipeDescriptionInput &&
    (forceDescription || !preserveDescription || !clean(newRecipeDescriptionInput.value) || newRecipeDescriptionInput.value === lastGeneratedRecipeDescription)
  ) {
    newRecipeDescriptionInput.value = nextDescription;
    lastGeneratedRecipeDescription = nextDescription;
  }

  const currentImage = clean(newRecipeImageInput?.value);
  const needsImage = forceImage || !preserveImage || !currentImage || currentImage === lastGeneratedRecipeImage;
  if (needsImage) {
    const nextImage = buildDefaultImageUrl(title, "cocktail", recipeImageShuffleIndex);
    setRecipeImage(nextImage);
    lastGeneratedRecipeImage = nextImage;
  } else if (newRecipeImageInput?.value) {
    setRecipeImage(newRecipeImageInput.value);
  }
}

function scheduleRecipeImageLookup() {
  clearTimeout(recipeLookupTimer);
  recipeLookupItems = [];
  recipeLookupImageIndex = 0;

  const query = getRecipeImageLookupQuery();
  if (!query) return;

  recipeLookupTimer = setTimeout(() => {
    ensureRecipeImageLookup({ force: true });
  }, 700);
}

async function ensureRecipeImageLookup({ force = false } = {}) {
  const query = getRecipeImageLookupQuery();
  if (!query) return false;

  if (!force && recipeLookupItems.length) {
    applyRecipeLookupImage(recipeLookupImageIndex);
    return true;
  }

  const requestId = ++recipeLookupRequestId;

  try {
    const response = await fetch(`/api/cocktail-lookup?q=${encodeURIComponent(query)}`, { cache: "no-store" });
    const result = await response.json();
    if (requestId !== recipeLookupRequestId) return false;
    if (!response.ok) throw new Error(result?.error || "Cocktail image lookup failed.");

    recipeLookupItems = (result.items || []).filter((item) => item.imageUrl);
    recipeLookupImageIndex = 0;
    if (!recipeLookupItems.length) return false;
    applyRecipeLookupImage(0);
    return true;
  } catch {
    return false;
  }
}

function getRecipeImageLookupQuery() {
  const title = clean(newRecipeTitleInput?.value);
  const ingredients = getRecipeBuilderIngredientsFromRows()
    .map((ingredient) => ingredient.name)
    .filter(Boolean)
    .slice(0, 4)
    .join(" ");
  return clean(`${title} ${ingredients} cocktail`);
}

function applyRecipeLookupImage(index) {
  const item = recipeLookupItems[index];
  if (!item?.imageUrl) return;
  recipeLookupImageIndex = index;
  setRecipeImage(item.imageUrl);
  lastGeneratedRecipeImage = item.imageUrl;
}

function shuffleRecipeLookupImage() {
  if (recipeLookupItems.length > 1) {
    applyRecipeLookupImage((recipeLookupImageIndex + 1) % recipeLookupItems.length);
    return;
  }
  recipeImageShuffleIndex += 1;
  syncRecipeCreativeDefaults({ preserveDescription: true, forceImage: true });
  ensureRecipeImageLookup({ force: true });
}

function syncPmbProductCreativeDefaults() {
  scheduleBeerProductLookup();
}

function scheduleBeerProductLookup() {
  const name = clean(pmbProductNameInput?.value);
  beerLookupItems = [];
  beerLookupImageIndex = 0;
  beerLookupDescriptionIndex = 0;
  clearTimeout(beerLookupTimer);

  if (!name) {
    clearBeerLookupResult();
    return;
  }

  setPmbProductStatus("Looking up beer description and image from the internet...", "loading");
  beerLookupTimer = setTimeout(() => {
    ensureBeerProductLookup({ force: true });
  }, 650);
}

async function ensureBeerProductLookup({ force = false } = {}) {
  const name = clean(pmbProductNameInput?.value) || "New Beer";
  if (!name || name === "New Beer") {
    clearBeerLookupResult();
    return false;
  }

  if (!force && beerLookupItems.length) {
    applyBeerLookupResult(beerLookupImageIndex, beerLookupDescriptionIndex);
    return true;
  }

  const requestId = ++beerLookupRequestId;
  setPmbProductStatus("Looking up beer description and image from the internet...", "loading");

  try {
    const response = await fetch(`/api/beer-lookup?q=${encodeURIComponent(name)}`, { cache: "no-store" });
    const result = await response.json();
    if (requestId !== beerLookupRequestId) return false;
    if (!response.ok) throw new Error(result?.error || "Beer lookup failed.");

    beerLookupItems = (result.items || []).filter((item) => item.description && item.imageUrl);
    beerLookupImageIndex = 0;
    beerLookupDescriptionIndex = 0;
    if (!beerLookupItems.length) {
      clearBeerLookupResult({ keepStatus: true });
      setPmbProductStatus("No internet result with both description and image was found. Try the full beer name.", "error");
      return false;
    }

    applyBeerLookupResult(0);
    return true;
  } catch (error) {
    if (requestId !== beerLookupRequestId) return false;
    clearBeerLookupResult({ keepStatus: true });
    setPmbProductStatus(error.message || "Could not look up beer details.", "error");
    return false;
  }
}

function applyBeerLookupResult(imageIndex, descriptionIndex = imageIndex) {
  const imageItem = beerLookupItems[imageIndex];
  const descriptionItem = beerLookupItems[descriptionIndex];
  if (!imageItem || !descriptionItem) return;
  applyBeerLookupDescription(descriptionIndex, { silent: true });
  applyBeerLookupImage(imageIndex, { silent: true });
  const imageDetails = buildBeerLookupImageDetails(imageItem);
  setPmbProductStatus(`Using internet info from ${descriptionItem.sourceName || imageItem.sourceName || "a web result"}.${imageDetails}`, "success");
}

function applyBeerLookupDescription(index, { silent = false } = {}) {
  const item = beerLookupItems[index];
  if (!item) return;
  beerLookupDescriptionIndex = index;
  if (pmbProductNotesInput) {
    pmbProductNotesInput.value = item.description;
    lastGeneratedPmbProductDescription = item.description;
  }
  if (!silent) {
    setPmbProductStatus(`Using description from ${item.sourceName || "a web result"}.`, "success");
  }
}

function applyBeerLookupImage(index, { silent = false } = {}) {
  const item = beerLookupItems[index];
  if (!item) return;
  beerLookupImageIndex = index;
  setPmbProductImage(item.imageUrl);
  lastGeneratedPmbProductImage = item.imageUrl;
  if (!silent) {
    setPmbProductStatus(`Using image from ${item.sourceName || "a web result"}.${buildBeerLookupImageDetails(item)}`, "success");
  }
}

function buildBeerLookupImageDetails(item) {
  const imageDetails = item.imageWidth && item.imageHeight && item.imageBytes
    ? ` Preview is the final ${item.imageWidth}x${item.imageHeight} crop, ${formatFileSize(item.imageBytes)}.`
    : "";
  return imageDetails;
}

function shuffleBeerLookupImage() {
  if (beerLookupItems.length > 1) {
    applyBeerLookupImage((beerLookupImageIndex + 1) % beerLookupItems.length);
    return;
  }
  ensureBeerProductLookup({ force: true });
}

function shuffleBeerLookupDescription() {
  if (beerLookupItems.length > 1) {
    applyBeerLookupDescription((beerLookupDescriptionIndex + 1) % beerLookupItems.length);
    return;
  }
  ensureBeerProductLookup({ force: true });
}

function clearBeerLookupResult({ keepStatus = false } = {}) {
  beerLookupItems = [];
  beerLookupImageIndex = 0;
  beerLookupDescriptionIndex = 0;
  if (pmbProductNotesInput) pmbProductNotesInput.value = "";
  setPmbProductImage("");
  if (!keepStatus) setPmbProductStatus("Enter a beer name and keg cost to look up internet details.", "");
}

function buildRecipeDescription(title, category, recipeIngredients = getRecipeBuilderIngredientsFromRows()) {
  const cleanedTitle = clean(title) || "This cocktail";
  const primaryIngredient = recipeIngredients.find((ingredient) => ingredient.oz > 0)?.name || getRecipeBuilderPrimaryIngredient();
  const ingredientNames = recipeIngredients.map((ingredient) => ingredient.name).filter(Boolean);
  const flavorWords = getCocktailFlavorWords(ingredientNames);
  const secondaryIngredients = ingredientNames
    .filter((name) => name !== primaryIngredient)
    .slice(0, 3);
  const supportingPhrase = secondaryIngredients.length ? ` with ${formatNaturalList(secondaryIngredients)}` : "";
  const flavorPhrase = flavorWords.length ? `${formatNaturalList(flavorWords)} ` : "";
  const spiritPhrase = primaryIngredient ? `built on ${primaryIngredient}` : `${category.toLowerCase()}-forward`;
  return `${cleanedTitle} is a ${flavorPhrase}draft cocktail ${spiritPhrase}${supportingPhrase}, made for a bright, smooth pour and an easy finish from the tap wall.`;
}

function getCocktailFlavorWords(ingredientNames) {
  const text = ingredientNames.join(" ").toLowerCase();
  const words = [];
  if (/pineapple|mango|passion|coconut|banana|guava/.test(text)) words.push("tropical");
  if (/lemon|lime|orange|citrus|sour|lemonade/.test(text)) words.push("citrus-kissed");
  if (/cranberry|strawberry|raspberry|blueberry|pomegranate|peach|apple/.test(text)) words.push("fruit-forward");
  if (/jalapeno|spicy|ginger|cinnamon|fireball/.test(text)) words.push("lively");
  if (/coffee|cold brew|espresso|kahlua|chocolate|cacao/.test(text)) words.push("rich");
  if (/cream|coconut|vanilla|horchata/.test(text)) words.push("smooth");
  if (/mint|cucumber|watermelon/.test(text)) words.push("refreshing");
  return words.slice(0, 2);
}

function formatNaturalList(items) {
  const values = items.map(clean).filter(Boolean);
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function buildBeerProductDescription(name, brewery, style) {
  const cleanedName = clean(name) || "This beer";
  const cleanedStyle = clean(style) || inferBeerStyle(cleanedName);
  const maker = brewery ? ` from ${brewery}` : "";
  const normalized = cleanedName.toLowerCase();

  if (normalized.includes("garage beer")) {
    return `${cleanedName} is a crisp, laid-back classic lager${maker}, built for easy sipping with light malt character, a clean body, and a refreshing finish that feels right at home on the beer wall.`;
  }
  if (normalized.includes("ipa")) {
    return `${cleanedName} is a hop-forward ${cleanedStyle}${maker}, pouring with bright aromatics, balanced bitterness, and a clean finish for guests who want something bold without feeling heavy.`;
  }
  if (normalized.includes("stout") || normalized.includes("porter")) {
    return `${cleanedName} is a smooth ${cleanedStyle}${maker}, bringing roasty depth, a rounded body, and a steady finish that gives the tap wall a richer, darker option.`;
  }
  if (normalized.includes("cider")) {
    return `${cleanedName} is a bright ${cleanedStyle}${maker}, pouring crisp and fruit-forward with a clean finish for a refreshing alternative to beer.`;
  }
  if (normalized.includes("seltzer")) {
    return `${cleanedName} is a light, sparkling ${cleanedStyle}${maker}, made for a clean pour with a crisp finish and an easy-drinking feel.`;
  }

  return `${cleanedName} is a refreshing ${cleanedStyle}${maker}, selected for a balanced draft pour, approachable flavor, and clean finish that fits naturally into the beer wall lineup.`;
}

function getRecipeBuilderPrimaryIngredient() {
  const firstRow = newIngredientRows?.querySelector("tr");
  const rawName = firstRow?.querySelector('[data-field="ingredient-name"]')?.value;
  return clean(rawName);
}

function buildDefaultImageUrl(name, kind, shuffleIndex) {
  const seed = encodeURIComponent(slugify(`${kind}-${name || "default"}-${shuffleIndex || 1}`));
  return `https://picsum.photos/seed/${seed}/720/480`;
}

function setRecipeImage(url) {
  if (newRecipeImageInput) newRecipeImageInput.value = url || "";
  if (newRecipeImagePreview) newRecipeImagePreview.src = url || buildDefaultImageUrl("New Cocktail", "cocktail", recipeImageShuffleIndex);
}

function setPmbProductImage(url) {
  if (pmbProductImageInput) pmbProductImageInput.value = url || "";
  if (pmbProductImagePreview) {
    if (url) {
      pmbProductImagePreview.src = url;
      pmbProductImagePreview.hidden = false;
    } else {
      pmbProductImagePreview.removeAttribute("src");
      pmbProductImagePreview.hidden = true;
    }
  }
}

function syncPmbProductDefaults() {
  const kind = clean(pmbProductKind?.value) || "cocktail";

  if (kind === "beer") {
    const kegCost = toNumber(pmbProductKegCostInput?.value);
    const targetMargin = getBeerTargetMargin();
    const chargePerOz = getGeneratedBeerChargePerOz(kegCost, targetMargin);
    if (pmbProductServingInput) pmbProductServingInput.value = "16";
    if (pmbProductMarginInput && !clean(pmbProductMarginInput.value)) pmbProductMarginInput.value = String(DEFAULT_BEER_TARGET_MARGIN);
    if (pmbProductStyleInput) pmbProductStyleInput.value = inferBeerStyle(pmbProductNameInput?.value);
    if (pmbProductBreweryInput) pmbProductBreweryInput.value = inferBeerBrewery(pmbProductNameInput?.value);
    if (pmbProductAbvInput) pmbProductAbvInput.value = "";
    if (pmbProductIbuInput) pmbProductIbuInput.value = "0";
    if (pmbProductKegOzInput) pmbProductKegOzInput.value = String(STANDARD_BEER_KEG_OZ);
    if (pmbProductPriceInput) pmbProductPriceInput.value = chargePerOz ? formatNumber(chargePerOz) : "";
    if (pmbGeneratedSummary) {
      pmbGeneratedSummary.textContent = chargePerOz
        ? `Generated: ${money(chargePerOz)}/oz at ${formatNumber(targetMargin)}% margin, 16 oz serving, ${formatNumber(STANDARD_BEER_KEG_OZ)} oz keg.`
        : "Enter a keg cost to generate the PMB price, serving size, keg size, description, and picture.";
    }
    return;
  }

  if (pmbProductServingInput && !clean(pmbProductServingInput.value)) pmbProductServingInput.value = "5.8";
  if (pmbProductBreweryInput && !clean(pmbProductBreweryInput.value)) pmbProductBreweryInput.value = "On Par Entertainment";
  if (pmbProductStyleInput && !clean(pmbProductStyleInput.value)) pmbProductStyleInput.value = "Cocktail";
  if (pmbProductIbuInput && !clean(pmbProductIbuInput.value)) pmbProductIbuInput.value = "0";
  if (pmbProductKegOzInput && !clean(pmbProductKegOzInput.value)) pmbProductKegOzInput.value = "1536";
}

function getBeerTargetMargin(value = pmbProductMarginInput?.value) {
  const margin = toNumber(value);
  if (!margin) return DEFAULT_BEER_TARGET_MARGIN;
  return Math.min(95, Math.max(1, margin));
}

function getGeneratedBeerChargePerOz(kegCost, targetMargin = DEFAULT_BEER_TARGET_MARGIN) {
  const costPerOz = toNumber(kegCost) / STANDARD_BEER_KEG_OZ;
  if (!costPerOz) return 0;
  const targetMarginFraction = getBeerTargetMargin(targetMargin) / 100;
  return Math.max(0.01, Math.round((costPerOz / (1 - targetMarginFraction)) * 100) / 100);
}

function inferBeerStyle(name) {
  const normalized = clean(name).toLowerCase();
  if (normalized.includes("ipa")) return "IPA";
  if (normalized.includes("lager") || normalized.includes("garage beer")) return "Classic Lager";
  if (normalized.includes("pils")) return "Pilsner";
  if (normalized.includes("wheat")) return "Wheat Beer";
  if (normalized.includes("stout")) return "Stout";
  if (normalized.includes("porter")) return "Porter";
  if (normalized.includes("cider")) return "Cider";
  if (normalized.includes("seltzer")) return "Hard Seltzer";
  if (normalized.includes("ale")) return "Ale";
  return "Beer";
}

function inferBeerBrewery(name) {
  const cleaned = clean(name);
  const known = [
    ["Garage Beer", "Garage Beer Co."],
    ["Kona", "Kona Brewing"],
    ["Stella", "Stella Artois"],
    ["Modelo", "Modelo"],
    ["Pabst", "Pabst Brewing Company"],
    ["Yuengling", "Yuengling"],
    ["Miller", "Miller Brewing Company"],
    ["Coors", "Coors Brewing Company"],
    ["Bud Light", "Anheuser-Busch"],
    ["Michelob", "Anheuser-Busch"],
  ];
  const match = known.find(([needle]) => cleaned.toLowerCase().includes(needle.toLowerCase()));
  return match?.[1] || "";
}

function setPmbProductStatus(message, state = "") {
  if (!pmbProductStatus) return;
  pmbProductStatus.textContent = message;
  pmbProductStatus.dataset.state = state;
}

function setLiquorProductStatus(message, state = "") {
  if (!liquorProductStatus) return;
  liquorProductStatus.textContent = message;
  liquorProductStatus.dataset.state = state;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    const contentType = response.headers.get("content-type") || "";
    const location = response.headers.get("location") || "";
    if (response.status >= 300 && response.status < 400) {
      return {
        error: location.includes("/login")
          ? "Your dashboard login expired. Log in again, then send the product."
          : `The dashboard was redirected instead of returning JSON (${response.status}${location ? ` to ${location}` : ""}).`,
      };
    }
    const isHtml = contentType.includes("text/html") || /^\s*</.test(text);
    return {
      error: isHtml
        ? `The dashboard received an HTML page instead of JSON (${response.status}). Log in again and try once more.`
        : `Unexpected response: ${text.slice(0, 180)}`,
    };
  }
}

function formatFileSize(bytes) {
  const size = toNumber(bytes);
  if (!size) return "0 KB";
  if (size >= 1024 * 1024) return `${formatNumber(size / (1024 * 1024))} MB`;
  return `${formatNumber(size / 1024)} KB`;
}

function addIngredientRow(ingredient = null) {
  const row = document.createElement("tr");
  const isFirstRow = newIngredientRows.children.length === 0;
  if (isFirstRow) row.classList.add("primary-liquor-row");
  const packageConfig = getRecipeBuilderPackageConfig(ingredient?.name || "");
  const quantityValue = getRecipeBuilderQuantityValue(ingredient, packageConfig);
  const ozValue = packageConfig ? calculateRecipeBuilderOunces(quantityValue, packageConfig) || ingredient?.oz || "" : ingredient?.oz || "";
  const costValue = ingredient?.manualCost ? ingredient.cost : "";
  const abvValue = ingredient?.manualAbvPercent === "" || ingredient?.manualAbvPercent == null ? "" : ingredient.manualAbvPercent;
  row.innerHTML = `
    <td>
      ${isFirstRow ? '<span class="row-badge">Liquor row</span>' : ""}
      <input data-field="ingredient-name" type="text" value="${escapeHtml(ingredient?.name || "")}" placeholder="${isFirstRow ? "Liquor / primary alcohol" : "Ingredient name"}" aria-label="${isFirstRow ? "New recipe primary liquor" : "New recipe ingredient"}">
    </td>
    <td>
      <input data-field="ingredient-cost" type="text" inputmode="decimal" value="${escapeHtml(costValue)}" placeholder="0" aria-label="New recipe ingredient cost">
      <span class="table-note" data-field="cost-note"></span>
    </td>
    <td>
      <input data-field="ingredient-quantity" type="text" inputmode="decimal" value="${escapeHtml(quantityValue)}" placeholder="${packageConfig?.unitLabel === "gallons" ? "2.5" : "1"}" aria-label="New recipe ingredient bottle or gallon count">
      <span class="table-note" data-field="package-note">${escapeHtml(getRecipeBuilderPackageNote(packageConfig))}</span>
    </td>
    <td>
      <input data-field="ingredient-oz" type="text" inputmode="decimal" value="${escapeHtml(ozValue)}" placeholder="0" aria-label="New recipe ingredient ounces"${packageConfig ? " readonly" : ""}>
      <span class="table-note" data-field="oz-note">${escapeHtml(getRecipeBuilderOzNote(packageConfig))}</span>
    </td>
    <td>
      <input data-field="ingredient-abv" type="text" inputmode="decimal" value="${escapeHtml(abvValue)}" placeholder="Auto" aria-label="New recipe ingredient ABV percent">
      <span class="table-note" data-field="abv-note"></span>
    </td>
    <td><button class="icon-button" type="button" aria-label="Remove ingredient row">x</button></td>
  `;
  const nameInput = row.querySelector('[data-field="ingredient-name"]');
  const quantityInput = row.querySelector('[data-field="ingredient-quantity"]');
  const costInput = row.querySelector('[data-field="ingredient-cost"]');
  const ozInput = row.querySelector('[data-field="ingredient-oz"]');
  const abvInput = row.querySelector('[data-field="ingredient-abv"]');
  nameInput.addEventListener("input", () => {
    syncRecipeBuilderRow(row);
    syncRecipeCreativeDefaults({ preserveDescription: true, preserveImage: true });
    scheduleRecipeImageLookup();
    syncRecipeBuilderSummary();
  });
  quantityInput.addEventListener("input", () => {
    syncRecipeBuilderRow(row);
    syncRecipeBuilderSummary();
  });
  costInput.addEventListener("input", syncRecipeBuilderSummary);
  ozInput.addEventListener("input", () => {
    syncRecipeBuilderRow(row, { preserveManualOz: true });
    syncRecipeBuilderSummary();
  });
  abvInput.addEventListener("input", syncRecipeBuilderSummary);
  row.querySelector("button").addEventListener("click", () => {
    row.remove();
    syncRecipeCreativeDefaults({ preserveDescription: true, preserveImage: true });
    syncRecipeBuilderSummary();
  });
  syncRecipeBuilderRow(row, { preserveManualOz: true });
  newIngredientRows.append(row);
  syncRecipeBuilderSummary();
}

function syncRecipeBuilderRow(row, options = {}) {
  const nameInput = row.querySelector('[data-field="ingredient-name"]');
  const quantityInput = row.querySelector('[data-field="ingredient-quantity"]');
  const costInput = row.querySelector('[data-field="ingredient-cost"]');
  const ozInput = row.querySelector('[data-field="ingredient-oz"]');
  const abvInput = row.querySelector('[data-field="ingredient-abv"]');
  const costNote = row.querySelector('[data-field="cost-note"]');
  const abvNote = row.querySelector('[data-field="abv-note"]');
  const packageNote = row.querySelector('[data-field="package-note"]');
  const ozNote = row.querySelector('[data-field="oz-note"]');
  const packageConfig = getRecipeBuilderPackageConfig(nameInput.value);

  if (packageNote) packageNote.textContent = getRecipeBuilderPackageNote(packageConfig);
  if (ozNote) ozNote.textContent = getRecipeBuilderOzNote(packageConfig);

  if (packageConfig) {
    ozInput.readOnly = true;
    const ounces = calculateRecipeBuilderOunces(quantityInput.value, packageConfig);
    ozInput.value = ounces ? formatNumber(ounces) : "";
  } else {
    ozInput.readOnly = false;
    if (!options.preserveManualOz) {
      ozInput.value = "";
    }
  }

  const name = normalizeIngredientAlias(clean(nameInput.value));
  const oz = toNumber(ozInput.value);
  const estimatedCost = estimateIngredientCost(name, oz);
  if (costInput && !clean(costInput.value)) {
    costInput.placeholder = estimatedCost ? money(estimatedCost) : "0";
  }
  if (costNote) {
    costNote.textContent = clean(costInput?.value)
      ? "Manual cost"
      : estimatedCost
        ? `Estimate ${money(estimatedCost)}`
        : "Manual cost";
  }
  if (abvNote) {
    const inferredAbv = getIngredientAbvPercent({ name, manualAbvPercent: clean(abvInput?.value) });
    abvNote.textContent = clean(abvInput?.value)
      ? "Manual ABV"
      : inferredAbv
        ? `Auto ${formatNumber(inferredAbv)}%`
        : "No alcohol";
  }
}

function getRecipeBuilderIngredientsFromRows() {
  return [...newIngredientRows.querySelectorAll("tr")]
    .map(getRecipeBuilderIngredientFromRow)
    .filter((ingredient) => ingredient.name);
}

function getRecipeBuilderIngredientFromRow(row) {
  const nameInput = row.querySelector('[data-field="ingredient-name"]');
  const quantityInput = row.querySelector('[data-field="ingredient-quantity"]');
  const costInput = row.querySelector('[data-field="ingredient-cost"]');
  const ozInput = row.querySelector('[data-field="ingredient-oz"]');
  const abvInput = row.querySelector('[data-field="ingredient-abv"]');
  const inputName = clean(nameInput?.value);
  const name = normalizeIngredientAlias(inputName);
  const packageConfig = getRecipeBuilderPackageConfig(name);
  const packageCount = clean(quantityInput?.value);
  const oz = toNumber(ozInput?.value);
  const manualCostValue = clean(costInput?.value);
  const manualCost = manualCostValue !== "";
  const manualAbvValue = clean(abvInput?.value);
  const estimatedCost = estimateIngredientCost(name, oz);

  return {
    id: slugify(name),
    raw: buildRecipeIngredientRaw(name, packageCount, packageConfig),
    name,
    cost: manualCost ? toNumber(manualCostValue) : estimatedCost,
    manualCost,
    oz,
    manualAbvPercent: manualAbvValue === "" ? "" : Math.max(0, toNumber(manualAbvValue)),
    packageCount,
    packageUnit: packageConfig?.unitLabel || "",
    packageSizeOz: packageConfig?.sizeOz || 0,
  };
}

function buildRecipeBuilderDraftRecipe() {
  const title = clean(newRecipeTitleInput?.value) || "New Cocktail";
  const category = clean(newRecipeCategoryInput?.value) || "Other";
  return {
    id: editingRecipeId || `draft-${slugify(title)}`,
    title,
    batch: DEFAULT_BATCH_LABEL,
    category,
    defaultChargePerOz: toNumber(document.querySelector("#new-recipe-charge")?.value),
    description: clean(newRecipeDescriptionInput?.value),
    imageUrl: clean(newRecipeImageInput?.value),
    ingredients: getRecipeBuilderIngredientsFromRows(),
    metrics: [],
    isCustom: true,
  };
}

function syncRecipeBuilderSummary() {
  if (!recipeGeneratedSummary || !newIngredientRows) return;
  const recipe = buildRecipeBuilderDraftRecipe();
  const totals = getRecipeTotals(recipe);
  const pricing = calculateRecipePricing(recipe, recipe.defaultChargePerOz, totals);
  const ingredientCount = recipe.ingredients.filter((ingredient) => ingredient.name).length;

  recipeGeneratedSummary.innerHTML = `
    <span><b>${ingredientCount}</b> ingredients</span>
    <span><b>${formatNumber(totals.oz)}</b> oz</span>
    <span><b>${money(totals.cost)}</b> batch cost</span>
    <span><b>${formatNumber(totals.abvPercent)}%</b> ABV</span>
    <span><b>${money(totals.costPerOz)}</b> cost/oz</span>
    <span><b>${pricing.chargePerOz ? `${formatNumber(pricing.margin)}%` : "-"}</b> margin</span>
    <span><b>${pricing.pourOz ? formatNumber(pricing.pourOz) : "-"}</b> oz pour</span>
    <span><b>${pricing.chargePerPour ? money(pricing.chargePerPour) : "-"}</b> pour</span>
  `;
}

function getRecipeBuilderPackageConfig(name) {
  const normalizedName = normalizeIngredientAlias(clean(name));
  if (!normalizedName) return null;

  const id = slugify(normalizedName);
  const override = priceOverrides[id];
  const overrideBottleOz = toNumber(override?.bottleOz);
  const mappedBottleOz = toNumber(getVendorMapping(id)?.bottleOz);
  const isGallon = getIngredientGroup(normalizedName) === "Buckeye Beverage";
  const sizeOz = isGallon ? (overrideBottleOz || 128) : (overrideBottleOz || mappedBottleOz);

  if (!sizeOz) return null;

  return {
    sizeOz,
    unitLabel: isGallon ? "gallons" : "bottles",
    unitSingle: isGallon ? "gallon" : "bottle",
  };
}

function getRecipeBuilderQuantityValue(ingredient, packageConfig) {
  if (!ingredient) return "";
  if (clean(ingredient.packageCount)) return clean(ingredient.packageCount);
  if (!packageConfig || !ingredient.oz) return "";

  const count = ingredient.oz / packageConfig.sizeOz;
  if (!Number.isFinite(count) || count <= 0) return "";
  return formatNumber(count);
}

function calculateRecipeBuilderOunces(quantityValue, packageConfig) {
  if (!packageConfig) return 0;
  const quantity = toNumber(quantityValue);
  if (!quantity) return 0;
  return quantity * packageConfig.sizeOz;
}

function getRecipeBuilderPackageNote(packageConfig) {
  if (!packageConfig) return "Enter ounces manually if this ingredient is not mapped yet.";
  return `${formatNumber(packageConfig.sizeOz)} oz per ${packageConfig.unitSingle}`;
}

function getRecipeBuilderOzNote(packageConfig) {
  if (!packageConfig) return "Manual ounces";
  return `Auto from ${packageConfig.unitLabel}`;
}

function buildRecipeIngredientRaw(name, packageCount, packageConfig) {
  const cleanedName = clean(name);
  const cleanedCount = clean(packageCount);
  if (!cleanedName || !cleanedCount || !packageConfig) return cleanedName;

  const count = toNumber(cleanedCount);
  const unit = count === 1 ? packageConfig.unitSingle : packageConfig.unitLabel;
  return `${cleanedName} ${formatNumber(count)} ${unit}`;
}

function getRecipeBuilderUnitCost(name) {
  const normalizedName = normalizeIngredientAlias(clean(name));
  if (!normalizedName) return 0;

  const id = slugify(normalizedName);
  const override = priceOverrides[id];
  const overrideBottleOz = toNumber(override?.bottleOz);
  const overrideBottlePrice = toNumber(override?.bottlePrice);
  if (overrideBottleOz && overrideBottlePrice) {
    return overrideBottlePrice / overrideBottleOz;
  }

  const catalogIngredient = ingredients.find((item) => item.id === id);
  if (catalogIngredient) {
    return getCatalogUnitCost(catalogIngredient);
  }

  return 0;
}

function estimateIngredientCost(name, ounces) {
  const unitCost = getRecipeBuilderUnitCost(name);
  if (!unitCost || !ounces) return 0;
  return unitCost * ounces;
}

function deactivateRecipe(id) {
  if (!inactiveRecipeIds.includes(id)) {
    inactiveRecipeIds.push(id);
  }
  saveInactiveRecipeIds();
  render();
}

function reactivateRecipe(id) {
  inactiveRecipeIds = inactiveRecipeIds.filter((recipeId) => recipeId !== id);
  saveInactiveRecipeIds();
  render();
}

function deleteCustomRecipe(id) {
  customRecipes = customRecipes.filter((recipe) => recipe.id !== id);
  recipes = recipes.filter((recipe) => recipe.id !== id);
  inactiveRecipeIds = inactiveRecipeIds.filter((recipeId) => recipeId !== id);
  delete chargeOverrides[id];
  saveCustomRecipes();
  saveInactiveRecipeIds();
  saveChargeOverrides();
  render();
}

function startEditingRecipe(id) {
  const recipe = recipes.find((item) => item.id === id);
  if (!recipe) return;

  editingRecipeId = id;
  recipeFormTitle.textContent = `Edit ${recipe.title}`;
  recipeSubmitButton.textContent = "Save changes";
  cancelEditButton.hidden = false;
  recipeForm.reset();
  newIngredientRows.innerHTML = "";
  document.querySelector("#new-recipe-title").value = recipe.title;
  document.querySelector("#new-recipe-category").value = recipe.category || "Other";
  document.querySelector("#new-recipe-charge").value = recipe.defaultChargePerOz || "";
  if (newRecipeDescriptionInput) newRecipeDescriptionInput.value = recipe.description || buildRecipeDescription(recipe.title, recipe.category || "Other");
  if (recipe.imageUrl) {
    setRecipeImage(recipe.imageUrl);
  } else {
    recipeImageShuffleIndex += 1;
    setRecipeImage(buildDefaultImageUrl(recipe.title, "cocktail", recipeImageShuffleIndex));
  }

  if (recipe.ingredients.length) {
    recipe.ingredients.forEach((ingredient) => addIngredientRow(ingredient));
  } else {
    addIngredientRow();
  }

  switchTab("add");
}

function resetRecipeForm() {
  editingRecipeId = null;
  recipeFormTitle.textContent = "Add cocktail product";
  recipeSubmitButton.textContent = "Add product";
  cancelEditButton.hidden = true;
  recipeForm.reset();
  newIngredientRows.innerHTML = "";
  addIngredientRow();
  addIngredientRow();
  addIngredientRow();
  recipeLookupItems = [];
  recipeLookupImageIndex = 0;
  clearTimeout(recipeLookupTimer);
  recipeImageShuffleIndex += 1;
  syncRecipeCreativeDefaults();
  syncRecipeBuilderSummary();
}

function hydrateCategoryFilter(sourceRecipes) {
  const categories = [...new Set(sourceRecipes.map((recipe) => recipe.category))].sort();
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    categoryFilter.append(option);
  });
}

function applyMenuOrder(sourceRecipes) {
  return applyRecipeOrder(sourceRecipes, MENU_ORDER);
}

function applyRecipeOrder(sourceRecipes, order) {
  const byTitle = new Map(sourceRecipes.map((recipe) => [normalizeTitle(recipe.title), recipe]));

  return order.map(([displayTitle, sourceTitle]) => {
    const source = byTitle.get(normalizeTitle(sourceTitle));
    if (!source) return null;

    return {
      ...source,
      id: slugify(displayTitle),
      title: displayTitle,
      sourceTitle: source.title,
      ingredients: source.ingredients.map((ingredient) => {
        const mappedName = getIngredientName(ingredient.raw, displayTitle);
        return {
          ...ingredient,
          id: slugify(mappedName),
          name: mappedName,
        };
      }),
      metrics: source.metrics.map((metric) => ({ ...metric })),
    };
  }).filter(Boolean);
}

function applyRecipeEdits(recipe) {
  const edits = editedRecipes[recipe.id];
  if (!edits) return recipe;

  return {
    ...recipe,
    ...edits,
    ingredients: (edits.ingredients || []).map((ingredient) => ({
      ...ingredient,
      id: slugify(ingredient.name),
      raw: ingredient.raw || buildRecipeIngredientRaw(ingredient.name, ingredient.packageCount, getRecipeBuilderPackageConfig(ingredient.name)),
      name: ingredient.name,
      cost: toNumber(ingredient.cost),
      manualCost: Boolean(ingredient.manualCost),
      oz: toNumber(ingredient.oz),
      manualAbvPercent: ingredient.manualAbvPercent === "" || ingredient.manualAbvPercent == null ? "" : toNumber(ingredient.manualAbvPercent),
      packageCount: clean(ingredient.packageCount),
      packageUnit: clean(ingredient.packageUnit),
      packageSizeOz: toNumber(ingredient.packageSizeOz),
    })),
  };
}

async function fetchCsv(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.text();
}

async function fetchOptionalCsv(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (response.status === 404) return "";
  if (!response.ok) throw new Error(`Unable to load ${path}`);
  return response.text();
}

function parseRecipes(rows) {
  const header = rows[0] || [];
  const batchRow = rows[1] || [];
  const groups = [];

  for (let index = 0; index < header.length; index += 1) {
    const title = clean(header[index]);
    const costHeader = clean(header[index + 1]).toLowerCase();
    const ozHeader = clean(header[index + 2]).toLowerCase();
    if (title && costHeader === "$" && ozHeader === "oz") {
      groups.push({ title, start: index });
    }
  }

  return groups.map((group) => {
    const ingredientsForRecipe = [];
    const metrics = [];

    rows.slice(2).forEach((row) => {
      const label = clean(row[group.start]);
      const costCell = clean(row[group.start + 1]);
      const ozCell = clean(row[group.start + 2]);
      if (!label) return;

      if (isMetricLabel(label)) {
        metrics.push({ label, value: costCell || ozCell });
        return;
      }

      ingredientsForRecipe.push({
        id: slugify(getIngredientName(label, group.title)),
        raw: label,
        name: getIngredientName(label, group.title),
        cost: toNumber(costCell),
        oz: toNumber(ozCell),
      });
    });

    return {
      id: slugify(group.title),
      title: group.title,
      batch: clean(batchRow[group.start]),
      category: inferCategory(group.title),
      defaultChargePerOz: getMetricNumber(metrics, "Price we're charging"),
      ingredients: ingredientsForRecipe,
      metrics,
    };
  });
}

function buildIngredientCatalog(sourceRecipes) {
  const byId = new Map();

  sourceRecipes.forEach((recipe) => {
    recipe.ingredients.forEach((ingredient) => {
      if (!byId.has(ingredient.id)) {
        byId.set(ingredient.id, {
          id: ingredient.id,
          name: ingredient.name,
          vendorProduct: getVendorMapping(ingredient.id),
          totalCost: 0,
          totalOz: 0,
          recipes: [],
        });
      }

      const record = byId.get(ingredient.id);
      record.totalCost += ingredient.cost || 0;
      record.totalOz += ingredient.oz || 0;
      if (!record.recipes.includes(recipe.title)) {
        record.recipes.push(recipe.title);
      }
    });
  });

  STRAIGHT_LIQUOR_TAP_INGREDIENTS.forEach((name) => {
    const id = slugify(name);
    if (byId.has(id)) return;
    byId.set(id, {
      id,
      name,
      vendorProduct: getVendorMapping(id),
      totalCost: 0,
      totalOz: 0,
      recipes: ["Straight liquor tap"],
    });
  });

  customLiquorTaps.forEach((item) => {
    const name = normalizeIngredientAlias(clean(item.name));
    const id = slugify(name);
    if (!name || byId.has(id)) return;
    byId.set(id, {
      id,
      name,
      vendorProduct: getVendorMapping(id),
      totalCost: 0,
      totalOz: 0,
      recipes: ["Straight liquor tap"],
    });
  });

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getRecipeTotals(recipe) {
  const cost = sum(recipe.ingredients.map((ingredient) => getIngredientCost(ingredient).cost));
  const oz = sum(recipe.ingredients.map((ingredient) => ingredient.oz));
  const alcoholOz = sum(recipe.ingredients.map((ingredient) => ingredient.oz * getIngredientAbvFraction(ingredient)));
  return {
    cost,
    oz,
    costPerOz: oz ? cost / oz : 0,
    alcoholOz,
    abvPercent: oz ? (alcoholOz / oz) * 100 : 0,
  };
}

function getRecipePricing(recipe) {
  const totals = getRecipeTotals(recipe);
  const chargePerOz = toNumber(chargeOverrides[recipe.id]) || getLiveTapPrice(recipe)?.chargePerOz || recipe.defaultChargePerOz || 0;
  return calculateRecipePricing(recipe, chargePerOz, totals);
}

function calculateRecipePricing(recipe, chargePerOz, existingTotals = null) {
  const totals = existingTotals || getRecipeTotals(recipe);
  const pourOz = getPourOzForAlcoholTarget(recipe, totals.oz);
  const profitPerOz = chargePerOz - totals.costPerOz;
  const revenue = chargePerOz * totals.oz;
  const profit = revenue - totals.cost;

  return {
    ...totals,
    chargePerOz,
    chargePerPour: chargePerOz * pourOz,
    revenue,
    profit,
    profitPerOz,
    margin: chargePerOz ? (profitPerOz / chargePerOz) * 100 : 0,
    pourOz,
  };
}

function getLiveTapPricingRows(searchTerm = "") {
  const normalizedSearch = String(searchTerm || "").trim().toLowerCase();

  if (!liveTapPriceItems.length) {
    return [
      ...getActiveRecipes().map((recipe) => ({ livePrice: null, recipe, kegItem: null })),
      ...kegPricingItems.map((kegItem) => ({ livePrice: null, recipe: null, kegItem })),
    ].filter(({ recipe, kegItem }) => {
      const haystack = `${recipe?.title || ""} ${kegItem?.name || ""} ${kegItem?.tapSummary || ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }

  return liveTapPriceItems
    .map((livePrice) => ({
      livePrice,
      recipe: getRecipeForLiveTapPrice(livePrice),
      kegItem: getKegPricingItemForLiveTapPrice(livePrice),
    }))
    .map((tapRow) => {
      if (!tapRow.recipe && !tapRow.kegItem) {
        tapRow.livePrice.ingredient = getIngredientForLiveTapPrice(tapRow.livePrice);
      }
      return tapRow;
    })
    .filter(({ livePrice, recipe, kegItem }) => {
      const haystack = `${livePrice.name} ${livePrice.tapPosition} ${recipe?.title || ""} ${kegItem?.name || ""} ${kegItem?.tapSummary || ""} ${livePrice.ingredient?.name || ""}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => toNumber(a.livePrice?.tapPosition) - toNumber(b.livePrice?.tapPosition));
}

function buildLiveTapPriceMap(items) {
  const map = new Map();
  items.forEach((item) => {
    if (!item?.name || !item.chargePerOz) return;
    getTapPriceAliases(item.name).forEach((key) => {
      if (!map.has(key)) {
        map.set(key, item);
      }
    });
  });
  return map;
}

function getLiveTapPrice(recipe) {
  for (const key of getTapPriceAliases(recipe.title)) {
    const match = liveTapPrices.get(key);
    if (match) return match;
  }
  return null;
}

function getRecipeForLiveTapPrice(livePrice) {
  if (!livePrice?.name) return null;
  const aliases = getTapPriceAliases(livePrice.name);
  return getActiveRecipes().find((recipe) => {
    const recipeAliases = getTapPriceAliases(recipe.title);
    return aliases.some((alias) => recipeAliases.includes(alias));
  }) || null;
}

function getIngredientForLiveTapPrice(livePrice) {
  if (!livePrice?.name || normalizeTitle(livePrice.type) !== "shots") return null;
  const candidates = getTapPriceAliases(livePrice.name)
    .map((alias) => normalizeIngredientAlias(alias))
    .filter(Boolean);

  const catalogIngredient = ingredients.find((ingredient) => {
    const ingredientAliases = [
      normalizeTapPriceKey(ingredient.name),
      normalizeTapPriceKey(normalizeIngredientAlias(ingredient.name)),
    ].filter(Boolean);

    return candidates.some((candidate) => {
      const candidateKey = normalizeTapPriceKey(candidate);
      return ingredientAliases.includes(candidateKey);
    });
  });

  return catalogIngredient || buildCurrentWallIngredient(candidates[0], livePrice);
}

function buildCurrentWallIngredient(name, livePrice = null) {
  const normalizedName = normalizeIngredientAlias(clean(name || livePrice?.name));
  const id = slugify(normalizedName);
  if (!id) return null;
  return {
    id,
    name: normalizedName,
    vendorProduct: getVendorMapping(id),
    totalCost: 0,
    totalOz: 0,
    recipes: [`Current wall${toNumber(livePrice?.tapPosition) ? ` tap ${toNumber(livePrice.tapPosition)}` : ""}`],
    isCurrentWallProduct: true,
  };
}

function getLiveBeerTapPricingRows(searchTerm = "") {
  const normalizedSearch = String(searchTerm || "").trim().toLowerCase();
  const liveRows = liveTapPriceItems
    .map((livePrice) => {
      const kegItem = getKegPricingItemForLiveTapPrice(livePrice);
      return kegItem ? { livePrice, kegItem } : null;
    })
    .filter(Boolean);

  const rows = liveRows.length
    ? liveRows
    : kegPricingItems.map((kegItem) => ({ livePrice: null, kegItem }));

  return rows
    .filter(({ livePrice, kegItem }) => {
      const haystack = `${livePrice?.name || ""} ${kegItem.name} ${kegItem.tapSummary} ${kegItem.vendor}`.toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => {
      const tapA = getLiveTapWallNumber(a.livePrice?.name) || a.kegItem.tapNumber || 0;
      const tapB = getLiveTapWallNumber(b.livePrice?.name) || b.kegItem.tapNumber || 0;
      if (tapA !== tapB) return tapA - tapB;
      return (a.livePrice?.name || a.kegItem.name).localeCompare(b.livePrice?.name || b.kegItem.name);
    });
}

function getKegPricingItemForLiveTapPrice(livePrice) {
  if (!livePrice?.name) return null;
  const aliases = getTapPriceAliases(livePrice.name);
  return kegPricingItems.find((item) => {
    const itemAliases = getTapPriceAliases(item.name);
    return aliases.some((alias) => itemAliases.includes(alias));
  }) || null;
}

function getLiveTapWallNumber(name) {
  return toNumber(String(name || "").match(/\s*([123])\s*$/)?.[1]);
}

function getTapPriceAliases(value) {
  const text = String(value || "");
  const withoutParenthetical = text.replace(/\([^)]*\)/g, " ");
  return [...new Set([normalizeTapPriceKey(text), normalizeTapPriceKey(withoutParenthetical)].filter(Boolean))];
}

function normalizeTapPriceKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/’/g, "'")
    .replace(/&/g, " and ")
    .replace(/\s*[123]\s*$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\btito s\b/g, "titos")
    .replace(/\bdaniel s\b/g, "daniels")
    .replace(/\bvodka|whiskey|tequila|rum|gin|bourbon|cognac\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getPourOzForAlcoholTarget(recipe, totalOz) {
  const primaryAlcoholOz = recipe.ingredients.find((ingredient) => ingredient.oz > 0)?.oz || 0;
  if (!primaryAlcoholOz || !totalOz) return 0;
  return 1.5 / (primaryAlcoholOz / totalOz);
}

function getCalculatedMetrics(recipe, totals, pricing) {
  return [
    { label: "Total price", value: money(totals.cost) },
    { label: "Total oz", value: formatNumber(totals.oz) },
    { label: "Pure alcohol oz", value: formatNumber(totals.alcoholOz) },
    { label: "Batch ABV", value: `${formatNumber(totals.abvPercent)}%` },
    { label: "Total price per oz", value: money(totals.costPerOz) },
    { label: "Price we're charging", value: money(pricing.chargePerOz) },
    { label: "Profit per oz", value: money(pricing.profitPerOz) },
    { label: "Profit margin", value: `${formatNumber(pricing.margin)}%` },
    { label: "Oz pour for 1.5 oz alcohol", value: pricing.pourOz ? formatNumber(pricing.pourOz) : "-" },
    { label: "Charge per pour", value: pricing.pourOz ? money(pricing.chargePerPour) : "-" },
  ];
}

function getIngredientCost(ingredient) {
  if (ingredient?.manualCost) {
    return {
      cost: toNumber(ingredient.cost),
      source: "manual",
    };
  }

  const resolvedId = getResolvedIngredientId(ingredient);
  const override = priceOverrides[resolvedId];
  const bottleOz = toNumber(override?.bottleOz);
  const bottlePrice = toNumber(override?.bottlePrice);

  if (bottleOz && bottlePrice && ingredient.oz) {
    return {
      cost: ingredient.oz * (bottlePrice / bottleOz),
      source: "override",
    };
  }

  const catalogIngredient = ingredients.find((item) => item.id === resolvedId);
  const catalogUnitCost = catalogIngredient ? getCatalogUnitCost(catalogIngredient) : 0;
  if (catalogUnitCost && ingredient.oz) {
    return {
      cost: ingredient.oz * catalogUnitCost,
      source: "catalog",
    };
  }

  return {
    cost: ingredient.cost || 0,
    source: "sheet",
  };
}

function getIngredientAbvFraction(ingredient) {
  const percent = getIngredientAbvPercent(ingredient);
  return percent ? percent / 100 : 0;
}

function getIngredientAbvPercent(ingredient) {
  if (ingredient?.manualAbvPercent !== "" && ingredient?.manualAbvPercent != null) {
    return Math.max(0, toNumber(ingredient.manualAbvPercent));
  }

  const resolvedId = getResolvedIngredientId(ingredient);
  if (!resolvedId) return 0;
  if (Object.hasOwn(INGREDIENT_ABV_PERCENT, resolvedId)) {
    return INGREDIENT_ABV_PERCENT[resolvedId];
  }

  const mappedProduct = getVendorMapping(resolvedId);
  const parsedProofAbv = getAbvPercentFromProductName(mappedProduct?.productName);
  if (parsedProofAbv) return parsedProofAbv;

  return inferFallbackAbvPercent(ingredient.name);
}

function getResolvedIngredientId(ingredient) {
  const resolvedName = normalizeIngredientAlias(clean(ingredient?.name));
  if (!resolvedName) return clean(ingredient?.id);
  return slugify(resolvedName);
}

function getAbvPercentFromProductName(productName) {
  const cleaned = clean(productName);
  if (!cleaned) return 0;

  const proofMatch = cleaned.match(/\b(\d{2,3})(?:\s*proof|\s+(?=1(?:\.\d+)?l\b|750ml\b|375ml\b|16oz\b))/i);
  if (!proofMatch) return 0;

  const proof = Number.parseFloat(proofMatch[1]);
  if (!Number.isFinite(proof)) return 0;
  return proof / 2;
}

function inferFallbackAbvPercent(name) {
  const normalized = clean(name).toLowerCase();
  if (!normalized) return 0;
  if (normalized.includes("vodka") || normalized.includes("tequila")) return 40;
  if (normalized.includes("bourbon")) return 45;
  if (normalized.includes("whiskey") || normalized.includes("whisky")) return 40;
  if (normalized.includes("rum")) return 35;
  if (normalized.includes("gin")) return 40;
  if (normalized.includes("triple sec") || normalized.includes("schnapps") || normalized.includes("creme de cacao")) return 15;
  if (normalized.includes("kahlua")) return 20;
  if (normalized.includes("bitters")) return 44.7;
  return 0;
}

function getCatalogUnitCost(ingredient) {
  const override = priceOverrides[ingredient.id];
  const bottleOz = toNumber(override?.bottleOz);
  const bottlePrice = toNumber(override?.bottlePrice);
  if (bottleOz && bottlePrice) return bottlePrice / bottleOz;
  return ingredient.totalOz ? ingredient.totalCost / ingredient.totalOz : 0;
}

function getCatalogCost(ingredient) {
  return getCatalogUnitCost(ingredient) * ingredient.totalOz;
}

function buildKegPricingCatalog(sourceKegWallItems) {
  const byId = new Map();

  sourceKegWallItems
    .filter((item) => isBeerPricingTap(item))
    .forEach((item) => {
      const id = getKegPricingKey(item.brand);
      const existing = byId.get(id);
      const tapLabel = `${item.wall} ${item.tapNumber}`;

      if (!existing) {
        const vendor = getKegVendorLabel(item);
        byId.set(id, {
          id,
          name: getKegDisplayName(item.brand),
          tapNumber: item.tapNumber,
          wall: item.wall,
          type: item.type,
          kegOz: getDefaultKegSizeOz(item),
          vendor,
          vendorProduct: getKegVendorProduct(getKegDisplayName(item.brand), vendor, getDefaultKegSizeOz(item)),
          sourceNames: [item.brand],
          sourceTaps: [tapLabel],
          sourceTypes: [item.type],
        });
        return;
      }

      if (!existing.sourceNames.includes(item.brand)) existing.sourceNames.push(item.brand);
      if (!existing.sourceTaps.includes(tapLabel)) existing.sourceTaps.push(tapLabel);
      if (!existing.sourceTypes.includes(item.type)) existing.sourceTypes.push(item.type);
      if (!existing.tapNumber || item.tapNumber < existing.tapNumber) {
        existing.tapNumber = item.tapNumber;
        existing.wall = item.wall;
      }
    });

  customBeerKegs.forEach((item) => {
    const id = item.id || getKegPricingKey(item.name);
    if (!id || byId.has(id)) return;
    byId.set(id, {
      ...item,
      id,
      sourceNames: item.sourceNames?.length ? item.sourceNames : [item.name],
      sourceTaps: item.sourceTaps?.length ? item.sourceTaps : ["New keg"],
      sourceTypes: item.sourceTypes?.length ? item.sourceTypes : ["Beer"],
      vendorProduct: null,
    });
  });

  return [...byId.values()]
    .map((item) => ({
      ...item,
      tapSummary: item.sourceTaps.sort(sortTapLabels).join(", "),
      typeSummary: [...new Set(item.sourceTypes)].join(", "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isBeerPricingTap(item) {
  return (
    (item.tapNumber >= 21 && item.tapNumber <= 46) ||
    (item.wall === "Karaoke" && item.tapNumber >= 73 && item.tapNumber <= 82)
  );
}

function sortTapLabels(a, b) {
  return toNumber(a.match(/\d+/)?.[0]) - toNumber(b.match(/\d+/)?.[0]);
}

function getDefaultKegSizeOz(item) {
  const overrideKegOz = getKegSizeOverrideOz(item);
  if (overrideKegOz) return overrideKegOz;

  const liveRow = getKegLiveRow(item);
  const rawKegSize = toNumber(liveRow?.rawKegSize);
  if (rawKegSize > 500) return rawKegSize;
  return STANDARD_BEER_KEG_OZ;
}

function getKegVendorLabel(item) {
  return KEG_VENDOR_MAPPINGS[getKegPricingKey(item?.brand || item?.name || "")] || "Needs mapping";
}

function getKegVendorProduct(name, vendor, kegOz) {
  if (!KEG_PROVI_DISTRIBUTOR_HINTS[vendor]) return null;
  const key = getKegPricingKey(name);
  const aliases = BONBRIGHT_KEG_ALIASES[key] || [];
  return {
    vendor,
    syncVendor: "Provi",
    productName: aliases[0] || name,
    bottleOz: kegOz,
    distributorHints: KEG_PROVI_DISTRIBUTOR_HINTS[vendor],
    searchAliases: [...new Set([name.replace(/\s+[12]$/, "").trim(), ...aliases].filter(Boolean))],
  };
}

function getKegPricingKey(value) {
  const normalizedName = getKegDisplayName(value)
    .replace(/\b1\/2\s*bbl\b/gi, "")
    .replace(/\b1\/2\b/gi, "")
    .trim();
  const key = slugify(normalizedName);
  return KEG_PRICING_KEY_ALIASES[key] || key;
}

function getKegDisplayName(value) {
  return clean(value).replace(/\s+[12]$/, "").trim();
}

function getKegCatalogUnitCost(item) {
  const override = kegPriceOverrides[item.id];
  if (isStaleSmallBeerKegOverride(item, override)) return 0;
  const kegOz = getKegPricingOz(item);
  const kegPrice = toNumber(override?.kegPrice);
  if (kegOz && kegPrice) return kegPrice / kegOz;
  return 0;
}

function getKegPrice(item) {
  const override = kegPriceOverrides[item.id];
  if (isStaleSmallBeerKegOverride(item, override)) return 0;
  const explicitPrice = toNumber(override?.kegPrice);
  if (explicitPrice > 0) return explicitPrice;
  const unitCost = getKegCatalogUnitCost(item);
  const kegOz = getKegPricingOz(item);
  return unitCost && kegOz ? unitCost * kegOz : 0;
}

function getKegPricingOz(item) {
  if (item?.priceType === "keg" || isBeerPricingTap(item)) return getExpectedBeerKegOz(item);
  return toNumber(kegPriceOverrides[item.id]?.kegOz) || toNumber(item.kegOz) || STANDARD_BEER_KEG_OZ;
}

function getKegOverrideDisplayOz(item, override = {}) {
  if (isBeerPricingTap(item)) return String(getExpectedBeerKegOz(item));
  return override.kegOz ?? "";
}

function isStaleSmallBeerKegOverride(item, override = {}) {
  if (!item || !isBeerPricingTap(item)) return false;
  const overrideKegOz = toNumber(override?.kegOz);
  return overrideKegOz > 0 && !isRoughlyEqual(overrideKegOz, getExpectedBeerKegOz(item));
}

function getExpectedBeerKegOz(item) {
  return getKegSizeOverrideOz(item) || STANDARD_BEER_KEG_OZ;
}

function getKegSizeOverrideOz(item) {
  return KEG_SIZE_OVERRIDES[getKegPricingKey(item?.brand || item?.name || "")] || 0;
}

function getIngredientBottleCost(ingredient) {
  const override = priceOverrides[ingredient.id];
  const overrideBottlePrice = toNumber(override?.bottlePrice);
  if (overrideBottlePrice > 0) return overrideBottlePrice;

  const bottleOz = toNumber(override?.bottleOz) || toNumber(ingredient.vendorProduct?.bottleOz);
  const unitCost = getCatalogUnitCost(ingredient);
  if (bottleOz > 0 && unitCost > 0) return bottleOz * unitCost;
  return 0;
}

function countOverrides() {
  return Object.keys(priceOverrides).filter((key) => {
    const override = priceOverrides[key];
    return toNumber(override?.bottleOz) && toNumber(override?.bottlePrice);
  }).length;
}

function countKegPriceOverrides() {
  return Object.keys(kegPriceOverrides).filter((key) => {
    const override = kegPriceOverrides[key];
    const pricingItem = getKegPricingItem(key);
    if (pricingItem && isStaleSmallBeerKegOverride(pricingItem, override)) return false;
    return toNumber(override?.kegOz) && toNumber(override?.kegPrice);
  }).length;
}

function countVendorMappings(sourceIngredients = ingredients) {
  return sourceIngredients.filter((ingredient) => ingredient.vendorProduct).length;
}

function countVendorMappingsByName(sourceIngredients, vendorName) {
  return sourceIngredients.filter((ingredient) => ingredient.vendorProduct?.vendor === vendorName).length;
}

function groupKegPricingItemsForDisplay(sourceItems) {
  const grouped = new Map();

  sourceItems.forEach((item) => {
    const vendorName = item.vendor || "Needs mapping";
    if (!grouped.has(vendorName)) {
      grouped.set(vendorName, []);
    }
    grouped.get(vendorName).push(item);
  });

  return ["Heidelberg", "Bonbright", "Needs mapping"]
    .map((groupName) => [
      groupName,
      (grouped.get(groupName) || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    ])
    .filter(([, items]) => items.length);
}

function groupIngredientsForDisplay(sourceIngredients) {
  const grouped = new Map();

  sourceIngredients.forEach((ingredient) => {
    const groupName = getIngredientGroup(ingredient.name);
    if (groupName === "Other") return;
    if (!grouped.has(groupName)) {
      grouped.set(groupName, []);
    }
    grouped.get(groupName).push(ingredient);
  });

  return ["Liquor", "Proof", "Buckeye Beverage", "Food Vendors", "Made In House", "Other"]
    .map((groupName) => [
      groupName,
      (grouped.get(groupName) || []).sort((a, b) => getIngredientSortKey(a).localeCompare(getIngredientSortKey(b))),
    ])
    .filter(([, items]) => items.length);
}

function isHiddenPricingIngredient(ingredient) {
  const normalized = clean(ingredient?.name).toLowerCase();
  return getIngredientGroup(ingredient?.name) === "Other";
}

function countChargeOverrides() {
  return Object.keys(chargeOverrides).filter((key) => toNumber(chargeOverrides[key])).length;
}

function getActiveRecipes() {
  return recipes.filter((recipe) => !inactiveRecipeIds.includes(recipe.id));
}

function getInactiveRecipes() {
  return recipes.filter((recipe) => inactiveRecipeIds.includes(recipe.id));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseInventory(rows) {
  const items = [];
  let currentSection = "Liquor";

  rows.forEach((row) => {
    const first = clean(row[0]);
    const last = clean(row[row.length - 1]);

    if (!first) return;
    if (/^total /i.test(first)) return;

    if (isInventorySectionRow(first, last)) {
      currentSection = first;
      return;
    }

    if (isInventoryHeaderRow(first)) return;

    const normalizedName = normalizeInventoryName(first);
    const casePackaged = currentSection === "Juices and Mixers";
    const packSize = casePackaged ? normalizePackSize(row[4]) : 1;
    const caseCost = toNumber(row[3]);
    const unitCost = getInventoryUnitCost(caseCost, packSize);
    let note = clean(row[10]);
    if (normalizedName === "Bombay Sapphire" && /do not order for now/i.test(note)) {
      note = "";
    }
    const group = getInventoryGroup(normalizedName, currentSection);
    const id = slugify(normalizedName);
    const sourceOnHandUnits = getInventoryOnHandUnits({
      caseEquivalent: row[1],
      individualUnits: row[2],
      packSize,
      casePackaged,
    });
    const onHandDisplay = inventoryOnHandOverrides[id] ?? String(sourceOnHandUnits);
    const parDisplay = inventoryParOverrides[id] ?? clean(row[7]);

    if (group === "Bottle Service" || group === "Bubbly") return;
    if (["Jameson", "Patron", "Pink Whitney", "Screwball"].includes(normalizedName)) return;

    const item = {
      id,
      name: normalizedName,
      group,
      allowsDecimal: false,
      sourceSection: currentSection,
      onHandDisplay,
      casePackaged,
      packSize,
      legacyPackSize: getLegacyInventoryPackSize(normalizedName, packSize, casePackaged),
      caseCost,
      baseUnitCost: unitCost,
      unitCost,
      parDisplay,
      note,
      excludeFromOrderList: normalizedName === "Sour Mix",
      excludeFromInventoryValue: normalizedName === "Non Alcoholic Beer",
    };

    recalculateInventoryItem(item);
    items.push(item);
  });

  ensureInventoryPlaceholder(items, {
    name: "Non Alcoholic Beer",
    group: "Other",
    unitCost: 0,
    note: "Tracked separately",
    excludeFromInventoryValue: true,
  });

  return items;
}

function migrateInventoryOnHandOverrides(rows) {
  if (localStorage.getItem(INVENTORY_UNIT_MODEL_STORAGE_KEY) === INVENTORY_UNIT_MODEL_VERSION) return;

  let currentSection = "Liquor";
  let changed = false;

  rows.forEach((row) => {
    const first = clean(row[0]);
    const last = clean(row[row.length - 1]);
    if (!first) return;

    if (isInventorySectionRow(first, last)) {
      currentSection = first;
      return;
    }

    if (currentSection !== "Juices and Mixers" || isInventoryHeaderRow(first)) return;

    const normalizedName = normalizeInventoryName(first);
    const id = slugify(normalizedName);
    if (!Object.prototype.hasOwnProperty.call(inventoryOnHandOverrides, id)) return;

    const packSize = normalizePackSize(row[4]);
    const legacyPackSize = getLegacyInventoryPackSize(normalizedName, packSize, true);
    inventoryOnHandOverrides[id] = String(
      convertLegacyCaseCountToUnits(inventoryOnHandOverrides[id], legacyPackSize),
    );
    changed = true;
  });

  if (changed) saveInventoryOnHandOverrides();
  localStorage.setItem(INVENTORY_UNIT_MODEL_STORAGE_KEY, INVENTORY_UNIT_MODEL_VERSION);
}

function getLegacyInventoryPackSize(name, packSize, casePackaged) {
  if (!casePackaged) return 1;
  if (name === "Cold Brew") return 1;
  return normalizePackSize(packSize);
}

function parseKegLevels(rows) {
  const items = [];
  let currentWall = "";

  rows.forEach((row) => {
    const cells = row.map(clean);
    const wallCell = cells.find((cell) => ["Patio", "Main Bar", "Karaoke"].includes(cell));
    if (wallCell) {
      currentWall = wallCell === "Main Bar" ? "Main" : wallCell;
      return;
    }

    const tapNumber = toNumber(cells[0]);
    if (!tapNumber || !currentWall) return;

    const type = cells[1];
    const brand = cells[2];
    if (!type || !brand) return;

    items.push({
      id: slugify(`${currentWall}-${tapNumber}-${brand}`),
      tapNumber,
      type,
      brand,
      wall: currentWall,
    });
  });

  return items.sort((a, b) => a.tapNumber - b.tapNumber);
}

function parseWeeklyUsage(rows) {
  const headerRow = rows[0] || [];
  const historyColumns = headerRow
    .map((value, index) => ({ label: clean(value).replace(/\s+/g, " "), index }))
    .filter((entry) => entry.index >= 6 && isWeeklyHistoryHeader(entry.label));

  const parsedItems = rows
    .slice(2)
    .map((row) => {
      const tapNumber = toNumber(row[1]);
      const name = clean(row[2]);
      if (!tapNumber || !name || /^do not erase/i.test(name)) return null;

      const kegInfo = kegWallItems.find((item) => item.tapNumber === tapNumber);
      const rawOz = toNumber(row[3]);
      const currentEquivalentRaw = clean(row[4]);
      const currentEquivalent = toNumber(row[4]);
      const averageRaw = clean(row[5]);
      const average = toNumber(row[5]);
      const displayUnit = getWeeklyUsageDisplayUnitForTap({
        tapNumber,
        type: kegInfo?.type,
        name,
      }, {
        displayUnit: currentEquivalentRaw !== "" ? "kegs" : "oz",
      });
      const history = historyColumns
        .map((column) => {
          const rawValue = clean(row[column.index]);
          return {
            label: column.label,
            value: toNumber(row[column.index]),
            hasValue: rawValue !== "",
          };
        })
        .filter((entry) => entry.hasValue);

      return {
        id: slugify(`${tapNumber}-${name}`),
        tapNumber,
        name,
        wall: kegInfo?.wall || "",
        type: kegInfo?.type || "",
        rawOz,
        currentEquivalent,
        average: averageRaw !== "" ? average : calculateAverage(history.map((entry) => entry.value)),
        history: [...(weeklyUsageHistoryOverrides[slugify(`${tapNumber}-${name}`)] || []), ...history],
        isLiquorShot: displayUnit === "oz",
        displayUnit,
        currentDisplayValue: currentEquivalentRaw !== "" ? currentEquivalent : rawOz,
      };
    })
    .map((item) => item ? ({
      ...item,
      average: calculateAverage(item.history.map((entry) => entry.value)),
    }) : null)
    .filter(Boolean);

  return mergeWeeklyUsageDuplicates(parsedItems).sort((a, b) => a.tapNumber - b.tapNumber);
}

function parseWeeklyUsageChangeovers(rows) {
  const headerRow = (rows[0] || []).map((value) => normalizeWeeklyUsageColumnName(value));
  const columnIndex = (aliases, fallback) => {
    const match = aliases.map(normalizeWeeklyUsageColumnName).find((alias) => headerRow.includes(alias));
    return match ? headerRow.indexOf(match) : fallback;
  };

  const tapIndex = columnIndex(["Tap #", "Tap", "Tap Number"], 0);
  const previousIndex = columnIndex(["Previous Product", "Old Product", "Replaced Product"], 1);
  const currentIndex = columnIndex(["Current Product", "New Product", "Replacement Product"], 2);
  const effectiveIndex = columnIndex(["Effective Date", "Changed On", "Change Date"], 3);
  const splitWeekIndex = columnIndex(["Split Week", "Change Week"], 4);

  return rows
    .slice(1)
    .map((row) => {
      const tapNumber = toNumber(row[tapIndex]);
      const previousName = clean(row[previousIndex]);
      const currentName = clean(row[currentIndex]);
      const effectiveDate = normalizeWeeklyUsageEffectiveDate(row[effectiveIndex]);
      if (!tapNumber || !previousName || !currentName || !effectiveDate) return null;

      return {
        tapNumber,
        previousName,
        currentName,
        effectiveDate,
        splitWeek: normalizeWeeklyUsageSplitWeek(row[splitWeekIndex]),
      };
    })
    .filter(Boolean);
}

function normalizeWeeklyUsageColumnName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeWeeklyUsageEffectiveDate(value) {
  const cleaned = clean(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;

  const match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!month || !day || !year) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeWeeklyUsageSplitWeek(value) {
  const normalized = normalizeTitle(value);
  if (["previous", "old", "prior", "archive"].includes(normalized)) return "previous";
  return "current";
}

function mergeWeeklyUsageDuplicates(items) {
  const byId = new Map();

  items.forEach((item) => {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, {
        ...item,
        history: mergeWeeklyUsageHistory(item.history),
      });
      return;
    }

    existing.rawOz = pickWeeklyUsageValue(existing.rawOz, item.rawOz);
    existing.currentEquivalent = pickWeeklyUsageValue(existing.currentEquivalent, item.currentEquivalent);
    existing.currentDisplayValue = pickWeeklyUsageValue(existing.currentDisplayValue, item.currentDisplayValue);
    existing.history = mergeWeeklyUsageHistory([...existing.history, ...item.history]);
    existing.average = calculateAverage(existing.history.map((entry) => entry.value));
  });

  return [...byId.values()].map((item) => ({
    ...item,
    average: calculateAverage(item.history.map((entry) => entry.value)),
  }));
}

function parseWeeklyUsageExtraHistory(rows) {
  const headerRow = rows[0] || [];
  const historyColumns = headerRow
    .map((value, index) => ({ label: clean(value).replace(/\s+/g, " "), index }))
    .filter((entry) => entry.index >= 4 && isWeeklyHistoryHeader(entry.label));

  return rows
    .slice(1)
    .map((row) => {
      const tapNumber = toNumber(row[1]);
      const name = clean(row[2]);
      if (!tapNumber || !name || /^do not erase/i.test(name)) return null;

      const history = historyColumns
        .map((column) => {
          const rawValue = clean(row[column.index]);
          if (!rawValue || rawValue.startsWith("#")) return null;
          return {
            label: column.label,
            value: toNumber(rawValue),
            hasValue: true,
          };
        })
        .filter(Boolean);

      return {
        id: slugify(`${tapNumber}-${name}`),
        tapNumber,
        name,
        nameKey: normalizeWeeklyUsageName(name),
        history,
      };
    })
    .filter(Boolean);
}

function mergeWeeklyUsageExtraHistory(items, extraRows) {
  if (!extraRows.length) return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const byTap = new Map(items.map((item) => [String(item.tapNumber), item]));
  const byName = new Map(items.map((item) => [normalizeWeeklyUsageName(item.name), item]));

  extraRows.forEach((extra) => {
    const item = byId.get(extra.id) || byTap.get(String(extra.tapNumber)) || byName.get(extra.nameKey);
    if (!item) return;

    item.history = mergeWeeklyUsageHistory([...extra.history, ...item.history]);
    item.average = calculateAverage(item.history.map((entry) => entry.value));
  });

  return items;
}

function normalizeWeeklyUsageName(value, { stripWallNumber = false } = {}) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:ml|l|liter|litre)\b/g, " ")
    .replace(/&/g, "and")
    .replace(stripWallNumber ? /\s+[123]\s*$/ : /$^/, "")
    .replace(/\b(vodka|tequila|whiskey|whisky|rum|bourbon|cognac|gin)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\btito s\b/g, "titos")
    .replace(/\bdaniel s\b/g, "daniels")
    .replace(/\b([123])\s+\1$/g, "$1")
    .trim();
}

function pickWeeklyUsageValue(primary, fallback) {
  const primaryNumber = toNumber(primary);
  const fallbackNumber = toNumber(fallback);
  if (Number.isFinite(primaryNumber) && primaryNumber > 0) return primaryNumber;
  if (Number.isFinite(fallbackNumber) && fallbackNumber > 0) return fallbackNumber;
  return Number.isFinite(primaryNumber) ? primaryNumber : fallbackNumber;
}

function mergeWeeklyUsageHistory(history) {
  const byLabel = new Map();
  history.forEach((entry) => {
    if (!entry?.label || byLabel.has(entry.label)) return;
    if (!Number.isFinite(entry.value)) return;
    byLabel.set(entry.label, entry);
  });
  return sortWeeklyUsageHistory([...byLabel.values()]);
}

function sortWeeklyUsageHistory(history) {
  return [...history].sort((a, b) => getWeeklyUsageLabelTime(b.label) - getWeeklyUsageLabelTime(a.label));
}

function getWeeklyUsageLabelTime(label) {
  const match = clean(label).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return 0;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return new Date(year, month - 1, day).getTime();
}

function isWeeklyHistoryHeader(label) {
  const normalized = clean(label).toLowerCase();
  return Boolean(normalized)
    && normalized.includes("/")
    && normalized.includes("-")
    && !normalized.includes("avg");
}

function calculateAverage(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? sum(numbers) / numbers.length : 0;
}

function formatUsageDisplay(value, unit) {
  if (!Number.isFinite(value)) return "—";
  return `${formatNumber(value)} ${unit}`;
}

function ensureInventoryPlaceholder(items, config) {
  const id = slugify(config.name);
  if (items.some((item) => item.id === id)) return;

  const item = {
    id,
    name: config.name,
    group: config.group,
    allowsDecimal: false,
    sourceSection: config.group,
    onHandDisplay: inventoryOnHandOverrides[id] ?? "0",
    casePackaged: false,
    packSize: 1,
    legacyPackSize: 1,
    caseCost: config.unitCost || 0,
    baseUnitCost: config.unitCost || 0,
    unitCost: config.unitCost || 0,
    parDisplay: inventoryParOverrides[id] ?? "0",
    note: config.note || "",
    excludeFromOrderList: false,
    excludeFromInventoryValue: Boolean(config.excludeFromInventoryValue),
  };

  recalculateInventoryItem(item);
  items.push(item);
}

function isInventorySectionRow(first, last) {
  if (first === last && first) return true;
  return ["Juices and Mixers", "Bottle Service Karaoke Cooler", "Bubbly in patio cooler"].includes(first);
}

function isInventoryHeaderRow(first) {
  return /^bottle inventory/i.test(first) || /^on hand/i.test(first);
}

function normalizeInventoryName(name) {
  const normalized = clean(name)
    .replace(/\b1\.75ml\b/i, "")
    .replace(/\b1\.75\b/i, "")
    .trim();

  return normalizeIngredientAlias(normalized);
}

function groupInventoryForDisplay(sourceItems) {
  const grouped = new Map();

  sourceItems.forEach((item) => {
    if (!grouped.has(item.group)) {
      grouped.set(item.group, []);
    }
    grouped.get(item.group).push(item);
  });

  return ["Liquor Cabinet", "Mixer Cabinet", "Other"]
    .map((groupName) => [
      groupName,
      (grouped.get(groupName) || []).sort((a, b) => getInventorySortKey(a).localeCompare(getInventorySortKey(b))),
    ])
    .filter(([, items]) => items.length);
}

function getInventoryGroup(name, sourceSection) {
  const normalized = clean(name).toLowerCase();
  if (sourceSection === "Bottle Service Karaoke Cooler") return "Bottle Service";
  if (sourceSection === "Bubbly in patio cooler") return "Bubbly";
  if (normalized === "kahlua") return "Mixer Cabinet";
  if (normalized === "sweet and sour" || normalized === "non alcoholic beer") return "Other";

  const ingredientGroup = getIngredientGroup(name);
  if (ingredientGroup === "Liquor") return "Liquor Cabinet";
  return "Mixer Cabinet";
}

function inferCategory(title) {
  const match = title.match(/\(([^)]+)\)/);
  if (match) return clean(match[1]).replace("Tequilla", "Tequila");
  if (/margarita|marg|senorita/i.test(title)) return "Tequila";
  if (/martini|cran|lemonade|palmer|blue dot/i.test(title)) return "Vodka";
  if (/whiskey|jack|old fashioned|apple jack|smash|sour|on par tee/i.test(title)) return "Whiskey";
  if (/rum|captain/i.test(title)) return "Rum";
  return "Other";
}

function getIngredientName(value, recipeTitle = "") {
  let cleanedName = clean(value)
    .replace(/^\d+(\.\d+)?\s*(gallons?|oz|cups?)\s+/i, "")
    .replace(/\s*=\s*.*$/, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\b\d+(\.\d+)?\s*(bottles?|btls?|liter|liters|l|ml|oz|gallons?|cups?|diluted|pitchers|packets|water)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (/^flavored schnapps$/i.test(cleanedName)) {
    const flavor = getRecipeFlavor(recipeTitle);
    if (flavor) cleanedName = `${flavor} Schnapps`;
  }

  return normalizeIngredientAlias(cleanedName);
}

function getRecipeFlavor(recipeTitle) {
  const match = clean(recipeTitle).match(/blueberry|strawberry|raspberry|watermelon|peach/i);
  return match ? capitalize(match[0].toLowerCase()) : "";
}

function getVendorMapping(ingredientId) {
  if (PROOF_MAPPINGS[ingredientId] || OHLQ_MAPPINGS[ingredientId]) {
    return PROOF_MAPPINGS[ingredientId] || OHLQ_MAPPINGS[ingredientId] || null;
  }

  const fallbackId = slugify(normalizeIngredientAlias(clean(String(ingredientId).replace(/-/g, " "))));
  return PROOF_MAPPINGS[fallbackId] || OHLQ_MAPPINGS[fallbackId] || null;
}

function normalizeIngredientAlias(name) {
  const normalized = clean(name).toLowerCase();

  if (/^tito'?s(\s+vodka)?$/.test(normalized)) return "Tito's";
  if (/^hennessy(\s+cognac)?$/.test(normalized)) return "Hennessy";
  if (/^bacardi superior( traveler)?(\s+rum)?$/.test(normalized)) return "Bacardi Superior";
  if (/^1800 reposado(\s+tequila)?$/.test(normalized)) return "1800 Reposado";
  if (/^don julio blanco(\s+tequila)?$/.test(normalized)) return "Don Julio Blanco";
  if (/^pink whitney(\s+vodka)?$/.test(normalized)) return "Pink Whitney";
  if (/^jameson( irish)?(\s+whiskey)?$/.test(normalized)) return "Jameson";
  if (/^skr?ewball( peanut butter)?(\s+whiskey)?$/.test(normalized)) return "Screwball";
  if (/^absolut raspberri(\s+vodka)?$/.test(normalized)) return "Absolut Raspberri";
  if (/^absolut vanilia(\s+vodka)?$/.test(normalized)) return "Absolut Vanilia";
  if (/^grey goose(\s+vodka)?$/.test(normalized)) return "Grey Goose";
  if (/^patron( silver)?(\s+tequila)?$/.test(normalized)) return "Patron Silver";
  if (/^crown royal peach(\s+whiskey)?$/.test(normalized)) return "Crown Royal Peach";
  if (/^jose cuervo gold(\s+tequila)?$/.test(normalized)) return "Jose Cuervo Gold";
  if (/^ket(t)?le one cucumber vodka$/.test(normalized)) return "Ketel One Cucumber Vodka";
  if (/^ket(t)?le one cucumber$/.test(normalized)) return "Ketel One Cucumber Vodka";
  if (/^jose cuervo(\s+silver)?$/.test(normalized)) return "Jose Cuervo Silver";
  if (/^bull?iet$/.test(normalized) || /^bull?iet bourbon$/.test(normalized)) return "Bulleit Bourbon";
  if (/^crown royal(\s+whiskey)?$/.test(normalized)) return "Crown Royal";
  if (/^pomegrante schnapps$/.test(normalized)) return "Pomegranate Schnapps";
  if (
    /^crown apple royal$/.test(normalized) ||
    /^crown apple$/.test(normalized) ||
    /^crown apple 6-?$/.test(normalized) ||
    /^crown royal apple$/.test(normalized) ||
    /^crown royal regal apple$/.test(normalized) ||
    /^crown apple\b/.test(normalized)
  ) return "Crown Apple";
  if (/^jack daniels fire$/.test(normalized)) return "Jack Daniel's Fire";
  if (/^jack daniels$/.test(normalized)) return "Jack Daniel's";
  if (/^fireball(\s+cinnamon)?(\s+whisk(e)?y)?$/.test(normalized)) return "Fireball Cinnamon Whisky";
  if (/^svedka$/.test(normalized) || /^\d+\s+svedka blue raspberry$/.test(normalized) || /^svedka blue raspberry$/.test(normalized)) return "Svedka Blue Raspberry Vodka";
  if (/^gallon lemonade$/.test(normalized) || /^lemonade$/.test(normalized)) return "Lemonade";
  if (/pink lemonade$/.test(normalized)) return "Pink Lemonade";
  if (/strawberry lemonade$/.test(normalized)) return "Strawberry Lemonade";
  if (/^cranberry juice$/.test(normalized) || /^cranberry$/.test(normalized)) return "Cranberry Juice";
  if (/^simple syrup$/.test(normalized)) return "Simple Syrup";
  if (/^sour mix$/.test(normalized) || /^sweet and sour$/.test(normalized)) return "Sour Mix";
  if (/^blue dot juice$/.test(normalized) || /^blue dot$/.test(normalized)) return "Blue Dot Juice";
  if (/^lime juice$/.test(normalized)) return "Lime Juice";
  if (/^lemon juice$/.test(normalized)) return "Lemon Juice";
  if (/^creme de cocao$/.test(normalized)) return "Creme de Cacao";
  if (/^llords /.test(normalized)) return titleCaseIngredientName(name.replace(/^Llords/i, "Llord's"));

  return titleCaseIngredientName(name);
}

function getIngredientGroup(name) {
  const normalized = clean(name).toLowerCase();

  if (["lemonade", "pink lemonade", "cranberry juice", "sweet tea", "strawberry lemonade"].includes(normalized)) return "Buckeye Beverage";
  if (normalized === "cold brew coffee" || normalized === "sour mix" || normalized === "vanilla") return "Food Vendors";
  if (
    normalized === "triple sec" ||
    normalized === "bitters" ||
    normalized === "creme de cacao" ||
    normalized === "mint" ||
    normalized === "lime juice" ||
    normalized === "lemon juice" ||
    normalized.includes("schnapps") ||
    normalized.includes("pucker")
  ) {
    return "Proof";
  }
  if (normalized === "blue dot juice") return "Made In House";
  if (normalized === "simple syrup" || normalized.includes("syrup")) return "Made In House";
  if (
    normalized.includes("juice") ||
    normalized.includes("mix") ||
    normalized.includes("blue dot")
  ) return "Other";
  if (
    normalized.includes("vodka") ||
    normalized === "tito's" ||
    normalized.includes("gin") ||
    normalized.includes("rum") ||
    normalized.includes("tequila") ||
    normalized.includes("whiskey") ||
    normalized.includes("bourbon") ||
    normalized.includes("crown apple") ||
    normalized.includes("crown royal") ||
    normalized.includes("jose cuervo") ||
    normalized.includes("bombay") ||
    normalized.includes("captain morgan") ||
    normalized.includes("jim beam") ||
    normalized.includes("absolut citron") ||
    normalized.includes("svedka") ||
    normalized.includes("bulleit") ||
    normalized.includes("jack daniel") ||
    normalized === "kahlua"
  ) {
    return "Liquor";
  }

  return "Other";
}

function getIngredientSortKey(ingredient) {
  const normalized = clean(ingredient.name).toLowerCase();
  if (normalized === "kahlua") return "zzzz-kahlua";
  if (normalized === "simple syrup") return "zzzz-simple-syrup";
  return normalized;
}

function getInventorySortKey(item) {
  const cabinetIndex = INVENTORY_CABINET_ORDER.indexOf(item.name);
  if (cabinetIndex >= 0) return `${String(cabinetIndex).padStart(3, "0")}-${item.name.toLowerCase()}`;
  return `zzz-${item.name.toLowerCase()}`;
}

function titleCaseIngredientName(name) {
  return clean(name).replace(/\b([a-z])([a-z']*)/gi, (_, first, rest) => `${first.toUpperCase()}${rest.toLowerCase()}`);
}

function bindIngredientSummaryEvents() {
  const scopeSelect = document.querySelector("#vendor-sync-scope");
  const runSyncButton = document.querySelector("#run-vendor-sync");

  if (!scopeSelect || !runSyncButton) return;

  scopeSelect.addEventListener("change", () => {
    vendorSyncScope = scopeSelect.value;
  });

  runSyncButton.addEventListener("click", () => {
    vendorSyncScope = scopeSelect.value;
    runVendorSync();
  });
}

function getVendorMappedItems(scope = "all") {
  const ingredientItems = ingredients
    .filter((ingredient) => ingredient.id !== "water" && ingredient.vendorProduct)
    .map((ingredient) => ({
      id: ingredient.id,
      name: ingredient.name,
      priceType: "ingredient",
      vendorProduct: ingredient.vendorProduct,
    }));

  const kegItems = kegPricingItems
    .filter((item) => item.vendorProduct)
    .map((item) => ({
      id: item.id,
      name: item.name,
      priceType: "keg",
      vendorProduct: item.vendorProduct,
    }));

  const currentWallLiquorItems = getCurrentWallLiquorVendorItems();
  const byItemKey = new Map();
  [...ingredientItems, ...currentWallLiquorItems, ...kegItems].forEach((item) => {
    byItemKey.set(`${item.priceType}:${item.id}`, item);
  });

  return [...byItemKey.values()]
    .filter((ingredient) => scope === "all" || getVendorSyncName(ingredient.vendorProduct) === scope)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getCurrentWallLiquorVendorItems() {
  const byId = new Map();
  liveTapPriceItems.forEach((livePrice) => {
    const ingredient = getIngredientForLiveTapPrice(livePrice);
    if (!ingredient?.vendorProduct || byId.has(ingredient.id)) return;
    byId.set(ingredient.id, {
      id: ingredient.id,
      name: ingredient.name,
      priceType: "ingredient",
      vendorProduct: ingredient.vendorProduct,
    });
  });
  return [...byId.values()];
}

function getVendorSyncName(vendorProduct) {
  return vendorProduct?.syncVendor || vendorProduct?.vendor || "";
}

async function runVendorSync() {
  const candidates = getVendorMappedItems(vendorSyncScope);
  if (!candidates.length) {
    vendorSyncMessage = "No mapped pricing items match that vendor scope yet.";
    renderIngredientSummary();
    renderKegLevels();
    return;
  }

  vendorSyncRunning = true;
  vendorSyncMessage = `Checking ${vendorSyncScope === "all" ? "all mapped vendors" : vendorSyncScope}...`;
  renderIngredientSummary();
  renderKegLevels();

  try {
    const response = await fetch("/api/vendor-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: vendorSyncScope,
        items: candidates.map((item) => ({
          id: item.id,
          name: item.name,
          priceType: item.priceType,
          vendorProduct: item.vendorProduct,
          syncVendor: getVendorSyncName(item.vendorProduct),
        })),
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result?.error || "Vendor sync failed.");
    }

    let applied = 0;
    (result.updates || []).forEach((update) => {
      if (!update.id || !Number.isFinite(update.bottleOz) || !Number.isFinite(update.bottlePrice)) return;
      if (update.priceType === "keg") {
        const existingOverride = kegPriceOverrides[update.id] || {};
        const previousKegPrice = toNumber(existingOverride.kegPrice);
        const nextKegPrice = Number(update.bottlePrice);
        const pricingItem = getKegPricingItem(update.id);
        const nextKegOz = pricingItem && isBeerPricingTap(pricingItem) ? getExpectedBeerKegOz(pricingItem) : update.bottleOz;
        const didPriceChange = previousKegPrice > 0 && Math.abs(previousKegPrice - nextKegPrice) > 0.001;
        kegPriceOverrides[update.id] = {
          ...existingOverride,
          kegOz: String(nextKegOz),
          kegPrice: String(update.bottlePrice),
          updatedAt: update.updatedAt || new Date().toISOString(),
          previousKegPrice: didPriceChange ? String(previousKegPrice) : "",
          previousUpdatedAt: didPriceChange ? existingOverride.updatedAt || "" : "",
        };
        applied += 1;
        return;
      }

      const existingOverride = priceOverrides[update.id] || {};
      const previousBottlePrice = toNumber(existingOverride.bottlePrice);
      const nextBottlePrice = Number(update.bottlePrice);
      const didPriceChange = previousBottlePrice > 0 && Math.abs(previousBottlePrice - nextBottlePrice) > 0.001;
      priceOverrides[update.id] = {
        ...existingOverride,
        bottleOz: String(update.bottleOz),
        bottlePrice: String(update.bottlePrice),
        updatedAt: update.updatedAt || new Date().toISOString(),
        previousBottlePrice: didPriceChange ? String(previousBottlePrice) : "",
        previousUpdatedAt: didPriceChange ? existingOverride.updatedAt || "" : "",
      };
      applied += 1;
    });

    if (applied) {
      saveOverrides();
      saveKegPriceOverrides();
    }

    const vendorStatuses = result.vendorStatuses || [];
    const statusNotes = vendorStatuses
      .map((status) => `${status.vendor}: ${status.message}`)
      .join(" ");
    const blockedStatuses = vendorStatuses.filter((status) => ["blocked", "pending"].includes(status.status));

    vendorSyncMessage = applied || !blockedStatuses.length
      ? `Applied ${applied} price${applied === 1 ? "" : "s"}.${statusNotes ? ` ${statusNotes}` : ""}`
      : statusNotes || "No prices were applied because the selected vendor connection is not ready.";
    render();
  } catch (error) {
    vendorSyncMessage = error.message || "Vendor sync failed.";
    renderIngredientSummary();
    renderKegLevels();
  } finally {
    vendorSyncRunning = false;
    renderIngredientSummary();
    renderKegLevels();
  }
}

function getIngredientAddAmount(rawValue) {
  const raw = clean(rawValue);
  if (!raw) return "";

  if (raw.includes("=")) {
    const afterEquals = clean(raw.split("=").slice(1).join("="));
    return afterEquals.replace(/\s*=\s*.*$/, "").trim();
  }

  const leadingMatch = raw.match(/^(\d+(?:\.\d+)?)\s*(gallons?|oz|cups?|packets?|pitchers?)\b/i);
  if (leadingMatch) {
    return clean(leadingMatch[0]);
  }

  const shorthandBottleMatch = raw.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(l|ml)\b/i);
  if (shorthandBottleMatch) {
    const [, count, size, unit] = shorthandBottleMatch;
    return `${formatInventoryQuantity(count)} bottles (${formatContainerSizeLabel(size, unit)})`;
  }

  const quantityMatch = raw.match(/(\d+(?:\.\d+)?)\s*(bottles?|btls?|gallons?|oz|cups?|packets?|pitchers?)(.*)$/i);
  if (quantityMatch) {
    return clean(quantityMatch[0]);
  }

  return "";
}

function getRecipeCardAddAmount(ingredient) {
  const normalizedName = normalizeIngredientAlias(ingredient?.name || "");
  const rawValue = clean(ingredient?.raw);
  const gallonDisplayName = getRecipeCardGallonDisplayName(normalizedName, rawValue);

  const explicitGallonMatch = rawValue.match(/(\d+(?:\.\d+)?)\s*gallons?/i);
  if (explicitGallonMatch && gallonDisplayName) {
    const gallons = toNumber(explicitGallonMatch[1]);
    if (gallons > 0) {
      return `${formatNumber(gallons)} ${gallons === 1 ? "gallon" : "gallons"}`;
    }
  }

  if (gallonDisplayName && ingredient?.oz) {
    const gallons = ingredient.oz / 128;
    if (Number.isFinite(gallons) && gallons > 0) {
      return `${formatNumber(gallons)} ${gallons === 1 ? "gallon" : "gallons"}`;
    }
  }

  const baseAmount = getIngredientAddAmount(ingredient?.raw);
  if (!baseAmount) return "";
  if (/\(([^)]+)\)/.test(baseAmount)) return baseAmount;

  const packageSizeLabel = getRecipeCardPackageSizeLabel(ingredient);
  if (!packageSizeLabel) return baseAmount;
  if (!/\bbottles?\b/i.test(baseAmount)) return baseAmount;

  return `${baseAmount} (${packageSizeLabel})`;
}

function getRecipeCardGallonDisplayName(normalizedName, rawValue) {
  const normalizedRaw = clean(rawValue).toLowerCase();
  const gallonDisplayNames = new Set(["cranberry juice", "lemonade", "strawberry lemonade", "simple syrup", "sour mix", "blue dot juice"]);
  if (gallonDisplayNames.has(normalizedName)) return normalizedName;
  if (normalizedRaw.includes("strawberry lemonade")) return "strawberry lemonade";
  if (normalizedRaw.includes("gallon lemonade") || /\blemonade\b/.test(normalizedRaw)) return "lemonade";
  if (normalizedRaw.includes("cranberry")) return "cranberry juice";
  if (normalizedRaw.includes("simple syrup")) return "simple syrup";
  if (normalizedRaw.includes("sour mix") || normalizedRaw.includes("sweet and sour")) return "sour mix";
  if (normalizedRaw.includes("blue dot juice") || normalizedRaw.includes("blue dot")) return "blue dot juice";
  return "";
}

function getRecipeCardPackageSizeLabel(ingredient) {
  const explicitSizeOz = toNumber(ingredient?.packageSizeOz);
  if (explicitSizeOz) return formatPackageSizeFromOz(explicitSizeOz);

  const resolvedId = getResolvedIngredientId(ingredient);
  const overrideBottleOz = toNumber(priceOverrides[resolvedId]?.bottleOz);
  if (overrideBottleOz) return formatPackageSizeFromOz(overrideBottleOz);

  const mappedBottleOz = toNumber(getVendorMapping(resolvedId)?.bottleOz);
  if (mappedBottleOz) return formatPackageSizeFromOz(mappedBottleOz);

  return "";
}

function formatPackageSizeFromOz(sizeOz) {
  if (!sizeOz) return "";

  const roundedMl = Math.round(sizeOz * 29.5735);
  const literSizes = [
    { ml: 1750, label: "1.75L" },
    { ml: 1000, label: "1L" },
    { ml: 750, label: "750mL" },
    { ml: 375, label: "375mL" },
  ];

  const literMatch = literSizes.find((item) => Math.abs(roundedMl - item.ml) <= 20);
  if (literMatch) return literMatch.label;

  if (Math.abs(sizeOz - 16) <= 0.2) return "16oz";
  if (Math.abs(sizeOz - 128) <= 1) return "1 gallon";

  return `${formatNumber(sizeOz)} oz`;
}

function isMetricLabel(value) {
  return /^(total price|total oz|total price per oz|price we're charging|profit per oz|profit margin|cost for|how many oz per shot)/i.test(value);
}

function getMetricNumber(metrics, label) {
  const metric = metrics.find((item) => item.label.toLowerCase().startsWith(label.toLowerCase()));
  return toNumber(metric?.value);
}

function loadOverrides() {
  try {
    return {
      ...DEFAULT_PRICE_OVERRIDES,
      ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"),
    };
  } catch {
    return { ...DEFAULT_PRICE_OVERRIDES };
  }
}

function saveOverrides() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(priceOverrides));
}

function loadKegPriceOverrides() {
  try {
    const savedOverrides = JSON.parse(localStorage.getItem(KEG_PRICE_STORAGE_KEY) || "{}");
    const merged = {
      ...DEFAULT_KEG_PRICE_OVERRIDES,
      ...savedOverrides,
    };

    Object.entries(DEFAULT_KEG_PRICE_OVERRIDES).forEach(([key, defaultOverride]) => {
      if (defaultOverride.updatedAt !== "Bonbright manual pricing 2026-07-24") return;
      const savedOverride = savedOverrides[key];
      if (!savedOverride || /^Bonbright invoice 2026-07-08$/.test(String(savedOverride.updatedAt || ""))) {
        merged[key] = defaultOverride;
      }
    });

    return merged;
  } catch {
    return {
      ...DEFAULT_KEG_PRICE_OVERRIDES,
    };
  }
}

function saveKegPriceOverrides() {
  localStorage.setItem(KEG_PRICE_STORAGE_KEY, JSON.stringify(kegPriceOverrides));
}

function loadCustomBeerKegs() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_BEER_KEG_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomBeerKegs() {
  localStorage.setItem(CUSTOM_BEER_KEG_STORAGE_KEY, JSON.stringify(customBeerKegs));
}

function loadCustomLiquorTaps() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_LIQUOR_TAP_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomLiquorTaps() {
  localStorage.setItem(CUSTOM_LIQUOR_TAP_STORAGE_KEY, JSON.stringify(customLiquorTaps));
}

function loadComingSoonItems() {
  try {
    return JSON.parse(localStorage.getItem(COMING_SOON_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveComingSoonItems() {
  localStorage.setItem(COMING_SOON_STORAGE_KEY, JSON.stringify(comingSoonItems));
}

function loadTapReplacementOverrides() {
  try {
    return JSON.parse(localStorage.getItem(TAP_REPLACEMENT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveTapReplacementOverrides() {
  localStorage.setItem(TAP_REPLACEMENT_STORAGE_KEY, JSON.stringify(tapReplacementOverrides));
}

function loadChargeOverrides() {
  try {
    return JSON.parse(localStorage.getItem(CHARGE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveChargeOverrides() {
  localStorage.setItem(CHARGE_STORAGE_KEY, JSON.stringify(chargeOverrides));
}

function loadCustomRecipes() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_RECIPE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomRecipes() {
  localStorage.setItem(CUSTOM_RECIPE_STORAGE_KEY, JSON.stringify(customRecipes));
}

function loadInactiveRecipeIds() {
  try {
    return JSON.parse(localStorage.getItem(INACTIVE_RECIPE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveInactiveRecipeIds() {
  localStorage.setItem(INACTIVE_RECIPE_STORAGE_KEY, JSON.stringify(inactiveRecipeIds));
}

function loadEditedRecipes() {
  try {
    return JSON.parse(localStorage.getItem(EDITED_RECIPE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveEditedRecipes() {
  localStorage.setItem(EDITED_RECIPE_STORAGE_KEY, JSON.stringify(editedRecipes));
}

function loadCustomInventoryItems() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_INVENTORY_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomInventoryItems() {
  localStorage.setItem(CUSTOM_INVENTORY_STORAGE_KEY, JSON.stringify(customInventoryItems));
}

function loadInventoryOnHandOverrides() {
  try {
    return JSON.parse(localStorage.getItem(INVENTORY_ON_HAND_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveInventoryOnHandOverrides() {
  localStorage.setItem(INVENTORY_ON_HAND_STORAGE_KEY, JSON.stringify(inventoryOnHandOverrides));
}

function loadInventoryParOverrides() {
  try {
    return JSON.parse(localStorage.getItem(INVENTORY_PAR_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveInventoryParOverrides() {
  localStorage.setItem(INVENTORY_PAR_STORAGE_KEY, JSON.stringify(inventoryParOverrides));
}

function loadInventoryHistory() {
  try {
    return JSON.parse(localStorage.getItem(INVENTORY_HISTORY_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function loadWeeklyUsageCurrentOverrides() {
  try {
    return JSON.parse(localStorage.getItem(WEEKLY_USAGE_CURRENT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveWeeklyUsageCurrentOverrides() {
  localStorage.setItem(WEEKLY_USAGE_CURRENT_STORAGE_KEY, JSON.stringify(weeklyUsageCurrentOverrides));
}

function loadWeeklyUsageHistoryOverrides() {
  try {
    return JSON.parse(localStorage.getItem(WEEKLY_USAGE_HISTORY_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveWeeklyUsageHistoryOverrides() {
  localStorage.setItem(WEEKLY_USAGE_HISTORY_STORAGE_KEY, JSON.stringify(weeklyUsageHistoryOverrides));
}

function loadWeeklyUsageArchivedItems() {
  try {
    return JSON.parse(localStorage.getItem(WEEKLY_USAGE_ARCHIVE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveWeeklyUsageArchivedItems() {
  localStorage.setItem(WEEKLY_USAGE_ARCHIVE_STORAGE_KEY, JSON.stringify(weeklyUsageArchivedItems));
}

function loadKegOnHandOverrides() {
  try {
    return JSON.parse(localStorage.getItem(KEG_ON_HAND_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveKegOnHandOverrides() {
  localStorage.setItem(KEG_ON_HAND_STORAGE_KEY, JSON.stringify(kegOnHandOverrides));
}

function loadKegParOverrides() {
  try {
    return JSON.parse(localStorage.getItem(KEG_PAR_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveKegParOverrides() {
  localStorage.setItem(KEG_PAR_STORAGE_KEY, JSON.stringify(kegParOverrides));
}

function loadKegOnDeckOverrides() {
  try {
    return JSON.parse(localStorage.getItem(KEG_ON_DECK_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveKegOnDeckOverrides() {
  localStorage.setItem(KEG_ON_DECK_STORAGE_KEY, JSON.stringify(kegOnDeckOverrides));
}

function saveInventoryHistory() {
  localStorage.setItem(INVENTORY_HISTORY_STORAGE_KEY, JSON.stringify(inventoryHistory));
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeTitle(value) {
  return clean(value).toLowerCase();
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/[$,%\s]/g, "").replace(/,/g, "");
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function isRoughlyEqual(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) < 0.2;
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value || 0);
}

function formatInventoryQuantity(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  if (Number.isFinite(number)) return formatNumber(number);
  return value || "-";
}

function formatContainerSizeLabel(size, unit) {
  const cleanedUnit = clean(unit).toLowerCase();
  if (cleanedUnit === "l") return `${formatNumber(size)}L`;
  if (cleanedUnit === "ml") return `${formatNumber(size)}mL`;
  return `${formatNumber(size)} ${unit}`;
}

function formatUpdatedAt(value) {
  if (!value) return "Not updated";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not updated";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getPreviousPriceNote(override) {
  const currentPrice = toNumber(override?.bottlePrice) || toNumber(override?.kegPrice);
  const previousPrice = toNumber(override?.previousBottlePrice) || toNumber(override?.previousKegPrice);
  if (!currentPrice || !previousPrice) return "";
  if (Math.abs(currentPrice - previousPrice) <= 0.001) return "";

  const previousDate = override?.previousUpdatedAt ? formatUpdatedAt(override.previousUpdatedAt) : "";
  return previousDate ? `Was ${money(previousPrice)} before ${previousDate}` : `Was ${money(previousPrice)}`;
}

function formatInventorySnapshotLabel(value) {
  if (!value) return "Saved snapshot";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved snapshot";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getInventorySnapshotDate(snapshot) {
  return snapshot?.weekOf ? `${snapshot.weekOf}T12:00:00` : snapshot?.savedAt;
}

function formatBatchLabel(value) {
  const cleaned = clean(value);
  if (!cleaned) return DEFAULT_BATCH_LABEL;
  if (/^12\s*gallons?$/i.test(cleaned) || /^12\s*gallon\s*keg$/i.test(cleaned)) return DEFAULT_BATCH_LABEL;
  return cleaned;
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function capitalize(value) {
  return value ? value[0].toUpperCase() + value.slice(1) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(String(value || ""));
  return String(value || "").replace(/["\\]/g, "\\$&");
}
