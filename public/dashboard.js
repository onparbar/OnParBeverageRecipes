import {
  convertLegacyCaseCountToUnits,
  getCurrentMondayInventorySnapshot,
  getInventoryItemId,
  getInventoryOnHandUnits,
  getInventoryUnitCost,
  getOrderCaseCount,
  getRoundedOrderUnits,
  normalizeInventoryBaseName,
  normalizePackSize,
} from "./inventory-calculations.mjs";
import {
  getRecipeBuilderPackageQuantity,
  getRecipeBuilderPackageSizeOz,
  getRecipeBuilderPackageUnitHint,
  repairKnownRecipeFormulaEdits,
  repairLegacyGallonRecipeIngredients,
} from "./recipe-builder-calculations.mjs";
import {
  getCocktailAwareKegFullOunces,
  getCocktailRecipeYieldOz,
} from "./cocktail-recipe-yields.mjs";
import {
  getKnownBeerKegSizeOz,
  GUINNESS_KEG_OZ,
  GUINNESS_KEG_PRICE,
  isBeerTapPosition,
} from "./beer-keg-pricing.mjs";
import {
  buildKegOnDeckOptions,
  isKegOnDeckProductInstalled,
  resolveKegOnDeckOption,
} from "./keg-on-deck-options.mjs";
import {
  buildWeeklyActionPlan,
  canReuseWeeklyUsageHistory,
  evaluateWeeklyPlanReadiness,
  findWeeklyUsageIdentityMatch,
  getCocktailPrepDisplayName,
  getCurrentWeeklyPlanSnapshot,
  groupWeeklyPlanOrdersByVendor,
  hasCompleteWeeklyUsageRows,
  hasWeeklyUsagePhysicalIdentityConflict,
  isRecommendationForOperatingWeek,
  isWeeklyUsageNameFallbackEligible,
  isRecommendationSourceRevisionCurrent,
  normalizeLiquorTapProductName,
  refreshWeeklyPlanMetadata,
} from "./weekly-action-plan.mjs";
import {
  canSafelyRetryOperationalOutbox,
  createOperationalOutboxEntry,
  markOperationalOutboxFailure,
  normalizeOperationalOutboxEntry,
  normalizeOperationalOutboxList,
  normalizeOperationalOutboxMap,
  rebaseOperationalOutboxAfterOwnCommit,
} from "./operational-outbox.mjs";
import {
  createClearedKegOnHandOverrides,
  getAdjacentKegOnHandIndex,
  getKegOnHandEditorValue,
  normalizeKegOnHandDraft,
} from "./keg-on-hand-input.mjs";
import {
  buildActiveComingSoonBeerItems,
  buildAssignedOnDeckBeerItems,
  buildVerifiedCurrentBeerTapItems,
  filterCurrentTapPricingItems,
} from "./keg-pricing-scope.mjs";
import { REQUIRED_INGREDIENT_PRICE_DEFAULTS } from "./ingredient-price-defaults.mjs";
import {
  getPreparedIngredientCost,
  getPreparedIngredientCanonicalName,
  getPreparedIngredientFinishedUnitCost,
  getPreparedIngredientPurchase,
  getPreparedIngredientRecipeAmount,
  getPreparedIngredientYieldNote,
  isPreparedIngredientRecipeNote,
  normalizePreparedIngredientPriceOverrides,
} from "./prepared-ingredient-pricing.mjs";
import {
  enqueuePmbPublishItem,
  getPmbPublishQueueCounts,
  markPmbPublishFailed,
  markPmbPublished,
  normalizePmbPublishQueue,
  removePmbPublishItem,
} from "./pmb-publish-queue.mjs";
import { fetchPmbJsonWithRetry } from "./pmb-refresh.mjs";
import {
  searchDashboardData,
  searchDashboardItems,
} from "./global-dashboard-search.mjs";
import {
  buildPricingAdvisor,
  getPmbPriceEditorDefault,
  getPmbPriceUpdateEligibility,
  isPricingAdvisorEligibleKind,
  validatePmbPriceIncrease,
} from "./pricing-advisor.mjs";
import {
  buildWeeklyUsagePerformance,
  getWeeklyUsageEntryPouredOz,
  getWeeklyUsagePerformanceCategory,
} from "./weekly-usage-performance.mjs";
import { buildWeeklyPlanTrends } from "./weekly-plan-trends.mjs";
import {
  buildDashboardOverview,
  DASHBOARD_OVERVIEW_TARGETS,
} from "./dashboard-overview.mjs";
import { buildOhioComplianceWatchViewModel } from "./ohio-compliance-watch.mjs";
import { buildWeeklyUsageSellerRankings } from "./weekly-usage-seller-rankings.mjs";
import {
  buildLastWeekPourLeaders,
  buildLastWeekProjectedSalesMix,
} from "./dashboard-beverage-pulse.mjs";
import {
  buildShotPricingRows,
  summarizeShotPricingRows,
  validateShotPricePair,
} from "./shot-pricing-view.mjs";
import {
  getComingSoonKindLabel,
  mergeRequiredComingSoonItems,
} from "./coming-soon-items.mjs";
import { buildVendorOrderDrafts } from "./vendor-order-drafts.mjs";
import { buildProofPrepReplacementCandidates } from "./proof-prep-replacements.mjs";
import { selectPmbCurrentTapSnapshot } from "./pmb-current-tap-snapshot.mjs";

const CSV_PATH = "./data/cocktail-recipes.csv";
const NEW_COCKTAILS_CSV_PATH = "./data/new-cocktails.csv";
const INVENTORY_CSV_PATH = "./data/inventory-2026-06-01.csv";
const INVENTORY_BASELINE_DATE = "2026-06-01T12:00:00";
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
const INVENTORY_ORDER_STORAGE_KEY = "cocktail-dashboard-inventory-order";
const INVENTORY_UNIT_MODEL_STORAGE_KEY = "cocktail-dashboard-inventory-unit-model";
const INVENTORY_UNIT_MODEL_VERSION = "2";
const PRICE_OVERRIDE_MODEL_STORAGE_KEY = "cocktail-dashboard-price-override-model";
const PRICE_OVERRIDE_MODEL_VERSION = "3";
const KEG_ON_HAND_STORAGE_KEY = "cocktail-dashboard-keg-on-hand";
const KEG_PAR_STORAGE_KEY = "cocktail-dashboard-keg-par";
const KEG_ON_DECK_STORAGE_KEY = "cocktail-dashboard-keg-on-deck";
const KEG_PRICE_STORAGE_KEY = "cocktail-dashboard-keg-prices";
const CUSTOM_BEER_KEG_STORAGE_KEY = "cocktail-dashboard-custom-beer-kegs";
const CUSTOM_LIQUOR_TAP_STORAGE_KEY = "cocktail-dashboard-custom-liquor-taps";
const PMB_PUBLISH_QUEUE_STORAGE_KEY = "cocktail-dashboard-pmb-publish-queue";
const COMING_SOON_STORAGE_KEY = "cocktail-dashboard-coming-soon";
const TAP_REPLACEMENT_STORAGE_KEY = "cocktail-dashboard-tap-replacements";
const PMB_CURRENT_TAP_SNAPSHOT_STORAGE_KEY = "cocktail-dashboard-pmb-current-tap-snapshot";
const DASHBOARD_STATE_OUTBOX_STORAGE_KEY = "cocktail-dashboard-shared-state-outbox";
const EMPLOYEE_SHARED_RECIPE_CACHE_STORAGE_KEY = "cocktail-dashboard-employee-shared-recipes";
const OWNER_LOGIN_SYNC_LOCK_STORAGE_KEY = "cocktail-dashboard-owner-login-sync-lock";
const OWNER_LOGIN_SYNC_LOCK_MAX_AGE_MS = 2 * 60 * 1000;
const DASHBOARD_STATE_REQUEST_TIMEOUT_MS = 6000;
const OPERATIONAL_SHARED_REQUEST_TIMEOUT_MS = 8000;
const PAR_AGENT_RUN_REQUEST_TIMEOUT_MS = 30000;
const WEEKLY_USAGE_CURRENT_STORAGE_KEY = "cocktail-dashboard-weekly-usage-current";
const WEEKLY_USAGE_HISTORY_STORAGE_KEY = "cocktail-dashboard-weekly-usage-history";
const WEEKLY_USAGE_ARCHIVE_STORAGE_KEY = "cocktail-dashboard-weekly-usage-archive";
const WEEKLY_USAGE_LAST_SYNC_STORAGE_KEY = "cocktail-dashboard-weekly-usage-last-sync";
const WEEKLY_USAGE_OUTBOX_STORAGE_KEY = "cocktail-dashboard-weekly-usage-outbox";
const INVENTORY_FIELD_OUTBOX_STORAGE_KEY = "cocktail-dashboard-inventory-field-outbox";
const INVENTORY_ACTION_OUTBOX_STORAGE_KEY = "cocktail-dashboard-inventory-action-outbox";
const KEG_LEVELS_OUTBOX_STORAGE_KEY = "cocktail-dashboard-keg-levels-outbox";
const OWNER_PROFILE_MARKER_STORAGE_KEY = "cocktail-dashboard-owner-profile-marker";
const WEEKLY_USAGE_SYNC_LOOKBACK_WEEKS = 12;
const SHARED_DASHBOARD_FIELD_PATHS = Object.freeze([
  "pricing.ingredientPriceOverrides",
  "pricing.kegPriceOverrides",
  "pricing.chargeOverrides",
  "recipes.customRecipes",
  "recipes.inactiveRecipeIds",
  "recipes.editedRecipes",
  "products.customBeerKegs",
  "products.customLiquorTaps",
  "products.pmbPublishQueue",
  "products.comingSoonItems",
  "products.tapReplacementOverrides",
  "monitoring.ohioComplianceAcknowledgement",
]);
const SHARED_DASHBOARD_IMPORT_PHRASE = "IMPORT FROM SERVICE COMPUTER";
const INVENTORY_SHARED_IMPORT_PHRASE = "IMPORT INVENTORY FROM SERVICE COMPUTER";
const WEEKLY_USAGE_SHARED_IMPORT_PHRASE = "IMPORT WEEKLY USAGE FROM SERVICE COMPUTER";
const KEG_LEVELS_SHARED_IMPORT_PHRASE = "IMPORT KEG LEVELS FROM SERVICE COMPUTER";
const STANDARD_BEER_KEG_OZ = 15.5 * 128;
const STANDARD_COCKTAIL_KEG_OZ = 12 * 128;
const DEFAULT_BEER_TARGET_MARGIN = 82;
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
    bottleOz: "1",
    bottlePrice: "1",
    updatedAt: "Default pricing",
  },
  "cold-brew-coffee": {
    bottleOz: "32",
    bottlePrice: "25.835",
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
  ...REQUIRED_INGREDIENT_PRICE_DEFAULTS,
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
  "tito-s": {
    bottleOz: "59.17",
    bottlePrice: "34.78",
    updatedAt: "OHLQ pricing 2026-07-25",
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
  "garage-beer": "Bonbright",
  guinness: "Bonbright",
  "voodoo-ranger-ipa": "Bonbright",
};

const KEG_VENDOR_PRODUCT_CATALOG = {
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

function normalizeKegVendorCatalogKey(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+[12]$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getKegVendorCatalogProduct(...values) {
  for (const value of values) {
    const product = KEG_VENDOR_PRODUCT_CATALOG[normalizeKegVendorCatalogKey(value)];
    if (product) return product;
  }
  return null;
}
const KEG_PROVI_DISTRIBUTOR_HINTS = {
  Heidelberg: ["Heidelberg", "Heidelberg Distributing", "Heidelberg Distributing Company"],
  Bonbright: ["Bonbright", "Bonbright Distributors", "Bonbright Distributing"],
};
const KEG_PROVI_PRODUCT_MAPPINGS = {
  "triple-jam-cider": {
    productName: "Blake's Hard Cider Triple Jam",
    preferredSku: "41189",
    searchAliases: ["Triple Jam Cider", "Blake's Triple Jam"],
  },
  "truly-wild-berry": {
    productName: "TRULY Hard Seltzer Wild Berry",
    preferredSku: "42517",
    searchAliases: ["Truly Wild Berry", "Truly Hard Seltzer Wild Berry"],
  },
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
  "Jameson",
  "Screwball",
  "Pink Whitney",
  "Patron Silver",
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
  "apple-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "Llord's Apple Schnapps 30 1L", bottleOz: 33.81, preferredSku: "615006", packSize: 12, casePrice: 44.47, unitPrice: 3.71, priceCheckedAt: "2026-08-14" },
  bitters: { vendor: "Proof", syncVendor: "Provi", productName: "Angostura Bitters Aromatic 16oz", bottleOz: 16, preferredSku: "38000", packSize: 12, casePrice: 287.9, unitPrice: 23.99, priceCheckedAt: "2026-08-14" },
  "blueberry-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Blueberry Schnapps 30 1L", bottleOz: 33.81, preferredSku: "301977", packSize: 12, casePrice: 144.4, unitPrice: 12.03, priceCheckedAt: "2026-08-14", searchAliases: ["Blueberry Schnapps", "DeKuyper Blueberry Schnapps"] },
  "creme-de-cacao": { vendor: "Proof", syncVendor: "Provi", productName: "Llord's Creme De Cacao 30 1L", bottleOz: 33.81, preferredSku: "614536", packSize: 12, casePrice: 44.47, unitPrice: 3.71, priceCheckedAt: "2026-08-14", searchAliases: ["Llord's Creme De Cacao White", "Creme De Cacao White"] },
  "lemon-juice": { vendor: "Proof", syncVendor: "Provi", productName: "Finest Call Single Pressed Lemon Juice 1L", bottleOz: 33.81, preferredSku: "472535", packSize: 12, casePrice: 75.2, unitPrice: 6.27, priceCheckedAt: "2026-08-14" },
  "lime-juice": { vendor: "Proof", syncVendor: "Provi", productName: "Finest Call Lime Juice 1L", bottleOz: 33.81, preferredSku: "437071", packSize: 12, casePrice: 62.3, unitPrice: 5.19, priceCheckedAt: "2026-08-14" },
  "korbel-brut": { vendor: "Proof", syncVendor: "Provi", productName: "Korbel Brut Sparkling Wine America 250 Years California 750mL", bottleOz: 25.3605, preferredSku: "697774", packSize: 12, casePrice: 119.95, unitPrice: 10, priceCheckedAt: "2026-08-14", specialEdition: true, searchAliases: ["Korbel Brut", "Korbel California Champagne"] },
  mint: { vendor: "Proof", syncVendor: "Provi", productName: "Master of Mixes Mint Syrup Cocktail Essentials 375mL", bottleOz: 12.68, preferredSku: "437102", packSize: 12, unitPrice: 3.67, priceCheckedAt: "2026-08-14", searchAliases: ["Master of Mixes Mint Syrup", "Mint Syrup"] },
  "peach-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Peach Schnapps Peachtree 30 1L", bottleOz: 33.81, preferredSku: "25213", packSize: 12, casePrice: 144.4, unitPrice: 12.03, priceCheckedAt: "2026-08-14", searchAliases: ["Peachtree", "DeKuyper Peachtree Schnapps"] },
  "pomegranate-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Pomegranate Schnapps Pomegranate Pleasure 30 1L", bottleOz: 33.81, preferredSku: "186701", packSize: 12, casePrice: 144.4, unitPrice: 12.03, priceCheckedAt: "2026-08-14", searchAliases: ["Pomegranate Schnapps", "DeKuyper Pomegranate Schnapps"] },
  "raspberry-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Raspberry Schnapps Razzmatazz 33 1L", bottleOz: 33.81, preferredSku: "293371", packSize: 12, casePrice: 144.4, unitPrice: 12.03, priceCheckedAt: "2026-08-14", searchAliases: ["DeKuyper Razzmatazz Schnapps", "Razzmatazz"] },
  "strawberry-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Sour Strawberry Schnapps Pucker 30 1L", bottleOz: 33.81, preferredSku: "220898", packSize: 12, casePrice: 144.4, unitPrice: 12.03, priceCheckedAt: "2026-08-14", searchAliases: ["Strawberry Pucker", "DeKuyper Pucker Strawberry Schnapps"] },
  "triple-sec": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Triple Sec 30 1L", bottleOz: 33.81, preferredSku: "33497", packSize: 12, casePrice: 57.5, unitPrice: 4.79, priceCheckedAt: "2026-08-14" },
  "watermelon-schnapps": { vendor: "Proof", syncVendor: "Provi", productName: "DeKuyper Sour Watermelon Schnapps Pucker 30 1L", bottleOz: 33.81, preferredSku: "49357", packSize: 12, casePrice: 144.4, unitPrice: 12.03, priceCheckedAt: "2026-08-14", searchAliases: ["Watermelon Pucker", "DeKuyper Pucker Watermelon Schnapps"] },
};
const OHLQ_MAPPINGS = {
  "1800-reposado": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "1800 Reposado Tequila 1.75L", bottleOz: 59.1745, preferredSku: "2411D", unitPrice: 42.3, priceCheckedAt: "2026-08-15" },
  "absolut-raspberri": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Absolut Raspberri Vodka 750mL", bottleOz: 25.3605, preferredSku: "0068B", unitPrice: 16.92, priceCheckedAt: "2026-08-15" },
  "absolut-vanilia": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Absolut Vanilia Vodka 1L", bottleOz: 33.814, preferredSku: "0069L", unitPrice: 25.38, priceCheckedAt: "2026-08-15" },
  "absolut-citron": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Absolut Citron Vodka 1.75L", bottleOz: 59.17, preferredSku: "0028D", unitPrice: 32.9, priceCheckedAt: "2026-08-15" },
  "bacardi-superior": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Bacardi Superior Traveler Rum 1.75L", bottleOz: 59.1745, preferredSku: "0439D", unitPrice: 26.32, priceCheckedAt: "2026-08-15" },
  "bombay-sapphire": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Bombay Sapphire Gin 1.75L", bottleOz: 59.17, preferredSku: "1327D", unitPrice: 44.18, priceCheckedAt: "2026-08-15" },
  "buffalo-trace": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Buffalo Trace Bourbon 1L", bottleOz: 33.814, preferredSku: "1499L", packSize: 12, minimumOrderUnits: 12, casePrice: 417.36, unitPrice: 34.78, wholesaleOnly: true, priceCheckedAt: "2026-08-15", searchAliases: ["Buffalo Trace", "Buffalo Trace Kentucky Straight Bourbon"] },
  "bulleit-bourbon": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Bulleit Bourbon 1.75L", bottleOz: 59.17, preferredSku: "1497D", unitPrice: 51.7, priceCheckedAt: "2026-08-15" },
  "captain-morgan": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Captain Morgan Original Spiced Rum 1.75L", bottleOz: 59.1745, preferredSku: "1755D", unitPrice: 26.32, priceCheckedAt: "2026-08-15", searchAliases: ["Captain Morgan", "Captain Morgan Original Spiced Rum"] },
  "crown-apple": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Crown Royal Regal Apple 1.75L", bottleOz: 59.17, preferredSku: "2383D", unitPrice: 53.58, priceCheckedAt: "2026-08-15" },
  "crown-royal-peach": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Crown Royal Peach Whisky 1.75L", bottleOz: 59.1745, preferredSku: "2375D", unitPrice: 53.58, priceCheckedAt: "2026-08-15" },
  "crown-royal": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Crown Royal Canadian Whisky 1.75L", bottleOz: 59.17, preferredSku: "8894D", unitPrice: 53.58, priceCheckedAt: "2026-08-15" },
  "don-julio-blanco": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Don Julio Blanco Tequila 1.75L", bottleOz: 59.1745, preferredSku: "2722D", unitPrice: 98.7, priceCheckedAt: "2026-08-15" },
  "grey-goose": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Grey Goose Vodka 1.75L", bottleOz: 59.1745, preferredSku: "3907D", unitPrice: 47, priceCheckedAt: "2026-08-15" },
  hennessy: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Hennessy VS Cognac 1.75L", bottleOz: 59.1745, preferredSku: "0461D", unitPrice: 75.2, priceCheckedAt: "2026-08-15" },
  "jack-daniel-s": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jack Daniel's Old No. 7 1.75L", bottleOz: 59.17, preferredSku: "0066D", unitPrice: 47, priceCheckedAt: "2026-08-15" },
  "jack-daniel-s-fire": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jack Daniel's Tennessee Fire 1.75L", bottleOz: 59.17, preferredSku: "4982D", unitPrice: 47, priceCheckedAt: "2026-08-15" },
  "fireball-cinnamon-whisky": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Fireball Cinnamon Whisky 1.75L", bottleOz: 59.17, preferredSku: "3024D", unitPrice: 25.38, priceCheckedAt: "2026-08-15" },
  jameson: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jameson Irish Whiskey 1.75L", bottleOz: 59.1745, preferredSku: "0281D", unitPrice: 51.7, priceCheckedAt: "2026-08-15" },
  "jim-beam": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jim Beam Bourbon Whiskey 1.75L", bottleOz: 59.1745, preferredSku: "4116D", unitPrice: 32.9, priceCheckedAt: "2026-08-15", searchAliases: ["Jim Beam", "Jim Beam Bourbon", "Jim Beam Bourbon Whiskey Traveler"] },
  "jose-cuervo-gold": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jose Cuervo Especial Gold 1.75L", bottleOz: 59.1745, preferredSku: "2410D", unitPrice: 34.78, priceCheckedAt: "2026-08-15" },
  "jose-cuervo-silver": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Jose Cuervo Especial Silver 1.75L", bottleOz: 59.17, preferredSku: "5247D", unitPrice: 34.78, priceCheckedAt: "2026-08-15" },
  kahlua: {
    vendor: "OHLQ",
    syncVendor: "OHLQ",
    productName: "Kahlúa 1L",
    bottleOz: 33.814,
    preferredSku: "0893L",
    unitPrice: 27.26,
    priceCheckedAt: "2026-08-15",
    searchAliases: ["Kahlua", "Kahlúa"],
  },
  "makers-mark": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Maker's Mark Bourbon 1.75L", bottleOz: 59.1745, preferredSku: "6060D", unitPrice: 47, priceCheckedAt: "2026-08-15", searchAliases: ["Makers Mark", "Maker's Mark", "Maker's Mark Bourbon"] },
  "ketel-one-cucumber-vodka": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Ketel One Botanical Cucumber & Mint 1L", bottleOz: 33.81, preferredSku: "5376L", unitPrice: 28.2, priceCheckedAt: "2026-08-15" },
  "patron-silver": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Patron Silver Tequila 1.75L", bottleOz: 59.1745, preferredSku: "7984D", unitPrice: 98.7, priceCheckedAt: "2026-08-15" },
  "pink-whitney": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "New Amsterdam Pink Whitney Vodka 1.75L", bottleOz: 59.1745, preferredSku: "6765D", unitPrice: 20.68, priceCheckedAt: "2026-08-15" },
  screwball: { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Skrewball Peanut Butter Whiskey 750mL", bottleOz: 25.3605, preferredSku: "8780B", unitPrice: 18.8, priceCheckedAt: "2026-08-15" },
  "svedka-blue-raspberry-vodka": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Svedka Blue Raspberry Vodka 750mL", bottleOz: 25.36, preferredSku: "8867B", unitPrice: 8.46, priceCheckedAt: "2026-08-15" },
  "tito-s": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Tito's Handmade Vodka 1.75L", bottleOz: 59.17, preferredSku: "9232D", unitPrice: 34.78, priceCheckedAt: "2026-08-15" },
  "woodford-reserve": { vendor: "OHLQ", syncVendor: "OHLQ", productName: "Woodford Reserve Bourbon 1.75L", bottleOz: 59.1745, preferredSku: "9674D", unitPrice: 66.74, priceCheckedAt: "2026-08-15" },
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
const OPERATION_TAB_NAMES = ["keg-levels", "inventory", "weekly-plan"];
const MENU_TAB_NAMES = ["performance", "weekly-usage", "recipes", "add", "pricing", "ingredients"];
const NEW_RECIPE_ORDER = [
  ["Bacardi Sunset", "Bacardi Sunset"],
  ["Whiskey Smash", "Whiskey Smash"],
  ["APPLE JACK (WHISKEY)", "Apple Jack (Whiskey)"],
  ["On Par Tee", "On Par Tee"],
];
const STATIC_RECIPE_PRESENTATION = Object.freeze({
  "bacardi-sunset": Object.freeze({
    canonicalTitle: "Bacardi Sunset",
    category: "Rum",
    description: "Bacardi Sunset is a fruit-forward draft cocktail made with Bacardi Superior and strawberry lemonade for a bright, smooth, sunset-colored pour.",
    imageUrl: "/images/products/bacardi-sunset-pmb.png",
  }),
  "whiskey-smash": Object.freeze({
    canonicalTitle: "Whiskey Smash (Jim Beam)",
  }),
  "apple-jack-whiskey": Object.freeze({
    canonicalTitle: "Apple Jack (Jack Fire)",
  }),
  "on-par-tee": Object.freeze({
    canonicalTitle: "On Par Tee (Crown Royal)",
  }),
});
const CANONICAL_PRODUCT_DISPLAY_NAMES = Object.freeze({
  "whiskey smash": "Whiskey Smash (Jim Beam) 1",
  "on par tee": "On Par Tee (Crown Royal) 1",
});
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
const dashboardOverview = document.querySelector("#dashboard-overview");
const recipeGrid = document.querySelector("#recipe-grid");
const oldRecipeGrid = document.querySelector("#old-recipe-grid");
const currentRecipesView = document.querySelector("#current-recipes-view");
const oldRecipesView = document.querySelector("#old-recipes-view");
const recipeViewButtons = [...document.querySelectorAll("[data-recipe-view]")].filter((button) => (
  button.closest(".recipe-view-switcher")
));
const currentRecipeCount = document.querySelector("#current-recipe-count");
const oldRecipeCount = document.querySelector("#old-recipe-count");
const statsGrid = document.querySelector("#stats-grid");
const recipeCoverageAlert = document.querySelector("#recipe-coverage-alert");
const globalSearchTrigger = document.querySelector("#global-search-trigger");
const globalSearchDialog = document.querySelector("#global-search-dialog");
const globalSearchInput = document.querySelector("#global-search-input");
const globalSearchClose = document.querySelector("#global-search-close");
const globalSearchHint = document.querySelector("#global-search-hint");
const globalSearchResults = document.querySelector("#global-search-results");
const dashboardDataSearchForm = document.querySelector("#dashboard-data-search-form");
const dashboardDataSearchInput = document.querySelector("#dashboard-data-search-input");
const dashboardDataSearchFeedback = document.querySelector("#dashboard-data-search-feedback");
const dashboardDataSearchResults = document.querySelector("#dashboard-data-search-results");
const categoryFilter = document.querySelector("#category-filter");
const recipeSearch = document.querySelector("#recipe-search");
const oldSearch = document.querySelector("#old-search");
const pricingSearch = document.querySelector("#pricing-search");
const pricingTable = document.querySelector("#pricing-table");
const pricingSummary = document.querySelector("#pricing-summary");
const pricingAdvisorSummary = document.querySelector("#pricing-advisor-summary");
const pricingAdvisorTable = document.querySelector("#pricing-advisor-table");
const shotPricingSummary = document.querySelector("#shot-pricing-summary");
const shotPricingTable = document.querySelector("#shot-pricing-table");
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
const customInventorySubmitButton = document.querySelector("#custom-inventory-submit");
const customInventoryCancelButton = document.querySelector("#custom-inventory-cancel");
const inventoryTable = document.querySelector("#inventory-table");
const inventoryOrderTable = document.querySelector("#inventory-order-table");
const inventorySummary = document.querySelector("#inventory-summary");
const inventoryHistoryList = document.querySelector("#inventory-history-list");
const weeklyPlan = document.querySelector("#weekly-plan");
const kegSummary = document.querySelector("#keg-summary");
const kegWalls = document.querySelector("#keg-walls");
const weeklyUsageSearch = document.querySelector("#weekly-usage-search");
const weeklyUsageRangeInput = document.querySelector("#weekly-usage-range");
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
const beerUntappdResults = document.querySelector("#beer-untappd-results");
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
const liquorUntappdResults = document.querySelector("#liquor-untappd-results");
const pmbPublishQueueSummary = document.querySelector("#pmb-publish-queue-summary");
const pmbPublishQueueList = document.querySelector("#pmb-publish-queue-list");
const pmbQueueConnection = document.querySelector("#pmb-queue-connection");
const checkPmbQueueConnectionButton = document.querySelector("#check-pmb-queue-connection");
const addProductTypeButtons = [...document.querySelectorAll("[data-add-product-type]")];
const addProductForms = [...document.querySelectorAll("[data-add-product-form]")];
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
let weeklyUsageSyncMessage = "Open Weekly Usage on the work network to check Pour My Beer. After the service-computer import, saved reports remain available anywhere.";
let weeklyUsageLastSyncAt = loadWeeklyUsageLastSyncAt();
let weeklyUsageSyncAttempted = false;
let weeklyUsageHistoryLimit = window.matchMedia("(max-width: 720px)").matches ? 6 : 0;
let weeklyUsageSharedRevision = 0;
let weeklyUsageSharedInitialized = false;
let weeklyUsageSharedProvisioned = false;
let weeklyUsageSharedSaving = false;
let weeklyUsageSharedSaveError = "";
let weeklyUsageSharedMessage = "Loading shared Weekly Usage...";
let weeklyUsageApplyingSharedState = false;
let weeklyUsageSharedSaveTimer = null;
let weeklyUsageSharedPendingWrites = 0;
let weeklyUsageSharedWriteQueue = Promise.resolve();
let weeklyUsageSharedOutbox = loadWeeklyUsageSharedOutbox();
let weeklyUsageSharedOutboxDurable = true;
let kegPricingItems = [];
let priceOverrides = loadOverrides();
let kegPriceOverrides = loadKegPriceOverrides();
let chargeOverrides = loadChargeOverrides();
let customBeerKegs = loadCustomBeerKegs();
let customLiquorTaps = loadCustomLiquorTaps();
let pmbPublishQueue = loadPmbPublishQueue();
let comingSoonItems = mergeRequiredComingSoonItems(loadComingSoonItems(), pmbPublishQueue);
let tapReplacementOverrides = loadTapReplacementOverrides();
let customRecipes = loadCustomRecipes();
let inactiveRecipeIds = loadInactiveRecipeIds();
let editedRecipes = loadEditedRecipes();
let customInventoryItems = loadCustomInventoryItems();
let inventoryItemOrder = loadInventoryItemOrder();
let inventoryOnHandOverrides = loadInventoryOnHandOverrides();
let inventoryParOverrides = loadInventoryParOverrides();
let inventoryHistory = loadInventoryHistory();
let inventorySourceRows = [];
let inventorySharedUpdatedAt = "";
let inventorySharedMessage = "Loading shared inventory...";
let inventorySharedSaving = false;
let inventorySharedSaveError = "";
let inventorySharedInitialized = false;
let inventorySharedProvisioned = false;
let inventorySharedRevision = 0;
let dashboardSharedState = {
  version: 1,
  revision: 0,
  initialized: false,
  updatedAt: "",
  pricing: {
    ingredientPriceOverrides: {},
    kegPriceOverrides: {},
    chargeOverrides: {},
  },
  recipes: {
    customRecipes: [],
    inactiveRecipeIds: [],
    editedRecipes: {},
  },
  products: {
    customBeerKegs: [],
    customLiquorTaps: [],
    pmbPublishQueue: [],
    comingSoonItems: [],
    tapReplacementOverrides: {},
  },
  monitoring: {
    ohioComplianceAcknowledgement: {},
  },
};
let dashboardSharedSyncStatus = "loading";
let dashboardSharedSyncMessage = "Checking the shared dashboard configuration...";
let dashboardSharedProvisioned = false;
let dashboardBackupRunning = false;
let dashboardRestorePreview = null;
let dashboardRestoreMessage = "Restore files are checked locally first; nothing is overwritten automatically.";
let dashboardActivity = [];
let dashboardActivityMessage = "Loading shared change history...";
let dashboardSharedMutationGeneration = 0;
let dashboardSharedPatchScheduled = false;
let dashboardSharedPatchQueue = Promise.resolve();
let dashboardSharedOptimisticState = null;
let dashboardSharedWritesPaused = false;
let dashboardSharedWritePauseReason = "";
let dashboardSharedOutbox = loadDashboardSharedOutbox();
let dashboardSharedOutboxDurable = true;
let dashboardSharedLocalCacheDurable = true;
const dashboardSharedPendingSlices = new Set();
const inventoryFieldSyncTimers = new Map();
const inventoryFieldSyncFailures = new Map();
const inventoryQueuedFieldKeys = new Set();
const inventoryQueuedActionIds = new Set();
let inventoryFieldSyncPendingCount = 0;
let inventoryFieldSyncQueue = Promise.resolve();
let inventoryFieldOutbox = loadInventoryFieldOutbox();
let inventoryFieldOutboxDurable = true;
let inventoryActionOutbox = loadInventoryActionOutbox();
let inventoryActionOutboxDurable = true;
let inventoryOutboxClientOrder = Math.max(
  Date.now(),
  ...Object.values(inventoryFieldOutbox).map((entry) => Number(entry.clientOrder) || 0),
  ...inventoryActionOutbox.map((entry) => Number(entry.clientOrder) || 0),
);
let kegOnHandOverrides = loadKegOnHandOverrides();
let kegParOverrides = loadKegParOverrides();
let kegOnDeckOverrides = loadKegOnDeckOverrides();
let inventoryRowEditState = {};
let editingCustomInventoryId = "";
let draggedInventoryItemId = "";
const customInventoryPriceStatus = new Map();
let editingRecipeId = null;
let vendorSyncScope = "all";
let vendorSyncMessage = "Prices sync automatically.";
let vendorSyncRunning = false;
let pmbCurrentTapSnapshot = loadPmbCurrentTapSnapshot();
let kegLiveLevels = new Map();
let kegSyncMessage = "Refresh keg levels to pull current percentages from Pour My Beer.";
let kegSyncLoading = false;
let kegSyncAttempted = false;
let kegUpdatedAt = "";
let kegLiveLevelsStale = false;
let kegConfigUpdateRunning = false;
let kegDeviceLevels = new Map();
let kegTemplateAssignments = new Map();
let parAgentState = null;
let parAgentRunning = false;
let parAgentMessage = "Weekly par agent has not run yet.";
let parAgentError = "";
let parAgentInputsChangedAt = "";
let parAgentStateSyncTimer = null;
let parAgentStateSyncQueue = Promise.resolve();
let parAgentStateMutationVersion = 0;
let parAgentStateOutbox = loadKegLevelsOutbox();
let parAgentStateOutboxDurable = true;
let weeklyPlanUpdating = false;
let weeklyPlanRefreshMessage = "";
let weeklyPlanGroupMode = "vendor";
let weeklyOrderTracking = { available: false, generatedAt: "", drafts: [], vendors: [], itemCount: 0, receivedCount: 0, notReceivedCount: 0, notReceivedItems: [] };
let weeklyOrderTrackingMessage = "Loading shared order tracking...";
let weeklyOrderTrackingRefreshRunning = false;
let dashboardStaffPrepPlan = { available: false, generatedAt: "", items: [], completedCount: 0, totalCount: 0 };
let dashboardStaffPrepRefreshRunning = false;
let activeKegAdjustKey = "";
let pmbProductSaving = false;
let liquorProductSaving = false;
let activePmbQueuePublishId = "";
let pmbQueueConnectionState = "idle";
let pmbQueueConnectionMessage = "PMB connection not checked.";
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
let beerUntappdItems = [];
let liquorUntappdItems = [];
let beerUntappdSearchTimer = null;
let liquorUntappdSearchTimer = null;
let beerUntappdRequestId = 0;
let liquorUntappdRequestId = 0;
let selectedUntappdBeer = null;
let selectedUntappdLiquor = null;
let liveTapPrices = new Map();
let liveTapPriceItems = [];
let liveTapPricingMessage = "Open Tap Pricing on the work network to load current Pour My Beer prices.";
let liveTapPricingUpdatedAt = "";
let tapPricingSyncAttempted = false;
let tapPricingSyncLoading = false;
let shotPricingCapability = {
  writeAvailable: false,
  code: "PMB_PORTION_SCHEMA_UNVERIFIED",
  message: "Refresh PMB prices on the work network to check shot-pricing setup.",
};
let activePmbPortionPriceUpdateKey = "";
const pmbPortionPriceUpdateMessages = new Map();
let shotPricingRowsByKey = new Map();
let activePmbPriceUpdateKey = "";
const pmbPriceUpdateMessages = new Map();
let pricingAdvisorInputsByKey = new Map();
let beverageNewsPayload = null;
let beverageNewsLoading = false;
let ohioComplianceAcknowledgement = {};
let sellerRankingWall = "main";
let dashboardPulseRankingMetric = "oz";
// Kept for the detailed ranking renderer that remains available as a code-level
// fallback; the owner Dashboard now intentionally exposes only the wall choice.
let sellerRankingCategory = "all";
let sellerRankingMetric = "volume";
let sellerRankingPeriod = "six-weeks";
let sellerRankingListSize = 5;
let activeOperationsTab = "keg-levels";
let activeRecipeView = "current";
let activeAddProductType = "cocktail";
let globalSearchItems = [];
let visibleGlobalSearchResults = [];
let activeGlobalSearchResultIndex = -1;
let ownerLoginSyncStarted = false;

init();

async function init() {
  try {
    localStorage.setItem(OWNER_PROFILE_MARKER_STORAGE_KEY, "1");
  } catch {
    // The owner dashboard can still load when local storage is unavailable; its
    // existing save paths will surface their own fail-closed recovery notices.
  }
  await loadSharedDashboardState();

  if (isEmployeeDashboard) {
    const [csv, newCocktailsCsv] = await Promise.all([
      fetchCsv("/api/recipe-data?set=active"),
      fetchCsv("/api/recipe-data?set=new"),
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
  hydrateComingSoonRecipeItems();
  ingredients = buildIngredientCatalog(getActiveRecipes());
  inventorySourceRows = parseCsv(inventoryCsv);
  migrateInventoryOnHandOverrides(inventorySourceRows);
  inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
  await loadSharedInventoryState();
  inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
  kegWallItems = kegLevelsCsv ? parseKegLevels(parseCsv(kegLevelsCsv)) : [];
  kegPricingItems = buildKegPricingCatalog(kegWallItems, getCurrentKegPricingTapItems());
  weeklyUsageItems = weeklyUsageCsv ? parseWeeklyUsage(parseCsv(weeklyUsageCsv)) : [];
  if (weeklyUsageExtraCsv) {
    weeklyUsageItems = mergeWeeklyUsageExtraHistory(weeklyUsageItems, parseWeeklyUsageExtraHistory(parseCsv(weeklyUsageExtraCsv)));
  }
  weeklyUsageChangeovers = weeklyUsageChangeoversCsv ? parseWeeklyUsageChangeovers(parseCsv(weeklyUsageChangeoversCsv)) : [];
  applyWeeklyUsageProductChangeovers();
  await loadSharedWeeklyUsageState();
  await loadParAgentState();
  await loadWeeklyOrderTracking();
  await loadDashboardStaffPrepPlan();
  await loadDashboardActivity();
  renderDashboardSharedStateStatus();
  hydrateCategoryFilter(recipes);
  bindEvents();
  switchAddProductType(activeAddProductType);
  addIngredientRow();
  addIngredientRow();
  addIngredientRow();
  syncPmbProductDefaults();
  syncRecipeCreativeDefaults();
  syncRecipeBuilderSummary();
  clearBeerLookupResult();
  render();
  void hydrateComingSoonLiquorItemsFromUntappd();
  loadBeverageNews();
  void runOwnerLoginSync();
}

async function runOwnerLoginSync() {
  if (isEmployeeDashboard || ownerLoginSyncStarted) return;
  ownerLoginSyncStarted = true;
  const lockToken = acquireOwnerLoginSyncLock();
  try {
    const [kegOutcome, , usageOutcome] = await Promise.allSettled([
      runKegLevelSync(),
      runTapPricingSync(),
      lockToken
        ? runPmbWeeklyUsageSync({ automatic: true })
        : Promise.resolve({ ok: false, skipped: true }),
      lockToken
        ? runVendorSync({ automatic: true })
        : Promise.resolve({ ok: false, skipped: true }),
    ]);
    let kegResult = kegOutcome.status === "fulfilled" && kegOutcome.value;
    const usageResult = usageOutcome.status === "fulfilled" ? usageOutcome.value : null;
    if (!lockToken) {
      renderDashboardOverview();
      return;
    }
    if (!kegResult) kegResult = await runKegLevelSync();
    if (
      !kegResult
      || !usageResult?.ok
      || !parAgentState?.initialized
      || !weeklyUsageSharedInitialized
      || !inventorySharedInitialized
    ) return;

    const usageSaved = await flushPendingSharedWeeklyUsageSave();
    const inventorySaved = await flushPendingInventoryFieldSyncs();
    const parInputsSaved = await flushPendingParAgentStateSync();
    if (!usageSaved || !inventorySaved || !parInputsSaved) return;
    const mondaySnapshot = getCurrentMondayInventorySnapshot(inventoryHistory, new Date());
    const frozenKegPlan = mondaySnapshot?.kegPlanSnapshot;
    if (frozenKegPlan && !getCurrentWeeklyPlanSnapshot(parAgentState?.recommendations)) {
      await publishCurrentWeeklyPlanSnapshot();
    }
    renderDashboardOverview();
  } finally {
    if (lockToken) releaseOwnerLoginSyncLock(lockToken);
  }
}

function acquireOwnerLoginSyncLock() {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = JSON.parse(localStorage.getItem(OWNER_LOGIN_SYNC_LOCK_STORAGE_KEY) || "null");
    if (existing?.token && Date.now() - Number(existing.startedAt) < OWNER_LOGIN_SYNC_LOCK_MAX_AGE_MS) return "";
    localStorage.setItem(OWNER_LOGIN_SYNC_LOCK_STORAGE_KEY, JSON.stringify({ token, startedAt: Date.now() }));
    const saved = JSON.parse(localStorage.getItem(OWNER_LOGIN_SYNC_LOCK_STORAGE_KEY) || "null");
    return saved?.token === token ? token : "";
  } catch {
    return token;
  }
}

function releaseOwnerLoginSyncLock(token) {
  try {
    const existing = JSON.parse(localStorage.getItem(OWNER_LOGIN_SYNC_LOCK_STORAGE_KEY) || "null");
    if (existing?.token === token) localStorage.removeItem(OWNER_LOGIN_SYNC_LOCK_STORAGE_KEY);
  } catch {
    // The lock naturally expires even when browser storage is unavailable.
  }
}

function cloneDashboardStateValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainDashboardRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeDashboardSharedState(state = {}) {
  const data = isPlainDashboardRecord(state.data) ? state.data : state;
  const pricing = isPlainDashboardRecord(data.pricing) ? data.pricing : {};
  const recipeState = isPlainDashboardRecord(data.recipes) ? data.recipes : {};
  const products = isPlainDashboardRecord(data.products) ? data.products : {};
  const monitoring = isPlainDashboardRecord(data.monitoring) ? data.monitoring : {};

  return {
    version: Math.max(1, toNumber(state.version) || 1),
    id: clean(state.id),
    revision: Math.max(0, toNumber(state.revision)),
    initialized: state.initialized === true,
    initializedAt: clean(state.initializedAt),
    updatedAt: clean(state.updatedAt),
    updatedByRole: clean(state.updatedByRole),
    pricing: {
      ingredientPriceOverrides: isPlainDashboardRecord(pricing.ingredientPriceOverrides)
        ? cloneDashboardStateValue(pricing.ingredientPriceOverrides)
        : isPlainDashboardRecord(pricing.ingredientPrices)
          ? cloneDashboardStateValue(pricing.ingredientPrices)
          : {},
      kegPriceOverrides: isPlainDashboardRecord(pricing.kegPriceOverrides)
        ? cloneDashboardStateValue(pricing.kegPriceOverrides)
        : isPlainDashboardRecord(pricing.kegPrices)
          ? cloneDashboardStateValue(pricing.kegPrices)
          : {},
      chargeOverrides: isPlainDashboardRecord(pricing.chargeOverrides)
        ? cloneDashboardStateValue(pricing.chargeOverrides)
        : isPlainDashboardRecord(pricing.chargePrices)
          ? cloneDashboardStateValue(pricing.chargePrices)
          : {},
    },
    recipes: {
      customRecipes: Array.isArray(recipeState.customRecipes) ? cloneDashboardStateValue(recipeState.customRecipes) : [],
      inactiveRecipeIds: Array.isArray(recipeState.inactiveRecipeIds) ? cloneDashboardStateValue(recipeState.inactiveRecipeIds) : [],
      editedRecipes: isPlainDashboardRecord(recipeState.editedRecipes) ? cloneDashboardStateValue(recipeState.editedRecipes) : {},
    },
    products: {
      customBeerKegs: Array.isArray(products.customBeerKegs) ? cloneDashboardStateValue(products.customBeerKegs) : [],
      customLiquorTaps: Array.isArray(products.customLiquorTaps) ? cloneDashboardStateValue(products.customLiquorTaps) : [],
      pmbPublishQueue: normalizePmbPublishQueue(products.pmbPublishQueue),
      comingSoonItems: Array.isArray(products.comingSoonItems)
        ? cloneDashboardStateValue(products.comingSoonItems)
        : Array.isArray(products.comingSoon)
          ? cloneDashboardStateValue(products.comingSoon)
          : [],
      tapReplacementOverrides: isPlainDashboardRecord(products.tapReplacementOverrides)
        ? cloneDashboardStateValue(products.tapReplacementOverrides)
        : isPlainDashboardRecord(products.tapReplacements)
          ? cloneDashboardStateValue(products.tapReplacements)
          : {},
    },
    monitoring: {
      ohioComplianceAcknowledgement: isPlainDashboardRecord(monitoring.ohioComplianceAcknowledgement)
        ? cloneDashboardStateValue(monitoring.ohioComplianceAcknowledgement)
        : {},
    },
  };
}

function isSameDashboardRecord(left, right) {
  if (!isPlainDashboardRecord(left) || !isPlainDashboardRecord(right)) return false;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.every((key) => String(left[key] ?? "") === String(right[key] ?? ""));
}

function isConservativeBundledPriceDefault(
  id,
  override,
  defaults,
  { excludeAmbiguous = true } = {},
) {
  const defaultOverride = defaults[id];
  if (!defaultOverride || !isPlainDashboardRecord(override)) return false;
  if (
    id === "tito-s"
    && isRoughlyEqual(toNumber(override.bottleOz), 59.17)
    && Math.abs(toNumber(override.bottlePrice) - 25.85) < 0.001
    && ["", "1683D"].includes(clean(override.matchedSku))
  ) return true;
  if (isSameDashboardRecord(override, defaultOverride)) return true;

  const marker = clean(override.updatedAt);
  const bundledLabels = new Set([
    "default pricing",
    "default ohlq pricing",
    "default heidelberg provi pricing",
    "bonbright manual pricing 2026-07-24",
    "ohlq pricing 2026-07-25",
    "bonbright invoice 2026-07-08",
  ]);
  if (bundledLabels.has(marker.toLowerCase()) || /^default\b/i.test(marker)) return true;

  const hasPositiveProvenance = (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(marker)
    || Boolean(clean(override.matchedSku))
    || Boolean(clean(override.previousBottlePrice))
    || Boolean(clean(override.previousKegPrice))
    || Boolean(clean(override.previousUpdatedAt))
  );
  return excludeAmbiguous && !hasPositiveProvenance;
}

function filterBundledPriceDefaults(source, defaults, options = {}) {
  return Object.fromEntries(
    Object.entries(isPlainDashboardRecord(source) ? source : {}).filter(
      ([id, override]) => !isConservativeBundledPriceDefault(id, override, defaults, options),
    ),
  );
}

function getUserIngredientPriceOverrides(source = priceOverrides) {
  return filterBundledPriceDefaults(source, DEFAULT_PRICE_OVERRIDES);
}

function getUserKegPriceOverrides(source = kegPriceOverrides) {
  return filterBundledPriceDefaults(source, DEFAULT_KEG_PRICE_OVERRIDES);
}

function getLocalIngredientPriceOverrides(source = priceOverrides) {
  return filterBundledPriceDefaults(
    source,
    DEFAULT_PRICE_OVERRIDES,
    { excludeAmbiguous: false },
  );
}

function getLocalKegPriceOverrides(source = kegPriceOverrides) {
  return filterBundledPriceDefaults(
    source,
    DEFAULT_KEG_PRICE_OVERRIDES,
    { excludeAmbiguous: false },
  );
}

function getAmbiguousLegacyPriceOverrides(source, defaults) {
  return Object.fromEntries(
    Object.entries(isPlainDashboardRecord(source) ? source : {}).filter(([id, override]) => (
      isConservativeBundledPriceDefault(id, override, defaults)
      && !isConservativeBundledPriceDefault(
        id,
        override,
        defaults,
        { excludeAmbiguous: false },
      )
    )),
  );
}

function readDashboardLocalStorageValue(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    if (Array.isArray(fallback)) return Array.isArray(parsed) ? parsed : fallback;
    return isPlainDashboardRecord(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function getSharedDashboardImportSnapshot() {
  return {
    pricing: {
      ingredientPriceOverrides: filterBundledPriceDefaults(
        readDashboardLocalStorageValue(STORAGE_KEY, {}),
        DEFAULT_PRICE_OVERRIDES,
      ),
      kegPriceOverrides: filterBundledPriceDefaults(
        readDashboardLocalStorageValue(KEG_PRICE_STORAGE_KEY, {}),
        DEFAULT_KEG_PRICE_OVERRIDES,
      ),
      chargeOverrides: readDashboardLocalStorageValue(CHARGE_STORAGE_KEY, {}),
    },
    recipes: {
      customRecipes: readDashboardLocalStorageValue(CUSTOM_RECIPE_STORAGE_KEY, []),
      inactiveRecipeIds: readDashboardLocalStorageValue(INACTIVE_RECIPE_STORAGE_KEY, []),
      editedRecipes: readDashboardLocalStorageValue(EDITED_RECIPE_STORAGE_KEY, {}),
    },
    products: {
      customBeerKegs: readDashboardLocalStorageValue(CUSTOM_BEER_KEG_STORAGE_KEY, []),
      customLiquorTaps: readDashboardLocalStorageValue(CUSTOM_LIQUOR_TAP_STORAGE_KEY, []),
      pmbPublishQueue: normalizePmbPublishQueue(
        readDashboardLocalStorageValue(PMB_PUBLISH_QUEUE_STORAGE_KEY, []),
      ),
      comingSoonItems: readDashboardLocalStorageValue(COMING_SOON_STORAGE_KEY, []),
      tapReplacementOverrides: readDashboardLocalStorageValue(TAP_REPLACEMENT_STORAGE_KEY, {}),
    },
    monitoring: {
      ohioComplianceAcknowledgement: {},
    },
  };
}

function getSharedDashboardImportSummary(data = getSharedDashboardImportSnapshot()) {
  const rawIngredientPrices = readDashboardLocalStorageValue(STORAGE_KEY, {});
  const rawKegPrices = readDashboardLocalStorageValue(KEG_PRICE_STORAGE_KEY, {});
  const counts = {
    ingredientPrices: Object.keys(data.pricing.ingredientPriceOverrides).length,
    kegPrices: Object.keys(data.pricing.kegPriceOverrides).length,
    chargePrices: Object.keys(data.pricing.chargeOverrides).length,
    customRecipes: data.recipes.customRecipes.length,
    inactiveRecipes: data.recipes.inactiveRecipeIds.length,
    editedRecipes: Object.keys(data.recipes.editedRecipes).length,
    beerKegs: data.products.customBeerKegs.length,
    liquorTaps: data.products.customLiquorTaps.length,
    pmbQueue: data.products.pmbPublishQueue.length,
    comingSoon: data.products.comingSoonItems.length,
    tapReplacements: Object.keys(data.products.tapReplacementOverrides).length,
  };
  const excludedLegacyDefaults = (
    Object.keys(rawIngredientPrices).length
    - Object.keys(data.pricing.ingredientPriceOverrides).length
    + Object.keys(rawKegPrices).length
    - Object.keys(data.pricing.kegPriceOverrides).length
  );
  return {
    counts,
    total: Object.values(counts).reduce((total, count) => total + count, 0),
    excludedLegacyDefaults,
    text: [
      `Pricing: ${counts.ingredientPrices} ingredient, ${counts.kegPrices} keg, ${counts.chargePrices} charge override${counts.chargePrices === 1 ? "" : "s"}`,
      `Recipes: ${counts.customRecipes} custom, ${counts.editedRecipes} edited, ${counts.inactiveRecipes} inactive`,
      `Products: ${counts.beerKegs} beer, ${counts.liquorTaps} liquor, ${counts.pmbQueue} PMB queue, ${counts.comingSoon} coming soon, ${counts.tapReplacements} tap replacement${counts.tapReplacements === 1 ? "" : "s"}`,
      excludedLegacyDefaults > 0
        ? `Excluded from import: ${excludedLegacyDefaults} bundled or ambiguous legacy price default${excludedLegacyDefaults === 1 ? "" : "s"}`
        : "Excluded from import: no bundled legacy price defaults found",
    ].join("\n"),
  };
}

function getSharedDashboardPricingSnapshot() {
  return {
    ingredientPriceOverrides: cloneDashboardStateValue(getUserIngredientPriceOverrides()),
    kegPriceOverrides: cloneDashboardStateValue(getUserKegPriceOverrides()),
    chargeOverrides: cloneDashboardStateValue(chargeOverrides),
  };
}

function getSharedDashboardRecipeSnapshot() {
  return {
    customRecipes: cloneDashboardStateValue(customRecipes),
    inactiveRecipeIds: cloneDashboardStateValue(inactiveRecipeIds),
    editedRecipes: cloneDashboardStateValue(editedRecipes),
  };
}

function getSharedDashboardProductSnapshot() {
  return {
    customBeerKegs: cloneDashboardStateValue(customBeerKegs),
    customLiquorTaps: cloneDashboardStateValue(customLiquorTaps),
    pmbPublishQueue: cloneDashboardStateValue(pmbPublishQueue),
    comingSoonItems: cloneDashboardStateValue(comingSoonItems),
    tapReplacementOverrides: cloneDashboardStateValue(tapReplacementOverrides),
  };
}

function getSharedDashboardConfigSnapshot() {
  return {
    pricing: getSharedDashboardPricingSnapshot(),
    recipes: getSharedDashboardRecipeSnapshot(),
    products: getSharedDashboardProductSnapshot(),
    monitoring: {
      ohioComplianceAcknowledgement: cloneDashboardStateValue(ohioComplianceAcknowledgement),
    },
  };
}

function getSharedDashboardPatch(slices) {
  const snapshot = getSharedDashboardConfigSnapshot();
  const patch = {};
  slices.forEach((path) => {
    const [group, field] = path.split(".");
    if (!snapshot[group] || !Object.hasOwn(snapshot[group], field)) return;
    patch[group] ||= {};
    patch[group][field] = cloneDashboardStateValue(snapshot[group][field]);
  });
  return patch;
}

function getSharedDashboardStateField(state, path) {
  const [group, field] = path.split(".");
  return state?.[group]?.[field];
}

function areDashboardStateValuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areDashboardStateValuesEqual(value, right[index]));
  }
  if (isPlainDashboardRecord(left) || isPlainDashboardRecord(right)) {
    if (!isPlainDashboardRecord(left) || !isPlainDashboardRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => (
        key === rightKeys[index]
        && areDashboardStateValuesEqual(left[key], right[key])
      ));
  }
  return Object.is(left, right);
}

function isSharedDashboardArrayField(path) {
  return [
    "recipes.customRecipes",
    "recipes.inactiveRecipeIds",
    "products.customBeerKegs",
    "products.customLiquorTaps",
    "products.pmbPublishQueue",
    "products.comingSoonItems",
  ].includes(path);
}

function isValidSharedDashboardFieldValue(path, value) {
  return isSharedDashboardArrayField(path)
    ? Array.isArray(value)
    : isPlainDashboardRecord(value);
}

function loadDashboardSharedOutbox() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DASHBOARD_STATE_OUTBOX_STORAGE_KEY) || "{}");
    const entries = isPlainDashboardRecord(parsed.entries) ? parsed.entries : {};
    const validEntries = {};

    SHARED_DASHBOARD_FIELD_PATHS.forEach((path) => {
      const entry = entries[path];
      if (!isPlainDashboardRecord(entry)) return;
      if (!isValidSharedDashboardFieldValue(path, entry.desired)) return;
      if (!isValidSharedDashboardFieldValue(path, entry.base)) return;
      validEntries[path] = {
        desired: cloneDashboardStateValue(entry.desired),
        base: cloneDashboardStateValue(entry.base),
        baseRevision: Math.max(0, toNumber(entry.baseRevision)),
        requiresReview: entry.requiresReview === true,
        updatedAt: clean(entry.updatedAt),
      };
    });

    return { version: 1, entries: validEntries };
  } catch {
    return { version: 1, entries: {} };
  }
}

function saveDashboardSharedOutbox() {
  try {
    const paths = Object.keys(dashboardSharedOutbox.entries);
    if (!paths.length) {
      localStorage.removeItem(DASHBOARD_STATE_OUTBOX_STORAGE_KEY);
    } else {
      localStorage.setItem(DASHBOARD_STATE_OUTBOX_STORAGE_KEY, JSON.stringify(dashboardSharedOutbox));
    }
    dashboardSharedOutboxDurable = true;
    return true;
  } catch {
    dashboardSharedOutboxDurable = false;
    return false;
  }
}

function getDashboardSharedOutboxPaths() {
  return SHARED_DASHBOARD_FIELD_PATHS.filter((path) => dashboardSharedOutbox.entries[path]);
}

function hasDashboardSharedOutbox() {
  return getDashboardSharedOutboxPaths().length > 0;
}

function stageDashboardSharedOutbox(patch, touchedFields, { requiresReview = false } = {}) {
  touchedFields.forEach((path) => {
    const [group, field] = path.split(".");
    const desired = patch?.[group]?.[field];
    if (!isValidSharedDashboardFieldValue(path, desired)) return;

    const existing = dashboardSharedOutbox.entries[path];
    const canonicalBase = getSharedDashboardStateField(dashboardSharedState, path);
    const base = existing?.base ?? canonicalBase;
    if (isValidSharedDashboardFieldValue(path, base) && areDashboardStateValuesEqual(desired, base)) {
      delete dashboardSharedOutbox.entries[path];
      return;
    }
    dashboardSharedOutbox.entries[path] = {
      desired: cloneDashboardStateValue(desired),
      base: cloneDashboardStateValue(base),
      baseRevision: existing?.baseRevision ?? dashboardSharedState.revision,
      requiresReview: existing?.requiresReview === true || requiresReview,
      updatedAt: new Date().toISOString(),
    };
  });
  return saveDashboardSharedOutbox();
}

function getDashboardSharedOutboxPatch(paths = getDashboardSharedOutboxPaths()) {
  const patch = {};
  paths.forEach((path) => {
    const entry = dashboardSharedOutbox.entries[path];
    if (!entry) return;
    const [group, field] = path.split(".");
    patch[group] ||= {};
    patch[group][field] = cloneDashboardStateValue(entry.desired);
  });
  return patch;
}

function mergeDashboardSharedOutboxIntoState(rawState, paths = getDashboardSharedOutboxPaths()) {
  const patch = getDashboardSharedOutboxPatch(paths);
  return mergeSharedDashboardPatchIntoState(rawState, patch);
}

function clearCommittedDashboardSharedOutboxFields(paths, committedPatch, canonicalState) {
  let changed = false;
  paths.forEach((path) => {
    const entry = dashboardSharedOutbox.entries[path];
    if (!entry) return;
    const [group, field] = path.split(".");
    const committedValue = committedPatch?.[group]?.[field];
    if (!areDashboardStateValuesEqual(
      getSharedDashboardStateField(canonicalState, path),
      committedValue,
    )) return;

    if (areDashboardStateValuesEqual(entry.desired, committedValue)) {
      delete dashboardSharedOutbox.entries[path];
      changed = true;
      return;
    }

    entry.base = cloneDashboardStateValue(committedValue);
    entry.baseRevision = canonicalState.revision;
    changed = true;
  });
  if (changed) saveDashboardSharedOutbox();
}

function reconcileDashboardSharedOutboxWithCanonical(rawState) {
  const canonicalState = normalizeDashboardSharedState(rawState);
  const safePaths = [];
  const conflictPaths = [];
  let changed = false;

  getDashboardSharedOutboxPaths().forEach((path) => {
    const entry = dashboardSharedOutbox.entries[path];
    const canonicalValue = getSharedDashboardStateField(canonicalState, path);
    if (areDashboardStateValuesEqual(canonicalValue, entry.desired)) {
      delete dashboardSharedOutbox.entries[path];
      changed = true;
      return;
    }
    if (
      !entry.requiresReview
      && areDashboardStateValuesEqual(canonicalValue, entry.base)
    ) {
      safePaths.push(path);
      return;
    }
    conflictPaths.push(path);
  });

  if (changed) saveDashboardSharedOutbox();
  return { canonicalState, safePaths, conflictPaths };
}

function mergeSharedDashboardPatchIntoState(rawState, patch) {
  const next = normalizeDashboardSharedState(rawState);
  Object.entries(patch).forEach(([group, fields]) => {
    Object.entries(fields).forEach(([field, value]) => {
      next[group][field] = cloneDashboardStateValue(value);
    });
  });
  return next;
}

function getSharedDashboardBaseValues(state, paths) {
  return Object.fromEntries(
    paths.map((path) => [path, cloneDashboardStateValue(getSharedDashboardStateField(state, path))]),
  );
}

function hasSharedDashboardFieldConflict(state, baseValues, paths) {
  return paths.some((path) => !areDashboardStateValuesEqual(
    getSharedDashboardStateField(state, path),
    baseValues[path],
  ));
}

function loadEmployeeSharedRecipeCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMPLOYEE_SHARED_RECIPE_CACHE_STORAGE_KEY) || "{}");
    return {
      customRecipes: Array.isArray(parsed.customRecipes) ? parsed.customRecipes : [],
      inactiveRecipeIds: Array.isArray(parsed.inactiveRecipeIds) ? parsed.inactiveRecipeIds : [],
      editedRecipes: isPlainDashboardRecord(parsed.editedRecipes) ? parsed.editedRecipes : {},
    };
  } catch {
    return {
      customRecipes: [],
      inactiveRecipeIds: [],
      editedRecipes: {},
    };
  }
}

function applyEmployeeSharedRecipeCache() {
  const cache = loadEmployeeSharedRecipeCache();
  customRecipes = cloneDashboardStateValue(cache.customRecipes);
  inactiveRecipeIds = cloneDashboardStateValue(cache.inactiveRecipeIds);
  editedRecipes = cloneDashboardStateValue(cache.editedRecipes);
}

function saveEmployeeSharedRecipeCache() {
  dashboardSharedLocalCacheDurable = writeDashboardLocalStorageValue(
    EMPLOYEE_SHARED_RECIPE_CACHE_STORAGE_KEY,
    {
    customRecipes,
    inactiveRecipeIds,
    editedRecipes,
    },
  );
}

function writeDashboardLocalStorageValue(storageKey, value) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    dashboardSharedLocalCacheDurable = false;
    return false;
  }
}

function mirrorSharedDashboardState(state) {
  const entries = isEmployeeDashboard
    ? [[EMPLOYEE_SHARED_RECIPE_CACHE_STORAGE_KEY, state.recipes]]
    : [
      [STORAGE_KEY, state.pricing.ingredientPriceOverrides],
      [KEG_PRICE_STORAGE_KEY, state.pricing.kegPriceOverrides],
      [CHARGE_STORAGE_KEY, state.pricing.chargeOverrides],
      [CUSTOM_RECIPE_STORAGE_KEY, state.recipes.customRecipes],
      [INACTIVE_RECIPE_STORAGE_KEY, state.recipes.inactiveRecipeIds],
      [EDITED_RECIPE_STORAGE_KEY, state.recipes.editedRecipes],
      [CUSTOM_BEER_KEG_STORAGE_KEY, state.products.customBeerKegs],
      [CUSTOM_LIQUOR_TAP_STORAGE_KEY, state.products.customLiquorTaps],
      [PMB_PUBLISH_QUEUE_STORAGE_KEY, state.products.pmbPublishQueue],
      [COMING_SOON_STORAGE_KEY, state.products.comingSoonItems],
      [TAP_REPLACEMENT_STORAGE_KEY, state.products.tapReplacementOverrides],
    ];
  const results = entries.map(([storageKey, value]) => (
    writeDashboardLocalStorageValue(storageKey, value)
  ));
  dashboardSharedLocalCacheDurable = results.every(Boolean);
  return dashboardSharedLocalCacheDurable;
}

function applySharedDashboardState(rawState) {
  const state = normalizeDashboardSharedState(rawState);
  dashboardSharedState = state;
  if (!state.initialized) return state;

  const syncState = isEmployeeDashboard
    ? state
    : mergeDashboardSharedOutboxIntoState(state);

  if (isEmployeeDashboard) {
    customRecipes = cloneDashboardStateValue(syncState.recipes.customRecipes);
    inactiveRecipeIds = cloneDashboardStateValue(syncState.recipes.inactiveRecipeIds);
    editedRecipes = cloneDashboardStateValue(syncState.recipes.editedRecipes);
    mirrorSharedDashboardState(syncState);
    return state;
  }

  dashboardSharedOptimisticState = syncState;
  const effectiveState = cloneDashboardStateValue(syncState);
  effectiveState.pricing.ingredientPriceOverrides = {
    ...getAmbiguousLegacyPriceOverrides(
      readDashboardLocalStorageValue(STORAGE_KEY, {}),
      DEFAULT_PRICE_OVERRIDES,
    ),
    ...effectiveState.pricing.ingredientPriceOverrides,
  };
  effectiveState.pricing.kegPriceOverrides = {
    ...getAmbiguousLegacyPriceOverrides(
      readDashboardLocalStorageValue(KEG_PRICE_STORAGE_KEY, {}),
      DEFAULT_KEG_PRICE_OVERRIDES,
    ),
    ...filterBundledPriceDefaults(
      effectiveState.pricing.kegPriceOverrides,
      DEFAULT_KEG_PRICE_OVERRIDES,
      { excludeAmbiguous: false },
    ),
  };

  priceOverrides = normalizePreparedIngredientPriceOverrides({
    ...DEFAULT_PRICE_OVERRIDES,
    ...cloneDashboardStateValue(effectiveState.pricing.ingredientPriceOverrides),
  });
  kegPriceOverrides = normalizeKnownKegSizeOverrides({
    ...DEFAULT_KEG_PRICE_OVERRIDES,
    ...cloneDashboardStateValue(effectiveState.pricing.kegPriceOverrides),
  });
  chargeOverrides = cloneDashboardStateValue(effectiveState.pricing.chargeOverrides);
  customRecipes = cloneDashboardStateValue(effectiveState.recipes.customRecipes);
  inactiveRecipeIds = cloneDashboardStateValue(effectiveState.recipes.inactiveRecipeIds);
  editedRecipes = cloneDashboardStateValue(effectiveState.recipes.editedRecipes);
  customBeerKegs = cloneDashboardStateValue(effectiveState.products.customBeerKegs);
  customLiquorTaps = cloneDashboardStateValue(effectiveState.products.customLiquorTaps);
  pmbPublishQueue = normalizePmbPublishQueue(effectiveState.products.pmbPublishQueue);
  comingSoonItems = mergeRequiredComingSoonItems(
    cloneDashboardStateValue(effectiveState.products.comingSoonItems),
    pmbPublishQueue,
  );
  tapReplacementOverrides = cloneDashboardStateValue(effectiveState.products.tapReplacementOverrides);
  ohioComplianceAcknowledgement = cloneDashboardStateValue(
    effectiveState.monitoring?.ohioComplianceAcknowledgement || {},
  );
  mirrorSharedDashboardState(effectiveState);
  return state;
}

function ensureDashboardSharedStatePanel() {
  document.querySelector("#dashboard-shared-state")?.remove();
  return null;
}

function getServiceComputerReadiness() {
  const state = (name, provisioned, initialized) => ({
    name,
    status: initialized ? "ready" : provisioned ? "import" : "unavailable",
    label: initialized ? "Ready" : provisioned ? "Import at work" : "Unavailable",
  });
  return [
    state("Dashboard setup", dashboardSharedProvisioned, dashboardSharedState.initialized),
    state("Inventory", inventorySharedProvisioned, inventorySharedInitialized),
    state("Weekly Usage", weeklyUsageSharedProvisioned, weeklyUsageSharedInitialized),
    state("Keg Levels", Boolean(parAgentState), Boolean(parAgentState?.initialized)),
  ];
}

function renderServiceComputerReadiness() {
  if (isEmployeeDashboard) return "";
  const items = getServiceComputerReadiness();
  const importsNeeded = items.filter((item) => item.status === "import");
  const unavailable = items.filter((item) => item.status === "unavailable");
  const message = importsNeeded.length
    ? "When you are back at work, import in order: Dashboard setup, Inventory, Weekly Usage, then Keg Levels."
    : unavailable.length
      ? "Some shared areas could not be checked right now. Your saved home-browser data remains unchanged."
      : "All shared areas are ready. Live Pour My Beer reads and writes still require the work network.";
  return `
    <div class="service-computer-readiness">
      <p class="service-computer-readiness__title">Service-computer readiness</p>
      <div class="service-computer-readiness__items">
        ${items.map((item) => `<span class="service-computer-readiness__item service-computer-readiness__item--${item.status}">${escapeHtml(item.name)} · ${escapeHtml(item.label)}</span>`).join("")}
      </div>
      <p class="sync-status">${escapeHtml(message)}</p>
    </div>
  `;
}

function renderDashboardActivity() {
  if (isEmployeeDashboard) return "";
  const entries = dashboardActivity.slice(0, 12);
  return `
    <details class="dashboard-activity">
      <summary>Shared change history</summary>
      <p class="sync-status">${escapeHtml(dashboardActivityMessage)}</p>
      ${entries.length ? `
        <ul class="dashboard-activity__list">
          ${entries.map((entry) => `<li><strong>${escapeHtml(entry.area)}</strong> · ${escapeHtml(entry.summary || entry.action)}<span>${escapeHtml(formatUpdatedAt(entry.occurredAt))}</span></li>`).join("")}
        </ul>
      ` : ""}
    </details>
  `;
}

function renderDashboardSharedStateStatus() {
  const panel = ensureDashboardSharedStatePanel();
  if (!panel) return;

  const importSummary = isEmployeeDashboard
    ? { total: 0, text: "" }
    : getSharedDashboardImportSummary();
  const outboxPaths = isEmployeeDashboard ? [] : getDashboardSharedOutboxPaths();
  const labels = {
    loading: "Checking",
    setup: "Setup needed",
    importing: "Importing",
    saving: "Saving",
    saved: isEmployeeDashboard ? "Loaded" : "Saved",
    conflict: "Conflict",
    offline: "Offline",
  };
  const showImport = !isEmployeeDashboard
    && !dashboardSharedState.initialized
    && ["setup", "offline"].includes(dashboardSharedSyncStatus)
    && importSummary.total > 0;
  const showConflictRecovery = !isEmployeeDashboard
    && dashboardSharedState.initialized
    && dashboardSharedSyncStatus === "conflict"
    && outboxPaths.length > 0;
  const showOutboxRetry = !isEmployeeDashboard
    && dashboardSharedState.initialized
    && dashboardSharedSyncStatus === "offline"
    && outboxPaths.length > 0;
  const showBackup = !isEmployeeDashboard;
  panel.dataset.state = dashboardSharedSyncStatus;
  panel.innerHTML = `
    <div>
      <h2>Shared data · ${escapeHtml(labels[dashboardSharedSyncStatus] || "Status")}</h2>
      <p class="sync-status">${escapeHtml(dashboardSharedSyncMessage)}</p>
      ${renderServiceComputerReadiness()}
      ${renderDashboardActivity()}
      ${renderDashboardRestorePreview()}
      ${!isEmployeeDashboard && !dashboardSharedState.initialized ? `
        <p class="sync-status"><strong>Import source:</strong> saved data in this browser (not a live read from the offline service computer).</p>
        ${importSummary.text.split("\n").map((line) => `<p class="sync-status">${escapeHtml(line)}</p>`).join("")}
      ` : ""}
      ${outboxPaths.length ? `
        <p class="sync-status"><strong>${outboxPaths.length} local area${outboxPaths.length === 1 ? "" : "s"} awaiting shared sync.</strong></p>
      ` : ""}
      ${!dashboardSharedOutboxDurable ? `
        <p class="sync-status"><strong>Browser storage could not preserve the pending shared-data backup. Keep this page open and record the edit before reloading.</strong></p>
      ` : ""}
      ${!dashboardSharedLocalCacheDurable ? `
        <p class="sync-status"><strong>This browser could not refresh its normal offline cache.</strong> Shared data and the recovery queue remain separate; reconnect and reload before relying on this device offline.</p>
      ` : ""}
    </div>
    ${showImport || showConflictRecovery || showOutboxRetry || showBackup ? `
      <div class="sync-actions">
        ${showBackup ? `
          <button class="ghost-button" id="download-dashboard-backup" type="button"${dashboardBackupRunning ? " disabled" : ""}>
            ${dashboardBackupRunning ? "Creating backup..." : "Download backup"}
          </button>
          <label class="backup-restore-control" for="validate-dashboard-backup">
            <span>Validate backup</span>
            <input id="validate-dashboard-backup" type="file" accept="application/json,.json">
          </label>
        ` : ""}
        ${showImport ? `
          <button class="primary-button" id="initialize-dashboard-shared-state" type="button">
            Import this browser's saved setup
          </button>
        ` : ""}
        ${showOutboxRetry ? `
          <button class="primary-button" id="retry-dashboard-shared-state" type="button">
            Retry shared sync
          </button>
        ` : ""}
        ${showConflictRecovery ? `
          <button class="primary-button" id="publish-dashboard-local-state" type="button">
            Publish local version
          </button>
          <button class="ghost-button" id="discard-dashboard-local-state" type="button">
            Use shared version
          </button>
        ` : ""}
      </div>
    ` : ""}
  `;
  panel.querySelector("#initialize-dashboard-shared-state")
    ?.addEventListener("click", initializeSharedDashboardState);
  panel.querySelector("#retry-dashboard-shared-state")
    ?.addEventListener("click", retryDashboardSharedOutbox);
  panel.querySelector("#publish-dashboard-local-state")
    ?.addEventListener("click", forcePublishDashboardSharedOutbox);
  panel.querySelector("#discard-dashboard-local-state")
    ?.addEventListener("click", discardDashboardSharedOutbox);
  panel.querySelector("#download-dashboard-backup")
    ?.addEventListener("click", downloadDashboardBackup);
  panel.querySelector("#validate-dashboard-backup")
    ?.addEventListener("change", validateDashboardBackupFile);
}

function renderDashboardRestorePreview() {
  if (isEmployeeDashboard) return "";
  const preview = dashboardRestorePreview;
  return `
    <div class="dashboard-restore-preview">
      <p class="sync-status"><strong>Backup restore guard:</strong> ${escapeHtml(dashboardRestoreMessage)}</p>
      ${preview ? `<p class="sync-status">Valid file created ${escapeHtml(formatUpdatedAt(preview.createdAt))}. Includes: ${escapeHtml(preview.areas.join(", "))}. Current shared data has not been changed.</p>` : ""}
    </div>
  `;
}

async function validateDashboardBackupFile(event) {
  const file = event.currentTarget?.files?.[0];
  if (!file) return;
  dashboardRestorePreview = null;
  dashboardRestoreMessage = "Checking backup file locally...";
  renderDashboardSharedStateStatus();
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("Backup files must be 10 MB or smaller.");
    const backup = JSON.parse(await file.text());
    if (backup?.format !== "on-par-dashboard-backup" || Number(backup?.version) !== 1) {
      throw new Error("This is not a supported On Par dashboard backup.");
    }
    const areas = [
      backup.dashboard?.data ? "Dashboard setup" : "",
      backup.inventory?.data ? "Inventory" : "",
      backup.weeklyUsage?.data ? "Weekly Usage" : "",
      backup.kegLevels?.data ? "Keg Levels" : "",
    ].filter(Boolean);
    if (!areas.length) throw new Error("The backup does not contain any recognized shared dashboard areas.");
    dashboardRestorePreview = { createdAt: backup.createdAt || "", areas };
    dashboardRestoreMessage = "Backup is valid. Review the included areas above before asking to restore it; restore is intentionally not automatic.";
  } catch (error) {
    dashboardRestoreMessage = `Backup was not accepted: ${error.message || "invalid JSON file."}`;
  } finally {
    event.currentTarget.value = "";
    renderDashboardSharedStateStatus();
  }
}

function setDashboardSharedSyncStatus(status, message) {
  dashboardSharedSyncStatus = status;
  dashboardSharedSyncMessage = message;
  renderDashboardSharedStateStatus();
}

async function loadDashboardActivity() {
  if (isEmployeeDashboard) return;
  try {
    const response = await fetch("/api/dashboard-activity", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || !Array.isArray(result)) throw new Error(result?.error || "Shared change history is unavailable.");
    dashboardActivity = result;
    dashboardActivityMessage = result.length
      ? "Most recent shared changes. Activity begins after this update is installed."
      : "No shared changes have been recorded yet. Activity begins after this update is installed.";
  } catch (error) {
    dashboardActivity = [];
    dashboardActivityMessage = `Shared change history is unavailable: ${error.message || "could not load activity."}`;
  }
}

function getDashboardSharedUnavailableMessage(error, localChangeMessage) {
  const detail = clean(error?.message);
  if (/supabase.*not configured|not configured.*supabase|shared dashboard storage is not configured/i.test(detail)) {
    return `Shared database (Supabase) is not configured. ${localChangeMessage}`;
  }
  return `Shared sync is unavailable. ${localChangeMessage}`;
}

async function requestDashboardSharedState(method = "GET", body = null) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DASHBOARD_STATE_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("/api/dashboard-state", {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: body
        ? { Accept: "application/json", "Content-Type": "application/json" }
        : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const result = await parseJsonResponse(response);
    if (response.status === 409) {
      const conflictState = result.state || result.currentState;
      if (conflictState) {
        return {
          conflict: true,
          state: normalizeDashboardSharedState(conflictState),
        };
      }
      const canonical = await requestDashboardSharedState("GET");
      return {
        conflict: true,
        state: canonical.state,
      };
    }
    const responseState = result.state
      || (isPlainDashboardRecord(result.data) && Number.isSafeInteger(Number(result.revision)) ? result : null);
    if (!response.ok || result.ok === false || !responseState) {
      throw new Error(result.error || `Shared dashboard request failed (${response.status}).`);
    }
    return {
      conflict: false,
      state: normalizeDashboardSharedState(responseState),
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestSharedBackupSlice(path, label) {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const result = await parseJsonResponse(response);
  if (!response.ok) throw new Error(result?.error || `Could not include ${label} in the backup.`);
  return result;
}

function getBackupFilenameTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadDashboardBackup() {
  if (dashboardBackupRunning || isEmployeeDashboard) return;
  dashboardBackupRunning = true;
  renderDashboardSharedStateStatus();
  try {
    const [dashboard, inventory, weeklyUsage, kegLevels] = await Promise.all([
      requestDashboardSharedState("GET").then((result) => result.state),
      requestSharedBackupSlice("/api/inventory-state", "Inventory"),
      requestSharedBackupSlice("/api/weekly-usage-state", "Weekly Usage"),
      requestSharedBackupSlice("/api/keg-par-agent", "Keg Levels"),
    ]);
    downloadJsonFile(`on-par-dashboard-backup-${getBackupFilenameTimestamp()}.json`, {
      format: "on-par-dashboard-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      dashboard,
      inventory,
      weeklyUsage,
      kegLevels,
    });
    setDashboardSharedSyncStatus("saved", "Backup downloaded. Keep it somewhere private; it may contain pricing and operational data.");
  } catch (error) {
    setDashboardSharedSyncStatus("offline", `Backup was not created: ${error.message || "shared data could not be loaded."}`);
  } finally {
    dashboardBackupRunning = false;
    renderDashboardSharedStateStatus();
  }
}

function getDashboardSharedFieldLabel(path) {
  return {
    "pricing.ingredientPriceOverrides": "ingredient prices",
    "pricing.kegPriceOverrides": "keg prices",
    "pricing.chargeOverrides": "tap charges",
    "recipes.customRecipes": "custom recipes",
    "recipes.inactiveRecipeIds": "inactive recipes",
    "recipes.editedRecipes": "recipe edits",
    "products.customBeerKegs": "beer products",
    "products.customLiquorTaps": "liquor products",
    "products.pmbPublishQueue": "PMB publishing queue",
    "products.comingSoonItems": "coming-soon products",
    "products.tapReplacementOverrides": "tap replacements",
    "monitoring.ohioComplianceAcknowledgement": "Ohio compliance review status",
  }[path] || path;
}

function getDashboardSharedConflictMessage(paths = getDashboardSharedOutboxPaths()) {
  const labels = paths.map(getDashboardSharedFieldLabel);
  const storageWarning = dashboardSharedOutboxDurable
    ? "Local edits were kept for review"
    : "Local edits are available in this open page, but the browser could not preserve their recovery backup";
  return `${storageWarning} because shared data also changed in: ${labels.join(", ")}. Choose Publish local version to intentionally replace those shared areas, or Use shared version to discard the local edits.`;
}

async function recoverDashboardSharedOutbox(canonicalState) {
  let currentState = normalizeDashboardSharedState(canonicalState);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const reconciliation = reconcileDashboardSharedOutboxWithCanonical(currentState);
    currentState = reconciliation.canonicalState;
    applySharedDashboardState(currentState);

    if (!reconciliation.safePaths.length) {
      return {
        state: currentState,
        conflictPaths: reconciliation.conflictPaths,
      };
    }

    const patch = getDashboardSharedOutboxPatch(reconciliation.safePaths);
    const result = await requestDashboardSharedState("POST", {
      action: "patch",
      expectedRevision: currentState.revision,
      patch,
    });
    if (result.conflict) {
      currentState = result.state;
      continue;
    }

    currentState = result.state;
    clearCommittedDashboardSharedOutboxFields(
      reconciliation.safePaths,
      patch,
      currentState,
    );
  }

  const finalReconciliation = reconcileDashboardSharedOutboxWithCanonical(currentState);
  applySharedDashboardState(finalReconciliation.canonicalState);
  return {
    state: finalReconciliation.canonicalState,
    conflictPaths: [
      ...new Set([
        ...finalReconciliation.conflictPaths,
        ...finalReconciliation.safePaths,
      ]),
    ],
  };
}

async function retryDashboardSharedOutbox() {
  if (isEmployeeDashboard || !hasDashboardSharedOutbox()) return;
  setDashboardSharedSyncStatus("saving", "Checking whether the saved local edits can be synced safely...");

  try {
    const latest = await requestDashboardSharedState("GET");
    const recovered = await recoverDashboardSharedOutbox(latest.state);
    dashboardSharedWritesPaused = false;
    dashboardSharedWritePauseReason = "";
    const remainingPaths = getDashboardSharedOutboxPaths();
    if (remainingPaths.length) {
      setDashboardSharedSyncStatus(
        "conflict",
        getDashboardSharedConflictMessage(recovered.conflictPaths.length ? recovered.conflictPaths : remainingPaths),
      );
      render();
      return;
    }
    setDashboardSharedSyncStatus(
      "saved",
      `Saved pending local edits to the shared dashboard${recovered.state.updatedAt ? ` at ${formatUpdatedAt(recovered.state.updatedAt)}` : ""}.`,
    );
    render();
  } catch (error) {
    dashboardSharedWritesPaused = true;
    dashboardSharedWritePauseReason = "offline";
    setDashboardSharedSyncStatus(
      "offline",
      getDashboardSharedUnavailableMessage(
        error,
        "Pending edits remain safely stored in this browser and will be checked again before they are published.",
      ),
    );
  }
}

async function forcePublishDashboardSharedOutbox() {
  if (isEmployeeDashboard || !hasDashboardSharedOutbox()) return;
  const paths = getDashboardSharedOutboxPaths();
  if (!confirmDashboardAction(
    "Publish this browser's local version over the conflicting shared areas?",
    paths.map((path) => getDashboardSharedFieldLabel(path)),
    "This intentionally replaces those shared areas for every device.",
  )) return;

  const phrase = window.prompt(
    `Type PUBLISH LOCAL CHANGES to replace the listed shared areas with this browser's local version.`,
  );
  if (clean(phrase) !== "PUBLISH LOCAL CHANGES") {
    setDashboardSharedSyncStatus(
      "conflict",
      "Publish canceled. The local edits remain safely stored for review.",
    );
    return;
  }

  setDashboardSharedSyncStatus("saving", "Publishing the reviewed local version...");
  try {
    const latest = await requestDashboardSharedState("GET");
    const patch = getDashboardSharedOutboxPatch(paths);
    const result = await requestDashboardSharedState("POST", {
      action: "patch",
      expectedRevision: latest.state.revision,
      patch,
    });
    if (result.conflict) {
      applySharedDashboardState(result.state);
      setDashboardSharedSyncStatus(
        "conflict",
        "Shared data changed again while publishing. Local edits were kept; review the latest shared version and choose again.",
      );
      render();
      return;
    }

    clearCommittedDashboardSharedOutboxFields(paths, patch, result.state);
    applySharedDashboardState(result.state);
    dashboardSharedWritesPaused = false;
    dashboardSharedWritePauseReason = "";
    setDashboardSharedSyncStatus(
      hasDashboardSharedOutbox() ? "conflict" : "saved",
      hasDashboardSharedOutbox()
        ? "Some newer local edits are still waiting for review."
        : `Published the reviewed local version${result.state.updatedAt ? ` at ${formatUpdatedAt(result.state.updatedAt)}` : ""}.`,
    );
    render();
  } catch (error) {
    dashboardSharedWritesPaused = true;
    dashboardSharedWritePauseReason = "offline";
    setDashboardSharedSyncStatus(
      "offline",
      getDashboardSharedUnavailableMessage(
        error,
        "The reviewed local edits remain safely stored in this browser.",
      ),
    );
  }
}

async function discardDashboardSharedOutbox() {
  if (isEmployeeDashboard || !hasDashboardSharedOutbox()) return;
  const discardPaths = getDashboardSharedOutboxPaths();
  const discardSnapshot = Object.fromEntries(
    discardPaths.map((path) => [
      path,
      cloneDashboardStateValue(dashboardSharedOutbox.entries[path].desired),
    ]),
  );
  if (!confirmDashboardAction(
    "Discard this browser's unsynced local edits and use the shared version?",
    discardPaths.map((path) => getDashboardSharedFieldLabel(path)),
    "The listed local edits will be removed from this browser.",
  )) return;

  setDashboardSharedSyncStatus("saving", "Loading the shared version...");
  try {
    const latest = await requestDashboardSharedState("GET");
    discardPaths.forEach((path) => {
      if (areDashboardStateValuesEqual(
        dashboardSharedOutbox.entries[path]?.desired,
        discardSnapshot[path],
      )) {
        delete dashboardSharedOutbox.entries[path];
      }
    });
    saveDashboardSharedOutbox();
    applySharedDashboardState(latest.state);
    dashboardSharedWritesPaused = false;
    dashboardSharedWritePauseReason = "";
    setDashboardSharedSyncStatus(
      hasDashboardSharedOutbox() ? "conflict" : "saved",
      hasDashboardSharedOutbox()
        ? "The reviewed local edits were discarded, but newer local edits remain safely stored for review."
        : `Loaded the shared version${latest.state.updatedAt ? ` from ${formatUpdatedAt(latest.state.updatedAt)}` : ""}.`,
    );
    render();
  } catch (error) {
    setDashboardSharedSyncStatus(
      "offline",
      getDashboardSharedUnavailableMessage(
        error,
        "Local edits were not discarded because the shared version could not be loaded.",
      ),
    );
  }
}

async function loadSharedDashboardState() {
  renderDashboardSharedStateStatus();
  try {
    const result = await requestDashboardSharedState();
    dashboardSharedProvisioned = true;
    dashboardSharedState = result.state;
    if (!result.state.initialized) {
      if (isEmployeeDashboard) applyEmployeeSharedRecipeCache();
      const importSummary = isEmployeeDashboard
        ? { total: 0 }
        : getSharedDashboardImportSummary();
      setDashboardSharedSyncStatus(
        "setup",
        isEmployeeDashboard
          ? "Shared setup is waiting for a manager to import the complete service-computer configuration."
          : hasDashboardSharedOutbox()
            ? "Shared setup is not initialized. Local drafts are safely stored here for review; they will not auto-publish when another device initializes shared data."
            : importSummary.total
              ? "Shared setup is not initialized. Because the service computer is offline, wait and import from that computer unless this browser has the complete saved setup."
              : "Shared setup is not initialized. This authoritative browser has no saved non-default configuration; review setup to initialize the official bundled defaults.",
      );
      return;
    }

    if (!isEmployeeDashboard && hasDashboardSharedOutbox()) {
      const recovered = await recoverDashboardSharedOutbox(result.state);
      dashboardSharedWritesPaused = false;
      dashboardSharedWritePauseReason = "";
      const remainingPaths = getDashboardSharedOutboxPaths();
      if (remainingPaths.length) {
        setDashboardSharedSyncStatus(
          "conflict",
          getDashboardSharedConflictMessage(
            recovered.conflictPaths.length ? recovered.conflictPaths : remainingPaths,
          ),
        );
      } else {
        setDashboardSharedSyncStatus(
          "saved",
          `Recovered and saved this browser's pending edits${recovered.state.updatedAt ? ` at ${formatUpdatedAt(recovered.state.updatedAt)}` : ""}.`,
        );
      }
      return;
    }

    applySharedDashboardState(result.state);
    dashboardSharedWritesPaused = false;
    dashboardSharedWritePauseReason = "";
    setDashboardSharedSyncStatus(
      "saved",
      isEmployeeDashboard
        ? `Shared configuration loaded${result.state.updatedAt ? ` from ${formatUpdatedAt(result.state.updatedAt)}` : ""}.`
        : `Shared configuration is current${result.state.updatedAt ? ` as of ${formatUpdatedAt(result.state.updatedAt)}` : ""}.`,
    );
  } catch (error) {
    dashboardSharedProvisioned = false;
    if (isEmployeeDashboard) {
      applyEmployeeSharedRecipeCache();
      setDashboardSharedSyncStatus(
        "offline",
        getDashboardSharedUnavailableMessage(
          error,
          "Showing the last cached staff recipes on this device. Staff access is read-only; ask a manager to reconnect shared data for updates.",
        ),
      );
      return;
    }
    setDashboardSharedSyncStatus(
      "offline",
      getDashboardSharedUnavailableMessage(
        error,
        hasDashboardSharedOutbox()
          ? "Pending edits remain safely stored in this browser and will be checked against shared data before any retry."
          : "This browser can still be used. New shared edits will be stored locally and checked before they are published.",
      ),
    );
  }
}

async function initializeSharedDashboardState() {
  if (isEmployeeDashboard || dashboardSharedState.initialized) return;
  const importData = getSharedDashboardImportSnapshot();
  const importSummary = getSharedDashboardImportSummary(importData);
  const usesBundledDefaults = importSummary.total === 0;

  if (!confirmDashboardAction(
    usesBundledDefaults
      ? "Initialize the official shared dashboard setup with this release's bundled defaults?"
      : "Make this browser's saved dashboard setup the official shared version?",
    usesBundledDefaults
      ? [
          "Source: the bundled recipes, prices, products, and tap mappings in this release.",
          "This browser has no saved non-default overrides, so shared storage will start with the official bundled configuration.",
          "Future owner edits will then sync normally across devices.",
        ]
      : [
          "Source: saved local data in this browser (not a live read from the service computer).",
          importSummary.text,
          "Only continue if this browser already has the complete configuration.",
        ],
    "Only continue on the authoritative service computer after confirming the displayed setup is correct.",
  )) return;

  const phrase = window.prompt(
    `Type ${SHARED_DASHBOARD_IMPORT_PHRASE} to confirm that this browser contains the complete service-computer setup.`,
  );
  if (clean(phrase) !== SHARED_DASHBOARD_IMPORT_PHRASE) {
    setDashboardSharedSyncStatus(
      "setup",
      "Import canceled. Shared setup remains uninitialized and this browser's saved data was not published.",
    );
    return;
  }

  const importSnapshotStored = stageDashboardSharedOutbox(
    importData,
    SHARED_DASHBOARD_FIELD_PATHS,
    { requiresReview: true },
  );
  if (!importSnapshotStored) {
    setDashboardSharedSyncStatus(
      "offline",
      "Import paused because the browser could not preserve a recovery copy of this setup. Free browser storage, reload, and review the import again.",
    );
    return;
  }
  setDashboardSharedSyncStatus("importing", "Importing this browser's saved configuration...");
  try {
    const result = await requestDashboardSharedState("POST", {
      action: "initialize",
      expectedRevision: 0,
      data: importData,
    });
    if (result.conflict) {
      applySharedDashboardState(result.state);
      setDashboardSharedSyncStatus(
        "conflict",
        hasDashboardSharedOutbox()
          ? "Another device completed shared setup first. Local drafts were retained for review and were not allowed to overwrite its shared version."
          : "Another device completed shared setup first. Its shared configuration has been loaded here.",
      );
      render();
      return;
    }

    clearCommittedDashboardSharedOutboxFields(
      getDashboardSharedOutboxPaths(),
      importData,
      result.state,
    );
    applySharedDashboardState(result.state);
    dashboardSharedWritesPaused = false;
    dashboardSharedWritePauseReason = "";
    const remainingPaths = getDashboardSharedOutboxPaths();
    setDashboardSharedSyncStatus(
      remainingPaths.length ? "conflict" : "saved",
      remainingPaths.length
        ? "Shared setup was initialized, but newer local edits remain safely stored for review."
        : `Shared setup imported and saved${result.state.updatedAt ? ` at ${formatUpdatedAt(result.state.updatedAt)}` : ""}.`,
    );
    render();
  } catch (error) {
    setDashboardSharedSyncStatus(
      "offline",
      getDashboardSharedUnavailableMessage(
        error,
        "Nothing was imported; this browser's saved configuration is still local.",
      ),
    );
  }
}

function scheduleSharedDashboardStateSync(...slices) {
  if (isEmployeeDashboard) return;

  slices
    .filter((slice) => [
      "pricing.ingredientPriceOverrides",
      "pricing.kegPriceOverrides",
      "pricing.chargeOverrides",
      "recipes.customRecipes",
      "recipes.inactiveRecipeIds",
      "recipes.editedRecipes",
      "products.customBeerKegs",
      "products.customLiquorTaps",
      "products.pmbPublishQueue",
      "products.comingSoonItems",
      "products.tapReplacementOverrides",
      "monitoring.ohioComplianceAcknowledgement",
    ].includes(slice))
    .forEach((slice) => dashboardSharedPendingSlices.add(slice));
  if (dashboardSharedPatchScheduled) return;

  dashboardSharedPatchScheduled = true;
  queueMicrotask(() => {
    dashboardSharedPatchScheduled = false;
    const pendingSlices = [...dashboardSharedPendingSlices];
    dashboardSharedPendingSlices.clear();
    if (!pendingSlices.length) return;

    const patch = getSharedDashboardPatch(pendingSlices);
    if (!dashboardSharedState.initialized) {
      const draftStored = stageDashboardSharedOutbox(
        patch,
        pendingSlices,
        { requiresReview: true },
      );
      if (!draftStored) {
        setDashboardSharedSyncStatus(
          "offline",
          "This draft could not be backed up in browser storage. Keep this page open and record the change before reloading.",
        );
      } else if (!hasDashboardSharedOutbox()) {
        setDashboardSharedSyncStatus(
          "setup",
          "Shared setup is not initialized, and this browser has no unpublished local drafts.",
        );
      } else if (dashboardSharedSyncStatus !== "offline") {
        setDashboardSharedSyncStatus(
          "setup",
          "Shared setup is not initialized. This local draft is durably stored for review and will not auto-publish when shared setup is initialized elsewhere.",
        );
      } else {
        renderDashboardSharedStateStatus();
      }
      return;
    }

    enqueueSharedDashboardPatch(patch, pendingSlices);
  });
}

function enqueueSharedDashboardPatch(patch, touchedFields) {
  const generation = ++dashboardSharedMutationGeneration;
  const optimisticBase = dashboardSharedOptimisticState || dashboardSharedState;
  const baseValues = getSharedDashboardBaseValues(optimisticBase, touchedFields);
  const outboxStored = stageDashboardSharedOutbox(patch, touchedFields);
  dashboardSharedOptimisticState = mergeSharedDashboardPatchIntoState(optimisticBase, patch);
  const requiresReview = touchedFields.some(
    (path) => dashboardSharedOutbox.entries[path]?.requiresReview,
  );
  if (requiresReview) {
    setDashboardSharedSyncStatus(
      outboxStored ? "conflict" : "offline",
      outboxStored
        ? "This area contains a local draft created before shared setup was initialized. Review it and choose whether to publish the local or shared version."
        : "This draft needs review, but the browser could not preserve its recovery backup. Keep this page open and record the change before reloading.",
    );
    return;
  }
  setDashboardSharedSyncStatus("saving", "Saving this change to the shared dashboard...");
  dashboardSharedPatchQueue = dashboardSharedPatchQueue
    .then(() => persistSharedDashboardPatch(patch, touchedFields, baseValues, generation))
    .catch(() => {});
}

async function persistSharedDashboardPatch(patch, touchedFields, baseValues, generation) {
  let conflictFound = false;

  try {
    if (dashboardSharedWritesPaused) {
      if (generation === dashboardSharedMutationGeneration) {
        setDashboardSharedSyncStatus(
          dashboardSharedWritePauseReason === "conflict" ? "conflict" : "offline",
          dashboardSharedWritePauseReason === "conflict"
            ? dashboardSharedOutboxDurable
              ? "Another manager changed this same area while you were editing. Your local edits remain safely stored for explicit review."
              : "Another manager changed this same area, and the browser could not preserve the local recovery backup. Keep this page open and record the edit before reloading."
            : dashboardSharedOutboxDurable
              ? "Shared sync is paused after a connection error. Pending edits are safely stored in this browser; use Retry shared sync when the connection returns."
              : "Shared sync is paused and the browser could not preserve the pending backup. Keep this page open and record the edit before reloading.",
        );
      }
      return;
    }

    if (hasSharedDashboardFieldConflict(dashboardSharedState, baseValues, touchedFields)) {
      if (generation === dashboardSharedMutationGeneration) {
        applySharedDashboardState(dashboardSharedState);
        setDashboardSharedSyncStatus(
          "conflict",
          getDashboardSharedConflictMessage(touchedFields),
        );
        render();
      } else {
        dashboardSharedWritesPaused = true;
        dashboardSharedWritePauseReason = "conflict";
      }
      return;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await requestDashboardSharedState("POST", {
        action: "patch",
        expectedRevision: dashboardSharedState.revision,
        patch,
      });

      if (result.conflict) {
        conflictFound = true;
        dashboardSharedState = result.state;
        if (!result.state.initialized) {
          if (generation === dashboardSharedMutationGeneration) {
            setDashboardSharedSyncStatus(
              "conflict",
              "Shared setup changed while saving. Your change remains only on this browser.",
            );
          } else {
            dashboardSharedWritesPaused = true;
            dashboardSharedWritePauseReason = "conflict";
          }
          return;
        }
        if (hasSharedDashboardFieldConflict(result.state, baseValues, touchedFields)) {
          if (generation === dashboardSharedMutationGeneration) {
            applySharedDashboardState(result.state);
            setDashboardSharedSyncStatus(
              "conflict",
              getDashboardSharedConflictMessage(touchedFields),
            );
            render();
          } else {
            dashboardSharedWritesPaused = true;
            dashboardSharedWritePauseReason = "conflict";
          }
          return;
        }
        continue;
      }

      dashboardSharedState = result.state;
      clearCommittedDashboardSharedOutboxFields(
        touchedFields,
        patch,
        result.state,
      );
      if (generation === dashboardSharedMutationGeneration) {
        applySharedDashboardState(result.state);
        const remainingPaths = getDashboardSharedOutboxPaths();
        setDashboardSharedSyncStatus(
          remainingPaths.length ? "conflict" : "saved",
          remainingPaths.length
            ? getDashboardSharedConflictMessage(remainingPaths)
            : conflictFound
              ? "A newer change was found elsewhere. Your change was safely reapplied to that version and saved."
              : `Saved to the shared dashboard${result.state.updatedAt ? ` at ${formatUpdatedAt(result.state.updatedAt)}` : ""}.`,
        );
        render();
      }
      return;
    }

    if (generation === dashboardSharedMutationGeneration) {
      applySharedDashboardState(dashboardSharedState);
      setDashboardSharedSyncStatus(
        "conflict",
        `The shared dashboard changed repeatedly. ${getDashboardSharedConflictMessage(touchedFields)}`,
      );
      render();
    } else {
      dashboardSharedWritesPaused = true;
      dashboardSharedWritePauseReason = "conflict";
    }
  } catch (error) {
    dashboardSharedWritesPaused = true;
    dashboardSharedWritePauseReason = "offline";
    if (generation === dashboardSharedMutationGeneration) {
      setDashboardSharedSyncStatus(
        "offline",
        getDashboardSharedUnavailableMessage(
          error,
          dashboardSharedOutboxDurable
            ? "Your change was not published to other devices, but it remains safely stored in this browser for a later retry."
            : "Your change was not published, and the browser could not preserve its pending backup. Keep this page open and record the edit before reloading.",
        ),
      );
    }
  }
}

function bindEvents() {
  bindGlobalSearchEvents();
  bindDashboardDataSearchEvents();
  document.querySelectorAll(".tab-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.recipeView) switchRecipeView(button.dataset.recipeView);
      switchTab(button.dataset.tab);
    });
  });
  document.querySelectorAll(".dashboard-menu-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.recipeView) switchRecipeView(button.dataset.recipeView);
      switchTab(button.dataset.menuTab);
      button.closest("details")?.removeAttribute("open");
    });
  });
  document.querySelector("#onpar-insights")?.addEventListener("change", (event) => {
    const category = event.target.closest("[data-seller-ranking-category]");
    const wall = event.target.closest("[data-seller-ranking-wall]");
    const listSize = event.target.closest("[data-seller-ranking-list-size]");
    const period = event.target.closest("[data-seller-ranking-period]");
    const metric = event.target.closest("[data-seller-ranking-metric]");
    if (category) sellerRankingCategory = clean(category.value).toLowerCase() || "all";
    if (wall) sellerRankingWall = clean(wall.value).toLowerCase() || "main";
    if (listSize) sellerRankingListSize = Math.max(3, Math.min(25, Math.floor(toNumber(listSize.value) || 5)));
    if (period) sellerRankingPeriod = clean(period.value).toLowerCase() || "six-weeks";
    if (metric) {
      const selectedMetric = clean(metric.value).toLowerCase();
      sellerRankingMetric = ["sales", "profit"].includes(selectedMetric) ? selectedMetric : "volume";
    }
    renderOnParInsights();
  });
  recipeViewButtons.forEach((button) => {
    button.addEventListener("click", () => switchRecipeView(button.dataset.recipeView));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = recipeViewButtons.indexOf(button);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? recipeViewButtons.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + recipeViewButtons.length)
            % recipeViewButtons.length;
      switchRecipeView(recipeViewButtons[nextIndex]?.dataset.recipeView, { focus: true });
    });
  });
  dashboardOverview?.addEventListener("click", (event) => {
    const complianceReview = event.target.closest("[data-ohio-compliance-reviewed]");
    if (complianceReview) {
      acknowledgeOhioComplianceWatch();
      return;
    }
    const target = event.target.closest("[data-dashboard-target]");
    if (!target) return;
    if (target.dataset.dashboardTarget === DASHBOARD_OVERVIEW_TARGETS.sharedDashboardSetup) {
      initializeSharedDashboardState();
      return;
    }
    if (target.dataset.dashboardTarget === "recipes") switchRecipeView("current");
    switchTab(target.dataset.dashboardTarget);
  });
  dashboardOverview?.addEventListener("change", (event) => {
    const metricControl = event.target.closest("[data-dashboard-pulse-metric]");
    if (metricControl) {
      dashboardPulseRankingMetric = clean(metricControl.value).toLowerCase() === "sales" ? "sales" : "oz";
      renderDashboardOverview();
      return;
    }
    const wallFilterControl = event.target.closest("[data-seller-ranking-wall]");
    if (!wallFilterControl) return;
    sellerRankingWall = clean(wallFilterControl.value).toLowerCase() || "main";
    renderDashboardOverview();
  });
  document.querySelectorAll(".operation-tab").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.operationTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...button.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') || []];
      if (!tabs.length) return;
      event.preventDefault();
      const currentIndex = tabs.indexOf(button);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      switchTab(nextTab.dataset.operationTab);
      nextTab.focus();
    });
  });
  addProductTypeButtons.forEach((button) => {
    button.addEventListener("click", () => switchAddProductType(button.dataset.addProductType));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = addProductTypeButtons.indexOf(button);
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? addProductTypeButtons.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + addProductTypeButtons.length)
            % addProductTypeButtons.length;
      switchAddProductType(addProductTypeButtons[nextIndex]?.dataset.addProductType, { focus: true });
    });
  });

  recipeSearch.addEventListener("input", renderRecipes);
  categoryFilter.addEventListener("change", renderRecipes);
  recipeCoverageAlert?.addEventListener("click", handleRecipeCoverageAction);

  if (isEmployeeDashboard) return;

  oldSearch.addEventListener("input", renderOldRecipes);
  pricingSearch.addEventListener("input", renderPricing);
  ingredientSearch.addEventListener("input", renderIngredients);
  inventorySearch.addEventListener("input", renderInventory);
  customInventoryForm?.addEventListener("submit", addCustomInventoryItem);
  customInventoryCancelButton?.addEventListener("click", resetCustomInventoryForm);
  weeklyUsageSearch?.addEventListener("input", renderWeeklyUsage);
  weeklyUsageRangeInput?.addEventListener("change", () => {
    weeklyUsageHistoryLimit = Math.max(0, toNumber(weeklyUsageRangeInput.value));
    renderWeeklyUsage();
  });
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
    if (selectedUntappdBeer && clean(pmbProductNameInput.value) !== clean(selectedUntappdBeer.name)) {
      selectedUntappdBeer = null;
    }
    syncPmbProductDefaults();
    scheduleUntappdProductSearch("beer");
  });
  pmbProductKegCostInput?.addEventListener("input", () => syncPmbProductDefaults());
  pmbProductMarginInput?.addEventListener("input", () => syncPmbProductDefaults());
  pmbProductKegOzInput?.addEventListener("change", () => syncPmbProductDefaults());
  liquorProductForm?.addEventListener("submit", addLiquorProduct);
  liquorProductNameInput?.addEventListener("input", () => {
    if (selectedUntappdLiquor && clean(liquorProductNameInput.value) !== clean(selectedUntappdLiquor.name)) {
      selectedUntappdLiquor = null;
    }
    scheduleUntappdProductSearch("liquor");
  });
  checkPmbQueueConnectionButton?.addEventListener("click", () => {
    checkPmbQueueConnection();
  });
  pmbPublishQueueList?.addEventListener("click", handlePmbPublishQueueAction);
  beerUntappdResults?.addEventListener("click", (event) => selectUntappdSearchResult(event, "beer"));
  liquorUntappdResults?.addEventListener("click", (event) => selectUntappdSearchResult(event, "liquor"));
  shufflePmbProductImageButton?.addEventListener("click", () => {
    shuffleBeerLookupImage();
  });
  shufflePmbProductDescriptionButton?.addEventListener("click", () => {
    shuffleBeerLookupDescription();
  });
  clearPricesButton.addEventListener("click", () => {
    if (!confirmDashboardAction(
      "Clear every bottle-cost override?",
      [`${Object.keys(priceOverrides).length} saved price entries will be reset to dashboard defaults.`],
      "This cannot be undone from the dashboard.",
    )) return;
    priceOverrides = {};
    saveOverrides();
    render();
  });
  clearKegPricesButton?.addEventListener("click", () => {
    if (!confirmDashboardAction(
      "Clear every keg-cost override?",
      [`${Object.keys(kegPriceOverrides).length} saved keg price entries will be reset.`],
      "This cannot be undone from the dashboard.",
    )) return;
    kegPriceOverrides = {};
    saveKegPriceOverrides();
    render();
  });
  clearChargesButton.addEventListener("click", () => {
    if (!confirmDashboardAction(
      "Clear every tap-charge override?",
      [`${Object.keys(chargeOverrides).length} saved charge entries will be reset.`],
      "This cannot be undone from the dashboard.",
    )) return;
    chargeOverrides = {};
    saveChargeOverrides();
    render();
  });

  document.addEventListener("keydown", handleEnterKeyNavigation);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideUntappdSearchResults();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".untappd-search-field")) hideUntappdSearchResults();
  });
  window.addEventListener("focus", () => {
    void refreshWeeklyOrderTracking();
    void refreshDashboardStaffPrepPlan();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    void refreshWeeklyOrderTracking();
    void refreshDashboardStaffPrepPlan();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void refreshDashboardStaffPrepPlan();
  }, 30_000);
}

function switchAddProductType(productType, { focus = false } = {}) {
  const nextType = ["cocktail", "beer", "liquor"].includes(productType) ? productType : "cocktail";
  activeAddProductType = nextType;

  addProductTypeButtons.forEach((button) => {
    const isActive = button.dataset.addProductType === nextType;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && focus) button.focus();
  });

  addProductForms.forEach((form) => {
    form.hidden = form.dataset.addProductForm !== nextType;
  });
}

function switchRecipeView(viewName, { focus = false } = {}) {
  const nextView = viewName === "old" ? "old" : "current";
  activeRecipeView = nextView;

  recipeViewButtons.forEach((button) => {
    const isActive = button.dataset.recipeView === nextView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
    if (isActive && focus) button.focus();
  });

  if (currentRecipesView) currentRecipesView.hidden = nextView !== "current";
  if (oldRecipesView) oldRecipesView.hidden = nextView !== "old";
}

function confirmDashboardAction(title, details = [], warning = "") {
  const message = [
    title,
    "",
    ...details.filter(Boolean),
    warning ? `\n${warning}` : "",
  ].join("\n");
  return window.confirm(message);
}

function switchTab(tabName) {
  const requestedTab = tabName === "operations" ? activeOperationsTab : tabName;
  const isOperationTab = OPERATION_TAB_NAMES.includes(requestedTab);
  const isMenuTab = MENU_TAB_NAMES.includes(requestedTab);
  if (isOperationTab) {
    activeOperationsTab = requestedTab;
  }

  document.querySelectorAll(".tab-button").forEach((button) => {
    const isActive = isOperationTab ? button.dataset.tab === "operations" : button.dataset.tab === requestedTab;
    button.classList.toggle("is-active", isActive);
  });

  document.querySelector(".dashboard-menu-trigger")?.classList.toggle("is-active", isMenuTab);
  document.querySelectorAll(".dashboard-menu-item").forEach((button) => {
    const isActive = button.dataset.menuTab === requestedTab;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  document.querySelectorAll(".panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `${requestedTab}-panel`);
  });

  document.querySelectorAll(".operation-tab").forEach((button) => {
    const isActive = button.dataset.operationTab === activeOperationsTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  if (!isEmployeeDashboard && ["weekly-usage", "performance"].includes(requestedTab) && !weeklyUsageSyncAttempted) {
    runPmbWeeklyUsageSync({ automatic: true });
  }
  if (!isEmployeeDashboard && ["weekly-plan", "keg-levels", "ingredients", "inventory"].includes(requestedTab) && !kegSyncAttempted) {
    runKegLevelSync();
  }
  if (!isEmployeeDashboard && ["keg-levels", "pricing", "ingredients"].includes(requestedTab) && !tapPricingSyncAttempted) {
    runTapPricingSync();
  }
}

function render() {
  ingredients = buildIngredientCatalog(getActiveRecipes());
  kegPricingItems = buildKegPricingCatalog(kegWallItems, getCurrentKegPricingTapItems());
  syncInventoryItemCatalogLinks();
  renderStats();
  renderRecipes();
  renderPricing();
  renderIngredients();
  renderInventory();
  renderKegLevels();
  renderWeeklyUsage();
  renderOldRecipes();
  renderPmbPublishQueue();
  renderDashboardOverview();
  renderDashboardDataSearch();
  renderOnParInsights();
  refreshGlobalSearchIndex();
}

function renderEmployeeDashboard() {
  ingredients = buildIngredientCatalog(getActiveRecipes());
  renderStats();
  renderRecipes();
}

function bindGlobalSearchEvents() {
  if (!globalSearchTrigger || !globalSearchDialog || !globalSearchInput || !globalSearchResults) return;

  globalSearchTrigger.addEventListener("click", openGlobalSearch);
  globalSearchClose?.addEventListener("click", () => {
    closeGlobalSearch();
    globalSearchTrigger?.focus();
  });
  globalSearchInput.addEventListener("input", renderGlobalSearchResults);
  globalSearchInput.addEventListener("keydown", handleGlobalSearchKeydown);
  globalSearchResults.addEventListener("click", (event) => {
    const resultButton = event.target.closest("[data-global-search-result]");
    if (!resultButton) return;
    activateGlobalSearchResult(visibleGlobalSearchResults[toNumber(resultButton.dataset.globalSearchResult)]);
  });
  globalSearchDialog.addEventListener("click", (event) => {
    if (event.target === globalSearchDialog) {
      closeGlobalSearch();
      globalSearchTrigger?.focus();
    }
  });
  globalSearchDialog.addEventListener("close", () => {
    globalSearchInput.value = "";
    activeGlobalSearchResultIndex = -1;
    if (document.activeElement === document.body) globalSearchTrigger?.focus();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (globalSearchDialog.open) {
        closeGlobalSearch();
        globalSearchTrigger?.focus();
      } else {
        openGlobalSearch();
      }
    }
  });
}

function bindDashboardDataSearchEvents() {
  dashboardDataSearchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    renderDashboardDataSearch({ submitted: true });
  });
  dashboardDataSearchResults?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-dashboard-data-search-name]");
    if (!link || !weeklyUsageSearch) return;
    weeklyUsageSearch.value = link.dataset.dashboardDataSearchName || "";
    renderWeeklyUsage();
    switchTab("weekly-usage");
  });
}

function getDashboardDataSearchEntryOunces(item, entry) {
  const exactOunces = getWeeklyUsageEntryPouredOz(item, entry, getWeeklyUsageFullOunces);
  if (exactOunces !== null) return exactOunces;
  const value = Number(entry?.value);
  if (!Number.isFinite(value) || value < 0) return null;
  if (clean(item?.displayUnit).toLowerCase() === "oz") return value;
  const fullOunces = getWeeklyUsageFullOunces(item);
  return fullOunces > 0 ? value * fullOunces : null;
}

function getDashboardDataSearchPeriod(item, label, entries, sellingPricePerOz) {
  const ounceValues = entries
    .map((entry) => getDashboardDataSearchEntryOunces(item, entry))
    .filter((value) => value !== null);
  if (!ounceValues.length) return null;
  const ounces = ounceValues.reduce((total, value) => total + value, 0) / ounceValues.length;
  return {
    label,
    ounces,
    dollars: ounces === 0 ? 0 : sellingPricePerOz > 0 ? ounces * sellingPricePerOz : null,
  };
}

function buildDashboardDataSearchItems() {
  const sourceItems = [...weeklyUsageItems, ...weeklyUsageArchivedItems];
  const recentLabels = getWeeklyUsageHistoryHeaders(sourceItems).slice(0, 6);
  const latestLabel = recentLabels[0] || "";

  return sourceItems.map((item, index) => {
    const history = Array.isArray(item.history) ? item.history : [];
    const entriesByLabel = new Map(history.map((entry) => [entry.label, entry]));
    const recentEntries = recentLabels.map((label) => entriesByLabel.get(label)).filter(Boolean);
    const latestEntry = latestLabel ? entriesByLabel.get(latestLabel) : null;
    const sellingPricePerOz = toNumber(getWeeklyUsageItemSellingRate(item).sellingPricePerOz);
    const currentOunces = Object.prototype.hasOwnProperty.call(item, "rawOz")
      && Number.isFinite(Number(item.rawOz))
      ? Number(item.rawOz)
      : null;
    const thisWeek = currentOunces === null ? null : {
      label: "This week",
      ounces: currentOunces,
      dollars: currentOunces === 0 ? 0 : sellingPricePerOz > 0 ? currentOunces * sellingPricePerOz : null,
    };

    return {
      id: item.archiveId || item.id || `usage-search-${index}`,
      name: clean(item.name) || "Unnamed product",
      tapNumber: toNumber(item.tapNumber) || null,
      wall: getDashboardPulseWall(item) || clean(item.wall).toLowerCase(),
      category: getWeeklyUsagePerformanceCategory(item),
      hidden: item.hidden === true || weeklyUsageArchivedItems.includes(item),
      periods: {
        "this-week": thisWeek,
        "last-week": latestEntry
          ? getDashboardDataSearchPeriod(item, latestLabel, [latestEntry], sellingPricePerOz)
          : null,
        recent: getDashboardDataSearchPeriod(
          item,
          recentLabels.length ? `Recent ${recentLabels.length}-week average` : "Recent history",
          recentEntries,
          sellingPricePerOz,
        ),
      },
    };
  });
}

function renderDashboardDataSearch({ submitted = false } = {}) {
  if (!dashboardDataSearchInput || !dashboardDataSearchResults || !dashboardDataSearchFeedback) return;
  const query = clean(dashboardDataSearchInput.value);
  if (!query) {
    dashboardDataSearchFeedback.textContent = submitted ? "Enter a question to search dashboard data." : "";
    dashboardDataSearchResults.innerHTML = "";
    return;
  }

  const search = searchDashboardData(buildDashboardDataSearchItems(), query);
  if (search.status === "needs-clarification") {
    dashboardDataSearchFeedback.textContent = "One quick question";
    dashboardDataSearchResults.innerHTML = `<div class="dashboard-data-search-question">${escapeHtml(search.question)}</div>`;
    return;
  }

  dashboardDataSearchFeedback.textContent = `${search.results.length} matching item${search.results.length === 1 ? "" : "s"}`;
  if (!search.results.length) {
    dashboardDataSearchResults.innerHTML = '<div class="dashboard-data-search-empty">No dashboard items match that search. Try another wall, period, or threshold.</div>';
    return;
  }

  dashboardDataSearchResults.innerHTML = search.results.map((item) => {
    const primaryValue = search.intent.metric === "dollars"
      ? money(item.value)
      : `${formatNumber(item.value)} oz`;
    const secondaryValue = search.intent.metric === "dollars"
      ? item.ounces === null ? "Sales estimate" : `${formatNumber(item.ounces)} oz poured`
      : item.dollars === null ? "Poured volume" : `${money(item.dollars)} estimated sales`;
    const wallLabel = item.wall ? `${normalizeTitle(item.wall)} wall` : "Historical";
    return `
      <article class="dashboard-data-search-result">
        <div class="dashboard-data-search-result__identity">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(wallLabel)} · ${escapeHtml(getWeeklyUsagePerformanceCategoryLabel(item.category))}${item.tapNumber ? ` · Tap ${formatNumber(item.tapNumber)}` : ""}</span>
        </div>
        <div class="dashboard-data-search-result__value">
          <strong>${escapeHtml(primaryValue)}</strong>
          <small>${escapeHtml(item.periodLabel)} · ${escapeHtml(secondaryValue)}</small>
        </div>
        <button class="mini-button" type="button" data-dashboard-data-search-name="${escapeHtml(item.name)}">View in Weekly Usage</button>
      </article>
    `;
  }).join("");
}

function openGlobalSearch() {
  if (!globalSearchDialog || !globalSearchInput) return;
  refreshGlobalSearchIndex();
  renderGlobalSearchResults();
  if (!globalSearchDialog.open) globalSearchDialog.showModal();
  globalSearchInput.focus();
}

function closeGlobalSearch() {
  if (globalSearchDialog?.open) globalSearchDialog.close();
}

function getGlobalSearchSectionItems() {
  return [
    ["dashboard", "Dashboard", "Alerts, readiness, weekly priorities, and quick actions"],
    ["recipes", "Recipes", "Cocktails, batches, spirits, and ingredients", "current"],
    ["weekly-plan", "Weekly Plan", "Orders, beer kegs, and cocktails to make"],
    ["keg-levels", "Keg Levels", "Tap walls, current levels, pars, and on-deck products"],
    ["pricing", "Tap Pricing", "Pour prices, costs, and gross margins"],
    ["ingredients", "Ingredient & Keg Costs", "Bottle prices, keg prices, and vendor mappings"],
    ["inventory", "Inventory", "Liquor, mixers, counts, pars, and reorder items"],
    ["weekly-usage", "Weekly Usage", "PMB history, average ounces, and tap performance"],
    ["add", "Add Product", "Create a cocktail, beer keg, or liquor tap"],
    ["recipes", "Old Recipes", "Deactivated cocktail recipes", "old"],
  ].map(([tab, title, subtitle, recipeView]) => ({
    id: `section:${tab}:${recipeView || "default"}`,
    kind: "section",
    title,
    subtitle,
    section: "Dashboard section",
    searchText: [title, subtitle],
    tab,
    recipeView,
  }));
}

function getRecipeGlobalSearchItems(sourceRecipes, { inactive = false } = {}) {
  return sourceRecipes.map((recipe) => ({
    id: `${inactive ? "old-recipe" : "recipe"}:${recipe.id}`,
    kind: inactive ? "old-recipe" : "recipe",
    title: recipe.title,
    subtitle: `${recipe.category} · ${formatBatchLabel(recipe.batch)}`,
    section: inactive ? "Old Recipes" : "Recipes",
    searchText: [
      recipe.category,
      recipe.batch,
      recipe.description,
      ...(recipe.ingredients || []).map((ingredient) => ingredient.name),
    ],
    tab: "recipes",
    recipeView: inactive ? "old" : "current",
    filterId: inactive ? "old-search" : "recipe-search",
    query: recipe.title,
    highlightId: `recipe:${recipe.id}`,
  }));
}

function refreshGlobalSearchIndex() {
  if (isEmployeeDashboard) return;

  const ingredientItems = ingredients
    .filter((ingredient) => ingredient.id !== "water" && !isHiddenPricingIngredient(ingredient))
    .map((ingredient) => ({
      id: `ingredient:${ingredient.id}`,
      kind: "ingredient",
      title: ingredient.name,
      subtitle: ingredient.group || "Ingredient cost",
      section: "Ingredient & Keg Costs",
      searchText: [ingredient.group, ingredient.vendorProduct?.vendor, ingredient.vendorProduct?.productName, ...(ingredient.recipes || [])],
      tab: "ingredients",
      filterId: "ingredient-search",
      query: ingredient.name,
      highlightId: `ingredient:${ingredient.id}`,
    }));

  const kegPriceItems = kegPricingItems.map((item) => ({
    id: `keg-price:${item.id}`,
    kind: "keg-price",
    title: item.name,
    subtitle: [item.vendor, item.tapSummary].filter(Boolean).join(" · ") || "Beer keg cost",
    section: "Ingredient & Keg Costs",
    searchText: [item.wall, item.tapNumber ? `tap ${item.tapNumber}` : "", item.vendor, item.vendorProduct?.productName],
    tab: "ingredients",
    filterId: "ingredient-search",
    query: item.name,
    highlightId: `keg-price:${item.id}`,
  }));

  const inventorySearchItems = inventoryItems.map((item) => ({
    id: `inventory:${item.id}`,
    kind: "inventory",
    title: item.name,
    subtitle: item.group || "Inventory",
    section: "Inventory",
    searchText: [item.group, item.vendorProduct?.vendor, item.vendorProduct?.productName, item.orderQuantity > 0 ? "needs order reorder" : ""],
    tab: "inventory",
    filterId: "inventory-search",
    query: item.name,
    highlightId: `inventory:${item.id}`,
  }));

  const tapItems = kegWallItems.map((item) => {
    const liveRow = getKegLiveRow(item);
    const name = getKegDisplayBrand(item, liveRow);
    const itemKey = getKegItemKey(item);
    return {
      id: `tap:${itemKey}`,
      kind: "tap",
      title: name || item.brand,
      subtitle: `${item.wall} · Tap ${formatNumber(item.tapNumber)}`,
      section: "Keg Levels",
      searchText: [item.type, item.wall, `tap ${item.tapNumber}`, liveRow?.plu, liveRow?.productId],
      tab: "keg-levels",
      highlightId: `tap:${itemKey}`,
    };
  });

  const usageItems = [...weeklyUsageItems, ...weeklyUsageArchivedItems]
    .filter((item) => (item.history || []).length || weeklyUsageItems.includes(item))
    .map((item, index) => ({
      id: `usage:${item.tapNumber || "history"}:${slugify(item.name)}:${index}`,
      kind: "usage",
      title: item.name,
      subtitle: `${item.tapNumber ? `Tap ${item.tapNumber} · ` : ""}${item.wall || "Historical"}`,
      section: "Weekly Usage",
      searchText: [item.type, item.wall, item.replacedBy, item.tapNumber ? `tap ${item.tapNumber}` : ""],
      tab: "weekly-usage",
      filterId: "weekly-usage-search",
      query: item.name,
    }));

  globalSearchItems = [
    ...getGlobalSearchSectionItems(),
    ...getRecipeGlobalSearchItems(getActiveRecipes()),
    ...getRecipeGlobalSearchItems(getInactiveRecipes(), { inactive: true }),
    ...ingredientItems,
    ...kegPriceItems,
    ...inventorySearchItems,
    ...tapItems,
    ...usageItems,
  ];
}

function getGlobalSearchKindLabel(kind) {
  return ({
    section: "Open",
    recipe: "Recipe",
    "old-recipe": "Old recipe",
    ingredient: "Ingredient",
    "keg-price": "Keg",
    inventory: "Inventory",
    tap: "Tap",
    usage: "Usage",
  })[kind] || "Result";
}

function renderGlobalSearchResults() {
  if (!globalSearchResults || !globalSearchInput) return;
  visibleGlobalSearchResults = searchDashboardItems(globalSearchItems, globalSearchInput.value, { limit: 14 });
  activeGlobalSearchResultIndex = visibleGlobalSearchResults.length ? 0 : -1;
  if (globalSearchHint) {
    globalSearchHint.textContent = clean(globalSearchInput.value)
      ? `${visibleGlobalSearchResults.length} result${visibleGlobalSearchResults.length === 1 ? "" : "s"}`
      : "";
  }
  globalSearchResults.innerHTML = visibleGlobalSearchResults.length
    ? visibleGlobalSearchResults.map((item, index) => `
        <button
          class="global-search-result${index === activeGlobalSearchResultIndex ? " is-active" : ""}"
          type="button"
          role="option"
          aria-selected="${index === activeGlobalSearchResultIndex}"
          data-global-search-result="${index}"
        >
          <span class="global-search-result__copy">
            <strong>${escapeHtml(item.title)}</strong>
            <small>${escapeHtml(item.subtitle || getGlobalSearchKindLabel(item.kind))}</small>
          </span>
          <span class="global-search-result__section">${escapeHtml(item.section || getGlobalSearchKindLabel(item.kind))}</span>
        </button>
      `).join("")
    : '<div class="global-search-empty">No dashboard items match that search.</div>';
}

function setActiveGlobalSearchResult(nextIndex) {
  if (!visibleGlobalSearchResults.length) return;
  activeGlobalSearchResultIndex = (nextIndex + visibleGlobalSearchResults.length) % visibleGlobalSearchResults.length;
  globalSearchResults.querySelectorAll("[data-global-search-result]").forEach((button, index) => {
    const active = index === activeGlobalSearchResultIndex;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    if (active) button.scrollIntoView({ block: "nearest" });
  });
}

function handleGlobalSearchKeydown(event) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveGlobalSearchResult(activeGlobalSearchResultIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveGlobalSearchResult(activeGlobalSearchResultIndex - 1);
  } else if (event.key === "Enter" && activeGlobalSearchResultIndex >= 0) {
    event.preventDefault();
    activateGlobalSearchResult(visibleGlobalSearchResults[activeGlobalSearchResultIndex]);
  }
}

function highlightGlobalSearchTarget(item) {
  if (!item?.highlightId) return;
  window.requestAnimationFrame(() => {
    const target = item.kind === "recipe" || item.kind === "old-recipe"
      ? [...document.querySelectorAll(".recipe-card")].find((card) => card.dataset.recipeId === item.highlightId.slice(item.highlightId.indexOf(":") + 1))
      : item.kind === "tap"
        ? [...document.querySelectorAll("[data-keg-row-key]")].find((row) => `tap:${row.dataset.kegRowKey}` === item.highlightId)
        : [...document.querySelectorAll("[data-global-search-key]")].find((element) => element.dataset.globalSearchKey === item.highlightId);
    if (!target) return;
    target.classList.remove("global-search-target");
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    window.requestAnimationFrame(() => target.classList.add("global-search-target"));
    window.setTimeout(() => target.classList.remove("global-search-target"), 2100);
  });
}

function activateGlobalSearchResult(item) {
  if (!item) return;
  if (item.recipeView) switchRecipeView(item.recipeView);
  if (item.filterId) {
    const input = document.getElementById(item.filterId);
    if (input) {
      input.value = item.query || item.title;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  switchTab(item.tab || "recipes");
  closeGlobalSearch();
  if (item.highlightId) {
    highlightGlobalSearchTarget(item);
  } else {
    window.requestAnimationFrame(() => document.querySelector(`#${item.tab}-panel`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
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
  const stats = isEmployeeDashboard
    ? [
        ["Recipes", recipeCount.toLocaleString()],
        ["Spirit groups", new Set(activeRecipes.map((recipe) => recipe.category)).size.toLocaleString()],
        ["Ingredients", ingredients.filter((ingredient) => ingredient.id !== "water").length.toLocaleString()],
        ["Avg batch oz", formatNumber(recipeCount ? totalOz / recipeCount : 0)],
      ]
    : [
        ["Recipes", recipeCount.toLocaleString()],
        ["Avg cost per oz", money(avgCostPerOz)],
        ["Avg profit margin", `${formatNumber(avgMargin)}%`],
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
  const activeRecipes = getActiveRecipes();
  if (currentRecipeCount) currentRecipeCount.textContent = `(${activeRecipes.length.toLocaleString()})`;
  const visibleRecipes = activeRecipes.filter((recipe) => {
    const matchesCategory = category === "all" || recipe.category === category;
    const haystack = `${recipe.title} ${recipe.batch} ${recipe.ingredients.map((item) => item.name).join(" ")}`.toLowerCase();
    return matchesCategory && haystack.includes(searchTerm);
  });

  recipeGrid.innerHTML = "";
  renderRecipeCoverageAlert();

  visibleRecipes.forEach((recipe) => {
    const card = createRecipeCard(recipe, "active");
    recipeGrid.append(card);
  });
}

function getWallCocktailRecipeCoverage() {
  const records = kegWallItems
    .map((item) => {
      const liveRow = getKegLiveRow(item);
      const displayBrand = getKegDisplayBrand(item, liveRow);
      const context = getKegCostContext(item, displayBrand);
      if (context.kind !== "cocktail") return null;
      const productName = getKegDisplayName(context.livePrice?.name || displayBrand || item.brand);
      const inactiveRecipe = context.recipe ? null : findRecipeForWallProduct(getInactiveRecipes(), productName);
      return {
        item,
        productName,
        recipe: context.recipe,
        inactiveRecipe,
      };
    })
    .filter(Boolean);

  const missingByProduct = new Map();
  records
    .filter((record) => !record.recipe)
    .forEach((record) => {
      const key = getTapPriceAliases(record.productName)[0] || slugify(record.productName);
      const existing = missingByProduct.get(key) || {
        name: record.productName,
        locations: [],
        inactiveRecipeId: record.inactiveRecipe?.id || "",
      };
      existing.locations.push(`${record.item.wall} tap ${record.item.tapNumber}`);
      if (!existing.inactiveRecipeId && record.inactiveRecipe?.id) {
        existing.inactiveRecipeId = record.inactiveRecipe.id;
      }
      missingByProduct.set(key, existing);
    });

  return {
    totalTaps: records.length,
    coveredTaps: records.filter((record) => record.recipe).length,
    missing: [...missingByProduct.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function findRecipeForWallProduct(sourceRecipes, productName) {
  const aliases = getTapPriceAliases(productName);
  return sourceRecipes.find((recipe) => {
    const recipeAliases = getTapPriceAliases(recipe.title);
    return aliases.some((alias) => recipeAliases.includes(alias));
  }) || null;
}

function renderRecipeCoverageAlert() {
  if (!recipeCoverageAlert || !kegWallItems.length) return;
  const coverage = getWallCocktailRecipeCoverage();
  recipeCoverageAlert.hidden = false;
  recipeCoverageAlert.classList.toggle("is-complete", coverage.missing.length === 0);

  if (!coverage.missing.length) {
    recipeCoverageAlert.hidden = true;
    recipeCoverageAlert.innerHTML = "";
    return;
  }

  recipeCoverageAlert.innerHTML = `
    <div class="recipe-coverage-alert__header">
      <div>
        <h2>${coverage.missing.length} wall cocktail${coverage.missing.length === 1 ? "" : "s"} need recipe cards</h2>
        <p>${coverage.coveredTaps} of ${coverage.totalTaps} cocktail taps are covered. Counts refresh from ${isEmployeeDashboard ? "the current wall configuration" : "the current wall and Pour My Beer data"}.</p>
      </div>
    </div>
    <div class="recipe-coverage-alert__list">
      ${coverage.missing.map((item) => `
        <div class="recipe-coverage-alert__item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(item.locations.join(", "))}</span>
          </div>
          ${isEmployeeDashboard
            ? '<span class="table-note table-note--accent">Manager action needed</span>'
            : `
              <button
                class="mini-button"
                type="button"
                ${item.inactiveRecipeId
                  ? `data-reactivate-wall-recipe="${escapeHtml(item.inactiveRecipeId)}"`
                  : `data-create-wall-recipe="${escapeHtml(item.name)}"`}
              >${item.inactiveRecipeId ? "Reactivate recipe" : "Create recipe"}</button>
            `}
        </div>
      `).join("")}
    </div>
  `;
}

function handleRecipeCoverageAction(event) {
  const reactivateButton = event.target.closest("[data-reactivate-wall-recipe]");
  if (reactivateButton) {
    reactivateRecipe(reactivateButton.dataset.reactivateWallRecipe);
    return;
  }

  const createButton = event.target.closest("[data-create-wall-recipe]");
  if (!createButton) return;
  resetRecipeForm();
  newRecipeTitleInput.value = createButton.dataset.createWallRecipe || "";
  newRecipeCategoryInput.value = "Other";
  syncRecipeCreativeDefaults({ preserveDescription: false, preserveImage: false });
  scheduleRecipeImageLookup();
  syncRecipeBuilderSummary();
  switchTab("add");
  newRecipeTitleInput.focus();
}

function renderOldRecipes() {
  const searchTerm = oldSearch.value.trim().toLowerCase();
  const inactiveRecipes = getInactiveRecipes();
  if (oldRecipeCount) oldRecipeCount.textContent = `(${inactiveRecipes.length.toLocaleString()})`;
  const oldRecipes = inactiveRecipes.filter((recipe) => {
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
  card.dataset.recipeId = recipe.id;
  card.querySelector("h2").textContent = recipe.title;
  card.querySelector(".recipe-card__batch").textContent = formatBatchLabel(recipe.batch);
  card.querySelector(".spirit-pill").textContent = recipe.category;
  const actions = card.querySelector(".recipe-card__actions");
  if (isEmployeeDashboard) {
    actions.remove();
  } else {
    actions.innerHTML = `
      <div class="recipe-card__total-oz" aria-label="Total batch ounces">
        <strong>${formatNumber(totals.oz)}</strong>
        <span>oz</span>
      </div>
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
  renderShotPricing(visibleTapRows);
  renderPricingAdvisor(visibleTapRows);
  pricingTable.innerHTML = "";

  visibleTapRows.forEach((tapRow) => {
    pricingTable.append(renderTapPricingRow(tapRow));
  });
}

function renderShotPricing(visibleTapRows = []) {
  if (!shotPricingSummary || !shotPricingTable) return;
  const rows = buildShotPricingRows(visibleTapRows, shotPricingCapability);
  const summary = summarizeShotPricingRows(rows);
  shotPricingRowsByKey = new Map(rows.map((row) => [row.key, row]));

  shotPricingSummary.innerHTML = rows.length
    ? `
      <div class="shot-pricing__summary-counts">
        <span><strong>${formatNumber(summary.total)}</strong> liquor products</span>
        <span><strong>${formatNumber(summary.editable)}</strong> ready to edit</span>
        <span><strong>${formatNumber(summary.setupRequired)}</strong> need one-time setup</span>
      </div>
      <p class="shot-pricing__setup-note shot-pricing__setup-note--${summary.editable ? "ready" : "setup"}">
        <strong>${summary.editable ? "Live two-price review is ready." : "Live saves remain safely locked."}</strong>
        ${escapeHtml(summary.editable
          ? "Every change still requires owner confirmation and exact readback of both PMB portions."
          : shotPricingCapability.message || "Connect on-site once so PMB's portion IDs and edit form can be verified. Existing prices remain untouched.")}
      </p>
    `
    : `
      <p class="shot-pricing__setup-note">
        <strong>No live shot portions are loaded yet.</strong>
        Refresh PMB prices while connected to the work network to load both portion prices for each liquor tap.
      </p>
    `;

  shotPricingTable.innerHTML = rows.map((row) => {
    const running = activePmbPortionPriceUpdateKey === row.key;
    const message = pmbPortionPriceUpdateMessages.get(row.key);
    const affected = row.assignments.length > 1
      ? `${formatNumber(row.assignments.length)} taps share this PMB product`
      : row.wall ? `${row.wall} tap ${formatNumber(row.tapNumber)}` : `Tap ${formatNumber(row.tapNumber)}`;
    const currentPortions = row.portions.map((portion) => `
      <span><b>${escapeHtml(portion.name)}</b> ${money(portion.price)}${portion.quantityOz ? ` · ${formatNumber(portion.quantityOz)} oz` : ""}</span>
    `).join("");
    const editors = row.portions.slice(0, 2).map((portion, index) => `
      <label class="shot-pricing-field">
        <span>${escapeHtml(portion.name)}</span>
        <span class="shot-pricing-field__input"><i aria-hidden="true">$</i><input
          type="number"
          inputmode="decimal"
          min="0.01"
          max="1000"
          step="0.01"
          value="${escapeHtml(formatPriceInput(portion.price))}"
          data-shot-price-input="${index}"
          aria-label="New ${escapeHtml(portion.name)} price for ${escapeHtml(row.name)}"
          ${!row.canEdit || activePmbPortionPriceUpdateKey ? "disabled" : ""}
        ></span>
      </label>
    `).join("");
    const issue = row.blockers[0] || "Both portions and the physical PMB identity passed the safety checks.";

    return `
      <tr class="shot-pricing-row${row.canEdit ? "" : " shot-pricing-row--blocked"}" data-shot-pricing-key="${escapeHtml(row.key)}">
        <td><strong>${formatNumber(row.tapNumber)}</strong>${row.wall ? `<span class="table-note">${escapeHtml(row.wall)}</span>` : ""}</td>
        <td><strong>${escapeHtml(row.name)}</strong><span class="table-note">PMB PLU ${formatNumber(row.plu)} · ${escapeHtml(affected)}</span></td>
        <td><div class="portion-list">${currentPortions}</div></td>
        <td><div class="shot-pricing-fields">${editors}</div></td>
        <td>
          <span class="pricing-advisor-status pricing-advisor-status--${row.canEdit ? "ready" : "review"}">${row.canEdit ? "Ready" : "Setup required"}</span>
          <span class="table-note">${escapeHtml(issue)}</span>
        </td>
        <td>
          <div class="pricing-advisor-action">
            <button class="mini-button" type="button" data-shot-price-update="${escapeHtml(row.key)}"${!row.canEdit || activePmbPortionPriceUpdateKey ? " disabled" : ""}>${running ? "Updating both..." : "Update both in PMB"}</button>
            ${message ? `<span class="pricing-advisor-action__message pricing-advisor-action__message--${escapeHtml(message.tone)}" role="status">${escapeHtml(message.text)}</span>` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="6" class="empty-state">No PMB liquor portion rows match this search.</td></tr>';

  bindShotPricingControls();
}

function bindShotPricingControls() {
  shotPricingTable.querySelectorAll("[data-shot-pricing-key]").forEach((tableRow) => {
    const key = clean(tableRow.dataset.shotPricingKey);
    const row = shotPricingRowsByKey.get(key);
    const inputs = [...tableRow.querySelectorAll("[data-shot-price-input]")];
    const button = tableRow.querySelector("[data-shot-price-update]");
    if (!row || !button) return;
    const updateButtonState = () => {
      if (activePmbPortionPriceUpdateKey || !row.canEdit) return;
      button.disabled = !validateShotPricePair(row, inputs.map((input) => input.value)).valid;
    };
    inputs.forEach((input) => input.addEventListener("input", updateButtonState));
    updateButtonState();
    button.addEventListener("click", () => submitPmbPortionPriceUpdate(key));
  });
}

async function submitPmbPortionPriceUpdate(updateKey) {
  const key = clean(updateKey);
  if (!key || activePmbPortionPriceUpdateKey) return;
  const row = shotPricingRowsByKey.get(key);
  const tableRow = [...shotPricingTable.querySelectorAll("[data-shot-pricing-key]")]
    .find((candidate) => candidate.dataset.shotPricingKey === key);
  const inputs = [...tableRow?.querySelectorAll("[data-shot-price-input]") || []];
  const values = inputs.map((input) => input.value);
  const validation = validateShotPricePair(row, values);
  if (!validation.valid) {
    pmbPortionPriceUpdateMessages.set(key, { tone: "error", text: validation.message });
    renderPricing();
    return;
  }

  const changes = row.portions.map((portion, index) => (
    `${portion.name}: ${money(portion.price)} → ${money(validation.cents[index] / 100)}`
  ));
  const assignmentDetails = row.assignments.map((assignment) => (
    `${assignment.wall || "PMB"} tap ${formatNumber(assignment.tapNumber)} · device ${assignment.deviceId} · line ${assignment.lineNum}`
  ));
  if (!confirmDashboardAction(
    `Update both shot prices for ${row.name}?`,
    [...changes, `PMB PLU: ${row.plu}`, ...assignmentDetails],
    "This manual liquor price change is separate from the 82% advisor. Both PMB portions will be re-verified before and after saving.",
  )) return;

  activePmbPortionPriceUpdateKey = key;
  pmbPortionPriceUpdateMessages.set(key, { tone: "pending", text: "Re-verifying both PMB portions..." });
  renderPricing();

  try {
    const representative = row.assignments[0] || {};
    const response = await fetch("/api/pmb-portion-price-update", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        kind: "liquor",
        plu: row.plu,
        exactIdentity: {
          plu: row.plu,
          tapNumber: row.tapNumber,
          deviceId: representative.deviceId,
          lineNum: representative.lineNum,
          name: row.name,
        },
        expectedAssignments: row.assignments.map(({ tapNumber, deviceId, lineNum }) => ({ tapNumber, deviceId, lineNum })),
        portions: row.portions.map((portion, index) => ({
          itemId: portion.itemId,
          name: portion.name,
          quantityOz: portion.quantityOz,
          expectedPriceRaw: portion.priceRaw,
          priceDp: portion.priceDp,
          expectedCurrentPrice: formatPriceInput(portion.price),
          newPrice: (validation.cents[index] / 100).toFixed(2),
        })),
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.error || "PMB did not confirm both shot prices.");
    }
    pmbPortionPriceUpdateMessages.set(key, { tone: "success", text: "PMB accepted both prices. Refreshing the exact portions..." });
    await runTapPricingSync();
  } catch (error) {
    pmbPortionPriceUpdateMessages.set(key, {
      tone: "error",
      text: getPmbConnectionErrorMessage(error, "Could not update both PMB shot prices.", { writeAttempted: true }),
    });
  } finally {
    activePmbPortionPriceUpdateKey = "";
    renderPricing();
  }
}

function renderPricingAdvisor(visibleTapRows = []) {
  if (!pricingAdvisorSummary || !pricingAdvisorTable) return;

  const advisorInputs = visibleTapRows
    .map(buildPricingAdvisorInput)
    .filter((item) => isPricingAdvisorEligibleKind(item.kind));
  const advisor = buildPricingAdvisor(advisorInputs);
  const advisorByKey = new Map(advisorInputs.map((input) => [input.updateKey, input]));
  pricingAdvisorInputsByKey = advisorByKey;
  pricingAdvisorSummary.innerHTML = `
    <div><strong>${formatNumber(advisor.summary.priceChangeCount)}</strong><span>Price suggestions</span></div>
    ${advisor.summary.onTargetCount ? `<div><strong>${formatNumber(advisor.summary.onTargetCount)}</strong><span>At or above 82%</span></div>` : ""}
    ${advisor.summary.reviewCount ? `<div><strong>${formatNumber(advisor.summary.reviewCount)}</strong><span>Need review</span></div>` : ""}
    ${advisor.summary.blockedCount ? `<div><strong>${formatNumber(advisor.summary.blockedCount)}</strong><span>Missing data</span></div>` : ""}
  `;

  pricingAdvisorTable.innerHTML = advisor.rows.map((item) => {
    const source = advisorByKey.get(item.updateKey || item.id) || {};
    const status = getPricingAdvisorStatus(item);
    const issueCopy = item.issues.map((entry) => entry.message).join(" ");
    const tapLabel = item.tapPosition
      ? `${item.tapPosition}${item.wall ? `<span>${escapeHtml(item.wall)}</span>` : ""}`
      : "—";
    const currentMargin = item.currentPricePerOz && item.costPerOz
      ? `${formatNumber(item.currentMarginPercent)}%`
      : "—";
    const delta = item.currentPricePerOz && item.recommendedPricePerOz
      ? `${item.priceChange > 0 ? "+" : ""}${money(item.priceChange)} / oz`
      : "—";
    const costNote = [
      item.kind,
      item.costPerOz ? `${money(item.costPerOz)} cost / oz` : "Cost needed",
      item.costSource,
    ].filter(Boolean).join(" · ");
    const updateControl = renderPmbPriceUpdateControl(item, source);

    return `
      <tr class="pricing-advisor-row pricing-advisor-row--${escapeHtml(status.tone)}" data-pricing-advisor-key="${escapeHtml(source.updateKey || item.id)}">
        <td class="pricing-advisor__tap"><strong>${tapLabel}</strong></td>
        <td>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="table-note">${escapeHtml(costNote)}</span>
        </td>
        <td>${item.currentPricePerOz ? `${money(item.currentPricePerOz)} / oz` : "—"}</td>
        <td>${escapeHtml(currentMargin)}</td>
        <td><strong>${item.recommendedPricePerOz ? `${money(item.recommendedPricePerOz)} / oz` : "—"}</strong></td>
        <td>${escapeHtml(delta)}</td>
        <td>
          <span class="pricing-advisor-status pricing-advisor-status--${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span>
          ${issueCopy ? `<span class="table-note">${escapeHtml(issueCopy)}</span>` : '<span class="table-note">Inputs passed the dry-run checks.</span>'}
        </td>
        <td>${updateControl}</td>
      </tr>
    `;
  }).join("") || '<tr><td colspan="8" class="empty-state">No tap-pricing rows match this search.</td></tr>';

  bindPmbPriceUpdateControls();
}

function buildPricingAdvisorInput({ livePrice, recipe, kegItem }) {
  const ingredient = livePrice?.ingredient || null;
  const pricingContext = recipe
    ? {
        kind: "Cocktail",
        costPerOz: getRecipeTotals(recipe).costPerOz,
        costSource: "Recipe ingredient costs",
        costUpdatedAt: getRecipePricingAdvisorTimestamp(recipe),
      }
    : kegItem
      ? {
          kind: "Beer",
          costPerOz: getKegCatalogUnitCost(kegItem),
          costSource: "Keg cost",
          costUpdatedAt: kegPriceOverrides[kegItem.id]?.updatedAt,
          currentPricePerOz: toNumber(livePrice?.chargePerOz),
        }
      : ingredient
        ? {
            kind: "Liquor",
            costPerOz: getCatalogUnitCost(ingredient),
            costSource: "Bottle cost",
            costUpdatedAt: priceOverrides[ingredient.id]?.updatedAt,
            currentPricePerOz: getPricingAdvisorCurrentPrice(livePrice),
          }
        : {
            kind: clean(livePrice?.type) || "Tap",
            costPerOz: 0,
            costSource: "No mapped cost",
            costUpdatedAt: "",
          };

  const assignments = getPmbPriceAssignments(livePrice);
  const firstAssignment = assignments[0] || {};
  const tapNumber = toNumber(livePrice?.tapPosition || firstAssignment.tapNumber || kegItem?.tapNumber);
  const plu = toNumber(livePrice?.plu);
  const updateKey = `${plu || "no-plu"}:${tapNumber || "no-tap"}`;
  return {
    id: updateKey,
    updateKey,
    name: clean(livePrice?.name || recipe?.title || kegItem?.name) || "Unmapped PMB tap",
    wall: clean(livePrice?.wall || kegItem?.wall),
    tapPosition: tapNumber,
    tapNumber,
    mappingVerified: Boolean(recipe || kegItem || ingredient),
    currentPricePerOz: getPricingAdvisorCurrentPrice(livePrice),
    livePriceUpdatedAt: livePrice ? liveTapPricingUpdatedAt : "",
    plu,
    deviceId: toNumber(livePrice?.deviceId || firstAssignment.deviceId),
    lineNum: toNumber(livePrice?.lineNum || firstAssignment.lineNum),
    isCurrentTap: livePrice?.isCurrentTap === true,
    identityVerified: livePrice?.identityVerified === true,
    tapMatchSource: clean(livePrice?.tapMatchSource),
    assignments,
    ...pricingContext,
  };
}

function getPmbPriceAssignments(livePrice) {
  const provided = Array.isArray(livePrice?.assignments) ? livePrice.assignments : [];
  const fallback = livePrice?.tapPosition ? [livePrice] : [];
  return (provided.length ? provided : fallback)
    .map((assignment) => ({
      tapNumber: toNumber(assignment?.tapNumber || assignment?.tapPosition),
      deviceId: toNumber(assignment?.deviceId),
      lineNum: toNumber(assignment?.lineNum),
      wall: clean(assignment?.wall),
      name: clean(assignment?.name || livePrice?.name),
    }));
}

function getPmbPriceUpdateKey(input) {
  return clean(input?.updateKey || input?.id);
}

function renderPmbPriceUpdateControl(item, source) {
  const key = getPmbPriceUpdateKey(source);
  const eligibility = getPmbPriceUpdateEligibility(source);
  const isRunning = activePmbPriceUpdateKey === key;
  const defaultPrice = getPmbPriceEditorDefault(item);
  const message = pmbPriceUpdateMessages.get(key);
  if (!eligibility.eligible) {
    const needsLiveRefresh = eligibility.blockers.some((blocker) => (
      /current PMB|freshness|identity|assignment/i.test(blocker)
    ));
    const reason = needsLiveRefresh
      ? "Refresh PMB prices to verify this tap before editing."
      : eligibility.blockers[0] || "This PMB price cannot be edited safely.";
    return `
      <div class="pricing-advisor-action pricing-advisor-action--unavailable">
        <span class="pricing-advisor-action__unavailable">Unavailable</span>
        <span class="table-note">${escapeHtml(reason)}</span>
        ${message ? `<span class="pricing-advisor-action__message pricing-advisor-action__message--${escapeHtml(message.tone)}" role="status">${escapeHtml(message.text)}</span>` : ""}
      </div>
    `;
  }
  const noOpDefault = !validatePmbPriceIncrease({
    currentPricePerOz: item.currentPricePerOz,
    newPricePerOz: defaultPrice,
  }).valid;
  const controlDisabled = Boolean(activePmbPriceUpdateKey);
  const buttonDisabled = controlDisabled || noOpDefault;

  return `
    <div class="pricing-advisor-action">
      <label>
        <span class="sr-only">New PMB price per ounce for ${escapeHtml(item.name)}</span>
        <span class="pricing-advisor-action__currency" aria-hidden="true">$</span>
        <input
          type="number"
          inputmode="decimal"
          min="${escapeHtml(formatPriceInput(item.currentPricePerOz + 0.01))}"
          step="0.01"
          value="${escapeHtml(formatPriceInput(defaultPrice))}"
          data-pmb-price-input
          data-current-price="${escapeHtml(formatPriceInput(item.currentPricePerOz))}"
          data-update-eligible="${eligibility.eligible ? "true" : "false"}"
          aria-label="New PMB price per ounce for ${escapeHtml(item.name)}"
          ${controlDisabled ? "disabled" : ""}
        >
      </label>
      <button class="mini-button" type="button" data-pmb-price-update="${escapeHtml(key)}"${buttonDisabled ? " disabled" : ""}>${isRunning ? "Updating..." : "Approve & update PMB"}</button>
      ${message ? `<span class="pricing-advisor-action__message pricing-advisor-action__message--${escapeHtml(message.tone)}" role="status">${escapeHtml(message.text)}</span>` : ""}
    </div>
  `;
}

function bindPmbPriceUpdateControls() {
  pricingAdvisorTable.querySelectorAll("[data-pmb-price-update]").forEach((button) => {
    const row = button.closest("[data-pricing-advisor-key]");
    const input = row?.querySelector("[data-pmb-price-input]");
    button.addEventListener("click", () => submitPmbPriceIncrease(button.dataset.pmbPriceUpdate));
    input?.addEventListener("input", () => {
      if (activePmbPriceUpdateKey || input.dataset.updateEligible !== "true") return;
      button.disabled = !validatePmbPriceIncrease({
        currentPricePerOz: input.dataset.currentPrice,
        newPricePerOz: input.value,
      }).valid;
    });
  });
}

function formatPriceInput(value) {
  const price = toNumber(value);
  return price ? price.toFixed(2) : "";
}

async function submitPmbPriceIncrease(updateKey) {
  const key = clean(updateKey);
  if (!key || activePmbPriceUpdateKey) return;
  const source = pricingAdvisorInputsByKey.get(key);
  const eligibility = getPmbPriceUpdateEligibility(source);
  const row = [...pricingAdvisorTable.querySelectorAll("[data-pricing-advisor-key]")]
    .find((candidate) => candidate.dataset.pricingAdvisorKey === key);
  const input = row?.querySelector("[data-pmb-price-input]");
  const newPricePerOz = Math.round(toNumber(input?.value) * 100) / 100;
  const validation = validatePmbPriceIncrease({
    currentPricePerOz: eligibility.currentPricePerOz,
    newPricePerOz,
  });

  if (!eligibility.eligible) {
    pmbPriceUpdateMessages.set(key, {
      tone: "error",
      text: eligibility.blockers.join(" ") || "This PMB price cannot be updated safely.",
    });
    renderPricing();
    return;
  }
  if (!validation.valid) {
    pmbPriceUpdateMessages.set(key, { tone: "error", text: validation.message });
    renderPricing();
    return;
  }

  const assignments = source.assignments?.length
    ? source.assignments
    : [{ ...eligibility.identity, wall: source.wall }];
  const assignmentDetails = assignments.map((assignment) => {
    const location = [
      assignment.wall,
      assignment.tapNumber ? `tap ${formatNumber(assignment.tapNumber)}` : "",
    ].filter(Boolean).join(" ") || `Tap ${formatNumber(assignment.tapNumber)}`;
    return `Affected assignment: ${location} · device ${assignment.deviceId} · line ${assignment.lineNum}`;
  });

  if (!confirmDashboardAction(
    `Update ${source.name} in Pour My Beer?`,
    [
      `Current PMB price: ${money(eligibility.currentPricePerOz)} / oz`,
      `New PMB price: ${money(newPricePerOz)} / oz`,
      `PMB PLU: ${eligibility.plu}`,
      ...assignmentDetails,
    ],
    "This is a live price increase. No change is sent unless you confirm.",
  )) return;

  activePmbPriceUpdateKey = key;
  pmbPriceUpdateMessages.set(key, { tone: "pending", text: "Sending the confirmed increase to PMB..." });
  renderPricing();

  try {
    const response = await fetch("/api/pmb-price-update", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        plu: eligibility.plu,
        kind: eligibility.kind,
        exactIdentity: eligibility.identity,
        expectedAssignments: assignments.map(({ tapNumber, deviceId, lineNum }) => ({
          tapNumber,
          deviceId,
          lineNum,
        })),
        expectedCurrentPricePerOz: eligibility.currentPricePerOz,
        newPricePerOz,
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || result?.ok !== true) {
      throw new Error(result?.error || "PMB did not confirm the price update.");
    }
    const backendWarning = clean(result?.warning);
    const configUpdateIncomplete = result?.configUpdateComplete === false;

    pmbPriceUpdateMessages.set(key, {
      tone: backendWarning || configUpdateIncomplete ? "warning" : "success",
      text: `PMB accepted ${money(newPricePerOz)} / oz. Refreshing live prices...${backendWarning ? ` ${backendWarning}` : ""}`,
    });
    const refreshed = await runTapPricingSync();
    const refreshedPrice = toNumber(pricingAdvisorInputsByKey.get(key)?.currentPricePerOz);
    const verifiedPrice = toNumber(result?.product?.pricePerOz);
    const backendVerified = Math.abs(verifiedPrice - newPricePerOz) < 0.005;
    const dashboardConfirmed = refreshed && Math.abs(refreshedPrice - newPricePerOz) < 0.005;
    const priceConfirmed = backendVerified || dashboardConfirmed;
    const warningCopy = [
      backendWarning || (configUpdateIncomplete ? "The PMB configuration refresh did not complete." : ""),
    ].filter(Boolean).join(" ");
    const dashboardRefreshWarning = dashboardConfirmed
      ? ""
      : refreshed && refreshedPrice
        ? `The dashboard refresh still returned ${money(refreshedPrice)} / oz; refresh PMB prices again before another change. Do not submit this price again.`
        : "The dashboard price list did not reload; refresh PMB prices before another change. Do not submit this price again.";
    const completeWarning = [warningCopy, dashboardRefreshWarning].filter(Boolean).join(" ");
    pmbPriceUpdateMessages.set(key, {
      tone: priceConfirmed ? (completeWarning ? "warning" : "success") : "error",
      text: priceConfirmed
        ? `PMB price verified at ${money(newPricePerOz)} / oz.${completeWarning ? ` ${completeWarning}` : ""}`
        : refreshed && refreshedPrice
          ? `PMB accepted the update, but the refresh returned ${money(refreshedPrice)} / oz. Verify PMB before retrying.${warningCopy ? ` ${warningCopy}` : ""}`
          : `PMB accepted the update, but the live price could not be refreshed. Refresh PMB prices before another change.${warningCopy ? ` ${warningCopy}` : ""}`,
    });
  } catch (error) {
    pmbPriceUpdateMessages.set(key, {
      tone: "error",
      text: getPmbConnectionErrorMessage(error, "Could not update the PMB price.", { writeAttempted: true }),
    });
  } finally {
    activePmbPriceUpdateKey = "";
    renderPricing();
  }
}

function getPricingAdvisorCurrentPrice(livePrice) {
  const directPrice = toNumber(livePrice?.chargePerOz);
  if (directPrice) return directPrice;
  const portions = getLiveTapPortions(livePrice);
  const single = portions.find((portion) => !/double/i.test(portion?.name || "")) || portions[0];
  const servingOz = getPortionServingOz(single);
  return servingOz ? toNumber(single?.price) / servingOz : 0;
}

function getRecipePricingAdvisorTimestamp(recipe) {
  const pricedIngredients = (recipe?.ingredients || []).filter((ingredient) => (
    toNumber(ingredient.oz) > 0 && getIngredientCost(ingredient).cost > 0
  ));
  if (!pricedIngredients.length) return "";

  const timestamps = pricedIngredients.map((ingredient) => {
    if (ingredient.manualCost) return "";
    return clean(priceOverrides[getResolvedIngredientId(ingredient)]?.updatedAt);
  });
  if (timestamps.some((value) => !value)) return "";

  return timestamps.reduce((oldest, value) => {
    const valueTime = new Date(value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || value).getTime();
    const oldestTime = new Date(oldest.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || oldest).getTime();
    if (!Number.isFinite(valueTime)) return value;
    if (!Number.isFinite(oldestTime)) return oldest;
    return valueTime < oldestTime ? value : oldest;
  });
}

function getPricingAdvisorStatus(item) {
  if (item.hasBlocker) return { label: "Needs data", tone: "blocked" };
  if (item.action === "increase") return { label: "Review increase", tone: "change" };
  if (item.action === "set") return { label: "Review new price", tone: "change" };
  if (item.action === "hold") return { label: "No change", tone: "ready" };
  if (item.needsReview) return { label: "Review inputs", tone: "review" };
  return { label: "No change", tone: "ready" };
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
  const sourceLabel = override ? "Dashboard calculation override (not PMB)" : livePrice ? `PMB live: ${livePrice.name}` : "CSV fallback";
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
  pricingSummary.innerHTML = `
    <h2>Charge pricing</h2>
    <div class="sync-panel">
      <button class="primary-button" id="refresh-tap-pricing" type="button"${tapPricingSyncLoading ? " disabled" : ""}>${tapPricingSyncLoading ? "Refreshing..." : "Refresh PMB prices"}</button>
      <p class="sync-status">${escapeHtml(liveTapPricingMessage)}${liveTapPricingUpdatedAt ? ` Last updated ${escapeHtml(formatUpdatedAt(liveTapPricingUpdatedAt))}.` : ""}</p>
    </div>
    <div class="summary-line"><span>Cocktail recipes</span><strong>${activeRecipes.length}</strong></div>
    <div class="summary-line"><span>Current PMB taps</span><strong>${liveTapPriceItems.length || visibleTapRows.length}</strong></div>
    <div class="summary-line"><span>Projected batch revenue</span><strong>${money(revenue)}</strong></div>
    <div class="summary-line"><span>Projected batch profit</span><strong>${money(profit)}</strong></div>
    <div class="summary-line"><span>Projected margin</span><strong>${formatNumber(margin)}%</strong></div>
  `;
  document.querySelector("#refresh-tap-pricing")?.addEventListener("click", runTapPricingSync);
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
      const preparedPurchase = getPreparedIngredientPurchase(ingredient.id);
      const previousPriceNote = getPreviousPriceNote(override);
      const row = document.createElement("tr");
      row.dataset.globalSearchKey = `ingredient:${ingredient.id}`;
      row.innerHTML = `
        <td>
          <strong>${escapeHtml(ingredient.name)}</strong>
        </td>
        <td>${money(currentUnitCost)}</td>
        <td>${preparedPurchase
          ? `<span class="table-note">${escapeHtml(getPreparedIngredientYieldNote(ingredient.id))}</span><input type="hidden" value="${escapeHtml(preparedPurchase.purchaseUnitStorageValue)}">`
          : `<input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(override.bottleOz ?? "")}" placeholder="${escapeHtml(mappedBottleOz)}" aria-label="Package size in ounces for ${escapeHtml(ingredient.name)}">`}</td>
        <td><input type="text" inputmode="decimal" pattern="[0-9]*[.]?[0-9]*" value="${escapeHtml(override.bottlePrice ?? "")}" aria-label="${escapeHtml(preparedPurchase?.priceInputLabel || `Package price for ${ingredient.name}`)}"></td>
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
      row.dataset.globalSearchKey = `keg-price:${item.id}`;
      row.innerHTML = `
        <td>
          <strong>${escapeHtml(item.name)}</strong>
          <span class="table-note table-note--accent">${escapeHtml(item.tapSummary)}</span>
        </td>
        <td>${escapeHtml(vendorName)}</td>
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
  const kegTrackedValue = sum(visibleKegs.map((item) => getKegPrice(item)));

  ingredientSummary.innerHTML = `
    <h2>Pricing</h2>
    <div class="sync-panel">
      <h3>Price Sync</h3>
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
    <div class="summary-line"><span>Mapped to vendors</span><strong>${countVendorMappings(visibleIngredients)}</strong></div>
    <div class="summary-line"><span>Beer kegs tracked</span><strong>${visibleKegs.length}</strong></div>
    <div class="summary-line"><span>Keg catalog value</span><strong>${money(kegTrackedValue)}</strong></div>
    <div class="summary-line"><span>Estimated catalog cost</span><strong>${money(sum(visibleIngredients.map((item) => getCatalogCost(item))))}</strong></div>
  `;

  bindIngredientSummaryEvents();
}

function renderInventory() {
  const visibleItems = getVisibleInventoryItems();
  const groupedItems = groupInventoryForDisplay(visibleItems);
  const reorderItems = getInventoryReorderItems(visibleItems);

  renderWeeklyPlan();
  renderInventorySummary(visibleItems, reorderItems);
  renderInventoryStockTable(groupedItems);
  renderInventoryOrderTable(reorderItems);
  renderInventoryHistory();
}

function getWeeklyPlanInventoryItems() {
  const mondaySnapshot = getCurrentMondayInventorySnapshot(inventoryHistory, new Date());
  if (!mondaySnapshot) return [];
  return (mondaySnapshot.items || [])
    .filter((snapshotItem) => (
      !isFoodDepartmentOrderedInventoryItem(snapshotItem.name)
      && toNumber(snapshotItem.parDisplay) > 0
      && toNumber(snapshotItem.orderDisplay) > 0
    ))
    .map((snapshotItem) => {
      const item = inventoryItems.find((candidate) => candidate.id === snapshotItem.id)
        || inventoryItems.find((candidate) => candidate.name === snapshotItem.name);
      const vendorProduct = item?.vendorProduct || getVendorMapping(snapshotItem.id);
      const orderUnits = toNumber(snapshotItem.orderDisplay);
      const unitCost = toNumber(snapshotItem.unitCost);
      return {
        id: snapshotItem.id,
        name: snapshotItem.name,
        group: snapshotItem.group,
        orderUnits,
        casePackaged: Boolean(snapshotItem.casePackaged),
        packSize: normalizePackSize(snapshotItem.packSize || 1),
        vendor: vendorProduct?.vendor || vendorProduct?.syncVendor || "",
        vendorSku: vendorProduct?.preferredSku || item?.matchedSku || "",
        vendorProductName: vendorProduct?.productName || snapshotItem.name,
        estimatedCost: item?.excludeFromInventoryValue ? 0 : orderUnits * unitCost,
        unitCost: item?.excludeFromInventoryValue ? 0 : unitCost,
        hasKnownPrice: Boolean(item?.excludeFromInventoryValue) || unitCost > 0,
        onHand: toNumber(snapshotItem.onHandDisplay),
        par: toNumber(snapshotItem.parDisplay),
        hasCurrentCount: true,
        orderHoldReason: "",
      };
    });
}

function getCurrentMondayKegPlanSnapshot(now = new Date()) {
  return getCurrentMondayInventorySnapshot(inventoryHistory, now)?.kegPlanSnapshot || null;
}

function getWeeklyPlanRecommendations() {
  const frozenKegPlan = getCurrentMondayKegPlanSnapshot();
  const sourceItems = Array.isArray(frozenKegPlan?.items) ? frozenKegPlan.items : [];
  return sourceItems.map((item) => {
    if (item.isLiquorTap) {
      const orderProductName = normalizeIngredientAlias(
        normalizeLiquorTapProductName(item.orderProductName || item.name),
      );
      const ingredientId = slugify(orderProductName);
      const inventoryItem = inventoryItems.find((candidate) => (
        normalizeIngredientAlias(candidate.name) === orderProductName
      ));
      const vendorMapping = getVendorMapping(ingredientId);
      const unitCost = toNumber(priceOverrides[ingredientId]?.bottlePrice)
        || toNumber(inventoryItem?.unitCost);
      return {
        ...item,
        internalId: ingredientId,
        orderProductName,
        vendor: vendorMapping?.vendor || inventoryItem?.vendorProduct?.vendor || "OHLQ",
        vendorSku: vendorMapping?.preferredSku || inventoryItem?.vendorProduct?.preferredSku || inventoryItem?.matchedSku || "",
        vendorProductName: vendorMapping?.productName || inventoryItem?.vendorProduct?.productName || orderProductName,
        unitCost,
      };
    }
    if (!item.isKegTap || item.actionType !== "order") return item;
    const pricingItem = getKegPricingItem(item.orderProductName || item.name);
    const vendorCatalogProduct = getKegVendorCatalogProduct(
      pricingItem?.id,
      pricingItem?.name,
      item.orderProductName,
      item.name,
    );
    const unitCost = vendorCatalogProduct?.currentPrice ?? (pricingItem ? getKegPrice(pricingItem) : 0);
    return {
      ...item,
      internalId: pricingItem?.id || item.key,
      vendor: vendorCatalogProduct?.vendor || pricingItem?.vendor || "",
      vendorSku: vendorCatalogProduct?.vendorSku || pricingItem?.vendorProduct?.preferredSku || pricingItem?.preferredSku || "",
      vendorProductName: vendorCatalogProduct?.productName || pricingItem?.vendorProduct?.productName || pricingItem?.name || item.orderProductName || item.name,
      unitCost,
      vendorListPrice: vendorCatalogProduct?.listPrice ?? unitCost,
      vendorPriceCheckedAt: vendorCatalogProduct?.priceCheckedAt || "",
      vendorPromotion: Boolean(vendorCatalogProduct?.promotion),
    };
  });
}

function hasPublishedWeeklyPlanRecommendations(now = new Date()) {
  return Boolean(parAgentState?.recommendations?.generatedAt)
    && isRecommendationForOperatingWeek(parAgentState.recommendations.generatedAt, now);
}

function getWeeklyPlanModel() {
  const snapshot = getCurrentWeeklyPlanSnapshot(parAgentState?.recommendations, new Date());
  const plan = snapshot
    ? hydrateWeeklyPlanLiquorTapPricing(snapshot.plan)
    : buildWeeklyActionPlan({
      inventoryItems: getWeeklyPlanInventoryItems(),
      recommendations: getWeeklyPlanRecommendations(),
    });
  return refreshWeeklyPlanMetadata(plan, {
    resolveBeerOrder: (item) => {
      const pricingKey = getKegPricingKey(item.name);
      const pricingItem = getKegPricingItem(item.name);
      const vendor = pricingItem?.vendor || KEG_VENDOR_MAPPINGS[pricingKey] || "";
      const unitCost = pricingItem
        ? getKegPrice(pricingItem)
        : toNumber(kegPriceOverrides[pricingKey]?.kegPrice);
      if (!vendor && !unitCost) return null;
      return {
        vendor,
        vendorSku: pricingItem?.vendorProduct?.preferredSku || pricingItem?.preferredSku || item.vendorSku,
        vendorProductName: pricingItem?.vendorProduct?.productName || pricingItem?.name || item.vendorProductName,
        unitCost,
      };
    },
    excludeInventoryReview: (item) => {
      if (isFoodDepartmentOrderedInventoryItem(item.name)) return true;
      const currentItem = inventoryItems.find((candidate) => candidate.id === item.id)
        || inventoryItems.find((candidate) => candidate.name === item.name);
      return Boolean(currentItem) && toNumber(currentItem.parDisplay) <= 0;
    },
  });
}

function hydrateWeeklyPlanLiquorTapPricing(plan) {
  const liquorTapBottles = plan?.orders?.liquorTapBottles || [];
  let resolvedMissingPriceCount = 0;
  const pricedLiquorTapBottles = liquorTapBottles.map((item) => {
    if (item.hasKnownPrice !== false && toNumber(item.estimatedCost) > 0) return item;
    const ingredientId = slugify(normalizeIngredientAlias(item.name));
    const unitCost = toNumber(priceOverrides[ingredientId]?.bottlePrice);
    if (!unitCost) return item;
    if (item.hasKnownPrice === false) resolvedMissingPriceCount += 1;
    return {
      ...item,
      vendor: item.vendor || getVendorMapping(ingredientId)?.vendor || "OHLQ",
      unitCost,
      estimatedCost: toNumber(item.quantity) * unitCost,
      hasKnownPrice: true,
    };
  });
  if (!resolvedMissingPriceCount) return plan;
  const priorLiquorTapCost = toNumber(plan.summary.estimatedLiquorTapCost);
  const estimatedLiquorTapCost = pricedLiquorTapBottles
    .reduce((total, item) => total + toNumber(item.estimatedCost), 0);
  const missingPriceCount = Math.max(
    0,
    toNumber(plan.summary.missingPriceCount) - resolvedMissingPriceCount,
  );
  return {
    ...plan,
    orders: { ...plan.orders, liquorTapBottles: pricedLiquorTapBottles },
    summary: {
      ...plan.summary,
      estimatedLiquorTapCost,
      estimatedKnownPurchaseCost: toNumber(plan.summary.estimatedKnownPurchaseCost)
        + estimatedLiquorTapCost
        - priorLiquorTapCost,
      missingPriceCount,
      estimatedPurchaseCostComplete: missingPriceCount === 0,
    },
  };
}

async function publishCurrentWeeklyPlanSnapshot() {
  const mondaySnapshot = getCurrentMondayInventorySnapshot(inventoryHistory, new Date());
  if (!mondaySnapshot?.kegPlanSnapshot || !parAgentState?.initialized) return false;
  try {
    const recommendationPricing = getWeeklyPlanRecommendations().map((item) => ({
      key: item.key,
      vendor: item.vendor,
      vendorSku: item.vendorSku,
      vendorProductName: item.vendorProductName,
      unitCost: item.unitCost,
    }));
    const result = await requestParAgentState({
      action: "publish-weekly-plan",
      expectedRevision: parAgentState.revision,
      inventoryItems: getWeeklyPlanInventoryItems(),
      recommendationPricing,
      kegPlanSnapshot: mondaySnapshot.kegPlanSnapshot,
    });
    applyParAgentState(result);
    await loadWeeklyOrderTracking();
    await loadDashboardStaffPrepPlan();
    return Boolean(getCurrentWeeklyPlanSnapshot(parAgentState?.recommendations));
  } catch (error) {
    weeklyPlanRefreshMessage = error?.message || "The Monday plan could not be locked for the week.";
    return false;
  }
}

function normalizeWeeklyOrderTracking(result = {}) {
  return {
    available: result?.available === true,
    generatedAt: clean(result?.generatedAt),
    drafts: Array.isArray(result?.drafts) ? result.drafts : [],
    vendors: Array.isArray(result?.vendors) ? result.vendors : [],
    itemCount: toNumber(result?.itemCount),
    receivedCount: toNumber(result?.receivedCount),
    notReceivedCount: toNumber(result?.notReceivedCount),
    notReceivedItems: Array.isArray(result?.notReceivedItems) ? result.notReceivedItems : [],
    stateRevision: toNumber(result?.stateRevision),
    message: clean(result?.message),
  };
}

async function loadWeeklyOrderTracking() {
  try {
    const response = await fetch("/api/weekly-order-tracking", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "Weekly order tracking could not be loaded.");
    weeklyOrderTracking = normalizeWeeklyOrderTracking(result);
    if (parAgentState && weeklyOrderTracking.stateRevision > toNumber(parAgentState.revision)) {
      parAgentState.revision = weeklyOrderTracking.stateRevision;
      if (parAgentState.recommendations) {
        parAgentState.recommendations.publishedStateRevision = weeklyOrderTracking.stateRevision;
      }
    }
    weeklyOrderTrackingMessage = weeklyOrderTracking.message;
  } catch (error) {
    weeklyOrderTracking = normalizeWeeklyOrderTracking();
    weeklyOrderTrackingMessage = error?.message || "Weekly order tracking could not be loaded.";
  }
}

async function refreshWeeklyOrderTracking() {
  if (weeklyOrderTrackingRefreshRunning || isEmployeeDashboard) return;
  weeklyOrderTrackingRefreshRunning = true;
  try {
    await loadWeeklyOrderTracking();
    renderWeeklyPlan();
    renderDashboardOverview();
  } finally {
    weeklyOrderTrackingRefreshRunning = false;
  }
}

function normalizeDashboardStaffPrepPlan(result = {}) {
  return {
    available: result?.available === true,
    generatedAt: clean(result?.generatedAt),
    items: Array.isArray(result?.items) ? result.items : [],
    completedCount: toNumber(result?.completedCount),
    totalCount: toNumber(result?.totalCount),
  };
}

async function loadDashboardStaffPrepPlan() {
  try {
    const response = await fetch("/api/staff-prep-plan", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "Cocktail prep history could not be loaded.");
    dashboardStaffPrepPlan = normalizeDashboardStaffPrepPlan(result);
    return true;
  } catch {
    return false;
  }
}

async function refreshDashboardStaffPrepPlan() {
  if (dashboardStaffPrepRefreshRunning || isEmployeeDashboard) return;
  dashboardStaffPrepRefreshRunning = true;
  try {
    const refreshed = await loadDashboardStaffPrepPlan();
    if (refreshed) renderDashboardOverview();
  } finally {
    dashboardStaffPrepRefreshRunning = false;
  }
}

async function saveWeeklyOrderPlaced(vendorId, ordered, orderedBy) {
  weeklyOrderTrackingMessage = "Saving who placed the order...";
  try {
    const response = await fetch("/api/weekly-order-tracking", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set-ordered",
        generatedAt: weeklyOrderTracking.generatedAt,
        vendorId,
        ordered,
        orderedBy,
      }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "The ordered-by update could not be saved.");
    weeklyOrderTracking = normalizeWeeklyOrderTracking(result);
    weeklyOrderTrackingMessage = "Ordered-by confirmation saved.";
    await loadParAgentState();
  } catch (error) {
    weeklyOrderTrackingMessage = error?.message || "The ordered-by update could not be saved.";
  }
  renderWeeklyPlan();
  renderDashboardOverview();
}

async function saveVendorOrderDraftAction(payload) {
  weeklyOrderTrackingMessage = payload.action === "approve-draft" ? "Approving vendor draft..." : "Saving vendor draft...";
  try {
    const response = await fetch("/api/weekly-order-tracking", {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ generatedAt: weeklyOrderTracking.generatedAt, ...payload }),
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "The vendor draft could not be saved.");
    weeklyOrderTracking = normalizeWeeklyOrderTracking(result);
    weeklyOrderTrackingMessage = payload.action === "approve-draft"
      ? "Vendor draft approved. Real vendor submission remains disabled."
      : "Vendor draft saved for review.";
    await loadParAgentState();
  } catch (error) {
    weeklyOrderTrackingMessage = error?.message || "The vendor draft could not be saved.";
  }
  renderWeeklyPlan();
  renderDashboardOverview();
}

function getWeeklyPlanTapContext(item, unit, { compact = false } = {}) {
  const taps = item.tapNumbers.length
    ? `Tap${item.tapNumbers.length === 1 ? "" : "s"} ${item.tapNumbers.map(formatNumber).join(", ")}`
    : "Tap assignment unavailable";
  const walls = item.walls.length ? ` · ${item.walls.join(", ")}` : "";
  if (compact) return `${taps}${walls}`;
  if (unit === "oz") {
    return `${taps}${walls} · ${formatNumber(item.currentStockOunces)} oz current · ${formatNumber(item.avgWeeklyOunces)} oz avg/week`;
  }
  return `${taps}${walls} · ${formatNumber(item.currentStockKegs)} kegs in stock · ${formatNumber(item.avgWeeklyKegs)} avg/week`;
}

function renderWeeklyPlanInventoryRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">No active order lines in this section.</p>';
  return `<div class="weekly-plan-list">${items.map((item) => {
    const quantity = item.casePackaged
      ? `${formatNumber(item.caseCount)} case${item.caseCount === 1 ? "" : "s"} · ${formatNumber(item.quantity)} units`
      : `${formatNumber(item.quantity)} unit${item.quantity === 1 ? "" : "s"}`;
    const details = [
      item.vendor,
      `${formatNumber(item.onHand)} on hand / ${formatNumber(item.par)} par`,
      item.estimatedCost > 0 ? `${money(item.estimatedCost)} estimated` : "Price needed",
    ].filter(Boolean).join(" · ");
    return `
      <div class="weekly-plan-item">
        <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(details)}</span></div>
        <b>${escapeHtml(quantity)}</b>
      </div>
    `;
  }).join("")}</div>`;
}

function renderWeeklyPlanTapRows(items, { action, unit = "kegs" } = {}) {
  if (!items.length) return `<p class="weekly-plan-empty">No active lines to ${escapeHtml(action.toLowerCase())} in this section.</p>`;
  return `<div class="weekly-plan-list">${items.map((item) => `
    <div class="weekly-plan-item">
      <div>
        <strong>${escapeHtml(getCanonicalProductDisplayName(item.name))}</strong>
        <span>${escapeHtml(getWeeklyPlanTapContext(item, unit === "refills" ? "oz" : "kegs", { compact: true }))}</span>
      </div>
      <b>${escapeHtml(action)} ${formatNumber(item.quantity)} ${escapeHtml(unit === "refills" ? `refill${item.quantity === 1 ? "" : "s"}` : `keg${item.quantity === 1 ? "" : "s"}`)}</b>
    </div>
  `).join("")}</div>`;
}

function renderWeeklyPlanCocktailRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">None this week.</p>';
  const orderedItems = [...items].sort((a, b) => (
    toNumber(a.tapNumbers?.[0]) - toNumber(b.tapNumbers?.[0])
    || clean(a.name).localeCompare(clean(b.name))
  ));
  return `<div class="weekly-plan-list weekly-plan-label-list">${orderedItems.map((item) => {
    const wall = clean(item.walls?.[0]);
    const details = [
      wall ? `${wall} wall` : "Wall unavailable",
      toNumber(item.batchSizeOz) > 0 ? `${formatNumber(item.batchSizeOz)} oz` : "Batch ounces unavailable",
    ].join(" · ");
    return `
      <div class="weekly-plan-item weekly-plan-label-item">
        <div>
          <strong>${escapeHtml(getCocktailPrepDisplayName(getCanonicalProductDisplayName(item.name), wall))}</strong>
          <span>${escapeHtml(details)}</span>
        </div>
        <b>${formatNumber(item.quantity)} label${item.quantity === 1 ? "" : "s"}</b>
      </div>
    `;
  }).join("")}</div>`;
}

function renderWeeklyPlanLiquorTapRows(items) {
  if (!items.length) return '<p class="weekly-plan-empty">No liquor-tap bottle orders this week.</p>';
  return `<div class="weekly-plan-list">${items.map((item) => `
    <div class="weekly-plan-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(getWeeklyPlanTapContext(item, "oz", { compact: true }))}${item.vendor ? ` · ${escapeHtml(item.vendor)}` : ""}${item.hasKnownPrice === false ? " · Price needed" : ""}</span>
      </div>
      <b>Order ${formatNumber(item.quantity)} bottle${item.quantity === 1 ? "" : "s"}</b>
    </div>
  `).join("")}</div>`;
}

function renderWeeklyPlanGroup(title, count, content, accent = "") {
  return `
    <section class="weekly-plan-group ${accent ? `weekly-plan-group--${accent}` : ""}">
      <div class="weekly-plan-group__header"><h3>${escapeHtml(title)}</h3><strong>${formatNumber(count)}</strong></div>
      ${content}
    </section>
  `;
}

function getLatestPriceTimestamp() {
  return [...Object.values(priceOverrides), ...Object.values(kegPriceOverrides)]
    .map((entry) => clean(entry?.updatedAt))
    .map((value) => {
      const embeddedDate = value.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
      const time = new Date(embeddedDate || value).getTime();
      return Number.isFinite(time) ? time : 0;
    })
    .reduce((latest, time) => Math.max(latest, time), 0);
}

function getWeeklyPlanMissingInventoryCount() {
  if (getCurrentMondayInventorySnapshot(inventoryHistory, new Date())) return 0;
  return inventoryItems.filter((item) => (
    toNumber(item.parDisplay) > 0
    && !Object.prototype.hasOwnProperty.call(inventoryOnHandOverrides, item.id)
  )).length;
}

function getWeeklyPlanFreshness(plan) {
  const latestCompletedWeek = getCompletedMondayWeekStarts(1)[0] || null;
  const latestCompletedTime = latestCompletedWeek?.getTime() || 0;
  const latestCompletedUsageRowCount = latestCompletedTime
    ? weeklyUsageItems.filter((item) => (
      (item.history || []).some((entry) => getWeeklyUsageLabelTime(entry.label) === latestCompletedTime)
    )).length
    : 0;
  const requiredUsageRows = Math.max(1, weeklyUsageItems.length);
  const latestCompletedUsageSaved = latestCompletedTime > 0 && hasCompleteWeeklyUsageRows(
    weeklyUsageItems,
    (item) => (item.history || []).some((entry) => getWeeklyUsageLabelTime(entry.label) === latestCompletedTime),
  );
  const mondayKegPlan = getCurrentMondayKegPlanSnapshot();
  const lockedSnapshot = Boolean(getCurrentWeeklyPlanSnapshot(parAgentState?.recommendations, new Date()));
  const recommendationSummary = lockedSnapshot
    ? parAgentState?.recommendations?.summary || {}
    : mondayKegPlan?.summary || {};
  const inventorySnapshotCurrent = Boolean(mondayKegPlan);
  const readiness = evaluateWeeklyPlanReadiness({
    parInitialized: Boolean(parAgentState?.initialized),
    recommendationGeneratedAt: lockedSnapshot
      ? parAgentState?.recommendations?.generatedAt
      : mondayKegPlan?.generatedAt,
    recommendationError: lockedSnapshot ? "" : parAgentError || (parAgentStateOutbox ? "Keg Levels has an unsynced recovery operation." : ""),
    recommendationInventoryMissing: Boolean(recommendationSummary.inventoryStateMissing),
    recommendationSourceCurrent: lockedSnapshot || Boolean(mondayKegPlan),
    parInputsChangedAt: lockedSnapshot ? "" : parAgentInputsChangedAt,
    weeklyUsageInitialized: weeklyUsageSharedInitialized,
    weeklyUsageSavePending: lockedSnapshot ? false : weeklyUsageSharedSaving || weeklyUsageSharedPendingWrites > 0 || Boolean(weeklyUsageSharedSaveTimer) || Boolean(weeklyUsageSharedOutbox),
    weeklyUsageSaveError: lockedSnapshot ? "" : weeklyUsageSharedSaveError || (!weeklyUsageSharedOutboxDurable ? "Pending Weekly Usage could not be stored durably in this browser." : ""),
    latestCompletedUsageSaved: lockedSnapshot ? true : latestCompletedUsageSaved,
    weeklyUsageLastSyncAt: mondayKegPlan?.generatedAt || weeklyUsageLastSyncAt,
    inventoryInitialized: inventorySharedInitialized,
    inventorySnapshotCurrent: lockedSnapshot || inventorySnapshotCurrent,
    inventorySavePending: lockedSnapshot ? false : inventorySharedSaving || inventoryFieldSyncPendingCount > 0 || inventoryFieldSyncTimers.size > 0 || Object.keys(inventoryFieldOutbox).length > 0 || inventoryActionOutbox.length > 0,
    inventorySaveError: lockedSnapshot ? "" : inventorySharedSaveError || (!inventoryFieldOutboxDurable || !inventoryActionOutboxDurable ? "Pending Inventory changes could not be stored durably in this browser." : ""),
    missingInventoryCount: lockedSnapshot ? 0 : getWeeklyPlanMissingInventoryCount(),
    heldLineCount: plan.summary.heldLineCount,
    excludedLineCount: plan.summary.excludedLineCount,
    missingPriceCount: plan.summary.missingPriceCount,
    lockedForWeek: lockedSnapshot,
  });
  return {
    latestCompletedWeek,
    latestCompletedUsageSaved,
    latestCompletedUsageRowCount,
    requiredUsageRows,
    lockedSnapshot,
    readiness,
  };
}

function getDashboardSharedOverviewSource() {
  return {
    available: dashboardSharedProvisioned,
    provisioned: dashboardSharedProvisioned,
    initialized: Boolean(dashboardSharedState.initialized),
    savePending: ["loading", "importing", "saving"].includes(dashboardSharedSyncStatus)
      || dashboardSharedPendingSlices.size > 0
      || getDashboardSharedOutboxPaths().length > 0,
    saveError: ["conflict", "offline"].includes(dashboardSharedSyncStatus)
      ? dashboardSharedSyncMessage
      : "",
    unsavedCount: getDashboardSharedOutboxPaths().length,
    durable: dashboardSharedOutboxDurable && dashboardSharedLocalCacheDurable,
    setupMessage: dashboardSharedState.initialized ? "" : dashboardSharedSyncMessage,
    setupActionAvailable: dashboardSharedSyncStatus === "setup",
  };
}

function getInventorySharedOverviewSource() {
  const unsavedCount = inventoryFieldSyncPendingCount
    + inventoryFieldSyncTimers.size
    + Object.keys(inventoryFieldOutbox).length
    + inventoryActionOutbox.length;
  return {
    available: inventorySharedProvisioned,
    provisioned: inventorySharedProvisioned,
    initialized: inventorySharedInitialized,
    savePending: inventorySharedSaving || unsavedCount > 0,
    saveError: inventorySharedSaveError,
    unsavedCount,
    durable: inventoryFieldOutboxDurable && inventoryActionOutboxDurable,
  };
}

function getWeeklyUsageSharedOverviewSource() {
  const unsavedCount = weeklyUsageSharedPendingWrites
    + Number(Boolean(weeklyUsageSharedSaveTimer))
    + Number(Boolean(weeklyUsageSharedOutbox));
  return {
    available: weeklyUsageSharedProvisioned,
    provisioned: weeklyUsageSharedProvisioned,
    initialized: weeklyUsageSharedInitialized,
    savePending: weeklyUsageSharedSaving || unsavedCount > 0,
    saveError: weeklyUsageSharedSaveError,
    unsavedCount,
    durable: weeklyUsageSharedOutboxDurable,
  };
}

function getKegLevelsSharedOverviewSource() {
  return {
    available: Boolean(parAgentState),
    provisioned: Boolean(parAgentState),
    initialized: Boolean(parAgentState?.initialized),
    savePending: Boolean(parAgentStateSyncTimer || parAgentStateOutbox),
    // Recommendation refresh errors are shown by the Weekly Plan itself. Only
    // report a shared-save error here when a recovery copy is actually waiting
    // to be published; otherwise one failed refresh is mislabeled as lost data.
    saveError: parAgentStateOutbox ? parAgentError : "",
    hasOutbox: Boolean(parAgentStateOutbox),
    durable: parAgentStateOutboxDurable,
  };
}

function getPmbKegLevelOverviewFeed() {
  const expectedCount = kegWallItems.length;
  const capturedCount = kegWallItems.filter((item) => getKegLiveRow(item)).length;
  const status = kegSyncLoading
    ? "loading"
    : kegLiveLevelsStale
      ? "offline"
    : kegUpdatedAt
      ? capturedCount < expectedCount
        ? "partial"
        : "online"
      : kegSyncAttempted
        ? "offline"
        : "not-checked";
  return {
    status,
    capturedCount,
    expectedCount: status === "not-checked" ? 0 : expectedCount,
    updatedAt: kegUpdatedAt,
    error: !kegUpdatedAt && kegSyncAttempted ? kegSyncMessage : "",
  };
}

function getPmbPricingOverviewFeed() {
  const expectedCount = kegWallItems.length || liveTapPriceItems.length;
  const capturedCount = liveTapPriceItems.length;
  const status = tapPricingSyncLoading
    ? "loading"
    : liveTapPricingUpdatedAt
      ? expectedCount > 0 && capturedCount < expectedCount
        ? "partial"
        : "online"
      : tapPricingSyncAttempted
        ? "offline"
        : "not-checked";
  return {
    status,
    capturedCount,
    expectedCount: status === "not-checked" ? 0 : expectedCount,
    updatedAt: liveTapPricingUpdatedAt,
    error: !liveTapPricingUpdatedAt && tapPricingSyncAttempted ? liveTapPricingMessage : "",
  };
}

function renderDashboardAlert(alert) {
  const details = alert.details || [];
  return `
    <article class="dashboard-alert dashboard-alert--${escapeHtml(alert.severity)}">
      <div class="dashboard-alert__marker" aria-hidden="true"></div>
      <div class="dashboard-alert__copy">
        <span>${escapeHtml(alert.severity === "critical" ? "Action required" : alert.severity === "warning" ? "Review" : "Good to know")}</span>
        <h3>${escapeHtml(alert.title)}</h3>
        <p>${escapeHtml(alert.message)}</p>
        ${details.length ? `<details><summary>See ${formatNumber(details.length)} detail${details.length === 1 ? "" : "s"}</summary><ul>${details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul></details>` : ""}
      </div>
      ${alert.action ? `<button class="dashboard-overview-link" type="button" data-dashboard-target="${escapeHtml(alert.action.target)}">${escapeHtml(alert.action.label)} <span aria-hidden="true">→</span></button>` : ""}
    </article>
  `;
}

function getDashboardCompletedPrepItems() {
  if (!dashboardStaffPrepPlan.available) return [];
  return dashboardStaffPrepPlan.items
    .filter((item) => item?.completed === true && clean(item?.preparedBy) && clean(item?.completedAt))
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
}

function formatDashboardPrepTime(value) {
  const completedAt = new Date(value);
  if (Number.isNaN(completedAt.getTime())) return "Time unavailable";
  return completedAt.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderDashboardCompletedPrep() {
  const completedItems = getDashboardCompletedPrepItems();
  if (!completedItems.length) return "";
  return `
    <section class="dashboard-prepped" aria-labelledby="dashboard-prepped-title">
      <div class="dashboard-section-heading">
        <h2 id="dashboard-prepped-title">Cocktails Prepped</h2>
        <span>${formatNumber(completedItems.length)} done</span>
      </div>
      <div class="dashboard-prepped-list">
        ${completedItems.map((item) => {
          const wall = clean(item.wall || item.walls?.[0]);
          return `
            <article class="dashboard-prepped-item">
              <span class="dashboard-prepped-check" aria-hidden="true">✓</span>
              <div>
                <strong>${escapeHtml(item.displayName || item.name)}</strong>
                <small>${wall ? `${escapeHtml(wall)} wall · ` : ""}Prepped by ${escapeHtml(item.preparedBy)}</small>
              </div>
              <time datetime="${escapeHtml(item.completedAt)}">${escapeHtml(formatDashboardPrepTime(item.completedAt))}</time>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderDashboardOverview() {
  if (!dashboardOverview || isEmployeeDashboard) return;
  const plan = getWeeklyPlanModel();
  const freshness = getWeeklyPlanFreshness(plan);
  const usagePerformance = buildWeeklyUsagePerformance(weeklyUsageItems, {
    category: "all",
    getFullOunces: getWeeklyUsageFullOunces,
    limit: 10,
  });
  const pricingAdvisor = buildPricingAdvisor(
    getLiveTapPricingRows("").map(buildPricingAdvisorInput).filter((item) => isPricingAdvisorEligibleKind(item.kind)),
  );
  const recipeCoverage = getWallCocktailRecipeCoverage();
  const overview = buildDashboardOverview({
    weeklyPlan: {
      readiness: freshness.readiness,
      generatedAt: parAgentState?.recommendations?.generatedAt,
      lockedForWeek: hasPublishedWeeklyPlanRecommendations(),
      summary: plan.summary,
    },
    shared: {
      dashboard: getDashboardSharedOverviewSource(),
      inventory: getInventorySharedOverviewSource(),
      weeklyUsage: getWeeklyUsageSharedOverviewSource(),
      kegLevels: getKegLevelsSharedOverviewSource(),
    },
    pmb: {
      kegLevels: getPmbKegLevelOverviewFeed(),
      pricing: getPmbPricingOverviewFeed(),
    },
    usage: {
      initialized: weeklyUsageSharedInitialized,
      lastSyncAt: weeklyUsageLastSyncAt,
      performance: usagePerformance,
    },
    pricing: {
      targetMarginPercent: DEFAULT_BEER_TARGET_MARGIN,
      advisorSummary: pricingAdvisor.summary,
    },
    inventory: { missingCurrentCount: getWeeklyPlanMissingInventoryCount() },
    orders: { notReceivedItems: weeklyOrderTracking.notReceivedItems },
    recipes: { missingRecipeCount: recipeCoverage.missing.length },
    deferred: { cocktailIngredientNetting: true },
  }, { now: new Date() });
  const leadingAlerts = overview.alerts.slice(0, 6);

  dashboardOverview.innerHTML = `
    <header class="dashboard-overview-hero dashboard-overview-hero--${escapeHtml(overview.status)}">
      <div class="dashboard-overview-hero__copy">
        <h2>This week</h2>
        <div class="dashboard-overview-status">
          <span>${escapeHtml(overview.statusLabel)}</span>
          <strong>${formatNumber(overview.alertCounts.critical)} urgent · ${formatNumber(overview.alertCounts.warning)} to review</strong>
        </div>
      </div>
      <div class="dashboard-overview-hero__actions">
        <button class="primary-button" type="button" data-dashboard-target="weekly-plan">Open Weekly Plan</button>
        <button class="ghost-button" type="button" data-dashboard-target="keg-levels">Check Keg Levels</button>
      </div>
    </header>

    <section class="dashboard-kpi-grid" aria-label="Weekly operations summary">
      ${overview.kpis.map((kpi) => {
        const showDetail = kpi.confidence !== "verified" || ["items-to-order", "usage-coverage"].includes(kpi.id);
        return `
          <button class="dashboard-kpi dashboard-kpi--${escapeHtml(kpi.tone)}" type="button" data-dashboard-target="${escapeHtml(kpi.target)}">
            <span>${escapeHtml(kpi.label)}</span>
            <strong>${escapeHtml(kpi.value)}</strong>
            ${showDetail ? `<small>${escapeHtml(kpi.detail)}</small>` : ""}
            ${kpi.confidence === "verified" ? "" : `<em>${kpi.confidence === "partial" ? "Partial" : "Needs current data"}</em>`}
          </button>
        `;
      }).join("")}
    </section>

    ${renderDashboardCompletedPrep()}

    <section class="dashboard-overview-alerts" aria-labelledby="dashboard-alerts-title">
        <div class="dashboard-section-heading">
          <h2 id="dashboard-alerts-title">Alerts &amp; follow-ups</h2>
          <span>${formatNumber(overview.alerts.length)} total</span>
        </div>
        <div class="dashboard-alert-list">
          ${leadingAlerts.length ? leadingAlerts.map(renderDashboardAlert).join("") : '<div class="dashboard-overview-empty"><strong>No current alerts</strong></div>'}
        </div>
        ${overview.alerts.length > leadingAlerts.length ? `<p class="dashboard-alert-more">${formatNumber(overview.alerts.length - leadingAlerts.length)} additional informational notice${overview.alerts.length - leadingAlerts.length === 1 ? "" : "s"} are available in the linked workspaces.</p>` : ""}
    </section>

    <section class="dashboard-beverage-pulse" id="dashboard-beverage-pulse" aria-labelledby="dashboard-beverage-pulse-title"></section>
  `;
  renderDashboardBeveragePulse();
}

function getWeeklyUsageLivePrice(item) {
  const tapNumber = toNumber(item?.tapNumber);
  const plu = toNumber(item?.plu);
  if (!tapNumber || !plu) return null;

  const matches = liveTapPriceItems.filter((livePrice) => {
    if (livePrice?.isCurrentTap !== true || clean(livePrice?.tapMatchSource) !== "pmb-tap-config") return false;
    if (toNumber(livePrice?.plu) !== plu) return false;
    const assignments = Array.isArray(livePrice.assignments) ? livePrice.assignments : [];
    return assignments.some((assignment) => toNumber(assignment?.tapNumber) === tapNumber);
  });
  return matches.length === 1 ? matches[0] : null;
}

function getWeeklyUsageItemSellingRate(item) {
  const livePrice = getWeeklyUsageLivePrice(item);
  if (!livePrice) {
    return { sellingPricePerOz: null, reason: "Refresh PMB prices to verify this exact physical tap." };
  }
  const category = getWeeklyUsagePerformanceCategory(item);
  const sellingPricePerOz = category === "liquor"
    ? getPricingAdvisorCurrentPrice(livePrice)
    : toNumber(livePrice.chargePerOz);
  return sellingPricePerOz > 0
    ? { sellingPricePerOz }
    : { sellingPricePerOz: null, reason: "A current PMB selling price is unavailable." };
}

function getWeeklyUsageItemProfitRate(item) {
  const tapNumber = toNumber(item?.tapNumber);
  const plu = toNumber(item?.plu);
  if (!tapNumber || !plu) {
    return { grossProfitPerOz: null, reason: "Exact PMB tap and PLU identity are required." };
  }
  const livePrice = getWeeklyUsageLivePrice(item);
  if (!livePrice) {
    return { grossProfitPerOz: null, reason: "Refresh PMB prices to verify this exact physical tap." };
  }
  const category = getWeeklyUsagePerformanceCategory(item);

  if (category === "beer") {
    const kegMatches = kegPricingItems.filter((kegItem) => (
      getKegPricingKey(kegItem?.name) === getKegPricingKey(livePrice.name)
    ));
    const sellingPrice = toNumber(livePrice.chargePerOz);
    const costPerOz = kegMatches.length === 1 ? getKegCatalogUnitCost(kegMatches[0]) : 0;
    if (!sellingPrice || !costPerOz) {
      return { grossProfitPerOz: null, reason: "Verified live beer price and keg cost are required." };
    }
    return sellingPrice - costPerOz;
  }

  if (category === "cocktail") {
    const liveAliases = getTapPriceAliases(livePrice.name);
    const recipeMatches = getActiveRecipes().filter((recipe) => (
      liveAliases.some((alias) => getTapPriceAliases(recipe.title).includes(alias))
    ));
    const recipe = recipeMatches.length === 1 ? recipeMatches[0] : null;
    const sellingPrice = toNumber(livePrice.chargePerOz);
    const missingCost = recipe?.ingredients?.some((ingredient) => (
      toNumber(ingredient.oz) > 0
      && normalizeIngredientAlias(ingredient.name).toLowerCase() !== "water"
      && !(getIngredientCost(ingredient).cost > 0)
    ));
    const costPerOz = recipe && !missingCost ? getRecipeTotals(recipe).costPerOz : 0;
    if (!sellingPrice || !costPerOz) {
      return { grossProfitPerOz: null, reason: "Verified live cocktail price and complete recipe cost are required." };
    }
    return sellingPrice - costPerOz;
  }

  const ingredient = getIngredientForLiveTapPrice(livePrice);
  const costPerOz = ingredient ? getCatalogUnitCost(ingredient) : 0;
  const portions = getLiveTapPortions(livePrice);
  if (!costPerOz || portions.length !== 2 || portions.some((portion) => (
    !(toNumber(portion.price) > 0) || !(toNumber(portion.quantityOz) > 0)
  ))) {
    return {
      grossProfitPerOz: null,
      reason: "Liquor profit needs two verified PMB portion quantities and a mapped bottle cost.",
    };
  }
  const sellingRates = portions.map((portion) => toNumber(portion.price) / toNumber(portion.quantityOz));
  if (Math.abs(sellingRates[0] - sellingRates[1]) > 0.0001) {
    return {
      grossProfitPerOz: null,
      reason: "Single and Double portions have different per-ounce prices, and PMB usage does not include the portion mix.",
    };
  }
  return sellingRates[0] - costPerOz;
}

function renderSellerRankingList(rows, metric, emptyMessage = "There is not enough saved PMB history for a seller list yet.") {
  if (!rows.length) {
    return `<p class="onpar-ranking-empty">${escapeHtml(emptyMessage)}</p>`;
  }
  return `<ol class="onpar-ranking-list">${rows.map((row, index) => {
    const average = metric === "volume" ? toNumber(row.averageWeeklyOz) : toNumber(row.averageWeeklyValue);
    const value = metric === "volume" ? `${formatNumber(average)} oz` : money(average);
    const location = [...(row.walls || []), ...(row.tapNumbers?.length ? [`Tap${row.tapNumbers.length === 1 ? "" : "s"} ${row.tapNumbers.join(", ")}`] : [])].join(" · ");
    return `
      <li>
        <span class="onpar-ranking-list__rank">${index + 1}</span>
        <span class="onpar-ranking-list__product"><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(location || `${row.sampleWeekCount} recorded weeks`)}</small></span>
        <span class="onpar-ranking-list__value">${escapeHtml(value)}</span>
      </li>`;
  }).join("")}</ol>`;
}

function renderSellerRankingPeriod(period, { title, allTime, metric, emptyMessage, listSize }) {
  const periodDescription = period.weekCount
    ? `${formatNumber(period.weekCount)} saved PMB week${period.weekCount === 1 ? "" : "s"}`
    : "No saved PMB weeks";
  return `
    <article class="onpar-insights-period${allTime ? " onpar-insights-period--all-time" : ""}">
      <header class="onpar-insights-period__header">
        <div><p class="eyebrow">${allTime ? "Long view" : "Recent demand"}</p><h3>${escapeHtml(title)}</h3></div>
        <small>${escapeHtml(periodDescription)}</small>
      </header>
      <div class="onpar-insights-period__body">
        <section class="onpar-ranking" aria-label="Top ${formatNumber(listSize)} sellers">
          <div class="onpar-ranking__title"><h4>Top ${formatNumber(listSize)}</h4><span>${metric === "sales" ? "Avg projected sales" : metric === "profit" ? "Avg projected profit" : "Avg poured volume"}</span></div>
          ${renderSellerRankingList(period.top, metric, emptyMessage)}
        </section>
        <section class="onpar-ranking" aria-label="Bottom ${formatNumber(listSize)} sellers">
          <div class="onpar-ranking__title"><h4>Bottom ${formatNumber(listSize)}</h4><span>${metric === "sales" ? "Avg projected sales" : metric === "profit" ? "Avg projected profit" : "Avg poured volume"}</span></div>
          ${renderSellerRankingList(period.bottom, metric, emptyMessage)}
        </section>
      </div>
    </article>`;
}

function renderOhioComplianceAlert() {
  const watch = buildOhioComplianceWatchViewModel(beverageNewsPayload?.complianceWatch, {
    acknowledgedFingerprint: ohioComplianceAcknowledgement.fingerprint,
  });
  if (!watch.isVisible) return "";
  const links = watch.sources.map((source) => `
    <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.source || "Official Ohio source")} ↗</a>
  `).join("");
  return `
    <aside class="ohio-compliance-alert" role="region" aria-labelledby="ohio-compliance-alert-title">
      <span class="ohio-compliance-alert__marker" aria-hidden="true"></span>
      <div class="ohio-compliance-alert__copy">
        <span>Official Ohio change</span>
        <h3 id="ohio-compliance-alert-title">${escapeHtml(watch.alert.title)}</h3>
        <p>${escapeHtml(watch.alert.message)} Review the official pages before making a compliance decision.</p>
      </div>
      <div class="ohio-compliance-alert__actions">${links}<button class="ghost-button" type="button" data-ohio-compliance-reviewed>Mark reviewed</button></div>
    </aside>`;
}

function renderOnParInsights() {
  const container = document.querySelector("#onpar-insights");
  if (!container || isEmployeeDashboard) return;
  const recentWeekLimit = {
    "one-week": 1,
    "four-weeks": 4,
    "six-weeks": 6,
    "eight-weeks": 8,
    "twelve-weeks": 12,
  }[sellerRankingPeriod] || 6;
  const isSalesRanking = sellerRankingMetric === "sales";
  const isProfitRanking = sellerRankingMetric === "profit";
  const isDollarRanking = isSalesRanking || isProfitRanking;
  const rankings = buildWeeklyUsageSellerRankings(
    [...weeklyUsageItems, ...weeklyUsageArchivedItems],
    {
      category: sellerRankingCategory,
      wall: sellerRankingWall,
      metric: isDollarRanking ? "profit" : "volume",
      getFullOunces: getWeeklyUsageFullOunces,
      getGrossProfitPerOz: isSalesRanking ? getWeeklyUsageItemSellingRate : getWeeklyUsageItemProfitRate,
      recentWeekLimit,
      topLimit: sellerRankingListSize,
      bottomLimit: sellerRankingListSize,
    },
  );
  const unavailableExactVolumeSamples = rankings.metricMetadata.unavailableExactVolumeSampleCount;
  const dollarCoverage = isDollarRanking
    ? [
        rankings.metricMetadata.unavailableItemCount
          ? `${formatNumber(rankings.metricMetadata.unavailableItemCount)} product${rankings.metricMetadata.unavailableItemCount === 1 ? "" : "s"} excluded because price, cost, or liquor portion economics could not be verified.`
          : "",
        unavailableExactVolumeSamples
          ? `${formatNumber(unavailableExactVolumeSamples)} saved sample${unavailableExactVolumeSamples === 1 ? "" : "s"} excluded because exact PMB ounces were unavailable.`
          : "",
        !rankings.metricMetadata.unavailableItemCount && !unavailableExactVolumeSamples
          ? isProfitRanking
            ? "All ranked products have verified current prices, costs, and exact PMB ounces."
            : "All ranked products have verified current prices and exact PMB ounces."
          : "",
      ].filter(Boolean).join(" ")
    : "Exact PMB poured ounces; corporate-party pours remain included.";
  const identityCoverage = rankings.quality.unverifiedIdentityItemCount
    ? `${formatNumber(rankings.quality.unverifiedIdentityItemCount)} saved historical ${rankings.quality.unverifiedIdentityItemCount === 1 ? "product was" : "products were"} excluded because ${rankings.quality.unverifiedIdentityItemCount === 1 ? "its" : "their"} wall or drink type could not be verified.`
    : "";
  const emptyMessage = isDollarRanking
    ? isProfitRanking
      ? "No products in this filter have enough exact PMB usage plus verified current pricing and costs."
      : "No products in this filter have enough exact PMB usage and verified current pricing."
    : "No positive PMB poured usage is saved for this filter.";
  const periodRankings = sellerRankingPeriod === "all-time"
      ? rankings.allTime
      : rankings.recent;
  const periodTitle = sellerRankingPeriod === "all-time"
    ? "All saved PMB weeks"
    : recentWeekLimit === 1
      ? "Latest saved week"
      : `Last ${recentWeekLimit} saved weeks`;

  container.innerHTML = `
    <header class="onpar-insights__header">
      <div>
        <h2 id="onpar-insights-title">Performance</h2>
      </div>
      <div class="onpar-insights__controls">
        <label class="select-field"><span>Drinks</span><select data-seller-ranking-category>
          <option value="all"${sellerRankingCategory === "all" ? " selected" : ""}>All beverages</option>
          <option value="beer"${sellerRankingCategory === "beer" ? " selected" : ""}>Beer</option>
          <option value="cocktail"${sellerRankingCategory === "cocktail" ? " selected" : ""}>Cocktails</option>
          <option value="liquor"${sellerRankingCategory === "liquor" ? " selected" : ""}>Liquor</option>
        </select></label>
        <label class="select-field"><span>Wall</span><select data-seller-ranking-wall>
          <option value="main"${sellerRankingWall === "main" ? " selected" : ""}>Main wall</option>
          <option value="karaoke"${sellerRankingWall === "karaoke" ? " selected" : ""}>Karaoke wall</option>
          <option value="patio"${sellerRankingWall === "patio" ? " selected" : ""}>Patio liquor wall</option>
        </select></label>
        <label class="select-field"><span>Show per list</span><select data-seller-ranking-list-size>
          ${[3, 5, 10, 15, 25].map((size) => `<option value="${size}"${sellerRankingListSize === size ? " selected" : ""}>${size} drinks</option>`).join("")}
        </select></label>
        <label class="select-field"><span>Period</span><select data-seller-ranking-period>
          <option value="one-week"${sellerRankingPeriod === "one-week" ? " selected" : ""}>1 week</option>
          <option value="four-weeks"${sellerRankingPeriod === "four-weeks" ? " selected" : ""}>4 weeks</option>
          <option value="six-weeks"${sellerRankingPeriod === "six-weeks" ? " selected" : ""}>6 weeks</option>
          <option value="eight-weeks"${sellerRankingPeriod === "eight-weeks" ? " selected" : ""}>8 weeks</option>
          <option value="twelve-weeks"${sellerRankingPeriod === "twelve-weeks" ? " selected" : ""}>12 weeks</option>
          <option value="all-time"${sellerRankingPeriod === "all-time" ? " selected" : ""}>All time</option>
        </select></label>
        <label class="select-field"><span>Rank by</span><select data-seller-ranking-metric>
          <option value="volume"${sellerRankingMetric === "volume" ? " selected" : ""}>Poured volume</option>
          <option value="sales"${sellerRankingMetric === "sales" ? " selected" : ""}>Projected sales</option>
          <option value="profit"${sellerRankingMetric === "profit" ? " selected" : ""}>Projected profit</option>
        </select></label>
      </div>
    </header>
    <div class="onpar-insights__periods">
      ${renderSellerRankingPeriod(periodRankings, { title: periodTitle, allTime: sellerRankingPeriod === "all-time", metric: sellerRankingMetric, emptyMessage, listSize: sellerRankingListSize })}
    </div>
    <footer class="onpar-insights__footer">
      <span>${escapeHtml([dollarCoverage, identityCoverage].filter(Boolean).join(" "))}</span>
      <span>${isProfitRanking ? "Projected profit uses today’s verified prices and current costs." : isSalesRanking ? "Projected sales use today’s verified PMB prices." : "Averages use only the weeks recorded for each product."}</span>
    </footer>`;
}

function getDashboardPulseWall(item) {
  const tapNumber = toNumber(item?.tapNumber);
  if (tapNumber >= 1 && tapNumber <= 20) return "patio";
  if (tapNumber >= 21 && tapNumber <= 72) return "main";
  if (tapNumber >= 73 && tapNumber <= 102) return "karaoke";
  const wall = clean(item?.wall).toLowerCase();
  return wall === "main bar" ? "main" : wall;
}

function getDashboardPulseMovementCopy(item, direction) {
  if (!item) return "Waiting for another complete PMB week.";
  const magnitude = Math.abs(toNumber(item.changePercent));
  const strength = magnitude >= 30 ? "a lot" : magnitude >= 12 ? "noticeably" : "a little";
  return direction === "up"
    ? `Picked up ${strength} from last week.`
    : `Slowed ${strength} from last week.`;
}

function renderDashboardPulseStory({ tone, symbol, eyebrow, item, copy, emptyCopy }) {
  return `
    <article class="dashboard-pulse-story dashboard-pulse-story--${escapeHtml(tone)}">
      <span class="dashboard-pulse-story__symbol" aria-hidden="true">${escapeHtml(symbol)}</span>
      <p>${escapeHtml(eyebrow)}</p>
      <h3>${escapeHtml(item?.name || emptyCopy)}</h3>
      <small>${escapeHtml(item ? copy : "This insight will appear when enough PMB history is saved.")}</small>
    </article>
  `;
}

function renderDashboardPulseLeaderList(rows, metric, emptyMessage) {
  if (!rows.length) return `<p class="dashboard-pulse-empty">${escapeHtml(emptyMessage)}</p>`;
  const highestValue = Math.max(...rows.map((row) => toNumber(row.value)), 1);
  return `<ol class="dashboard-pulse-bars dashboard-pulse-bars--valued">${rows.map((row, index) => {
    const width = Math.max(12, Math.round((toNumber(row.value) / highestValue) * 100));
    const value = metric === "sales" ? money(row.value) : `${formatNumber(row.value)} oz`;
    return `
      <li style="grid-template-columns: 1fr; gap: 6px;">
        <div><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(value)}</small></div>
        <span class="dashboard-pulse-bar" aria-hidden="true"><i style="--pulse-width: ${width}%"></i></span>
      </li>`;
  }).join("")}</ol>`;
}

function renderDashboardPulseCategoryLeaders({ pourLeaders, wallLabel }) {
  const metric = pourLeaders.metric;
  const metricLabel = metric === "sales" ? "$" : "Oz";
  return `
    <div class="dashboard-pulse-category-leaders">
      <section aria-labelledby="dashboard-pulse-beer-leaders-title">
        <div class="dashboard-pulse-leader-heading"><h3 id="dashboard-pulse-beer-leaders-title">Top beers</h3><small>${metricLabel}</small></div>
        ${renderDashboardPulseLeaderList(pourLeaders.sections.beer.rows, metric, `No beer pours were saved for the ${wallLabel.toLowerCase()} last week.`)}
      </section>
      <section aria-labelledby="dashboard-pulse-cocktail-leaders-title">
        <div class="dashboard-pulse-leader-heading"><h3 id="dashboard-pulse-cocktail-leaders-title">Top cocktails</h3><small>${metricLabel}</small></div>
        ${renderDashboardPulseLeaderList(pourLeaders.sections.cocktail.rows, metric, `No cocktail pours were saved for the ${wallLabel.toLowerCase()} last week.`)}
      </section>
      <section aria-labelledby="dashboard-pulse-liquor-leaders-title">
        <div class="dashboard-pulse-leader-heading"><h3 id="dashboard-pulse-liquor-leaders-title">Top liquor</h3><small>${metricLabel}</small></div>
        ${renderDashboardPulseLeaderList(pourLeaders.sections.liquor.rows, metric, metric === "sales"
          ? "Add current PMB prices to rank liquor."
          : "No liquor pours were saved for the Patio or Karaoke wall last week.")}
      </section>
    </div>
  `;
}

function renderDashboardProjectedSalesMix(mix) {
  if (!mix.available) {
    return `
      <aside class="dashboard-pulse-sales-mix">
        <div class="dashboard-pulse-sales-mix__header">
          <h3>Projected sales mix</h3>
          <small>${escapeHtml(mix.weekLabel || "Last week")}</small>
        </div>
        <p class="dashboard-pulse-empty">Current PMB prices are needed to project last week’s category mix.</p>
      </aside>
    `;
  }
  const coverageCopy = mix.unpricedTapCount
    ? `${formatNumber(mix.unpricedTapCount)} poured tap${mix.unpricedTapCount === 1 ? " was" : "s were"} left out because a current price was unavailable.`
    : "All captured taps on this wall had a current price.";
  return `
    <aside class="dashboard-pulse-sales-mix">
      <div class="dashboard-pulse-sales-mix__header">
        <h3>Projected sales mix</h3>
        <small>${escapeHtml(mix.weekLabel || "Last week")}</small>
      </div>
      <div class="dashboard-pulse-mix-bar" aria-label="Projected sales mix for ${escapeHtml(mix.weekLabel || "last week")}">
        ${mix.categories.filter((row) => row.sharePercent > 0).map((row) => `<i class="dashboard-pulse-mix-bar__${escapeHtml(row.category)}" style="--mix-share:${row.sharePercent}%"></i>`).join("")}
      </div>
      <div class="dashboard-pulse-mix-legend">
        ${mix.categories.map((row) => `
          <div class="dashboard-pulse-mix-legend__${escapeHtml(row.category)}">
            <span aria-hidden="true"></span>
            <strong>${formatNumber(row.sharePercent)}%</strong>
            <small>${escapeHtml(row.label)}</small>
          </div>
        `).join("")}
      </div>
      <p>Exact PMB ounces × current prices. ${escapeHtml(coverageCopy)}</p>
    </aside>
  `;
}

function renderDashboardBeveragePulse() {
  const container = document.querySelector("#dashboard-beverage-pulse");
  if (!container || isEmployeeDashboard) return;
  const wallItems = weeklyUsageItems.filter((item) => getDashboardPulseWall(item) === sellerRankingWall);
  const trends = buildWeeklyPlanTrends(wallItems, { now: new Date(), limit: 3 });
  const rankings = buildWeeklyUsageSellerRankings(
    [...weeklyUsageItems, ...weeklyUsageArchivedItems],
    {
      category: "all",
      wall: sellerRankingWall,
      metric: "volume",
      getFullOunces: getWeeklyUsageFullOunces,
      recentWeekLimit: 6,
      topLimit: 3,
      bottomLimit: 3,
    },
  );
  const leaders = rankings.recent.top || [];
  const pourLeaders = buildLastWeekPourLeaders(
    [...weeklyUsageItems, ...weeklyUsageArchivedItems],
    {
      wall: sellerRankingWall,
      metric: dashboardPulseRankingMetric,
      getFullOunces: getWeeklyUsageFullOunces,
      getSellingPricePerOz: getWeeklyUsageItemSellingRate,
      limit: 3,
    },
  );
  const projectedSalesMix = buildLastWeekProjectedSalesMix(
    [...weeklyUsageItems, ...weeklyUsageArchivedItems],
    {
    wall: sellerRankingWall,
    getFullOunces: getWeeklyUsageFullOunces,
    getSellingPricePerOz: getWeeklyUsageItemSellingRate,
    },
  );
  const favorite = leaders[0] || null;
  const favoriteName = clean(favorite?.name).toLowerCase();
  const rising = [
    ...(trends.sections.movers.risers || []),
    ...(trends.sections.sustained.items || []),
  ].find((item) => clean(item?.name).toLowerCase() !== favoriteName)
    || null;
  const lowSignal = trends.sections.emergingLow.items?.[0] || null;
  const cooling = lowSignal || trends.sections.movers.fallers?.[0] || null;
  const wallLabel = sellerRankingWall === "patio"
    ? "Patio liquor wall"
    : sellerRankingWall === "karaoke"
      ? "Karaoke wall"
      : "Main wall";
  container.innerHTML = `
    <header class="dashboard-pulse-header">
      <div>
        <h2 id="dashboard-beverage-pulse-title">Guest favorites</h2>
      </div>
      <div class="dashboard-pulse-controls">
        <label class="dashboard-pulse-wall"><span>Wall</span><select data-seller-ranking-wall>
          <option value="main"${sellerRankingWall === "main" ? " selected" : ""}>Main wall</option>
          <option value="karaoke"${sellerRankingWall === "karaoke" ? " selected" : ""}>Karaoke wall</option>
          <option value="patio"${sellerRankingWall === "patio" ? " selected" : ""}>Patio liquor wall</option>
        </select></label>
        <label class="dashboard-pulse-wall dashboard-pulse-metric"><span>Rank by</span><select data-dashboard-pulse-metric>
          <option value="oz"${dashboardPulseRankingMetric === "oz" ? " selected" : ""}>Oz</option>
          <option value="sales"${dashboardPulseRankingMetric === "sales" ? " selected" : ""}>$</option>
        </select></label>
      </div>
    </header>
    ${renderOhioComplianceAlert()}
    <div class="dashboard-pulse-stories">
      ${renderDashboardPulseStory({
        tone: "favorite",
        symbol: "★",
        eyebrow: "Crowd favorite",
        item: favorite,
        copy: "",
        emptyCopy: "A favorite will show up here",
      })}
      ${renderDashboardPulseStory({
        tone: "rising",
        symbol: "↗",
        eyebrow: "Gaining attention",
        item: rising,
        copy: trends.sections.movers.risers?.[0]
          ? getDashboardPulseMovementCopy(rising, "up")
          : "Staying popular week after week.",
        emptyCopy: "Nothing is clearly rising yet",
      })}
      ${renderDashboardPulseStory({
        tone: "watch",
        symbol: "◌",
        eyebrow: "Worth a glance",
        item: cooling,
        copy: lowSignal
          ? "Recently fell below its usual pace."
          : getDashboardPulseMovementCopy(cooling, "down"),
        emptyCopy: "Nothing needs special attention",
      })}
    </div>
    <div class="dashboard-pulse-detail">
      ${renderDashboardPulseCategoryLeaders({ pourLeaders, wallLabel })}
      ${renderDashboardProjectedSalesMix(projectedSalesMix)}
    </div>
  `;
  // The detailed renderer is intentionally retained as a fallback for future
  // drill-down work, but it is no longer mounted on the owner Dashboard.
  void renderOnParInsights;
  void renderSellerRankingPeriod;
  void getWeeklyUsageItemProfitRate;
  void renderWeeklyPlanTrends;
}

async function loadBeverageNews({ force = false } = {}) {
  if (beverageNewsLoading || isEmployeeDashboard) return;
  beverageNewsLoading = true;
  renderDashboardOverview();

  try {
    const response = await fetch(`/api/beverage-news?scope=compliance${force ? "&refresh=1" : ""}`, {
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) throw new Error(result?.error || "Could not check official Ohio compliance sources.");
    beverageNewsPayload = result;
    establishOhioComplianceBaselineIfNeeded();
  } catch (error) {
    const message = clean(error?.message) || "Official Ohio compliance sources could not be checked.";
    beverageNewsPayload = beverageNewsPayload
      ? {
          ...beverageNewsPayload,
          status: "partial",
          errors: [...(beverageNewsPayload.errors || []), { source: "Ohio compliance watch", message }].slice(-6),
        }
      : {
          status: "offline",
          updatedAt: "",
          items: [],
          regulatoryWatch: [],
          officialResources: [],
          complianceWatch: { status: "unavailable", isComplete: false, currentFingerprint: "", sources: [] },
          errors: [{ source: "Ohio compliance watch", message }],
        };
  } finally {
    beverageNewsLoading = false;
    renderDashboardOverview();
  }
}

function getOhioComplianceView() {
  return buildOhioComplianceWatchViewModel(beverageNewsPayload?.complianceWatch, {
    acknowledgedFingerprint: ohioComplianceAcknowledgement.fingerprint,
  });
}

function saveOhioComplianceAcknowledgement(fingerprint) {
  ohioComplianceAcknowledgement = {
    fingerprint: clean(fingerprint),
    acknowledgedAt: new Date().toISOString(),
  };
  scheduleSharedDashboardStateSync("monitoring.ohioComplianceAcknowledgement");
}

function establishOhioComplianceBaselineIfNeeded() {
  const view = getOhioComplianceView();
  if (view.shouldEstablishBaseline && dashboardSharedState.initialized) {
    saveOhioComplianceAcknowledgement(view.currentFingerprint);
  }
}

function acknowledgeOhioComplianceWatch() {
  const view = getOhioComplianceView();
  if (!view.shouldAlert) return;
  saveOhioComplianceAcknowledgement(view.currentFingerprint);
  renderDashboardOverview();
}

function renderWeeklyPlanReadiness(readiness) {
  const reasons = [...readiness.blockers, ...readiness.staleReasons, ...readiness.reviewReasons];
  return `
    <section class="weekly-plan-readiness weekly-plan-readiness--${escapeHtml(readiness.status)}" aria-labelledby="weekly-plan-readiness-title">
      <h3 id="weekly-plan-readiness-title">${escapeHtml(readiness.label)}</h3>
      ${reasons.length ? `<ul>${reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
    </section>
  `;
}

function renderWeeklyPlanProvenance({ latestCompletedWeek, latestCompletedUsageSaved, latestCompletedUsageRowCount }) {
  const recommendations = parAgentState?.recommendations;
  const planLocked = hasPublishedWeeklyPlanRecommendations();
  const priceTime = getLatestPriceTimestamp();
  const missingCounts = getWeeklyPlanMissingInventoryCount();
  return `
    <section class="weekly-plan-provenance" aria-label="Weekly plan source freshness">
      <div>
        <span>Plan</span>
        <strong>${planLocked ? "Locked · " : ""}${recommendations?.generatedAt ? escapeHtml(formatUpdatedAt(recommendations.generatedAt)) : "Not generated"}</strong>
      </div>
      <div>
        <span>Weekly Usage</span>
        <strong>${weeklyUsageSharedSaveError ? "Recovery review needed" : weeklyUsageSharedSaving || weeklyUsageSharedPendingWrites || weeklyUsageSharedSaveTimer || weeklyUsageSharedOutbox ? "Saving changes" : latestCompletedWeek ? `Week of ${escapeHtml(formatIsoDate(latestCompletedWeek))}` : "No completed week"}</strong>
        ${weeklyUsageSharedSaveError ? `<small>${escapeHtml(weeklyUsageSharedSaveError)}</small>` : !latestCompletedUsageSaved ? `<small>${formatNumber(latestCompletedUsageRowCount)}/${formatNumber(weeklyUsageItems.length)} taps saved</small>` : ""}
      </div>
      <div>
        <span>Inventory</span>
        <strong>${inventorySharedSaveError ? "Recovery review needed" : inventorySharedSaving || inventoryFieldSyncPendingCount || inventoryFieldSyncTimers.size || Object.keys(inventoryFieldOutbox).length || inventoryActionOutbox.length ? "Saving changes" : inventorySharedInitialized ? (inventorySharedUpdatedAt ? escapeHtml(formatUpdatedAt(inventorySharedUpdatedAt)) : "Shared inventory") : "Local / baseline only"}</strong>
        ${inventorySharedSaveError ? `<small>${escapeHtml(inventorySharedSaveError)}</small>` : missingCounts ? `<small>${formatNumber(missingCounts)} missing count${missingCounts === 1 ? "" : "s"}</small>` : ""}
      </div>
      <div>
        <span>Prices</span>
        <strong>${priceTime ? escapeHtml(formatUpdatedAt(priceTime)) : "Bundled defaults"}</strong>
        ${vendorSyncRunning ? "<small>Syncing…</small>" : ""}
      </div>
    </section>
  `;
}

function getWeeklyPlanVendorLines(plan) {
  return groupWeeklyPlanOrdersByVendor(plan).map((group) => ({
    ...group,
    items: group.items.map((item) => ({
      ...item,
      quantityLabel: item.lineType === "Beer keg"
        ? `${formatNumber(item.quantity)} keg${item.quantity === 1 ? "" : "s"}`
        : item.lineType === "Liquor tap bottle"
          ? `${formatNumber(item.quantity)} bottle${item.quantity === 1 ? "" : "s"}`
        : item.casePackaged
          ? `${formatNumber(item.caseCount)} case${item.caseCount === 1 ? "" : "s"} · ${formatNumber(item.quantity)} units`
          : `${formatNumber(item.quantity)} unit${item.quantity === 1 ? "" : "s"}`,
    })),
  }));
}

function renderWeeklyPlanByVendor(plan) {
  const groups = getWeeklyPlanVendorLines(plan);
  if (!groups.length) return '<p class="weekly-plan-empty">No active purchasing lines. Review held and excluded items below before concluding no order is needed.</p>';
  return groups.map((group) => renderWeeklyPlanGroup(
    `${group.vendor} Order`,
    group.items.length,
    `<div class="weekly-plan-vendor-summary"><strong>${group.hasCompletePricing ? money(group.estimatedCost) : `${money(group.estimatedCost)} subtotal`}</strong></div><div class="weekly-plan-list">${group.items.map((item) => {
      const details = [
        item.tapNumbers?.length ? `Tap${item.tapNumbers.length === 1 ? "" : "s"} ${item.tapNumbers.map(formatNumber).join(", ")}` : "",
        item.hasKnownPrice === false ? "Price needed" : "",
      ].filter(Boolean).join(" · ");
      return `
        <div class="weekly-plan-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            ${details ? `<span>${escapeHtml(details)}</span>` : ""}
          </div>
          <b>${escapeHtml(item.quantityLabel)}</b>
        </div>
      `;
    }).join("")}</div>`,
  )).join("");
}

function renderWeeklyPlanReview(plan) {
  if (!plan.review.heldRecommendations.length && !plan.review.excludedInventory.length) return "";
  return `
    <section class="weekly-plan-review" aria-labelledby="weekly-plan-review-title">
      <div class="weekly-plan-column__header">
        <h2 id="weekly-plan-review-title">Review Before Ordering</h2>
      </div>
      ${plan.review.heldRecommendations.length ? renderWeeklyPlanGroup(
        "Held recommendations",
        plan.review.heldRecommendations.length,
        `<div class="weekly-plan-list">${plan.review.heldRecommendations.map((item) => `
          <div class="weekly-plan-item weekly-plan-item--held">
            <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(getWeeklyPlanTapContext(item, item.category === "held-liquor-bottles" ? "oz" : "kegs"))} · ${escapeHtml(item.reasons.join(" ") || "Held for review")}</span></div>
            <b>Held ${formatNumber(item.quantity)}</b>
          </div>
        `).join("")}</div>`,
      ) : ""}
      ${plan.review.excludedInventory.length ? renderWeeklyPlanGroup(
        "Inventory ordering rules",
        plan.review.excludedInventory.length,
        `<div class="weekly-plan-list">${plan.review.excludedInventory.map((item) => `
          <div class="weekly-plan-item weekly-plan-item--held">
            <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.group)} · ${formatNumber(item.onHand)} on hand / ${formatNumber(item.par)} par · ${escapeHtml(item.reason)}</span></div>
            <b>${item.quantity > 0 ? `${formatNumber(item.quantity)} needed — held` : "Review"}</b>
          </div>
        `).join("")}</div>`,
      ) : ""}
    </section>
  `;
}

function getVendorOrderDraftModel(plan, freshness) {
  const snapshot = getCurrentWeeklyPlanSnapshot(parAgentState?.recommendations, new Date());
  return buildVendorOrderDrafts(plan, {
    proofMinimumCandidates: buildProofPrepReplacementCandidates({
      cocktails: plan?.prep?.cocktails,
      recipes,
      inventoryItems,
    }),
    generatedAt: snapshot?.generatedAt || "",
    sourceDate: snapshot?.publishedAt || "",
    freshness: freshness.readiness,
    budgetLimit: null,
    proofMinimum: 350,
    now: new Date(),
    confirmationRecipient: "samantha@onparbar.com",
  });
}

function renderVendorOrderDraftWorkspace(plan, freshness) {
  const model = getVendorOrderDraftModel(plan, freshness);
  const savedById = new Map((weeklyOrderTracking.drafts || []).map((draft) => [draft.id, draft]));
  if (!model.drafts.length) return "";
  return `
    <section class="vendor-order-drafts" aria-labelledby="vendor-order-drafts-title">
      <header class="vendor-order-drafts__header">
        <div><p class="eyebrow">Approval required</p><h2 id="vendor-order-drafts-title">Vendor Order Drafts</h2><p>Due Tuesday by 4 PM · no substitutions.</p></div>
        <div><strong>${escapeHtml(model.schedule.label)}</strong><span>${money(model.weeklyTotal)} known total</span></div>
      </header>
      <p class="weekly-plan-live-status" role="status">${escapeHtml(weeklyOrderTrackingMessage || "Draft only · vendor submission disabled.")}</p>
      <div class="vendor-order-drafts__grid">
        ${model.drafts.map((draft) => {
          const saved = savedById.get(draft.id) || {};
          const approved = Boolean(saved.approvedAt);
          return `
            <form class="vendor-order-draft-card vendor-order-draft-card--${approved ? "approved" : draft.status}" data-vendor-order-draft="${escapeHtml(draft.vendor)}">
              <header><div><h3>${escapeHtml(draft.vendor)}</h3><p>${formatNumber(draft.lineCount)} line${draft.lineCount === 1 ? "" : "s"} · ${money(draft.estimatedTotal)}</p></div><span>${approved ? "Approved" : draft.status === "blocked" ? "Blocked" : "Review"}</span></header>
              <div class="vendor-order-draft-lines">
                ${draft.lines.map((line) => `<div><strong>${escapeHtml(line.productName)}</strong><span>${escapeHtml(line.vendorSku ? `SKU ${line.vendorSku}` : "SKU needed")} · ${line.requestedCases ? `${formatNumber(line.requestedCases)} case${line.requestedCases === 1 ? "" : "s"} / ` : ""}${formatNumber(line.requestedUnits)} unit${line.requestedUnits === 1 ? "" : "s"} · ${line.extendedCost ? money(line.extendedCost) : "Price needed"}</span><small>${escapeHtml(line.reason)}</small></div>`).join("")}
              </div>
              ${draft.blockers.length ? `<div class="vendor-order-draft-issues vendor-order-draft-issues--blocked"><strong>Approval blockers</strong>${draft.blockers.map((item) => `<span>${escapeHtml(item.message)}</span>`).join("")}</div>` : ""}
              ${draft.warnings.length ? `<div class="vendor-order-draft-issues"><strong>Review notes</strong>${draft.warnings.map((item) => `<span>${escapeHtml(item.message)}</span>`).join("")}</div>` : ""}
              <div class="vendor-order-draft-fields">
                <label><span>Manager</span><input type="text" maxlength="80" autocomplete="name" data-order-draft-manager value="${escapeHtml(saved.approvedBy || saved.createdBy || "")}" placeholder="Manager name"${approved ? " disabled" : ""}></label>
              </div>
              <label class="vendor-order-draft-confirm"><input type="checkbox" data-order-draft-confirm${approved ? " checked disabled" : ""}><span>I confirm ${escapeHtml(draft.vendor)}, ${money(draft.estimatedTotal)}, and ${formatNumber(draft.lineCount)} order lines.</span></label>
              <div class="vendor-order-draft-actions">
                <button class="ghost-button" type="button" data-order-draft-create${approved ? " disabled" : ""}>${saved.createdAt ? "Refresh draft" : "Create draft"}</button>
                <button class="primary-button" type="submit"${approved || draft.blockers.length ? " disabled" : ""}>${approved ? `Approved by ${escapeHtml(saved.approvedBy)}` : "Approve draft"}</button>
              </div>
              <p class="vendor-order-draft-adapter">Submission adapter: disabled · Confirmation: ${escapeHtml(draft.confirmationRecipient)}</p>
            </form>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function renderOwnerWeeklyOrderTracking() {
  if (!weeklyOrderTracking.available) {
    return `
      <section class="weekly-order-tracking" aria-labelledby="weekly-order-tracking-title">
        <div class="weekly-plan-column__header">
          <h2 id="weekly-order-tracking-title">Order &amp; Delivery Tracking</h2>
        </div>
        <p class="weekly-plan-empty">${escapeHtml(weeklyOrderTrackingMessage || "Order tracking will be available after the Monday plan is published.")}</p>
      </section>
    `;
  }
  const vendorCards = weeklyOrderTracking.vendors.map((vendor) => `
    <article class="weekly-order-vendor-card">
      <form class="weekly-order-placed-form" data-weekly-order-vendor-id="${escapeHtml(vendor.id)}">
        <div>
          <h3>${escapeHtml(vendor.vendor)} Order</h3>
          <p>${formatNumber(vendor.items?.length || 0)} delivery line${vendor.items?.length === 1 ? "" : "s"}</p>
        </div>
        <label class="weekly-order-check"><input type="checkbox" data-weekly-order-placed${vendor.ordered ? " checked" : ""}><span>Order placed</span></label>
        <label><span>Ordered by</span><input type="text" maxlength="80" autocomplete="name" data-weekly-ordered-by value="${escapeHtml(vendor.orderedBy)}" placeholder="Manager name"></label>
        <button class="ghost-button" type="submit">Save</button>
      </form>
      ${vendor.ordered ? `<p class="weekly-order-placed-meta">Ordered by ${escapeHtml(vendor.orderedBy)}${vendor.orderedAt ? ` · ${escapeHtml(formatUpdatedAt(vendor.orderedAt))}` : ""}</p>` : ""}
      <div class="weekly-order-receipt-list">
        ${(vendor.items || []).map((item) => `
          <div class="weekly-order-receipt weekly-order-receipt--${escapeHtml(item.status || "pending")}">
            <div><strong>${escapeHtml(item.name)}</strong><span>${formatNumber(item.quantity)} ${escapeHtml(item.unit)}</span></div>
            <b>${item.status === "received"
              ? `All received by ${escapeHtml(item.handledBy)}`
              : item.status === "partial"
                ? `${formatNumber(item.receivedQuantity)} of ${formatNumber(item.quantity)} received · ${escapeHtml(item.handledBy)}`
                : item.status === "not-received"
                  ? `0 of ${formatNumber(item.quantity)} received · ${escapeHtml(item.handledBy)}`
                  : "Awaiting delivery check"}</b>
          </div>
        `).join("")}
      </div>
    </article>
  `).join("");
  return `
    <section class="weekly-order-tracking" aria-labelledby="weekly-order-tracking-title">
      <div class="weekly-plan-column__header">
        <h2 id="weekly-order-tracking-title">Order &amp; Delivery Tracking</h2>
      </div>
      ${weeklyOrderTracking.notReceivedCount ? `<p class="weekly-order-tracking__summary">${formatNumber(weeklyOrderTracking.notReceivedCount)} line${weeklyOrderTracking.notReceivedCount === 1 ? "" : "s"} short or missing</p>` : ""}
      ${weeklyOrderTrackingMessage ? `<p class="weekly-plan-live-status" role="status">${escapeHtml(weeklyOrderTrackingMessage)}</p>` : ""}
      <div class="weekly-order-vendor-grid">${vendorCards || '<p class="weekly-plan-empty">There are no active vendor orders in this plan.</p>'}</div>
    </section>
  `;
}

function bindOwnerWeeklyOrderTrackingEvents() {
  document.querySelectorAll(".weekly-order-placed-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const ordered = Boolean(form.querySelector("[data-weekly-order-placed]")?.checked);
      const orderedByInput = form.querySelector("[data-weekly-ordered-by]");
      const orderedBy = clean(orderedByInput?.value);
      if (ordered && !orderedBy) {
        weeklyOrderTrackingMessage = "Enter who placed the order before checking it off.";
        orderedByInput?.setCustomValidity("Enter who placed the order.");
        orderedByInput?.reportValidity();
        orderedByInput?.focus();
        return;
      }
      orderedByInput?.setCustomValidity("");
      form.querySelectorAll("input, button").forEach((control) => { control.disabled = true; });
      await saveWeeklyOrderPlaced(form.dataset.weeklyOrderVendorId, ordered, orderedBy);
    });
  });
  document.querySelectorAll("[data-vendor-order-draft]").forEach((form) => {
    const vendor = form.dataset.vendorOrderDraft;
    const managerInput = form.querySelector("[data-order-draft-manager]");
    form.querySelector("[data-order-draft-create]")?.addEventListener("click", async () => {
      const createdBy = clean(managerInput?.value);
      if (!createdBy) {
        managerInput?.setCustomValidity("Enter the manager creating this draft.");
        managerInput?.reportValidity();
        return;
      }
      managerInput?.setCustomValidity("");
      await saveVendorOrderDraftAction({ action: "create-draft", vendor, createdBy });
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const approvedBy = clean(managerInput?.value);
      const confirmed = Boolean(form.querySelector("[data-order-draft-confirm]")?.checked);
      if (!approvedBy) {
        managerInput?.setCustomValidity("Enter the approving manager.");
        managerInput?.reportValidity();
        return;
      }
      managerInput?.setCustomValidity("");
      if (!confirmed) {
        weeklyOrderTrackingMessage = "Confirm the vendor, total, and line count before approval.";
        renderWeeklyPlan();
        return;
      }
      await saveVendorOrderDraftAction({ action: "approve-draft", vendor, approvedBy, confirmed: true });
    });
  });
}

function renderWeeklyPlanTrendRows(items, { kind }) {
  if (!items.length) return '<p class="weekly-plan-trend-empty">No beverages meet this signal yet.</p>';
  return `<ol class="weekly-plan-trend-list">${items.map((item) => {
    const meta = kind === "sustained"
      ? `${formatNumber(item.averageOz)} oz weekly average · ${formatNumber(item.currentOz)} oz latest`
      : kind === "mix"
        ? `${formatNumber(item.previousSharePercent)}% → ${formatNumber(item.currentSharePercent)}% of captured pours`
        : `${formatNumber(item.previousOz ?? item.baselineOz)} oz → ${formatNumber(item.currentOz)} oz`;
    const signal = kind === "sustained"
      ? `${formatNumber(item.lowestWeekOz)}–${formatNumber(item.highestWeekOz)} oz range`
      : kind === "mix"
        ? `${item.sharePointChange > 0 ? "+" : ""}${formatNumber(item.sharePointChange)} pts`
        : item.percentGuard
          ? `${item.changeOz > 0 ? "+" : ""}${formatNumber(item.changeOz)} oz`
          : `${item.changePercent > 0 ? "+" : ""}${formatNumber(item.changePercent)}%`;
    return `
      <li>
        <div>
          <strong>${escapeHtml(item.name || item.category)}</strong>
          <small>${escapeHtml(meta)}</small>
        </div>
        <b class="weekly-plan-trend-signal${kind === "fallers" || kind === "low" || (kind === "mix" && item.sharePointChange < 0) ? " is-down" : ""}">${escapeHtml(signal)}</b>
      </li>
    `;
  }).join("")}</ol>`;
}

function renderWeeklyPlanTrendCard({ eyebrow, title, section, content }) {
  return `
    <article class="weekly-plan-trend-card">
      <div class="weekly-plan-trend-card__header">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h3>${escapeHtml(title)}</h3>
      </div>
      ${section.available ? content : `<p class="weekly-plan-trend-empty">${escapeHtml(section.reason)}</p>`}
    </article>
  `;
}

function renderWeeklyPlanTrends() {
  const trends = buildWeeklyPlanTrends(weeklyUsageItems, { now: new Date(), limit: 5 });
  const status = ["ready", "limited", "incomplete", "stale", "unavailable"].includes(trends.status)
    ? trends.status
    : "unavailable";
  const coverage = trends.coverage;
  const period = trends.period;
  const latestCoverageCopy = coverage.eligibleTapCount
    ? `${formatNumber(coverage.latestCapturedTapCount)} of ${formatNumber(coverage.eligibleTapCount)} current taps captured`
    : "No eligible current taps";
  const comparisonCoverageCopy = period.previousLabel
    ? `${formatNumber(coverage.comparisonIncludedTapCount)} comparable${coverage.comparisonExcludedTapCount ? ` · ${formatNumber(coverage.comparisonExcludedTapCount)} excluded` : ""}`
    : "";
  const coverageCopy = [latestCoverageCopy, comparisonCoverageCopy].filter(Boolean).join(" · ");
  const periodCopy = period.latestLabel && period.previousLabel
    ? `${period.latestLabel} compared with ${period.previousLabel}`
    : period.latestLabel || "Waiting for two completed PMB weeks";
  const emergingItems = trends.sections.emergingLow.items || [];

  return `
    <section class="weekly-plan-trends" aria-labelledby="weekly-plan-trends-title">
      <header class="weekly-plan-trends__header">
        <div>
          <p class="eyebrow">Beverage pulse</p>
          <h2 id="weekly-plan-trends-title">What changed in the pours</h2>
          <p>Signals use exact Pour My Beer ounces—not drinks sold or revenue—so corporate-party pours remain represented.</p>
        </div>
        <div class="weekly-plan-trends__status">
          <span class="weekly-plan-trends__badge weekly-plan-trends__badge--${status}">${escapeHtml(trends.statusLabel)}</span>
          <strong>${escapeHtml(periodCopy)}</strong>
          <small>${escapeHtml(coverageCopy)}</small>
        </div>
      </header>
      ${status === "ready" ? "" : `<p class="weekly-plan-trends__notice">${escapeHtml(trends.statusCopy)}</p>`}
      <div class="weekly-plan-trends__grid">
        ${renderWeeklyPlanTrendCard({
          eyebrow: "Week over week",
          title: "Biggest movers",
          section: trends.sections.movers,
          content: `
            <div class="weekly-plan-trend-split">
              <div><h4>Rising</h4>${renderWeeklyPlanTrendRows(trends.sections.movers.risers || [], { kind: "risers" })}</div>
              <div><h4>Cooling</h4>${renderWeeklyPlanTrendRows(trends.sections.movers.fallers || [], { kind: "fallers" })}</div>
            </div>
          `,
        })}
        ${renderWeeklyPlanTrendCard({
          eyebrow: "Repeat demand",
          title: "Sustained high volume",
          section: trends.sections.sustained,
          content: renderWeeklyPlanTrendRows(trends.sections.sustained.items || [], { kind: "sustained" }),
        })}
        ${renderWeeklyPlanTrendCard({
          eyebrow: "Needs a look",
          title: "Emerging low or zero movement",
          section: trends.sections.emergingLow,
          content: renderWeeklyPlanTrendRows(emergingItems, { kind: "low" }),
        })}
        ${renderWeeklyPlanTrendCard({
          eyebrow: "Category balance",
          title: "Pour mix shifts",
          section: trends.sections.categoryMix,
          content: renderWeeklyPlanTrendRows(trends.sections.categoryMix.items || [], { kind: "mix" }),
        })}
      </div>
    </section>
  `;
}

function renderWeeklyPlan() {
  if (!weeklyPlan) return;
  const recommendations = parAgentState?.recommendations;
  const plan = getWeeklyPlanModel();
  const summary = plan.summary;
  const freshness = getWeeklyPlanFreshness(plan);
  const planLocked = Boolean(getCurrentWeeklyPlanSnapshot(recommendations, new Date()));
  const updatedText = recommendations?.generatedAt
    ? "Thursday delivery · locked through Sunday"
    : "Publish Monday for Thursday delivery.";
  const priceNote = summary.estimatedPurchaseCostComplete
    ? ""
    : `${summary.missingPriceCount ? `${formatNumber(summary.missingPriceCount)} active line${summary.missingPriceCount === 1 ? " is" : "s are"} missing a price. ` : ""}The total shown is the known-price subtotal, not a complete spend total.`;

  weeklyPlan.innerHTML = `
    <header class="weekly-plan-header">
      <div>
        <h2>Order &amp; Prep Plan</h2>
        <p>${escapeHtml(updatedText)}</p>
      </div>
      <div class="weekly-plan-actions">
        <button class="primary-button" id="run-weekly-plan-agent" type="button"${parAgentRunning || weeklyPlanUpdating || planLocked ? " disabled" : ""}>${parAgentRunning || weeklyPlanUpdating ? "Locking..." : planLocked ? "Plan locked through Sunday" : "Lock Monday Plan"}</button>
        <label><span>Group purchases</span><select id="weekly-plan-group-mode"><option value="category"${weeklyPlanGroupMode === "category" ? " selected" : ""}>By category</option><option value="vendor"${weeklyPlanGroupMode === "vendor" ? " selected" : ""}>By vendor</option></select></label>
      </div>
    </header>
    <p class="weekly-plan-live-status" id="weekly-plan-live-status" role="status" aria-live="polite" aria-atomic="true">${escapeHtml(weeklyPlanRefreshMessage || (parAgentRunning || weeklyPlanUpdating || parAgentError ? parAgentMessage : ""))}</p>
    ${renderWeeklyPlanReadiness(freshness.readiness)}
    ${renderWeeklyPlanProvenance(freshness)}
    <div class="weekly-plan-stats">
      <div><span>Order lines</span><strong>${formatNumber(summary.orderLineCount)}</strong></div>
      <div><span>Beer kegs</span><strong>${formatNumber(summary.beerKegTotal)}</strong></div>
      <div><span>Liquor tap bottles</span><strong>${formatNumber(summary.liquorTapBottleTotal)}</strong></div>
      <div><span>Cocktail kegs to make</span><strong>${formatNumber(summary.cocktailBatchTotal)}</strong></div>
      <div><span>Held for review</span><strong>${formatNumber(summary.heldLineCount + summary.excludedLineCount)}</strong></div>
      <div class="${summary.estimatedPurchaseCostComplete ? "" : "weekly-plan-stat--warning"}"><span>Purchase estimate</span><strong>${money(summary.estimatedKnownPurchaseCost)}</strong>${summary.missingPriceCount ? `<small>${formatNumber(summary.missingPriceCount)} missing price${summary.missingPriceCount === 1 ? "" : "s"}</small>` : ""}</div>
    </div>
    ${priceNote ? `<p class="weekly-plan-cost-note">${escapeHtml(priceNote)}</p>` : ""}
    <div class="weekly-plan-columns">
      <section class="weekly-plan-column">
        <div class="weekly-plan-column__header"><h2>Order This Week</h2></div>
        ${weeklyPlanGroupMode === "vendor" ? renderWeeklyPlanByVendor(plan) : `
          ${renderWeeklyPlanGroup("Beer Kegs", plan.orders.beerKegs.length, renderWeeklyPlanTapRows(plan.orders.beerKegs, { action: "Order", unit: "kegs" }), "beer")}
          ${renderWeeklyPlanGroup("Liquor Tap Bottles", plan.orders.liquorTapBottles.length, renderWeeklyPlanLiquorTapRows(plan.orders.liquorTapBottles), "liquor")}
          ${renderWeeklyPlanGroup("Liquor Bottles", plan.orders.liquor.length, renderWeeklyPlanInventoryRows(plan.orders.liquor), "liquor")}
          ${renderWeeklyPlanGroup("Mixers", plan.orders.mixers.length, renderWeeklyPlanInventoryRows(plan.orders.mixers), "mixers")}
          ${renderWeeklyPlanGroup("Other Supplies", plan.orders.supplies.length, renderWeeklyPlanInventoryRows(plan.orders.supplies))}
        `}
      </section>
      <section class="weekly-plan-column weekly-plan-column--prep">
        <div class="weekly-plan-column__header"><h2>Cocktails To Make</h2></div>
        ${renderWeeklyPlanCocktailRows(plan.prep.cocktails)}
      </section>
    </div>
    ${renderOwnerWeeklyOrderTracking()}
    ${renderVendorOrderDraftWorkspace(plan, freshness)}
    ${renderWeeklyPlanReview(plan)}
  `;

  document.querySelector("#run-weekly-plan-agent")?.addEventListener("click", runWeeklyPlanUpdate);
  document.querySelector("#weekly-plan-group-mode")?.addEventListener("change", (event) => {
    weeklyPlanGroupMode = event.currentTarget.value === "vendor" ? "vendor" : "category";
    renderWeeklyPlan();
  });
  bindOwnerWeeklyOrderTrackingEvents();
}

function renderKegLevels() {
  if (!kegSummary || !kegWalls) return;

  const wallNames = ["Patio", "Main", "Karaoke"];
  const totalTaps = kegWallItems.length;
  const liveCount = kegWallItems.filter((item) => getKegLiveRow(item)).length;
  const reorderCount = kegWallItems.filter((item) => getKegNeed(item) > 0).length;
  const currentInventoryValue = sum(kegWallItems.map((item) => getKegCurrentValue(item, getKegLiveRow(item))));
  const recipeCoverage = getWallCocktailRecipeCoverage();

  kegSummary.innerHTML = `
    <h2>Keg Levels</h2>
    <div class="sync-panel sync-panel--keg-actions">
      <div class="sync-actions sync-actions--keg-primary">
        <button class="primary-button" id="refresh-keg-levels" type="button"${kegSyncLoading || kegConfigUpdateRunning ? " disabled" : ""}>${kegSyncLoading ? "Refreshing..." : "Refresh keg levels"}</button>
        <button class="ghost-button" id="send-keg-config-update" type="button"${kegSyncLoading || kegConfigUpdateRunning ? " disabled" : ""}>${kegConfigUpdateRunning ? "Sending..." : "Send config update"}</button>
        <button class="ghost-button keg-clear-on-hand-button" id="clear-keg-on-hand" type="button">Clear all on hand</button>
      </div>
      <p class="sync-status">${escapeHtml(kegSyncMessage)}${kegUpdatedAt ? ` Last updated ${escapeHtml(formatUpdatedAt(kegUpdatedAt))}.` : ""}</p>
    </div>
    <div class="keg-summary-stats">
      <div class="summary-line"><span>Total taps</span><strong>${totalTaps}</strong></div>
      <div class="summary-line"><span>Live levels found</span><strong>${liveCount}</strong></div>
      <div class="summary-line"><span>Kegs below par</span><strong>${reorderCount}</strong></div>
      ${recipeCoverage.missing.length ? `<div class="summary-line"><span>Missing recipes</span><strong>${recipeCoverage.missing.length}</strong></div>` : ""}
      <div class="summary-line"><span>Current line value</span><strong>${money(currentInventoryValue)}</strong></div>
    </div>
    ${recipeCoverage.missing.length ? `
      <div class="recipe-coverage-summary">
        <p>${recipeCoverage.missing.length} wall cocktail${recipeCoverage.missing.length === 1 ? "" : "s"} need attention.</p>
        <button class="mini-button" id="view-missing-recipes" type="button">View missing recipes</button>
      </div>
    ` : ""}
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
  const isLiquor = item.kind === "liquor";
  const currentMargin = toNumber(item.targetMargin) || DEFAULT_BEER_TARGET_MARGIN;
  const currentPrice = getGeneratedBeerChargePerOz(item.kegCost, currentMargin);
  const replacement = item.replaceTapKey ? tapReplacementOverrides[item.replaceTapKey] : null;
  return `
    <article class="coming-soon-item" data-coming-soon-id="${escapeHtml(item.id)}">
      ${item.imageUrl ? `<img class="coming-soon-item__image" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}">` : ""}
      <div class="coming-soon-item__body">
        <div class="coming-soon-item__title">
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(getComingSoonKindLabel(item.kind))}</span>
        </div>
        ${item.description ? `<p>${escapeHtml(getComingSoonCardDescription(item.description))}</p>` : ""}
        ${isRecipe ? renderComingSoonRecipeStats(item) : ""}
        ${isLiquor ? renderComingSoonLiquorDetails(item) : ""}
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

function getComingSoonCardDescription(value) {
  const description = clean(value);
  if (description.length <= 260) return description;
  const firstSentence = description.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length >= 80) return firstSentence;
  return `${description.slice(0, 257).trim()}…`;
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

function renderComingSoonLiquorDetails(item) {
  const details = [
    item.producer ? `<span><b>${escapeHtml(item.producer)}</b> maker</span>` : "",
    item.style ? `<span><b>${escapeHtml(item.style)}</b></span>` : "",
    toNumber(item.abvPercent) ? `<span><b>${formatNumber(item.abvPercent)}%</b> ABV</span>` : "",
    item.untappdId ? `<span><b>Untappd</b> #${escapeHtml(item.untappdId)}</span>` : "",
  ].filter(Boolean);
  return details.length ? `<div class="coming-soon-stats">${details.join("")}</div>` : "";
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
  const savedTimes = new Set();
  [...weeklyUsageItems, ...weeklyUsageArchivedItems].forEach((item) => {
    (item.history || []).forEach((entry) => {
      const time = getWeeklyUsageLabelTime(entry.label);
      if (time) savedTimes.add(time);
    });
  });
  // This only avoids re-fetching represented historical weeks. The latest completed week
  // is always checked by getPmbSyncWeekStarts, and order readiness requires every active row.
  return savedTimes;
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
      .filter((item) => isWeeklyUsageAssignmentReusableMatch(item, assignment, sourceItems))
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

function isWeeklyUsageAssignmentReusableMatch(item, assignment, sourceItems = []) {
  const namesMatch = hasExactWeeklyUsageProductNameMatch(item.name, assignment.name)
    || isSameWeeklyUsageProductName(item.name, assignment.name);
  if (!namesMatch) return false;
  const plu = toNumber(item.plu) || toNumber(assignment.plu);
  const matchingPluSourceCount = plu
    ? sourceItems.filter((sourceItem) => toNumber(sourceItem.plu) === plu).length
    : 0;
  return canReuseWeeklyUsageHistory(item, assignment, matchingPluSourceCount);
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
    currentName,
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
    name: clean(source?.currentName || source?.name || source?.brand || source?.product),
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

function getWeeklyUsagePerformanceCategoryLabel(category) {
  return {
    beer: "Beer",
    cocktail: "Cocktail",
    liquor: "Liquor",
  }[category] || "Drink";
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
  const activeRows = visibleItems.filter((item) => !item.isArchivedSearchResult).length;
  const searchArchiveRows = visibleItems.filter((item) => item.isArchivedSearchResult).length;
  const allHistoryHeaders = getWeeklyUsageHistoryHeaders(visibleItems);
  const historyHeaders = weeklyUsageHistoryLimit
    ? allHistoryHeaders.slice(0, weeklyUsageHistoryLimit)
    : allHistoryHeaders;
  const compactUsageTable = window.matchMedia("(max-width: 720px)").matches;
  const usageColumnWidths = compactUsageTable
    ? { tap: 46, product: 150, average: 132, week: 90 }
    : { tap: 70, product: 340, average: 156, week: 112 };
  const weeklyUsageTableElement = weeklyUsageHead.closest("table");
  if (weeklyUsageTableElement) {
    const tableWidth = `${usageColumnWidths.tap + usageColumnWidths.product + usageColumnWidths.average + (historyHeaders.length * usageColumnWidths.week)}px`;
    weeklyUsageTableElement.style.width = tableWidth;
    weeklyUsageTableElement.style.minWidth = tableWidth;
    weeklyUsageTableElement.querySelector("colgroup")?.remove();
    weeklyUsageTableElement.insertAdjacentHTML("afterbegin", `
      <colgroup>
        <col style="width: ${usageColumnWidths.tap}px;">
        <col style="width: ${usageColumnWidths.product}px;">
        <col style="width: ${usageColumnWidths.average}px;">
        ${historyHeaders.map(() => `<col style="width: ${usageColumnWidths.week}px;">`).join("")}
      </colgroup>
    `);
  }

  if (weeklyUsageRangeInput) {
    weeklyUsageRangeInput.value = String(weeklyUsageHistoryLimit);
  }

  if (pullPmbWeeklyUsageButton) {
    pullPmbWeeklyUsageButton.textContent = weeklyUsageSyncLoading ? "Pulling..." : "Pull PMB report";
    pullPmbWeeklyUsageButton.disabled = weeklyUsageSyncLoading;
  }

  weeklyUsageSummary.innerHTML = `
    <h2>Weekly Usage</h2>
    <div class="weekly-usage-summary__hero">
      <span>Latest history week</span>
      <strong>${escapeHtml(latestLabel)}</strong>
    </div>
    <div class="weekly-usage-summary__grid">
      <div><strong>${activeRows}</strong><span>Current taps</span></div>
      ${searchArchiveRows ? `<div><strong>${searchArchiveRows}</strong><span>Archived matches</span></div>` : ""}
    </div>
    <div class="summary-line"><span>Weeks displayed</span><strong>${historyHeaders.length}${historyHeaders.length !== allHistoryHeaders.length ? ` of ${allHistoryHeaders.length}` : ""}</strong></div>
    <div class="summary-line"><span>Last PMB sync</span><strong>${weeklyUsageLastSyncAt ? escapeHtml(formatUpdatedAt(weeklyUsageLastSyncAt)) : "Not yet"}</strong></div>
    <div class="sync-panel sync-panel--weekly-usage">
      <p class="sync-status">${escapeHtml(weeklyUsageSyncMessage)}</p>
      ${weeklyUsageSharedProvisioned && !weeklyUsageSharedInitialized ? '<button class="ghost-button" id="initialize-shared-weekly-usage" type="button">Import from service computer</button>' : ""}
      ${!weeklyUsageSharedInitialized || weeklyUsageSharedSaveError ? `<p class="sync-status">${escapeHtml(weeklyUsageSharedMessage)}</p>` : ""}
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
          <td class="weekly-usage-average">
            <strong>${escapeHtml(averageDisplay)}</strong>
          </td>
          ${historyCells}
        </tr>
      `;
    })
    .join("") || `<tr><td colspan="${3 + historyHeaders.length}" class="empty-state">No weekly usage rows match that search.</td></tr>`;

  document.querySelector("#initialize-shared-weekly-usage")?.addEventListener(
    "click",
    initializeSharedWeeklyUsageFromServiceComputer,
  );
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

function getPmbConnectionErrorMessage(error, fallback, { writeAttempted = false } = {}) {
  const message = clean(error?.message || error);
  if (/fetch failed|failed to fetch|networkerror|econnrefused|econnreset|enotfound|etimedout|timed? ?out|socket hang up|aborted|pmb .+ failed \(0\)|pmb .+ unavailable/i.test(message)) {
    return writeAttempted
      ? "Pour My Beer is reachable only from the work network. The dashboard could not confirm whether that change completed, so check PMB at work before retrying."
      : "PMB unavailable. Showing saved data.";
  }
  return message || fallback;
}

async function requirePmbWorkNetworkForServiceImport() {
  let response;
  let result = {};
  try {
    response = await fetch("/api/pmb-products", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
    });
    result = await parseJsonResponse(response);
  } catch (error) {
    throw new Error(getPmbConnectionErrorMessage(error, "Pour My Beer could not be reached."));
  }
  if (!response.ok || !result?.ok) {
    throw new Error(getPmbConnectionErrorMessage(
      result?.error || `PMB connection check failed (${response.status}).`,
      "Pour My Beer could not be reached.",
    ));
  }
  return result;
}

async function requestOperationalSharedJson(path, options = {}, timeoutMs = OPERATIONAL_SHARED_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
    });
    return { response, result: await parseJsonResponse(response) };
  } catch (error) {
    if (controller.signal.aborted || error?.name === "AbortError") {
      const timeoutError = new Error("The shared-state request timed out. The local change remains saved for recovery.");
      timeoutError.code = "OPERATIONAL_SHARED_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function requestSharedWeeklyUsage(body = null) {
  const { response, result } = await requestOperationalSharedJson("/api/weekly-usage-state", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = new Error(result.error || `Shared Weekly Usage request failed (${response.status}).`);
    error.code = result.code || "WEEKLY_USAGE_STATE_ERROR";
    error.status = response.status;
    error.currentRevision = result.currentRevision;
    throw error;
  }
  return result;
}

function loadWeeklyUsageSharedOutbox() {
  try {
    return normalizeOperationalOutboxEntry(JSON.parse(localStorage.getItem(WEEKLY_USAGE_OUTBOX_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

function saveWeeklyUsageSharedOutbox() {
  try {
    if (weeklyUsageSharedOutbox) {
      localStorage.setItem(WEEKLY_USAGE_OUTBOX_STORAGE_KEY, JSON.stringify(weeklyUsageSharedOutbox));
    } else {
      localStorage.removeItem(WEEKLY_USAGE_OUTBOX_STORAGE_KEY);
    }
    weeklyUsageSharedOutboxDurable = true;
    return true;
  } catch {
    weeklyUsageSharedOutboxDurable = false;
    weeklyUsageSharedSaveError = "This browser could not preserve the pending Weekly Usage recovery copy. Keep this page open and do not order from the plan.";
    return false;
  }
}

function stageWeeklyUsageSharedOutbox() {
  const prior = weeklyUsageSharedOutbox;
  const entry = createOperationalOutboxEntry({
    baseRevision: prior?.baseRevision ?? weeklyUsageSharedRevision,
    payload: {
      action: "replace",
      data: getSharedWeeklyUsageData(),
    },
    updatedAt: new Date().toISOString(),
  });
  if (!entry) return false;
  weeklyUsageSharedOutbox = {
    ...entry,
    ...(prior?.conflict ? {
      conflict: true,
      currentRevision: prior.currentRevision,
      lastError: prior.lastError,
    } : {}),
  };
  return saveWeeklyUsageSharedOutbox();
}

function restoreWeeklyUsageFromOutbox() {
  const data = weeklyUsageSharedOutbox?.payload?.data;
  if (!data || typeof data !== "object") return false;
  weeklyUsageApplyingSharedState = true;
  try {
    weeklyUsageItems = Array.isArray(data.activeItems) ? cloneWeeklyUsageValue(data.activeItems) : weeklyUsageItems;
    weeklyUsageArchivedItems = Array.isArray(data.archivedItems) ? cloneWeeklyUsageValue(data.archivedItems) : weeklyUsageArchivedItems;
    weeklyUsageCurrentOverrides = data.currentOverrides && typeof data.currentOverrides === "object"
      ? cloneWeeklyUsageValue(data.currentOverrides)
      : weeklyUsageCurrentOverrides;
    weeklyUsageHistoryOverrides = data.historyOverrides && typeof data.historyOverrides === "object"
      ? cloneWeeklyUsageValue(data.historyOverrides)
      : weeklyUsageHistoryOverrides;
    weeklyUsageLastSyncAt = clean(data.lastSyncAt) || weeklyUsageLastSyncAt;
    saveWeeklyUsageCurrentOverrides();
    saveWeeklyUsageHistoryOverrides();
    saveWeeklyUsageArchivedItems();
    saveWeeklyUsageLastSyncAt();
  } finally {
    weeklyUsageApplyingSharedState = false;
  }
  return true;
}

function cloneWeeklyUsageValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function getSharedWeeklyUsageData() {
  return {
    activeItems: cloneWeeklyUsageValue(weeklyUsageItems),
    archivedItems: cloneWeeklyUsageValue(weeklyUsageArchivedItems),
    currentOverrides: cloneWeeklyUsageValue(weeklyUsageCurrentOverrides),
    historyOverrides: cloneWeeklyUsageValue(weeklyUsageHistoryOverrides),
    lastSyncAt: clean(weeklyUsageLastSyncAt),
  };
}

function applySharedWeeklyUsageState(state) {
  const data = state?.data || {};
  weeklyUsageApplyingSharedState = true;
  try {
    weeklyUsageSharedRevision = Number(state.revision) || 0;
    weeklyUsageSharedInitialized = Boolean(state.initialized);
    weeklyUsageSharedProvisioned = true;
    weeklyUsageItems = Array.isArray(data.activeItems) ? cloneWeeklyUsageValue(data.activeItems) : [];
    weeklyUsageArchivedItems = Array.isArray(data.archivedItems)
      ? cloneWeeklyUsageValue(data.archivedItems)
      : [];
    weeklyUsageCurrentOverrides = data.currentOverrides && typeof data.currentOverrides === "object"
      ? cloneWeeklyUsageValue(data.currentOverrides)
      : {};
    weeklyUsageHistoryOverrides = data.historyOverrides && typeof data.historyOverrides === "object"
      ? cloneWeeklyUsageValue(data.historyOverrides)
      : {};
    weeklyUsageLastSyncAt = clean(data.lastSyncAt);
    saveWeeklyUsageCurrentOverrides();
    saveWeeklyUsageHistoryOverrides();
    saveWeeklyUsageArchivedItems();
    saveWeeklyUsageLastSyncAt();
  } finally {
    weeklyUsageApplyingSharedState = false;
  }
}

async function loadSharedWeeklyUsageState() {
  try {
    const state = await requestSharedWeeklyUsage();
    weeklyUsageSharedProvisioned = true;
    weeklyUsageSharedInitialized = Boolean(state.initialized);
    weeklyUsageSharedRevision = Number(state.revision) || 0;
    if (state.initialized) {
      if (weeklyUsageSharedOutbox) {
        if (areDashboardStateValuesEqual(weeklyUsageSharedOutbox.payload?.data, state.data)) {
          weeklyUsageSharedOutbox = null;
          saveWeeklyUsageSharedOutbox();
          applySharedWeeklyUsageState(state);
          weeklyUsageSharedSaveError = "";
          weeklyUsageSharedMessage = "The pending Weekly Usage report was already saved by another dashboard tab.";
          return;
        }
        restoreWeeklyUsageFromOutbox();
        if (canSafelyRetryOperationalOutbox(weeklyUsageSharedOutbox, state.revision)) {
          weeklyUsageSharedOutbox = markOperationalOutboxFailure(weeklyUsageSharedOutbox);
          saveWeeklyUsageSharedOutbox();
          weeklyUsageSharedMessage = "Recovering a Weekly Usage change that did not finish saving...";
          const recovered = await queueSharedWeeklyUsageSave();
          if (recovered) return;
        } else {
          weeklyUsageSharedOutbox = markOperationalOutboxFailure(weeklyUsageSharedOutbox, {
            conflict: true,
            currentRevision: state.revision,
            message: `Shared Weekly Usage is now revision ${state.revision}, but this browser's recovery copy was based on revision ${weeklyUsageSharedOutbox.baseRevision}.`,
          });
          saveWeeklyUsageSharedOutbox();
        }
        weeklyUsageSharedSaveError = weeklyUsageSharedOutbox?.lastError || "Pending Weekly Usage recovery needs review.";
        weeklyUsageSharedMessage = weeklyUsageSharedOutbox?.conflict
          ? `Weekly Usage conflict: this browser kept its unsynced report from revision ${weeklyUsageSharedOutbox.baseRevision} instead of overwriting it with shared revision ${weeklyUsageSharedOutbox.currentRevision}. Review the local and shared versions before publishing either one.`
          : `Weekly Usage recovery is still pending. This browser kept the unsynced report from revision ${weeklyUsageSharedOutbox?.baseRevision}; ordering remains blocked until it saves successfully.`;
        return;
      }
      applySharedWeeklyUsageState(state);
      weeklyUsageSharedSaveError = "";
      weeklyUsageSharedMessage = "Shared Weekly Usage is available on all signed-in manager devices.";
    } else {
      weeklyUsageSharedMessage = "Setup needed: import Weekly Usage only from the service computer. Until then, reports stay on this device.";
    }
  } catch (error) {
    weeklyUsageSharedProvisioned = false;
    if (weeklyUsageSharedOutbox && restoreWeeklyUsageFromOutbox()) {
      weeklyUsageSharedInitialized = true;
      weeklyUsageSharedRevision = weeklyUsageSharedOutbox.baseRevision;
      weeklyUsageSharedSaveError = error.message || "Shared Weekly Usage could not be loaded.";
      weeklyUsageSharedMessage = `Shared Weekly Usage unavailable. This browser restored its pending local report and blocked ordering: ${error.message}`;
    } else {
      weeklyUsageSharedInitialized = false;
      weeklyUsageSharedMessage = `Shared Weekly Usage unavailable. Reports remain saved on this device only: ${error.message}`;
    }
  }
}

function scheduleSharedWeeklyUsageSave() {
  if (weeklyUsageApplyingSharedState) return;
  if (!weeklyUsageSharedInitialized) {
    weeklyUsageSharedMessage = "Shared Weekly Usage is not initialized. Reports remain saved on this device only.";
    return;
  }

  stageWeeklyUsageSharedOutbox();
  if (weeklyUsageSharedOutbox?.conflict) {
    weeklyUsageSharedSaveError = weeklyUsageSharedOutbox.lastError || "Weekly Usage has an unresolved revision conflict.";
    weeklyUsageSharedMessage = "Weekly Usage changes remain in this browser for explicit conflict review; they will not overwrite the newer shared version.";
    renderWeeklyPlan();
    return;
  }

  clearTimeout(weeklyUsageSharedSaveTimer);
  weeklyUsageSharedSaving = true;
  weeklyUsageSharedMessage = "Saving shared Weekly Usage...";
  weeklyUsageSharedSaveTimer = setTimeout(() => {
    weeklyUsageSharedSaveTimer = null;
    queueSharedWeeklyUsageSave();
  }, 350);
  renderWeeklyPlan();
}

function queueSharedWeeklyUsageSave() {
  if (!weeklyUsageSharedOutbox) stageWeeklyUsageSharedOutbox();
  const initialEntry = normalizeOperationalOutboxEntry(weeklyUsageSharedOutbox);
  if (!initialEntry || initialEntry.conflict) return Promise.resolve(false);
  let activeEntry = initialEntry;
  weeklyUsageSharedPendingWrites += 1;
  weeklyUsageSharedWriteQueue = weeklyUsageSharedWriteQueue.then(async () => {
    activeEntry = normalizeOperationalOutboxEntry(weeklyUsageSharedOutbox) || initialEntry;
    if (activeEntry.conflict) return false;
    try {
      const state = await requestSharedWeeklyUsage({
        action: "replace",
        expectedRevision: activeEntry.baseRevision,
        data: activeEntry.payload.data,
      });
      if (weeklyUsageSharedOutbox?.id === activeEntry.id) {
        weeklyUsageSharedOutbox = null;
        saveWeeklyUsageSharedOutbox();
        applySharedWeeklyUsageState(state);
        weeklyUsageSharedSaveError = "";
        weeklyUsageSharedMessage = "Shared Weekly Usage saved.";
      } else {
        weeklyUsageSharedOutbox = rebaseOperationalOutboxAfterOwnCommit(weeklyUsageSharedOutbox, {
          committedBaseRevision: activeEntry.baseRevision,
          nextRevision: state.revision,
        });
        saveWeeklyUsageSharedOutbox();
        weeklyUsageSharedRevision = Number(state.revision) || weeklyUsageSharedRevision;
        weeklyUsageSharedMessage = "An earlier Weekly Usage save completed; a newer local edit is still pending.";
      }
      return true;
    } catch (error) {
      weeklyUsageSharedSaveError = error.message || "Shared Weekly Usage could not be saved.";
      weeklyUsageSharedOutbox = markOperationalOutboxFailure(weeklyUsageSharedOutbox || activeEntry, {
        message: weeklyUsageSharedSaveError,
        currentRevision: error.currentRevision,
        conflict: error.code === "WEEKLY_USAGE_STATE_REVISION_CONFLICT",
      });
      saveWeeklyUsageSharedOutbox();
      weeklyUsageSharedMessage = error.code === "WEEKLY_USAGE_STATE_REVISION_CONFLICT"
        ? "Another manager changed Weekly Usage first. This browser kept the complete local report for explicit review and will not retry it against a different revision."
        : `Could not save shared Weekly Usage. This browser preserved the pending report for a safe retry: ${error.message}`;
      return false;
    } finally {
      weeklyUsageSharedPendingWrites = Math.max(0, weeklyUsageSharedPendingWrites - 1);
      weeklyUsageSharedSaving = weeklyUsageSharedPendingWrites > 0 || Boolean(weeklyUsageSharedSaveTimer);
      renderWeeklyUsage();
      renderWeeklyPlan();
      renderDashboardOverview();
    }
  });
  return weeklyUsageSharedWriteQueue;
}

async function flushPendingSharedWeeklyUsageSave() {
  if (weeklyUsageSharedSaveTimer) {
    clearTimeout(weeklyUsageSharedSaveTimer);
    weeklyUsageSharedSaveTimer = null;
    const result = await queueSharedWeeklyUsageSave();
    return result !== false
      && weeklyUsageSharedPendingWrites === 0
      && !weeklyUsageSharedSaving
      && !weeklyUsageSharedSaveError
      && !weeklyUsageSharedOutbox
      && weeklyUsageSharedOutboxDurable;
  }
  if (weeklyUsageSharedOutbox) {
    if (!canSafelyRetryOperationalOutbox(weeklyUsageSharedOutbox, weeklyUsageSharedRevision)) return false;
    const recovered = await queueSharedWeeklyUsageSave();
    return recovered !== false && !weeklyUsageSharedOutbox && weeklyUsageSharedOutboxDurable;
  }
  const result = await weeklyUsageSharedWriteQueue;
  return result !== false && weeklyUsageSharedPendingWrites === 0 && !weeklyUsageSharedSaving && !weeklyUsageSharedSaveError && weeklyUsageSharedOutboxDurable;
}

async function initializeSharedWeeklyUsageFromServiceComputer() {
  if (!weeklyUsageSharedProvisioned || weeklyUsageSharedInitialized || weeklyUsageSharedSaving) return;
  const data = getSharedWeeklyUsageData();
  const reportCount = data.activeItems.reduce((total, item) => total + (item.history || []).length, 0);

  if (!confirmDashboardAction(
    "Make this browser's Weekly Usage reports the official shared version?",
    [
      "Source: saved Weekly Usage data in this browser (not a live PMB read).",
      `${data.activeItems.length} current tap row${data.activeItems.length === 1 ? "" : "s"}, ${reportCount} saved weekly report${reportCount === 1 ? "" : "s"}, and ${data.archivedItems.length} replaced-product history row${data.archivedItems.length === 1 ? "" : "s"}.`,
      "Only continue while using the service computer with its complete saved PMB history.",
    ],
    "If you are at home or unsure, cancel and wait until you are back at the service computer.",
  )) return;

  const phrase = window.prompt(
    `Type ${WEEKLY_USAGE_SHARED_IMPORT_PHRASE} to confirm that this is the service computer and its Weekly Usage history is complete.`,
  );
  if (clean(phrase) !== WEEKLY_USAGE_SHARED_IMPORT_PHRASE) {
    weeklyUsageSharedMessage = "Weekly Usage import canceled. Shared reports remain uninitialized.";
    renderWeeklyUsage();
    return;
  }

  weeklyUsageSharedSaving = true;
  weeklyUsageSharedMessage = "Checking the service-computer connection to Pour My Beer...";
  renderWeeklyUsage();
  try {
    await requirePmbWorkNetworkForServiceImport();
    weeklyUsageSharedMessage = "Importing the service computer's Weekly Usage reports...";
    renderWeeklyUsage();
    const state = await requestSharedWeeklyUsage({
      action: "initialize",
      expectedRevision: 0,
      data,
    });
    applySharedWeeklyUsageState(state);
    weeklyUsageSharedSaveError = "";
    weeklyUsageSharedMessage = "Service-computer Weekly Usage imported. PMB reports and replaced-product history are now shared.";
  } catch (error) {
    weeklyUsageSharedMessage = error.code === "WEEKLY_USAGE_STATE_ALREADY_INITIALIZED"
      ? "Shared Weekly Usage was already initialized in another session. Reload to use the official version."
      : `Weekly Usage import failed. Nothing was published from this browser: ${error.message}`;
  } finally {
    weeklyUsageSharedSaving = false;
    renderWeeklyUsage();
  }
}

async function runPmbWeeklyUsageSync({ automatic = false } = {}) {
  if (weeklyUsageSyncLoading) return { ok: false, error: "Weekly Usage is already refreshing." };
  weeklyUsageSyncAttempted = true;

  const weekStarts = getPmbSyncWeekStarts();
  if (!weekStarts.length) {
    weeklyUsageSyncMessage = `${automatic ? "Automatic PMB check complete. " : ""}All recent completed Monday-Sunday weeks are already saved.`;
    renderWeeklyUsage();
    return { ok: true, checkedWeeks: 0, matched: 0, alreadyCurrent: true };
  }

  weeklyUsageSyncLoading = true;
  weeklyUsageSyncMessage = `${automatic ? "Automatically checking" : "Pulling"} ${weekStarts.length} completed PMB week${weekStarts.length === 1 ? "" : "s"}...`;
  renderWeeklyUsage();

  try {
    const requestParams = new URLSearchParams({
      weeks: weekStarts.map(formatIsoDate).join(","),
    });
    const requestWeeklyUsage = async (confirmationToken = "") => {
      const params = new URLSearchParams(requestParams);
      if (confirmationToken) params.set("confirm", confirmationToken);
      return requestOperationalSharedJson(`/api/pmb-weekly-usage?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
      }, 45_000);
    };

    let { response, result } = await requestWeeklyUsage();
    if (!response.ok && result?.code === "PMB_WEEKLY_USAGE_REVIEW_REQUIRED") {
      const reviewWeeks = Array.isArray(result.reviewWeeks) ? result.reviewWeeks : [];
      const reviewDetails = reviewWeeks.map((entry) => {
        if (typeof entry === "string") return `Week: ${clean(entry)}`;
        const range = [
          clean(entry?.weekStart || entry?.start || entry?.week || entry?.label),
          clean(entry?.weekEnd || entry?.end),
        ].filter(Boolean).join(" to ");
        const reason = clean(entry?.reason || entry?.message);
        return [range ? `Week: ${range}` : "Week requiring review", reason].filter(Boolean).join(" — ");
      });
      const overallReason = clean(result.reviewReason || result.reason || result.error);
      if (automatic) {
        weeklyUsageSyncAttempted = false;
        weeklyUsageSyncMessage = [
          "Automatic PMB check paused for owner review.",
          overallReason,
          ...reviewDetails,
          "Open Weekly Usage and refresh manually to review this exception; nothing was accepted or saved automatically.",
        ].filter(Boolean).join(" ");
        return { ok: false, reviewRequired: true, error: weeklyUsageSyncMessage };
      }
      const confirmed = confirmDashboardAction(
        "Pour My Beer returned a sparse or closed week that needs owner review.",
        [overallReason, ...reviewDetails],
        "Continue only if these weeks are legitimately closed or sparse. Confirming records the exception and retries the same report; it does not invent usage rows.",
      );
      if (!confirmed) {
        weeklyUsageSyncAttempted = false;
        weeklyUsageSyncMessage = "Weekly Usage review canceled. No sparse or closed week was accepted or saved.";
        return { ok: false, canceled: true, error: weeklyUsageSyncMessage };
      }
      const confirmationToken = clean(result.confirmationToken);
      if (!confirmationToken) {
        throw new Error("PMB requested owner review but did not provide a valid confirmation token. Nothing was saved.");
      }
      weeklyUsageSyncMessage = "Owner confirmed the reviewed week; retrying the same PMB report...";
      renderWeeklyUsage();
      ({ response, result } = await requestWeeklyUsage(confirmationToken));
    }
    if (!response.ok) {
      const error = new Error(result?.error || "Could not pull PMB weekly usage.");
      error.code = result?.code;
      throw error;
    }

    const applied = applyPmbWeeklyUsageSync(result);
    weeklyUsageLastSyncAt = result.updatedAt || new Date().toISOString();
    saveWeeklyUsageLastSyncAt();
    const successPrefix = automatic ? "Automatic PMB check complete. " : "";
    weeklyUsageSyncMessage = applied.matched
      ? `${successPrefix}Saved ${applied.matched} PMB row${applied.matched === 1 ? "" : "s"} across ${applied.reports} week${applied.reports === 1 ? "" : "s"}. ${applied.archived ? `${applied.archived} old/replaced product row${applied.archived === 1 ? "" : "s"} went to hidden history.` : ""}`
      : `PMB returned ${applied.reportItems} product row${applied.reportItems === 1 ? "" : "s"} across ${applied.reports} week${applied.reports === 1 ? "" : "s"}, but none matched the active tracker.`;
    return { ok: true, checkedWeeks: weekStarts.length, ...applied };
  } catch (error) {
    weeklyUsageSyncAttempted = false;
    const message = getPmbConnectionErrorMessage(error, "Could not pull PMB weekly usage.");
    weeklyUsageSyncMessage = automatic
      ? `${message} Existing saved usage remains visible.`
      : message;
    return { ok: false, error: message };
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
  const isIdentityCandidate = (reportItem) => (
      !usedReportIds.has(getPmbWeeklyUsageReportId(reportItem))
      && toNumber(reportItem.volumeOz) >= 0
      && shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label)
  );
  const identityMatch = findWeeklyUsageIdentityMatch(item, reportItems, isIdentityCandidate);
  if (identityMatch) return identityMatch;
  if (hasWeeklyUsagePhysicalIdentityConflict(item, reportItems, isIdentityCandidate)) return null;

  const exactKeys = getWeeklyUsageNameKeys(item.name, { stripWallNumber: false });
  const exactMatch = reportItems.find((reportItem) => (
    isWeeklyUsageNameFallbackEligible(reportItem)
    &&
    !usedReportIds.has(getPmbWeeklyUsageReportId(reportItem))
    && toNumber(reportItem.volumeOz) > 0
    && shouldApplyWeeklyUsageReportItemToItem(item, reportItem, label)
    && getWeeklyUsageNameKeys(reportItem.name || reportItem.brand, { stripWallNumber: false }).some((key) => exactKeys.includes(key))
  ));
  if (exactMatch) return exactMatch;

  const looseKeys = getWeeklyUsageNameKeys(item.name, { stripWallNumber: true });
  return reportItems.find((reportItem) => (
    isWeeklyUsageNameFallbackEligible(reportItem)
    &&
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
  const historicalFullKegOunces = toNumber(item?.historicalFullKegOunces);
  if (Number.isFinite(historicalFullKegOunces) && historicalFullKegOunces > 0) return historicalFullKegOunces;
  const kegItem = kegWallItems.find((entry) => toNumber(entry.tapNumber) === toNumber(item.tapNumber));
  if (!kegItem) return item.displayUnit === "kegs" ? STANDARD_BEER_KEG_OZ : 0;
  if (normalizeTitle(kegItem.type) === "cocktail") {
    return getCocktailAwareKegFullOunces(
      item,
      kegItem,
      STANDARD_COCKTAIL_KEG_OZ,
    );
  }
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
              <th>Inventory value</th>
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
                      ${onDeck ? `
                        <span class="table-note table-note--accent keg-on-deck-summary">
                          <span>On deck: ${escapeHtml(onDeck.name)}</span>
                          <button class="keg-on-deck-remove" data-keg-key="${escapeHtml(itemKey)}" type="button" aria-label="Remove ${escapeHtml(onDeck.name)} from On Deck for tap ${escapeHtml(item.tapNumber)}">Remove</button>
                        </span>
                      ` : ""}
                      ${renderTapChangeControls(item, liveRow, displayBrand)}
                    </td>
                    <td class="keg-level-cell ${getKegLevelClass(liveRow?.fillLevelPercent)}">
                      <span class="keg-level-display">${formatKegCurrentLevel(item, liveRow)}</span>
                    </td>
                    <td class="keg-value-cell">${currentValue > 0 ? money(currentValue) : '<span class="inventory-order-zero">-</span>'}</td>
                    <td class="keg-pricing-cell">${pricing.chargeHtml}</td>
                    <td class="keg-usage-cell">${formatKegWeeklyUsageAverage(item, displayBrand)}</td>
                    <td><input class="inventory-input keg-input keg-on-hand-input" data-keg-field="onHand" data-keg-key="${escapeHtml(itemKey)}" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" value="${escapeHtml(getKegOnHandEditorValue(onHand))}" placeholder="0" aria-label="On hand kegs for ${escapeHtml(displayBrand)}"></td>
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
      label: `${item.name} (${getComingSoonKindLabel(item.kind, { compact: true })})`,
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
        <h3>${escapeHtml(context.title)}</h3>
        <span>${escapeHtml(status)}</span>
      </div>
      ${context.recipe ? renderCocktailCostEditor(context.recipe) : renderKegCostEmptyState("No matching cocktail recipe was found for this tap yet.")}
    `;
  }

  if (context.kind === "liquor") {
    return `
      <div class="keg-cost-editor__header">
        <h3>${escapeHtml(context.title)}</h3>
        <span>${escapeHtml(status)}</span>
      </div>
      ${context.ingredient ? renderIngredientCostEditor([context.ingredient]) : renderKegCostEmptyState("No mapped bottle cost was found for this liquor tap yet.")}
    `;
  }

  return `
    <div class="keg-cost-editor__header">
      <h3>${escapeHtml(context.title)}</h3>
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
            <th>Package size</th>
            <th>Package price</th>
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
  const preparedPurchase = getPreparedIngredientPurchase(ingredient.id);
  const previousPriceNote = getPreviousPriceNote(override);
  return `
    <tr>
      <td>
        <strong>${escapeHtml(ingredient.name)}</strong>
        ${ingredient.recipeOz ? `<span class="table-note">${formatNumber(ingredient.recipeOz)} oz in recipe</span>` : ""}
      </td>
      <td>${currentUnitCost ? money(currentUnitCost) : '<span class="inventory-order-zero">-</span>'}</td>
      <td>${preparedPurchase
        ? `<span class="table-note">${escapeHtml(getPreparedIngredientYieldNote(ingredient.id))}</span><input class="keg-cost-bottle-oz" data-ingredient-id="${escapeHtml(ingredient.id)}" type="hidden" value="${escapeHtml(preparedPurchase.purchaseUnitStorageValue)}">`
        : `<input class="inventory-input keg-cost-bottle-oz" data-ingredient-id="${escapeHtml(ingredient.id)}" type="text" inputmode="decimal" value="${escapeHtml(override.bottleOz ?? "")}" placeholder="${escapeHtml(mappedBottleOz)}" aria-label="Package size in ounces for ${escapeHtml(ingredient.name)}">`}</td>
      <td><input class="inventory-input keg-cost-bottle-price" data-ingredient-id="${escapeHtml(ingredient.id)}" type="text" inputmode="decimal" value="${escapeHtml(override.bottlePrice ?? "")}" aria-label="${escapeHtml(preparedPurchase?.priceInputLabel || `Package price for ${ingredient.name}`)}"></td>
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
  const options = getKegOnDeckOptions(item);
  const selectedId = onDeck?.comingSoonId || "";
  return `
    <label class="keg-on-deck-control">
      <span>On Deck product</span>
      <select class="keg-on-deck-select" data-keg-key="${escapeHtml(itemKey)}"${options.length ? "" : " disabled"}>
        <option value="">No On Deck product</option>
        ${options.map((entry) => `
          <option value="${escapeHtml(entry.id)}"${entry.id === selectedId ? " selected" : ""}>
            ${escapeHtml(entry.name)} (${escapeHtml(getComingSoonKindLabel(entry.kind, { compact: true }))})
          </option>
        `).join("")}
      </select>
    </label>
  `;
}

function renderKegLevelAdjustRow(item, liveRow, displayBrand = item.brand) {
  const itemKey = getKegItemKey(item);
  const disabled = !liveRow?.plu || !liveRow?.deviceId || !liveRow?.lineNum;
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

  const currentOunces = getKegCurrentLevelOz(liveRow, item);
  const fullOunces = getKegFullOunces(liveRow, item);
  if (!Number.isFinite(currentOunces) || !fullOunces) return;

  const targetOunces = Math.min(fullOunces, Math.max(0, currentOunces + deltaOunces));
  const targetPercent = (targetOunces / fullOunces) * 100;
  percentInput.value = formatNumber(Math.round(targetPercent * 10) / 10);
}

async function pushKegLevelAdjustment(key) {
  const item = getKegWallItemByKey(key);
  const liveRow = item ? getKegLiveRow(item) : null;
  if (!item || !liveRow?.plu || !liveRow?.deviceId || !liveRow?.lineNum) {
    kegSyncMessage = "That tap does not have a verified PMB PLU, device, and line yet. Refresh keg levels first.";
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

  if (!confirmDashboardAction(
    `Push a live keg-level change for ${item.brand}?`,
    [
      `PMB target: PLU ${liveRow.plu}, device ${liveRow.deviceId}, line ${liveRow.lineNum}`,
      liveRow.fillLevelPercent == null
        ? "Current level: Not reported"
        : `Current level: ${formatNumber(liveRow.fillLevelPercent)}%`,
      deltaOunces ? `Ounce adjustment: ${deltaOunces}` : "",
      targetPercent ? `Target level: ${targetPercent}%` : "",
    ],
    "The server will re-check this exact PMB tap mapping before changing the physical wall.",
  )) return;

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
    kegSyncMessage = getPmbConnectionErrorMessage(
      error,
      "Could not push keg level adjustment.",
      { writeAttempted: true },
    );
  } finally {
    kegConfigUpdateRunning = false;
    renderKegLevels();
  }
}

function clearAllKegOnHand() {
  const nonZeroCount = kegWallItems.filter((item) => (
    toNumber(kegOnHandOverrides[getKegItemKey(item)]) > 0
  )).length;
  if (!confirmDashboardAction(
    "Clear the entire Keg Levels on-hand column?",
    [
      `All ${kegWallItems.length} on-hand counts will be set to zero.`,
      `${nonZeroCount} non-zero count${nonZeroCount === 1 ? "" : "s"} will be cleared.`,
    ],
    "This updates the shared counts used by the par agent.",
  )) return;

  kegOnHandOverrides = createClearedKegOnHandOverrides(kegWallItems, getKegItemKey);
  saveKegOnHandOverrides();
  kegSyncMessage = `Cleared all ${kegWallItems.length} on-hand counts to zero.`;
  scheduleParAgentStateSync({ immediate: true });
  renderKegLevels();
}

function bindKegLevelEvents() {
  document.querySelector("#view-missing-recipes")?.addEventListener("click", () => {
    switchRecipeView("current");
    switchTab("recipes");
    recipeCoverageAlert?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
  document.querySelector("#clear-keg-on-hand")?.addEventListener("click", clearAllKegOnHand);
  document.querySelector("#initialize-shared-keg-levels")?.addEventListener("click", () => {
    initializeSharedKegLevelsFromServiceComputer();
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

  document.querySelectorAll('.keg-input[data-keg-field="onHand"]').forEach((input) => {
    input.dataset.lastValidValue = normalizeKegOnHandDraft(input.value);

    input.addEventListener("focus", () => input.select());
    input.addEventListener("click", () => input.select());

    input.addEventListener("keydown", (event) => {
      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const inputs = [...document.querySelectorAll('.keg-input[data-keg-field="onHand"]')];
      const currentIndex = inputs.indexOf(input);
      const nextIndex = getAdjacentKegOnHandIndex(
        currentIndex,
        inputs.length,
        event.key === "ArrowUp" ? "up" : "down",
      );
      const nextInput = inputs[nextIndex];
      if (!nextInput || nextInput === input) return;
      nextInput.focus();
      nextInput.select();
      nextInput.scrollIntoView({ block: "nearest" });
    });

    input.addEventListener("input", (event) => {
      const target = event.currentTarget;
      const key = target.dataset.kegKey;
      if (!key) return;

      const nextValue = normalizeKegOnHandDraft(target.value, target.dataset.lastValidValue || "");
      if (target.value !== nextValue) target.value = nextValue;
      target.dataset.lastValidValue = nextValue;
      kegOnHandOverrides[key] = nextValue || "0";
      saveKegOnHandOverrides();
      updateKegNeedCell(key, target);
    });

    input.addEventListener("change", () => {
      scheduleParAgentStateSync();
    });
  });

  document.querySelectorAll('.keg-input:not([data-keg-field="onHand"])').forEach((input) => {
    input.addEventListener("input", (event) => {
      const target = event.currentTarget;
      const key = target.dataset.kegKey;
      const field = target.dataset.kegField;
      if (!key || !field) return;

      const nextValue = target.value;

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

  document.querySelectorAll(".keg-on-deck-remove").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.kegKey;
      const onDeck = getKegOnDeckItem(key);
      if (!key || !onDeck) return;
      setKegOnDeckItem(key, "");
      saveKegOnDeckOverrides();
      scheduleParAgentStateSync({ immediate: true });
      kegSyncMessage = `${onDeck.name} was removed from On Deck.`;
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
  const abvPercent = toNumber(item.abvPercent);
  if (!item.plu || !pricePerOz || abvPercent <= 0 || abvPercent > 100) {
    kegSyncMessage = "That beer is missing a PMB product id, keg cost, or verified ABV, so pricing was not updated.";
    renderKegLevels();
    return;
  }

  if (!confirmDashboardAction(
    `Update ${item.name} pricing in Pour My Beer?`,
    [
      `PMB PLU: ${item.plu}`,
      `New charge: ${money(pricePerOz)} / oz`,
      `Target margin: ${formatNumber(targetMargin)}%`,
      `ABV: ${formatNumber(abvPercent)}%`,
    ],
    "This updates the existing PMB product immediately.",
  )) return;

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
        abvPercent,
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
    kegSyncMessage = getPmbConnectionErrorMessage(
      error,
      "Could not update PMB pricing.",
      { writeAttempted: true },
    );
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

  if (!confirmDashboardAction(
    `${item.plu ? "Update" : "Create"} ${item.name} in Pour My Beer?`,
    [
      item.plu ? `Existing PMB PLU: ${item.plu}` : "A new PMB product will be created.",
      `Charge: ${money(payload.pricePerOz)} / oz`,
      `Serving size: ${formatNumber(payload.servingOz)} oz`,
      payload.abvPercent ? `ABV: ${formatNumber(payload.abvPercent)}%` : "",
    ],
    "Review the product and price before continuing.",
  )) return null;

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
    kegSyncMessage = getPmbConnectionErrorMessage(
      error,
      "Could not save the PMB product.",
      { writeAttempted: true },
    );
    renderKegLevels();
    return null;
  }
}

function buildPmbPayloadFromComingSoonItem(item) {
  const imageUrl = clean(item.imageUrl);
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
    imageUrl: imageUrl.startsWith("/") ? new URL(imageUrl, window.location.origin).href : imageUrl,
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
  const liveRow = getKegLiveRow(tap);
  if (!liveRow?.plu || !liveRow?.deviceId || !liveRow?.lineNum) {
    kegSyncMessage = "That physical tap has not been verified against live PMB yet. Refresh keg levels on the work network before replacing it.";
    renderKegLevels();
    return;
  }
  const tapLabel = `${tap.wall} ${tap.tapNumber}`;
  const target = buildTapReplacementTarget(details, item, replacementValue);
  if (!confirmDashboardAction(
    `Change ${tapLabel} in Pour My Beer?`,
    [
      `Current product: ${tap.brand}`,
      `New product: ${target.name}`,
      `PMB target: PLU ${liveRow.plu}, device ${liveRow.deviceId}, line ${liveRow.lineNum}`,
      target.plu ? `Existing PMB PLU: ${target.plu}` : "A new or matching PMB product may be used.",
      target.chargePerOz ? `Charge: ${money(target.chargePerOz)} / oz` : "",
    ],
    "This changes the product assigned to a physical tap and sends a wall configuration update.",
  )) return;

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
        currentPlu: toNumber(liveRow.plu),
        deviceId: toNumber(liveRow.deviceId),
        lineNum: toNumber(liveRow.lineNum),
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
      tapNumber: toNumber(tap.tapNumber),
      oldBrand: tap.brand,
      oldPlu: toNumber(liveRow.plu),
      newBrand,
      newKind: target.productKind || target.kind || details.kind,
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

    const clearedOnDeck = clearKegOnDeckIfInstalled(tapKey, {
      name: newBrand,
      tapProduct: newBrand,
      plu: newPlu,
    });
    if (clearedOnDeck) {
      saveKegOnDeckOverrides();
      scheduleParAgentStateSync({ immediate: true });
    }

    saveTapReplacementOverrides();
    saveComingSoonItems();
    kegSyncMessage = `${newBrand} was pushed to PMB on ${tapLabel}${result.configUpdateSent ? " and the affected tap wall was updated." : "."}`;
    await runTapPricingSync();
    await runKegLevelSync();
    kegSyncMessage = `${newBrand} was pushed to PMB on ${tapLabel}${result.configUpdateSent ? " and the affected tap wall was updated." : "."}`;
  } catch (error) {
    kegSyncMessage = getPmbConnectionErrorMessage(
      error,
      "Could not change the PMB tap product.",
      { writeAttempted: true },
    );
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

async function requestParAgentState(body = null, timeoutMs = OPERATIONAL_SHARED_REQUEST_TIMEOUT_MS) {
  const { response, result } = await requestOperationalSharedJson("/api/keg-par-agent", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }, timeoutMs);
  if (!response.ok) {
    const error = new Error(result?.error || `Keg Levels shared-state request failed (${response.status}).`);
    error.code = result?.code || "KEG_STATE_ERROR";
    error.status = response.status;
    error.currentRevision = result?.currentRevision;
    throw error;
  }
  return result;
}

function loadKegLevelsOutbox() {
  try {
    return normalizeOperationalOutboxEntry(JSON.parse(localStorage.getItem(KEG_LEVELS_OUTBOX_STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

function saveKegLevelsOutbox() {
  try {
    if (parAgentStateOutbox) localStorage.setItem(KEG_LEVELS_OUTBOX_STORAGE_KEY, JSON.stringify(parAgentStateOutbox));
    else localStorage.removeItem(KEG_LEVELS_OUTBOX_STORAGE_KEY);
    parAgentStateOutboxDurable = true;
    return true;
  } catch {
    parAgentStateOutboxDurable = false;
    parAgentError = "This browser could not preserve the pending Keg Levels recovery copy. Keep this page open and do not order from the plan.";
    return false;
  }
}

function stageKegLevelsOutbox() {
  const prior = parAgentStateOutbox;
  const entry = createOperationalOutboxEntry({
    baseRevision: prior?.baseRevision ?? parAgentState?.revision,
    payload: {
      action: "sync-state",
      onHandOverrides: { ...kegOnHandOverrides },
      parOverrides: { ...kegParOverrides },
      onDeckOverrides: { ...kegOnDeckOverrides },
      settings: getParAgentSettings(),
    },
    updatedAt: new Date().toISOString(),
  });
  if (!entry) return null;
  parAgentStateOutbox = {
    ...entry,
    ...(prior?.conflict ? {
      conflict: true,
      currentRevision: prior.currentRevision,
      lastError: prior.lastError,
    } : {}),
  };
  saveKegLevelsOutbox();
  return parAgentStateOutbox;
}

function restoreKegLevelsOutbox(result = {}) {
  const payload = parAgentStateOutbox?.payload;
  if (!payload) return false;
  parAgentState = {
    ...(result || {}),
    revision: Number(result?.revision ?? parAgentStateOutbox.baseRevision),
    initialized: result?.initialized !== false,
    onHandOverrides: { ...(payload.onHandOverrides || {}) },
    parOverrides: { ...(payload.parOverrides || {}) },
    onDeckOverrides: { ...(payload.onDeckOverrides || {}) },
    settings: { ...(payload.settings || {}) },
  };
  kegOnHandOverrides = { ...(payload.onHandOverrides || {}) };
  kegParOverrides = { ...(payload.parOverrides || {}) };
  kegOnDeckOverrides = { ...(payload.onDeckOverrides || {}) };
  saveKegOnHandOverrides();
  saveKegParOverrides();
  saveKegOnDeckOverrides();
  parAgentInputsChangedAt = parAgentStateOutbox.updatedAt || new Date().toISOString();
  return true;
}

async function loadParAgentState() {
  try {
    const result = await requestParAgentState();
    if (parAgentStateOutbox) {
      restoreKegLevelsOutbox(result);
      if (canSafelyRetryOperationalOutbox(parAgentStateOutbox, result.revision)) {
        parAgentStateOutbox = markOperationalOutboxFailure(parAgentStateOutbox);
        saveKegLevelsOutbox();
        parAgentMessage = "Recovering Keg Levels inputs that did not finish saving...";
        const recovered = await syncParAgentState({ silent: false });
        if (recovered) return;
      } else {
        parAgentStateOutbox = markOperationalOutboxFailure(parAgentStateOutbox, {
          conflict: true,
          currentRevision: result.revision,
          message: `Shared Keg Levels is now revision ${result.revision}, but this browser's recovery copy was based on revision ${parAgentStateOutbox.baseRevision}.`,
        });
        saveKegLevelsOutbox();
      }
      parAgentError = parAgentStateOutbox?.lastError || "Pending Keg Levels recovery needs review.";
      parAgentMessage = parAgentStateOutbox?.conflict
        ? `Keg Levels conflict: this browser restored its unsynced inputs from revision ${parAgentStateOutbox.baseRevision} instead of overwriting them with shared revision ${parAgentStateOutbox.currentRevision}. Review the local and shared versions before publishing.`
        : `Keg Levels recovery is still pending. This browser restored the unsynced inputs from revision ${parAgentStateOutbox?.baseRevision}; ordering remains blocked until they save successfully.`;
      return;
    }
    parAgentError = "";
    applyParAgentState(result, { hydrate: true });
  } catch (error) {
    if (parAgentStateOutbox && restoreKegLevelsOutbox()) {
      parAgentError = error.message || "Could not load shared Keg Levels.";
      parAgentMessage = `Shared Keg Levels is unavailable. This browser restored its pending inputs and blocked ordering: ${parAgentError}`;
    } else {
      parAgentError = error.message || "Could not load weekly par agent.";
      parAgentMessage = parAgentError;
    }
  }
}

function applyParAgentState(state, { hydrate = false } = {}) {
  parAgentState = state || {};
  if (!parAgentState.initialized) {
    parAgentMessage = "Setup needed: import Keg Levels only from the service computer. Counts and par choices stay on this device until then.";
    return;
  }
  const serverOnHand = parAgentState.onHandOverrides || {};
  const serverPars = parAgentState.parOverrides || {};
  const serverOnDeck = parAgentState.onDeckOverrides || {};
  kegOnHandOverrides = { ...serverOnHand };
  kegParOverrides = { ...serverPars };
  kegOnDeckOverrides = { ...serverOnDeck };
  saveKegOnHandOverrides();
  saveKegParOverrides();
  saveKegOnDeckOverrides();

  parAgentMessage = getParAgentStatusMessage();
}

function hasCurrentParAgentRecommendations() {
  const recommendations = parAgentState?.recommendations;
  if (!recommendations?.generatedAt) return false;
  if (parAgentInputsChangedAt) return false;
  return isRecommendationSourceRevisionCurrent(
    parAgentState?.revision,
    recommendations.sourceStateRevision,
    recommendations.publishedStateRevision,
  );
}

function getParAgentStatusMessage() {
  if (!parAgentState?.initialized) {
    return "Setup needed: import Keg Levels only from the service computer. Counts and par choices stay on this device until then.";
  }
  const recommendations = parAgentState?.recommendations;
  if (!recommendations?.generatedAt) {
    return "Needs have not been calculated yet.";
  }
  if (!hasCurrentParAgentRecommendations()) {
    return "Counts changed. Update needs again.";
  }

  const summary = recommendations.summary || {};
  if (summary.inventoryStateMissing) {
    return "On-hand counts are still syncing.";
  }
  return `Updated ${formatUpdatedAt(recommendations.generatedAt)}`;
}

function getParAgentSettings() {
  const maxOrderPerTap = parAgentState?.settings?.maxOrderPerTap;
  return maxOrderPerTap == null ? {} : { maxOrderPerTap };
}

function renderParAgentPanel() {
  return `
    <div class="sync-panel sync-panel--par-agent">
      <div class="sync-actions par-agent-actions">
        <button class="primary-button" id="run-par-agent" type="button"${parAgentRunning ? " disabled" : ""}>${parAgentRunning ? "Updating..." : "Update needs"}</button>
      </div>
      ${parAgentState?.initialized === false ? '<button class="ghost-button" id="initialize-shared-keg-levels" type="button">Import from service computer</button>' : ""}
      <p class="sync-status">${escapeHtml(parAgentMessage)}</p>
    </div>
  `;
}

function getCocktailsToMake() {
  if (!hasCurrentParAgentRecommendations()) return [];
  return (parAgentState?.recommendations?.items || [])
    .filter((item) => item.actionType === "make" && toNumber(item.orderQty) > 0)
    .sort((a, b) => toNumber(a.tapNumber) - toNumber(b.tapNumber) || clean(a.name).localeCompare(clean(b.name)));
}

function renderCocktailsToMakePanel() {
  const items = getCocktailsToMake();
  const recommendationsStale = Boolean(parAgentState?.recommendations?.generatedAt) && !hasCurrentParAgentRecommendations();
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
              <strong>${escapeHtml(getCocktailPrepDisplayName(getCanonicalProductDisplayName(item.orderProductName || item.name), item.wall))}</strong>
              <span>Tap ${formatNumber(item.tapNumber)} · Make ${formatNumber(item.orderQty)}</span>
            </div>
          `).join("")}
        </div>
      ` : `<p class="sync-status">${recommendationsStale ? "Cocktail recommendations are hidden because Keg Levels changed after the last run. Refresh the par agent." : "No cocktails need to be made from the current par-agent run."}</p>`}
    </div>
  `;
}

function getParAgentRecommendation(item) {
  if (!hasCurrentParAgentRecommendations()) return null;
  const key = getKegItemKey(item);
  const recommendations = parAgentState?.recommendations?.items || [];
  return recommendations.find((entry) => entry.key === key)
    || recommendations.find((entry) => toNumber(entry.tapNumber) === toNumber(item.tapNumber))
    || null;
}

function scheduleParAgentStateSync({ immediate = false } = {}) {
  parAgentInputsChangedAt = new Date().toISOString();
  parAgentStateMutationVersion += 1;
  const mutationVersion = parAgentStateMutationVersion;
  const staged = stageKegLevelsOutbox();
  if (staged?.conflict) {
    parAgentError = staged.lastError || "Keg Levels has an unresolved revision conflict.";
    parAgentMessage = "This Keg Levels change remains saved locally for explicit conflict review; it will not overwrite the newer shared revision.";
    renderKegLevels();
    renderWeeklyPlan();
    return;
  }
  clearTimeout(parAgentStateSyncTimer);
  parAgentStateSyncTimer = setTimeout(() => {
    parAgentStateSyncTimer = null;
    parAgentStateSyncQueue = parAgentStateSyncQueue
      .then(() => syncParAgentState({ silent: true, mutationVersion }))
      .catch(() => {});
  }, immediate ? 0 : 1500);
  renderWeeklyPlan();
}

async function syncParAgentState({ silent = false, mutationVersion = parAgentStateMutationVersion } = {}) {
  if (!parAgentState?.initialized) {
    if (!silent) {
      parAgentMessage = getParAgentStatusMessage();
      renderKegLevels();
    }
    return false;
  }
  if (!parAgentStateOutbox) stageKegLevelsOutbox();
  const sentEntry = normalizeOperationalOutboxEntry(parAgentStateOutbox);
  if (!sentEntry || sentEntry.conflict) {
    parAgentError = sentEntry?.lastError || "Keg Levels has an unresolved recovery conflict.";
    parAgentMessage = parAgentError;
    if (!silent) renderKegLevels();
    renderWeeklyPlan();
    return false;
  }
  try {
    const result = await requestParAgentState({
      ...sentEntry.payload,
      expectedRevision: sentEntry.baseRevision,
    });
    if (parAgentStateOutbox?.id === sentEntry.id && mutationVersion === parAgentStateMutationVersion) {
      parAgentStateOutbox = null;
      saveKegLevelsOutbox();
      applyParAgentState(result);
    } else {
      parAgentStateOutbox = rebaseOperationalOutboxAfterOwnCommit(parAgentStateOutbox, {
        committedBaseRevision: sentEntry.baseRevision,
        nextRevision: result.revision,
      });
      saveKegLevelsOutbox();
      parAgentState = {
        ...(parAgentState || {}),
        revision: result.revision,
        initialized: result.initialized,
        updatedAt: result.updatedAt,
      };
    }
    parAgentError = "";
    parAgentMessage = parAgentStateOutbox
      ? "An earlier Keg Levels save completed; newer local inputs are still pending."
      : getParAgentStatusMessage();
    return true;
  } catch (error) {
    parAgentStateOutbox = markOperationalOutboxFailure(parAgentStateOutbox || sentEntry, {
      message: error.message || "Could not save par agent state.",
      currentRevision: error.currentRevision,
      conflict: error.code === "KEG_STATE_REVISION_CONFLICT",
    });
    saveKegLevelsOutbox();
    parAgentError = error.message || "Could not save par agent state.";
    if (error.code === "KEG_STATE_REVISION_CONFLICT") {
      parAgentMessage = "Another manager changed Keg Levels first. This browser preserved its local inputs for explicit review and will not retry them against a different revision.";
      renderKegLevels();
      renderWeeklyPlan();
      return false;
    }
    parAgentMessage = `Could not save Keg Levels. The complete input payload remains in this browser for a safe retry: ${parAgentError}`;
    if (!silent) renderKegLevels();
    renderWeeklyPlan();
    return false;
  }
}

async function flushPendingParAgentStateSync() {
  let enqueued = false;
  if (parAgentStateSyncTimer) {
    clearTimeout(parAgentStateSyncTimer);
    parAgentStateSyncTimer = null;
    const mutationVersion = parAgentStateMutationVersion;
    parAgentStateSyncQueue = parAgentStateSyncQueue
      .then(() => syncParAgentState({ silent: false, mutationVersion }))
      .catch(() => false);
    enqueued = true;
  }
  if (parAgentStateOutbox && !enqueued) {
    if (!canSafelyRetryOperationalOutbox(parAgentStateOutbox, parAgentState?.revision)) return false;
    const mutationVersion = parAgentStateMutationVersion;
    parAgentStateSyncQueue = parAgentStateSyncQueue
      .then(() => syncParAgentState({ silent: false, mutationVersion }))
      .catch(() => false);
  }
  const result = await parAgentStateSyncQueue;
  return result !== false && !parAgentStateOutbox && parAgentStateOutboxDurable;
}

async function runKegParAgent() {
  if (!parAgentState?.initialized) {
    parAgentMessage = getParAgentStatusMessage();
    renderKegLevels();
    renderWeeklyPlan();
    return false;
  }
  if (parAgentRunning) return false;
  if (parAgentStateSyncTimer || parAgentStateOutbox) {
    const inputsSaved = await flushPendingParAgentStateSync();
    if (!inputsSaved) {
      parAgentError = "Pending Keg Levels inputs could not be saved before the recommendation run.";
      parAgentMessage = parAgentError;
      renderKegLevels();
      renderWeeklyPlan();
      return false;
    }
  }
  parAgentRunning = true;
  parAgentError = "";
  parAgentMessage = "Pulling PMB levels and matching configured taps to the saved Weekly Usage averages...";
  renderKegLevels();
  renderWeeklyPlan();

  try {
    const result = await requestParAgentState({
        action: "run",
        expectedRevision: parAgentState.revision,
        onHandOverrides: kegOnHandOverrides,
        parOverrides: kegParOverrides,
        onDeckOverrides: kegOnDeckOverrides,
        settings: getParAgentSettings(),
      }, PAR_AGENT_RUN_REQUEST_TIMEOUT_MS);

    applyParAgentState(result);
    parAgentInputsChangedAt = "";
    parAgentError = "";
    parAgentMessage = getParAgentStatusMessage();
    return true;
  } catch (error) {
    parAgentError = error.code === "KEG_STATE_REVISION_CONFLICT"
      ? "Another manager changed Keg Levels first. Reload before running the agent again."
      : error.message || "Could not run par agent.";
    parAgentMessage = parAgentError;
    return false;
  } finally {
    parAgentRunning = false;
    renderKegLevels();
    renderWeeklyPlan();
    renderDashboardOverview();
  }
}

async function runWeeklyPlanUpdate() {
  if (weeklyPlanUpdating || parAgentRunning) return;
  if (getCurrentWeeklyPlanSnapshot(parAgentState?.recommendations, new Date())) {
    weeklyPlanRefreshMessage = "This Monday order is locked through Sunday for Thursday delivery. Live keg levels can still refresh without changing the published plan.";
    renderWeeklyPlan();
    return;
  }
  if (!parAgentState?.initialized || !weeklyUsageSharedInitialized || !inventorySharedInitialized) {
    parAgentError = "Complete the shared Keg Levels, Weekly Usage, and Inventory setup before updating the Weekly Plan.";
    weeklyPlanRefreshMessage = parAgentError;
    renderWeeklyPlan();
    return;
  }
  if (!getCurrentMondayInventorySnapshot(inventoryHistory, new Date())) {
    weeklyPlanRefreshMessage = "Save this week's Monday Inventory Snapshot before locking the plan.";
    renderWeeklyPlan();
    return;
  }
  const frozenKegPlan = getCurrentMondayKegPlanSnapshot();
  if (!frozenKegPlan) {
    weeklyPlanRefreshMessage = "Resave this week's Monday Snapshot so it includes PMB keg levels, backup/on-hand kegs, and cocktail prep needs.";
    renderWeeklyPlan();
    return;
  }

  weeklyPlanUpdating = true;
  parAgentError = "";
  weeklyPlanRefreshMessage = "Locking the order and cocktail plan from the saved Monday snapshot...";
  renderWeeklyPlan();

  try {
    const published = await publishCurrentWeeklyPlanSnapshot();
    if (!published) throw new Error("The saved Monday snapshot could not be locked for the week.");

    const summary = parAgentState?.recommendations?.summary || {};
    weeklyPlanRefreshMessage = `Monday plan locked for Thursday delivery from the saved snapshot: ${formatNumber(summary.tapCount || 0)} tap recommendation${toNumber(summary.tapCount) === 1 ? "" : "s"}, including saved keg levels, on-hand kegs, and cocktail prep, will stay fixed through Sunday.`;
    parAgentError = "";
  } catch (error) {
    parAgentError = error.message || "Weekly Plan update failed.";
    weeklyPlanRefreshMessage = `${parAgentError} The last successful plan remains visible and is marked not ready.`;
  } finally {
    weeklyPlanUpdating = false;
    renderWeeklyPlan();
  }
}

async function initializeSharedKegLevelsFromServiceComputer() {
  if (parAgentState?.initialized || !parAgentState) return;
  const count = Object.keys(kegOnHandOverrides).length;
  if (!confirmDashboardAction(
    "Make this browser's Keg Levels choices the official shared version?",
    [
      "Source: the saved keg counts, pars, on-deck selections, and cooler setting in this browser.",
      `${count} backup/on-hand count${count === 1 ? "" : "s"} will be published for all signed-in managers.`,
      "Only continue while using the service computer with the complete current keg setup.",
    ],
    "If you are at home or unsure, cancel and wait until you are back at the service computer.",
  )) return;
  const phrase = window.prompt(`Type ${KEG_LEVELS_SHARED_IMPORT_PHRASE} to confirm this is the service computer.`);
  if (clean(phrase) !== KEG_LEVELS_SHARED_IMPORT_PHRASE) {
    parAgentMessage = "Keg Levels import canceled. Shared Keg Levels remain uninitialized.";
    renderKegLevels();
    return;
  }
  parAgentMessage = "Checking the service-computer connection to Pour My Beer...";
  renderKegLevels();
  try {
    await requirePmbWorkNetworkForServiceImport();
    parAgentMessage = "Importing the service computer's Keg Levels choices...";
    renderKegLevels();
    const result = await requestParAgentState({ action: "initialize", expectedRevision: 0, onHandOverrides: kegOnHandOverrides, parOverrides: kegParOverrides, onDeckOverrides: kegOnDeckOverrides, settings: getParAgentSettings() });
    applyParAgentState(result);
    parAgentMessage = "Service-computer Keg Levels imported. Counts, pars, on-deck choices, and recommendations are now shared.";
  } catch (error) {
    parAgentMessage = error.code === "KEG_STATE_ALREADY_INITIALIZED"
      ? "Shared Keg Levels was already initialized in another session. Reload to use the official version."
      : `Keg Levels import failed. Nothing was published from this browser: ${error.message}`;
  }
  renderKegLevels();
}

async function runKegLevelSync() {
  kegSyncAttempted = true;
  kegSyncLoading = true;
  kegSyncMessage = "Checking Pour My Beer for live keg levels...";
  renderKegLevels();
  let succeeded = false;

  try {
    const { response, result } = await fetchPmbJsonWithRetry({
      fetcher: () => fetch("/api/keg-levels", { cache: "no-store" }),
      parseResponse: parseJsonResponse,
    });
    if (!response.ok) {
      throw new Error(result?.error || "Could not load keg levels.");
    }

    const selection = selectPmbCurrentTapSnapshot({
      candidate: result,
      fallback: pmbCurrentTapSnapshot,
      expectedTapNumbers: kegWallItems.map((item) => item.tapNumber),
    });
    if (selection.source !== "candidate") {
      if (selection.snapshot) applyPmbCurrentTapSnapshot(selection.snapshot);
      throw new Error(selection.issue || "PMB did not return the complete wall.");
    }

    pmbCurrentTapSnapshot = selection.snapshot;
    applyPmbCurrentTapSnapshot(pmbCurrentTapSnapshot);
    kegLiveLevelsStale = Boolean(result.stale);
    const installedOnDeckItems = kegLiveLevelsStale ? [] : reconcileInstalledKegOnDeckProducts();
    if (!kegLiveLevelsStale) savePmbCurrentTapSnapshot();
    kegSyncMessage = kegLiveLevelsStale
      ? `Last known taps and levels from ${formatUpdatedAt(kegUpdatedAt)}.`
      : installedOnDeckItems.length
        ? `Found live levels for ${result.items?.length || 0} products. Removed ${installedOnDeckItems.map((entry) => `${entry.name} from On Deck on tap ${entry.tapNumber}`).join(", ")} because ${installedOnDeckItems.length === 1 ? "it is" : "they are"} now connected.`
        : `Found live levels for ${result.items?.length || 0} products.`;
    renderIngredients();
    renderPricing();
    succeeded = !kegLiveLevelsStale;
  } catch (error) {
    const fallback = selectPmbCurrentTapSnapshot({
      fallback: pmbCurrentTapSnapshot,
      expectedTapNumbers: kegWallItems.map((item) => item.tapNumber),
    });
    if (fallback.snapshot) {
      applyPmbCurrentTapSnapshot(fallback.snapshot);
      kegLiveLevelsStale = true;
    }
    kegSyncMessage = fallback.snapshot
      ? "PMB unavailable. Showing last complete sync."
      : getPmbConnectionErrorMessage(error, "Could not load live keg levels.");
  } finally {
    kegSyncLoading = false;
    renderKegLevels();
    renderWeeklyPlan();
    renderDashboardOverview();
  }
  return succeeded;
}

async function runTapPricingSync() {
  if (tapPricingSyncLoading) return false;
  tapPricingSyncAttempted = true;
  tapPricingSyncLoading = true;
  liveTapPricingMessage = "Checking Pour My Beer for current tap prices...";
  renderPricingSummary();
  let succeeded = false;

  try {
    const { response, result } = await fetchPmbJsonWithRetry({
      fetcher: () => fetch("/api/tap-pricing", { cache: "no-store" }),
      parseResponse: parseJsonResponse,
    });
    if (!response.ok) {
      throw new Error(result?.error || "Could not load tap pricing.");
    }

    liveTapPriceItems = filterCurrentTapPricingItems(result.items);
    shotPricingCapability = result.portionPricing && typeof result.portionPricing === "object"
      ? result.portionPricing
      : {
          writeAvailable: false,
          code: "PMB_PORTION_SCHEMA_UNVERIFIED",
          message: "PMB did not report a verified shot-pricing write capability. Existing prices remain untouched.",
        };
    kegPricingItems = buildKegPricingCatalog(kegWallItems, getCurrentKegPricingTapItems());
    liveTapPrices = buildLiveTapPriceMap(liveTapPriceItems);
    liveTapPricingUpdatedAt = clean(result.updatedAt);
    const matchedCount = getActiveRecipes().filter((recipe) => getLiveTapPrice(recipe)).length;
    liveTapPricingMessage = `Matched ${matchedCount} recipes from Pour My Beer.`;
    renderPricing();
    renderKegLevels();
    renderWeeklyUsage();
    renderRecipes();
    renderOldRecipes();
    renderStats();
    succeeded = true;
  } catch (error) {
    liveTapPricingUpdatedAt = "";
    liveTapPricingMessage = getPmbConnectionErrorMessage(error, "Could not load current tap pricing.");
    renderPricing();
    renderKegLevels();
  } finally {
    tapPricingSyncLoading = false;
    renderPricingSummary();
    renderDashboardOverview();
  }
  return succeeded;
}

async function runKegConfigUpdate() {
  if (!confirmDashboardAction(
    "Send a configuration update to the Pour My Beer walls?",
    ["The command targets the configured PMB tap devices."],
    "Only continue while connected to the work network and after verifying the displayed tap assignments.",
  )) return;

  kegConfigUpdateRunning = true;
  kegSyncMessage = "Sending config update to Pour My Beer...";
  renderKegLevels();

  try {
    const response = await fetch("/api/keg-config-update", {
      method: "POST",
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(result?.error || "Could not send config update.");
    }

    kegSyncMessage = result.message || "Configuration update sent.";
  } catch (error) {
    kegSyncMessage = getPmbConnectionErrorMessage(
      error,
      "Could not send config update.",
      { writeAttempted: true },
    );
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
  const option = resolveKegOnDeckOption(getKegOnDeckOptions(key), saved);
  if (option) {
    return {
      comingSoonId: option.id,
      name: option.name,
      kind: option.kind,
      plu: toNumber(option.plu),
    };
  }
  return typeof saved === "object" && clean(saved.name)
    ? saved
    : null;
}

function getKegOnDeckOptions(itemOrKey) {
  const key = typeof itemOrKey === "string" ? itemOrKey : getKegItemKey(itemOrKey);
  return buildKegOnDeckOptions({
    comingSoonItems,
    recipes,
    selected: kegOnDeckOverrides[key],
  });
}

function clearKegOnDeckIfInstalled(itemOrKey, currentProduct) {
  const key = typeof itemOrKey === "string" ? itemOrKey : getKegItemKey(itemOrKey);
  const onDeck = getKegOnDeckItem(key);
  if (!key || !onDeck || !isKegOnDeckProductInstalled(onDeck, currentProduct)) return null;

  delete kegOnDeckOverrides[key];
  return onDeck;
}

function reconcileInstalledKegOnDeckProducts() {
  const replacedAt = new Date().toISOString();
  const cleared = kegWallItems.flatMap((item) => {
    const liveProduct = getKegLiveRow(item);
    const onDeck = clearKegOnDeckIfInstalled(item, liveProduct);
    return onDeck ? [{ ...onDeck, tapKey: getKegItemKey(item), tapNumber: item.tapNumber, liveProduct }] : [];
  });
  if (!cleared.length) return cleared;

  let comingSoonChanged = false;
  comingSoonItems = comingSoonItems.map((item) => {
    const installed = cleared.find((entry) => entry.comingSoonId === item.id);
    if (!installed || item.replacedAt) return item;
    comingSoonChanged = true;
    return {
      ...item,
      plu: toNumber(installed.liveProduct?.plu) || toNumber(item.plu),
      pmbProductName: clean(installed.liveProduct?.name || installed.liveProduct?.tapProduct) || item.pmbProductName,
      pmbUpdatedAt: replacedAt,
      replaceTapKey: installed.tapKey,
      replacedAt,
    };
  });

  saveKegOnDeckOverrides();
  if (comingSoonChanged) saveComingSoonItems();
  scheduleParAgentStateSync({ immediate: true });
  return cleared;
}

function setKegOnDeckItem(key, comingSoonId) {
  const item = resolveKegOnDeckOption(getKegOnDeckOptions(key), comingSoonId);
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
  if (parAgentState?.recommendations?.generatedAt && !hasCurrentParAgentRecommendations()) return 0;
  const recommendation = getParAgentRecommendation(item);
  if (recommendation?.isLiquorTap) {
    const activeBottleQty = toNumber(recommendation.orderQty);
    const legacyDeferredQty = Math.max(
      toNumber(recommendation.deferredQty),
      toNumber(recommendation.suggestedRefillQty),
    );
    return Math.max(0, Math.round(activeBottleQty || legacyDeferredQty * 2));
  }
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
      ? `<span class="inventory-order-value">${formatNumber(need)}${recommendation?.isLiquorTap ? ` bottle${need === 1 ? "" : "s"}` : ""}</span>`
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

  const orderProductName = getCanonicalProductDisplayName(recommendation.orderProductName);
  const actionLabel = recommendation.isLiquorTap
    ? "Order"
    : recommendation.actionType === "make"
      ? "Make"
      : "Order";
  return `
    <div class="keg-need-agent">
      ${valueHtml}
      ${orderProductName && need > 0 ? `<span class="table-note table-note--accent">${escapeHtml(actionLabel)} ${escapeHtml(orderProductName)}</span>` : ""}
    </div>
  `;
}

function getKegLiveRow(item) {
  return kegTemplateAssignments.get(getKegItemKey(item)) || null;
}

function getDefaultKegLevelSize(item) {
  if (isLiquorOunceTap(toNumber(item?.tapNumber))) return 500;
  if (normalizeTitle(item?.type) === "cocktail") {
    return getCocktailRecipeYieldOz(item) || STANDARD_COCKTAIL_KEG_OZ;
  }
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

function applyPmbCurrentTapSnapshot(snapshot) {
  kegLiveLevels = buildKegLiveLevelMap(snapshot?.items || []);
  kegDeviceLevels = buildKegDeviceLevelsMap(snapshot?.deviceLevels || {});
  kegTemplateAssignments = buildKegTemplateAssignments();
  kegPricingItems = buildKegPricingCatalog(kegWallItems, getCurrentKegPricingTapItems());
  kegUpdatedAt = snapshot?.updatedAt || "";
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
  const knownBeerKegOz = getKegSizeOverrideOz(liveRow) || getKegSizeOverrideOz(item);
  if (knownBeerKegOz) return knownBeerKegOz;
  return getCocktailAwareKegFullOunces(
    liveRow,
    item,
    item ? getDefaultKegLevelSize(item) : 0,
  ) || null;
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

function getKegCurrentValueBreakdown(item, liveRow) {
  const replacement = tapReplacementOverrides[getKegItemKey(item)];
  const onHandKegs = toNumber(getKegOnHandDisplay(item));
  if (replacement?.comingSoonId) {
    const comingSoonItem = comingSoonItems.find((entry) => entry.id === replacement.comingSoonId);
    const replacementCost = toNumber(comingSoonItem?.batchCost || comingSoonItem?.kegCost);
    const fraction = getKegCurrentFraction(item, liveRow);
    if (replacementCost) {
      return {
        connectedValue: replacementCost * (fraction || 0),
        backupValue: replacementCost * onHandKegs,
      };
    }
  }

  const displayBrand = getKegDisplayBrand(item, liveRow);
  const currentOunces = getKegCurrentLevelOz(liveRow, item);
  const fullOunces = getKegFullOunces(liveRow, item) || getDefaultKegLevelSize(item);
  const costPerOz = getKegWallPricing(item, displayBrand).costPerOz;
  if (!costPerOz) return { connectedValue: 0, backupValue: 0 };
  return {
    connectedValue: Number.isFinite(currentOunces) && currentOunces ? currentOunces * costPerOz : 0,
    backupValue: onHandKegs && fullOunces ? onHandKegs * fullOunces * costPerOz : 0,
  };
}

function getKegCurrentValue(item, liveRow) {
  const values = getKegCurrentValueBreakdown(item, liveRow);
  return values.connectedValue + values.backupValue;
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
  const { response, result } = await requestOperationalSharedJson("/api/inventory-state", {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = new Error(result.error || `Shared inventory request failed (${response.status}).`);
    error.code = result.code || "INVENTORY_STATE_ERROR";
    error.status = response.status;
    error.currentRevision = result.currentRevision;
    throw error;
  }
  return result;
}

function loadInventoryFieldOutbox() {
  try {
    return normalizeOperationalOutboxMap(JSON.parse(localStorage.getItem(INVENTORY_FIELD_OUTBOX_STORAGE_KEY) || "{}"));
  } catch {
    return {};
  }
}

function loadInventoryActionOutbox() {
  try {
    return normalizeOperationalOutboxList(JSON.parse(localStorage.getItem(INVENTORY_ACTION_OUTBOX_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

function saveInventoryActionOutbox() {
  try {
    if (inventoryActionOutbox.length) {
      localStorage.setItem(INVENTORY_ACTION_OUTBOX_STORAGE_KEY, JSON.stringify(inventoryActionOutbox));
    } else {
      localStorage.removeItem(INVENTORY_ACTION_OUTBOX_STORAGE_KEY);
    }
    inventoryActionOutboxDurable = true;
    return true;
  } catch {
    inventoryActionOutboxDurable = false;
    inventorySharedSaveError = "This browser could not preserve pending Inventory recovery operations. Keep this page open and do not order from the plan.";
    return false;
  }
}

function nextInventoryOutboxClientOrder() {
  inventoryOutboxClientOrder = Math.max(Date.now(), inventoryOutboxClientOrder + 1);
  return inventoryOutboxClientOrder;
}

function stageInventoryActionOutbox(payload, options = {}) {
  const entry = createOperationalOutboxEntry({
    baseRevision: inventorySharedRevision,
    payload: {
      ...payload,
      recoveryOptions: {
        applyState: options.applyState !== false,
        rebuild: options.rebuild === true,
        successMessage: clean(options.successMessage) || "Shared inventory saved.",
      },
    },
    updatedAt: new Date().toISOString(),
    clientOrder: nextInventoryOutboxClientOrder(),
  });
  if (!entry) return null;
  inventoryActionOutbox.push(entry);
  saveInventoryActionOutbox();
  return entry;
}

function saveInventoryFieldOutbox() {
  try {
    if (Object.keys(inventoryFieldOutbox).length) {
      localStorage.setItem(INVENTORY_FIELD_OUTBOX_STORAGE_KEY, JSON.stringify(inventoryFieldOutbox));
    } else {
      localStorage.removeItem(INVENTORY_FIELD_OUTBOX_STORAGE_KEY);
    }
    inventoryFieldOutboxDurable = true;
    return true;
  } catch {
    inventoryFieldOutboxDurable = false;
    inventorySharedSaveError = "This browser could not preserve pending Inventory recovery operations. Keep this page open and do not order from the plan.";
    return false;
  }
}

function stageInventoryFieldOutbox(key, payload) {
  const prior = inventoryFieldOutbox[key];
  const entry = createOperationalOutboxEntry({
    baseRevision: prior?.baseRevision ?? inventorySharedRevision,
    payload,
    updatedAt: new Date().toISOString(),
    clientOrder: nextInventoryOutboxClientOrder(),
  });
  if (!entry) return null;
  inventoryFieldOutbox[key] = {
    ...entry,
    ...(prior?.conflict ? {
      conflict: true,
      currentRevision: prior.currentRevision,
      lastError: prior.lastError,
    } : {}),
  };
  saveInventoryFieldOutbox();
  return inventoryFieldOutbox[key];
}

function overlayInventoryFieldOutbox() {
  Object.values(inventoryFieldOutbox).forEach((entry) => {
    const payload = entry?.payload || {};
    const id = clean(payload.id);
    if (!id || !["onHand", "par"].includes(payload.field)) return;
    const target = payload.field === "par" ? inventoryParOverrides : inventoryOnHandOverrides;
    const value = clean(payload.value);
    if (value === "") delete target[id];
    else target[id] = value;
  });
  saveInventoryOnHandOverrides();
  saveInventoryParOverrides();
}

function getPendingInventoryOperations() {
  return [
    ...Object.entries(inventoryFieldOutbox).map(([key, entry]) => ({ kind: "field", key, entry })),
    ...inventoryActionOutbox.map((entry) => ({ kind: "action", key: entry.id, entry })),
  ].sort((left, right) => (
    left.entry.clientOrder - right.entry.clientOrder
    || left.entry.updatedAt.localeCompare(right.entry.updatedAt)
    || left.entry.id.localeCompare(right.entry.id)
  ));
}

function hasEarlierFailedInventoryOperation(entry) {
  return getPendingInventoryOperations().some(({ entry: candidate }) => (
    candidate.clientOrder < entry.clientOrder
    && (candidate.conflict || Boolean(candidate.lastError))
  ));
}

function applyPendingInventoryActionLocally(payload) {
  if (!payload || typeof payload !== "object") return;
  switch (payload.action) {
    case "upsert-custom": {
      const item = payload.item;
      if (!item?.id) return;
      customInventoryItems = [...customInventoryItems.filter((entry) => entry.id !== item.id), { ...item }];
      if (clean(item.onHandDisplay) === "") delete inventoryOnHandOverrides[item.id];
      else inventoryOnHandOverrides[item.id] = clean(item.onHandDisplay);
      if (clean(item.parDisplay) === "") delete inventoryParOverrides[item.id];
      else inventoryParOverrides[item.id] = clean(item.parDisplay);
      break;
    }
    case "delete-custom":
      customInventoryItems = customInventoryItems.filter((item) => item.id !== payload.id);
      inventoryItemOrder = inventoryItemOrder.filter((id) => id !== payload.id);
      delete inventoryOnHandOverrides[payload.id];
      delete inventoryParOverrides[payload.id];
      break;
    case "reorder-items":
      inventoryItemOrder = Array.isArray(payload.itemOrder) ? [...new Set(payload.itemOrder)] : inventoryItemOrder;
      break;
    case "restore-snapshot": {
      const snapshot = inventoryHistory.find((entry) => entry.id === payload.id);
      if (!snapshot) return;
      inventoryOnHandOverrides = {};
      inventoryParOverrides = {};
      snapshot.items.forEach((item) => {
        const id = clean(item.id) || slugify(item.name);
        if (id && clean(item.onHandDisplay) !== "") inventoryOnHandOverrides[id] = clean(item.onHandDisplay);
        if (id && clean(item.parDisplay) !== "") inventoryParOverrides[id] = clean(item.parDisplay);
      });
      break;
    }
    case "delete-snapshot":
      inventoryHistory = inventoryHistory.filter((snapshot) => snapshot.id !== payload.id);
      break;
    case "save-snapshot":
      // The server owns the canonical snapshot id, week, and timestamp. The exact
      // payload remains durable and visible as pending until its revision-bound save finishes.
      break;
    default:
      break;
  }
}

function overlayInventoryOutboxes() {
  getPendingInventoryOperations().forEach(({ kind, entry }) => {
    if (kind === "action") applyPendingInventoryActionLocally(entry.payload);
    else {
      const payload = entry.payload || {};
      const target = payload.field === "par" ? inventoryParOverrides : inventoryOnHandOverrides;
      const value = clean(payload.value);
      if (!payload.id || !["onHand", "par"].includes(payload.field)) return;
      if (value === "") delete target[payload.id];
      else target[payload.id] = value;
    }
  });
  saveInventoryOnHandOverrides();
  saveInventoryParOverrides();
  saveCustomInventoryItems();
  saveInventoryItemOrder();
  saveInventoryHistory();
  if (inventorySourceRows.length) {
    inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
    syncInventoryItemCatalogLinks();
  }
}

function markInventoryOutboxConflicts(currentRevision, message = "") {
  inventoryFieldOutbox = Object.fromEntries(Object.entries(inventoryFieldOutbox).map(([key, entry]) => [
    key,
    markOperationalOutboxFailure(entry, {
      conflict: true,
      currentRevision,
      message: message || `Shared Inventory is now revision ${currentRevision}, but this pending change was based on revision ${entry.baseRevision}.`,
    }),
  ]));
  saveInventoryFieldOutbox();
  inventoryActionOutbox = inventoryActionOutbox.map((entry) => markOperationalOutboxFailure(entry, {
    conflict: true,
    currentRevision,
    message: message || `Shared Inventory is now revision ${currentRevision}, but this pending ${entry.payload.action} operation was based on revision ${entry.baseRevision}.`,
  }));
  saveInventoryActionOutbox();
}

async function loadSharedInventoryState() {
  try {
    const state = await requestSharedInventory();
    inventorySharedProvisioned = true;
    inventorySharedInitialized = Boolean(state.initialized);
    inventorySharedRevision = Number(state.revision) || 0;
    if (state.initialized) {
      applySharedInventoryState(state);
      if (getPendingInventoryOperations().length) {
        overlayInventoryOutboxes();
        const safeToRetry = getPendingInventoryOperations().every(({ entry }) => (
          canSafelyRetryOperationalOutbox(entry, state.revision)
        ));
        if (safeToRetry) {
          inventoryFieldOutbox = Object.fromEntries(Object.entries(inventoryFieldOutbox).map(([key, entry]) => [
            key,
            markOperationalOutboxFailure(entry),
          ]));
          saveInventoryFieldOutbox();
          inventoryActionOutbox = inventoryActionOutbox.map((entry) => markOperationalOutboxFailure(entry));
          saveInventoryActionOutbox();
          inventorySharedMessage = "Recovering Inventory changes that did not finish saving...";
          const recovered = await flushPendingInventorySyncs();
          if (recovered) {
            inventorySharedSaveError = "";
            inventorySharedMessage = "Recovered and saved pending Inventory changes.";
            return;
          }
        } else {
          markInventoryOutboxConflicts(state.revision);
        }
        const pendingEntry = getPendingInventoryOperations()[0]?.entry;
        inventorySharedSaveError = pendingEntry?.lastError || "Pending Inventory recovery needs review.";
        inventorySharedMessage = pendingEntry?.conflict
          ? `Inventory conflict: this browser restored unsynced field values from revision ${pendingEntry.baseRevision} instead of overwriting them with shared revision ${pendingEntry.currentRevision}. Review them against the shared version before publishing.`
          : `Inventory recovery is still pending. This browser restored unsynced field values from revision ${pendingEntry?.baseRevision}; ordering remains blocked until they save successfully.`;
        return;
      }
      inventorySharedSaveError = "";
      inventorySharedMessage = "Shared inventory is available on all signed-in manager devices.";
    } else {
      inventorySharedMessage = "Setup needed: import inventory only from the service computer. Until then, changes stay on this device.";
    }
  } catch (error) {
    inventorySharedProvisioned = false;
    if (getPendingInventoryOperations().length) {
      overlayInventoryOutboxes();
      inventorySharedInitialized = true;
      inventorySharedRevision = Math.min(...getPendingInventoryOperations().map(({ entry }) => entry.baseRevision));
    } else {
      inventorySharedInitialized = false;
    }
    inventorySharedSaveError = error.message || "Shared inventory could not be loaded.";
    inventorySharedMessage = getPendingInventoryOperations().length
      ? `Shared inventory unavailable. This browser restored its pending changes and blocked ordering: ${error.message}`
      : `Shared inventory unavailable. Changes are saved on this device only: ${error.message}`;
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
  inventorySharedProvisioned = true;
  inventorySharedInitialized = Boolean(state.initialized);
  inventorySharedRevision = Number(state.revision) || 0;
  inventoryOnHandOverrides = { ...(state.current?.onHandOverrides || {}) };
  inventoryParOverrides = { ...(state.current?.parOverrides || {}) };
  customInventoryItems = Array.isArray(state.current?.customItems) ? state.current.customItems : [];
  inventoryItemOrder = Array.isArray(state.current?.itemOrder) ? state.current.itemOrder : [];
  inventoryHistory = Array.isArray(state.snapshots) ? state.snapshots : [];
  inventorySharedUpdatedAt = state.current?.updatedAt || "";
  saveInventoryOnHandOverrides();
  saveInventoryParOverrides();
  saveCustomInventoryItems();
  saveInventoryItemOrder();
  saveInventoryHistory();

  if (rebuild && inventorySourceRows.length) {
    inventoryItems = mergeCustomInventoryItems(parseInventory(inventorySourceRows));
    syncInventoryItemCatalogLinks();
  }
}

function getInventorySharedImportSnapshot() {
  return {
    onHandOverrides: { ...inventoryOnHandOverrides },
    parOverrides: { ...inventoryParOverrides },
    customItems: [...customInventoryItems],
    itemOrder: [...inventoryItemOrder],
    snapshots: getMigratedInventoryHistory(),
  };
}

async function initializeSharedInventoryFromServiceComputer() {
  if (!inventorySharedProvisioned || inventorySharedInitialized || inventorySharedSaving) return;
  const data = getInventorySharedImportSnapshot();
  const savedCountCount = Object.keys(data.onHandOverrides).length;
  const parCount = Object.keys(data.parOverrides).length;

  if (!confirmDashboardAction(
    "Make this browser's saved inventory the official shared inventory?",
    [
      "Source: saved inventory data in this browser (not a live read from the service computer).",
      `${savedCountCount} saved count${savedCountCount === 1 ? "" : "s"}, ${parCount} par override${parCount === 1 ? "" : "s"}, ${data.customItems.length} custom item${data.customItems.length === 1 ? "" : "s"}, and ${data.snapshots.length} Monday snapshot${data.snapshots.length === 1 ? "" : "s"}.`,
      "Only continue while using the service computer with its complete saved inventory.",
    ],
    "If you are at home or unsure, cancel and wait until you are back at the service computer.",
  )) return;

  const phrase = window.prompt(
    `Type ${INVENTORY_SHARED_IMPORT_PHRASE} to confirm that this is the service computer and its saved inventory is complete.`,
  );
  if (clean(phrase) !== INVENTORY_SHARED_IMPORT_PHRASE) {
    inventorySharedMessage = "Inventory import canceled. Shared inventory remains uninitialized.";
    renderInventoryPanels();
    return;
  }

  setInventorySharedStatus("Checking the service-computer connection to Pour My Beer...", true);
  try {
    await requirePmbWorkNetworkForServiceImport();
    setInventorySharedStatus("Importing the service computer's saved inventory...", true);
    const state = await requestSharedInventory({
      action: "initialize",
      expectedRevision: 0,
      data,
    });
    applySharedInventoryState(state, { rebuild: true });
    inventorySharedMessage = "Service-computer inventory imported. Counts, pars, custom items, and Monday snapshots are now shared.";
    inventorySharedSaveError = "";
    inventorySharedSaving = false;
  } catch (error) {
    inventorySharedSaveError = error.message || "Inventory import failed.";
    inventorySharedMessage = error.code === "INVENTORY_STATE_ALREADY_INITIALIZED"
      ? "Shared inventory was already initialized in another session. Reload to use the official version."
      : `Inventory import failed. Nothing was published from this browser: ${error.message}`;
    inventorySharedSaving = false;
  } finally {
    renderInventoryPanels();
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
  if (!inventorySharedInitialized) {
    inventorySharedMessage = "Shared inventory is not initialized. This change remains saved on this device only; import later from the service computer.";
    inventorySharedSaving = false;
    renderInventoryPanels();
    return null;
  }
  const staged = stageInventoryActionOutbox(body, {
    successMessage,
    applyState,
    rebuild,
  });
  if (!staged || !inventoryActionOutboxDurable) {
    inventorySharedSaving = false;
    renderInventoryPanels();
    renderWeeklyPlan();
    return null;
  }
  overlayInventoryOutboxes();
  renderInventory();
  setInventorySharedStatus("Saving shared inventory...", true);
  if (flushFields) {
    const saved = await flushPendingInventorySyncs();
    return saved ? true : null;
  }
  return queueInventoryActionSync(staged.id);
}

function queueInventoryActionSync(operationId) {
  if (inventoryQueuedActionIds.has(operationId)) return inventoryFieldSyncQueue;
  inventoryQueuedActionIds.add(operationId);
  inventoryFieldSyncPendingCount += 1;
  inventoryFieldSyncQueue = inventoryFieldSyncQueue.then(async () => {
    const entryIndex = inventoryActionOutbox.findIndex((entry) => entry.id === operationId);
    const activeEntry = entryIndex >= 0 ? normalizeOperationalOutboxEntry(inventoryActionOutbox[entryIndex]) : null;
    if (!activeEntry || activeEntry.conflict || hasEarlierFailedInventoryOperation(activeEntry)) {
      inventoryQueuedActionIds.delete(operationId);
      inventoryFieldSyncPendingCount = Math.max(0, inventoryFieldSyncPendingCount - 1);
      return null;
    }
    const { recoveryOptions = {}, ...body } = activeEntry.payload;
    inventorySharedSaving = true;
    try {
      const state = await requestSharedInventory({
        ...body,
        expectedRevision: activeEntry.baseRevision,
      });
      inventorySharedRevision = Number(state.revision) || inventorySharedRevision;
      inventorySharedUpdatedAt = state.current?.updatedAt || inventorySharedUpdatedAt;
      inventoryActionOutbox = inventoryActionOutbox.filter((entry) => entry.id !== activeEntry.id);
      inventoryActionOutbox = inventoryActionOutbox.map((entry) => rebaseOperationalOutboxAfterOwnCommit(entry, {
        committedBaseRevision: activeEntry.baseRevision,
        nextRevision: state.revision,
      }));
      inventoryFieldOutbox = Object.fromEntries(Object.entries(inventoryFieldOutbox).map(([key, entry]) => [
        key,
        rebaseOperationalOutboxAfterOwnCommit(entry, {
          committedBaseRevision: activeEntry.baseRevision,
          nextRevision: state.revision,
        }),
      ]));
      saveInventoryActionOutbox();
      saveInventoryFieldOutbox();
      if (recoveryOptions.applyState !== false) applySharedInventoryState(state, { rebuild: recoveryOptions.rebuild === true });
      overlayInventoryOutboxes();
      if (!getPendingInventoryOperations().length && inventoryFieldOutboxDurable && inventoryActionOutboxDurable) inventorySharedSaveError = "";
      inventorySharedMessage = getPendingInventoryOperations().length
        ? "An earlier Inventory operation saved; newer local changes are still pending."
        : recoveryOptions.successMessage || "Shared inventory saved.";
      return state;
    } catch (error) {
      const currentIndex = inventoryActionOutbox.findIndex((entry) => entry.id === activeEntry.id);
      if (currentIndex >= 0) {
        inventoryActionOutbox[currentIndex] = markOperationalOutboxFailure(inventoryActionOutbox[currentIndex], {
          message: error.message || "A pending Inventory operation could not be saved.",
          currentRevision: error.currentRevision,
          conflict: error.code === "INVENTORY_STATE_REVISION_CONFLICT",
        });
      }
      saveInventoryActionOutbox();
      inventorySharedSaveError = error.message || "A pending Inventory operation could not be saved.";
      inventorySharedMessage = error.code === "INVENTORY_STATE_REVISION_CONFLICT"
        ? `Inventory conflict: the local ${body.action} operation is preserved for explicit review and will not be retried against the newer shared revision.`
        : `Could not save shared inventory. The complete ${body.action} operation remains in this browser for a safe retry: ${error.message}`;
      return null;
    } finally {
      inventoryQueuedActionIds.delete(operationId);
      inventoryFieldSyncPendingCount = Math.max(0, inventoryFieldSyncPendingCount - 1);
      inventorySharedSaving = inventoryFieldSyncPendingCount > 0 || inventoryFieldSyncTimers.size > 0;
      renderInventoryPanels();
      renderWeeklyPlan();
    }
  }).catch((error) => {
    inventoryQueuedActionIds.delete(operationId);
    inventorySharedSaveError = error.message || "A pending Inventory operation could not be saved.";
    inventorySharedSaving = false;
    return null;
  });
  return inventoryFieldSyncQueue;
}

function scheduleInventoryFieldSync(id, field, value) {
  if (!inventorySharedInitialized) {
    inventorySharedMessage = "Shared inventory is not initialized. Changes remain saved on this device only.";
    inventorySharedSaving = false;
    return;
  }
  const key = `${id}:${field}`;
  const payload = { action: "update-field", id, field, value };
  const staged = stageInventoryFieldOutbox(key, payload);
  if (staged?.conflict) {
    inventorySharedSaveError = staged.lastError || "Inventory has an unresolved revision conflict.";
    inventorySharedMessage = "This Inventory change remains saved locally for explicit conflict review; it will not overwrite the newer shared revision.";
    inventorySharedSaving = false;
    renderInventoryPanels();
    renderWeeklyPlan();
    return;
  }
  clearTimeout(inventoryFieldSyncTimers.get(key)?.timer);
  inventoryFieldSyncFailures.delete(key);
  if (!inventoryFieldSyncFailures.size
    && !getPendingInventoryOperations().some(({ entry }) => entry.conflict)
    && inventoryFieldOutboxDurable
    && inventoryActionOutboxDurable) inventorySharedSaveError = "";
  inventorySharedMessage = "Saving shared inventory...";
  inventorySharedSaving = true;
  const timer = setTimeout(() => {
    inventoryFieldSyncTimers.delete(key);
    queueInventoryFieldSync(key, payload);
  }, 500);
  inventoryFieldSyncTimers.set(key, { timer, payload });
  renderWeeklyPlan();
}

function queueInventoryFieldSync(key, payload) {
  if (inventoryQueuedFieldKeys.has(key)) return inventoryFieldSyncQueue;
  const staged = inventoryFieldOutbox[key] || stageInventoryFieldOutbox(key, payload);
  const initialEntry = normalizeOperationalOutboxEntry(staged);
  if (!initialEntry || initialEntry.conflict) {
    if (initialEntry) inventoryFieldSyncFailures.set(key, initialEntry.payload);
    return Promise.resolve(null);
  }
  let activeEntry = initialEntry;
  let committed = false;
  inventoryQueuedFieldKeys.add(key);
  inventoryFieldSyncPendingCount += 1;
  inventoryFieldSyncQueue = inventoryFieldSyncQueue.then(async () => {
    activeEntry = normalizeOperationalOutboxEntry(inventoryFieldOutbox[key]) || initialEntry;
    if (activeEntry.conflict || hasEarlierFailedInventoryOperation(activeEntry)) {
      inventoryFieldSyncFailures.set(key, activeEntry.payload);
      return null;
    }
    inventorySharedSaving = true;
    try {
      const state = await requestSharedInventory({
        ...activeEntry.payload,
        expectedRevision: activeEntry.baseRevision,
      });
      inventorySharedRevision = Number(state.revision) || inventorySharedRevision;
      inventorySharedUpdatedAt = state.current?.updatedAt || inventorySharedUpdatedAt;
      if (inventoryFieldOutbox[key]?.id === activeEntry.id) delete inventoryFieldOutbox[key];
      else {
        inventoryFieldOutbox[key] = rebaseOperationalOutboxAfterOwnCommit(inventoryFieldOutbox[key], {
          committedBaseRevision: activeEntry.baseRevision,
          nextRevision: state.revision,
        });
      }
      inventoryFieldOutbox = Object.fromEntries(Object.entries(inventoryFieldOutbox).map(([entryKey, entry]) => [
        entryKey,
        rebaseOperationalOutboxAfterOwnCommit(entry, {
          committedBaseRevision: activeEntry.baseRevision,
          nextRevision: state.revision,
        }),
      ]));
      inventoryActionOutbox = inventoryActionOutbox.map((entry) => rebaseOperationalOutboxAfterOwnCommit(entry, {
        committedBaseRevision: activeEntry.baseRevision,
        nextRevision: state.revision,
      }));
      saveInventoryFieldOutbox();
      saveInventoryActionOutbox();
      inventoryFieldSyncFailures.delete(key);
      if (!inventoryFieldSyncFailures.size && !getPendingInventoryOperations().length && inventoryFieldOutboxDurable && inventoryActionOutboxDurable) inventorySharedSaveError = "";
      inventorySharedMessage = getPendingInventoryOperations().length
        ? "An earlier Inventory field saved; newer local changes are still pending."
        : "Shared inventory saved.";
      committed = true;
      return state;
    } catch (error) {
      inventorySharedSaveError = error.message || "A pending inventory field could not be saved.";
      inventoryFieldOutbox[key] = markOperationalOutboxFailure(inventoryFieldOutbox[key] || activeEntry, {
        message: inventorySharedSaveError,
        currentRevision: error.currentRevision,
        conflict: error.code === "INVENTORY_STATE_REVISION_CONFLICT",
      });
      saveInventoryFieldOutbox();
      inventoryFieldSyncFailures.set(key, activeEntry.payload);
      inventorySharedMessage = error.code === "INVENTORY_STATE_REVISION_CONFLICT"
        ? "Inventory conflict: the local field value is preserved for explicit review and will not be retried against the newer shared revision."
        : `Could not save shared inventory. The field change remains in this browser for a safe retry: ${error.message}`;
      return null;
    }
  }).catch((error) => {
    inventoryFieldSyncFailures.set(key, activeEntry.payload);
    inventorySharedSaveError = error.message || "A pending inventory field could not be saved.";
    inventorySharedSaving = false;
    return null;
  }).finally(() => {
    inventoryQueuedFieldKeys.delete(key);
    inventoryFieldSyncPendingCount = Math.max(0, inventoryFieldSyncPendingCount - 1);
    inventorySharedSaving = inventoryFieldSyncPendingCount > 0 || inventoryFieldSyncTimers.size > 0;
    if (committed && inventoryFieldOutbox[key] && inventoryFieldOutbox[key].id !== activeEntry.id && !inventoryFieldOutbox[key].conflict) {
      window.setTimeout(() => queueInventoryFieldSync(key, inventoryFieldOutbox[key].payload), 0);
      inventorySharedSaving = true;
    }
    renderInventoryPanels();
    renderWeeklyPlan();
  });
  return inventoryFieldSyncQueue;
}

async function flushPendingInventoryFieldSyncs() {
  return flushPendingInventorySyncs();
}

async function flushPendingInventorySyncs() {
  const timers = [...inventoryFieldSyncTimers.values()].map((entry) => entry.timer);
  inventoryFieldSyncTimers.clear();
  timers.forEach((timer) => clearTimeout(timer));
  inventoryFieldSyncFailures.clear();
  const operations = getPendingInventoryOperations();
  const conflictEntry = operations.find(({ entry }) => entry?.conflict)?.entry;
  if (operations.length && !conflictEntry) {
    inventorySharedSaveError = "";
    inventorySharedSaving = true;
  } else if (conflictEntry) {
    inventorySharedSaveError = conflictEntry.lastError || "Pending Inventory changes need explicit conflict review.";
    inventorySharedMessage = "Inventory has locally preserved changes that conflict with the current shared revision. Ordering remains blocked until they are reviewed.";
    inventorySharedSaving = inventoryFieldSyncPendingCount > 0;
    renderInventoryPanels();
    renderWeeklyPlan();
    return false;
  }
  operations.forEach(({ kind, key, entry }) => {
    if (entry.conflict) {
      if (kind === "field") inventoryFieldSyncFailures.set(key, entry.payload);
      return;
    }
    if (kind === "field") queueInventoryFieldSync(key, entry.payload);
    else queueInventoryActionSync(entry.id);
  });
  await inventoryFieldSyncQueue;
  inventorySharedSaving = inventoryFieldSyncPendingCount > 0 || inventoryFieldSyncTimers.size > 0;
  return inventoryFieldSyncPendingCount === 0
    && !inventorySharedSaving
    && !inventorySharedSaveError
    && inventoryFieldSyncFailures.size === 0
    && Object.keys(inventoryFieldOutbox).length === 0
    && inventoryActionOutbox.length === 0
    && inventoryFieldOutboxDurable
    && inventoryActionOutboxDurable;
}

function renderInventorySummary(visibleItems, reorderItems) {
  const totalValue = sum(visibleItems.filter((item) => !item.excludeFromInventoryValue).map((item) => item.totalValue));
  const reorderCost = sum(reorderItems.filter((item) => !item.excludeFromInventoryValue).map((item) => getInventoryRoundedOrderQuantity(item) * item.unitCost));
  const latestSnapshot = inventoryHistory[0];

  inventorySummary.innerHTML = `
    <h2>Inventory</h2>
    <div class="summary-line"><span>Tracked items</span><strong>${visibleItems.length}</strong></div>
    <div class="summary-line"><span>Current value</span><strong>${money(totalValue)}</strong></div>
    <div class="summary-line"><span>Items to reorder</span><strong>${reorderItems.length}</strong></div>
    <div class="summary-line"><span>Reorder cost</span><strong>${money(reorderCost)}</strong></div>
    <div class="sync-panel inventory-actions-panel">
      <button class="primary-button" id="save-inventory-snapshot" type="button"${inventorySharedSaving || !inventorySharedInitialized ? " disabled" : ""}>${inventorySharedSaving ? "Saving..." : inventorySharedInitialized ? "Save Monday Snapshot" : "Shared setup required"}</button>
      ${inventorySharedProvisioned && !inventorySharedInitialized ? '<button class="ghost-button" id="initialize-shared-inventory" type="button">Import from service computer</button>' : ""}
      ${inventorySharedSaveError || !inventorySharedInitialized ? `<p class="sync-status">${escapeHtml(inventorySharedMessage)}</p>` : ""}
      <p class="sync-status">${latestSnapshot ? `Last snapshot: ${escapeHtml(formatInventorySnapshotLabel(getInventorySnapshotDate(latestSnapshot)))}` : "No snapshots yet"}</p>
    </div>
  `;

  bindInventorySummaryEvents();
}

function bindInventorySummaryEvents() {
  document.querySelector("#save-inventory-snapshot")?.addEventListener("click", saveInventorySnapshot);
  document.querySelector("#initialize-shared-inventory")?.addEventListener(
    "click",
    initializeSharedInventoryFromServiceComputer,
  );
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
  const name = clean(customInventoryNameInput?.value || "");
  if (!name) return;

  const id = editingCustomInventoryId || slugify(name);
  const existing = findInventoryItem(id);
  const group = clean(customInventoryGroupInput?.value) || getInventoryGroup(name, "Custom Inventory");
  const onHandDisplay = normalizeInventoryInputValue(customInventoryOnHandInput?.value || "", false);
  const parDisplay = normalizeInventoryInputValue(customInventoryParInput?.value || "", false);
  const packSize = normalizePackSize(customInventoryPackSizeInput?.value || 1);
  const casePackaged = packSize > 1;
  const caseCost = toNumber(customInventoryUnitCostInput?.value);
  const unitCost = getInventoryUnitCost(caseCost, packSize);
  const vendorProduct = getVendorMapping(id) || getCustomInventoryVendorProduct(name, group);

  if (existing && !existing.isCustomInventory && !editingCustomInventoryId) {
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
      vendorProduct,
      updatedAt: new Date().toISOString(),
    };
    customInventoryItems = [
      ...customInventoryItems.filter((item) => item.id !== id),
      nextItem,
    ];
    if (unitCost > 0) customInventoryPriceStatus.delete(id);
    saveCustomInventoryItems();
    if (onHandDisplay) inventoryOnHandOverrides[id] = onHandDisplay;
    if (parDisplay) inventoryParOverrides[id] = parDisplay;
    saveInventoryOnHandOverrides();
    saveInventoryParOverrides();
    inventoryItems = mergeCustomInventoryItems(inventoryItems.filter((item) => !item.isCustomInventory));
    await runSharedInventoryAction(
      { action: "upsert-custom", item: nextItem },
      {
        successMessage: editingCustomInventoryId
          ? `${name} was updated in shared inventory.`
          : `${name} was added to shared inventory.`,
        rebuild: true,
      },
    );

    if (unitCost <= 0 && vendorProduct) {
      await syncCustomInventoryPrice(id, { automatic: true });
    }
  }

  resetCustomInventoryForm();
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
  const name = clean(item?.name || "");
  if (!name) return null;
  const id = item.id || slugify(name);
  const group = clean(item.group) || getInventoryGroup(name, "Custom Inventory");
  const onHandDisplay = Object.prototype.hasOwnProperty.call(inventoryOnHandOverrides, id)
    ? inventoryOnHandOverrides[id]
    : inventorySharedInitialized ? "" : clean(item.onHandDisplay);
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
    vendorProduct: getVendorMapping(id) || item.vendorProduct || getCustomInventoryVendorProduct(name, group),
    parDisplay,
    note: unitCost > 0
      ? `${item.priceUpdatedAt ? item.vendorProduct?.vendor || "Vendor" : "Manual"} price`
      : "Price needed",
    isCustomInventory: true,
    matchedSku: clean(item.matchedSku),
    priceUpdatedAt: clean(item.priceUpdatedAt),
  };
  recalculateInventoryItem(normalized);
  return normalized;
}

function editCustomInventoryItem(id) {
  const item = customInventoryItems.find((entry) => entry.id === id);
  if (!item) return;
  editingCustomInventoryId = id;
  customInventoryNameInput.value = item.name || "";
  customInventoryGroupInput.value = item.group || "Other";
  customInventoryOnHandInput.value = item.onHandDisplay || "";
  customInventoryParInput.value = item.parDisplay || "";
  customInventoryPackSizeInput.value = String(item.packSize || 1);
  customInventoryUnitCostInput.value = toNumber(item.caseCost) > 0 ? String(item.caseCost) : "";
  customInventorySubmitButton.textContent = "Update item";
  customInventoryCancelButton.hidden = false;
  customInventoryNameInput.focus();
}

function resetCustomInventoryForm() {
  editingCustomInventoryId = "";
  customInventoryForm?.reset();
  if (customInventoryPackSizeInput) customInventoryPackSizeInput.value = "1";
  if (customInventorySubmitButton) customInventorySubmitButton.textContent = "Add item";
  if (customInventoryCancelButton) customInventoryCancelButton.hidden = true;
}

function getCustomInventoryVendorProduct(name, group) {
  const bottleOz = getBottleOzFromInventoryName(name);
  if (bottleOz <= 0) return null;
  const syncVendor = group === "Liquor Cabinet" ? "OHLQ" : "Provi";
  return {
    vendor: syncVendor,
    syncVendor,
    productName: clean(name),
    bottleOz,
  };
}

function getBottleOzFromInventoryName(name) {
  const text = clean(name);
  const literMatch = text.match(/(\d+(?:\.\d+)?)\s*l\b/i);
  if (literMatch) return Number.parseFloat(literMatch[1]) * 33.814;
  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return Number.parseFloat(mlMatch[1]) * 0.033814;
  const ozMatch = text.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  return ozMatch ? Number.parseFloat(ozMatch[1]) : 0;
}

async function syncCustomInventoryPrice(id, { automatic = false } = {}) {
  const item = customInventoryItems.find((entry) => entry.id === id);
  if (!item) return;
  const vendorProduct = getVendorMapping(id) || item.vendorProduct || getCustomInventoryVendorProduct(item.name, item.group);
  if (!vendorProduct?.bottleOz) {
    customInventoryPriceStatus.set(id, "Add the bottle size to the item name before finding a price.");
    renderInventory();
    return;
  }

  customInventoryPriceStatus.set(id, `Checking ${vendorProduct.syncVendor}...`);
  renderInventory();

  try {
    const response = await fetch("/api/vendor-sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: vendorProduct.syncVendor,
        items: [{
          id,
          name: item.name,
          priceType: "ingredient",
          syncVendor: vendorProduct.syncVendor,
          vendorProduct,
        }],
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "Price lookup failed.");
    const update = (result.updates || []).find((entry) => entry.id === id);
    if (!update || !isRoughlyEqual(update.bottleOz, vendorProduct.bottleOz)) {
      throw new Error(`No exact ${formatPackageSizeFromOz(vendorProduct.bottleOz)} match was found.`);
    }

    const nextItem = {
      ...item,
      caseCost: update.bottlePrice * normalizePackSize(item.packSize),
      unitCost: update.bottlePrice,
      vendorProduct: {
        ...vendorProduct,
        preferredSku: update.matchedSku || vendorProduct.preferredSku || "",
      },
      matchedSku: update.matchedSku || "",
      priceUpdatedAt: update.updatedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    customInventoryItems = [
      ...customInventoryItems.filter((entry) => entry.id !== id),
      nextItem,
    ];
    saveCustomInventoryItems();
    inventoryItems = mergeCustomInventoryItems(inventoryItems.filter((entry) => !entry.isCustomInventory));
    customInventoryPriceStatus.set(
      id,
      `${update.matchedProductName || item.name} ${update.matchedSize || ""} linked at ${money(update.bottlePrice)}.`,
    );
    await runSharedInventoryAction(
      { action: "upsert-custom", item: nextItem },
      {
        successMessage: `${item.name} pricing was linked from ${vendorProduct.syncVendor}.`,
        rebuild: true,
      },
    );
  } catch (error) {
    customInventoryPriceStatus.set(
      id,
      automatic
        ? `Count saved. Price still needed: ${error.message}`
        : error.message,
    );
    renderInventory();
  }
}

async function deleteCustomInventoryItem(id) {
  const item = customInventoryItems.find((entry) => entry.id === id);
  if (!confirmDashboardAction(
    `Remove ${item?.name || "this custom item"} from shared inventory?`,
    ["Its saved on-hand count, par, position, and linked pricing will also be removed."],
    "This change affects every signed-in manager.",
  )) return;

  customInventoryItems = customInventoryItems.filter((item) => item.id !== id);
  delete inventoryOnHandOverrides[id];
  delete inventoryParOverrides[id];
  saveCustomInventoryItems();
  saveInventoryOnHandOverrides();
  saveInventoryParOverrides();
  inventoryItems = inventoryItems.filter((item) => item.id !== id);
  inventoryItemOrder = inventoryItemOrder.filter((itemId) => itemId !== id);
  saveInventoryItemOrder();
  customInventoryPriceStatus.delete(id);
  if (editingCustomInventoryId === id) resetCustomInventoryForm();
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
  if (mode === "stock") row.dataset.globalSearchKey = `inventory:${item.id}`;
  const orderQuantityForMode = mode === "order" ? getInventoryRoundedOrderQuantity(item) : item.orderQuantity;
  const costCell = item.unitCost > 0
    ? (mode === "order" ? money(orderQuantityForMode * item.unitCost) : money(item.totalValue))
    : '<span class="inventory-order-zero">Price needed</span>';
  const orderCell = mode === "order"
    ? getInventoryOrderCell(item, orderQuantityForMode)
    : formatInventoryQuantity(item.orderDisplay);
  const packLabel = item.casePackaged ? `${formatNumber(item.packSize)} / case` : "Each";
  row.className = mode === "order" && item.orderQuantity > 0 ? "inventory-row--order" : "";
  const inputMode = item.allowsDecimal ? "decimal" : "numeric";
  const isRowEditing = Boolean(inventoryRowEditState[item.id]);
  const linkedNotes = [];
  if (mode === "stock") {
    linkedNotes.push(`
      <div class="inventory-row-controls">
        <button class="mini-button inventory-row-edit-toggle" type="button">${isRowEditing ? "Done" : "Edit"}</button>
        ${isRowEditing ? `
          <span class="inventory-drag-handle" draggable="true" title="Drag to reorder" aria-label="Drag ${escapeHtml(item.name)} to reorder">::</span>
          <button class="icon-button inventory-move-up" type="button" title="Move up" aria-label="Move ${escapeHtml(item.name)} up">&uarr;</button>
          <button class="icon-button inventory-move-down" type="button" title="Move down" aria-label="Move ${escapeHtml(item.name)} down">&darr;</button>
          ${item.isCustomInventory ? `
            <button class="mini-button custom-inventory-edit" type="button">Edit item</button>
            <button class="mini-button mini-button--danger custom-inventory-delete" data-custom-inventory-id="${escapeHtml(item.id)}" type="button">Remove</button>
          ` : ""}
        ` : ""}
      </div>
      ${customInventoryPriceStatus.has(item.id) ? `<span class="table-note">${escapeHtml(customInventoryPriceStatus.get(item.id))}</span>` : ""}
    `);
  }
  const unitCostCell = item.unitCost > 0
    ? money(item.unitCost)
    : '<span class="inventory-order-zero">Price needed</span>';
  row.innerHTML = `
    <td><strong>${escapeHtml(item.name)}</strong>${item.note ? `<span class="table-note">${escapeHtml(item.note)}</span>` : ""}${item.orderHoldReason ? `<span class="table-note table-note--warning">Ordering hold: ${escapeHtml(item.orderHoldReason)}</span>` : ""}${linkedNotes.join("")}</td>
    <td>${mode === "stock" ? `<input class="inventory-input" data-field="onHand" type="text" inputmode="${inputMode}" value="${escapeHtml(item.onHandDisplay)}" aria-label="On hand for ${escapeHtml(item.name)}">` : formatInventoryQuantity(item.onHandDisplay)}</td>
    <td>${mode === "stock" ? `<div class="inventory-par-cell"><input class="inventory-input inventory-input--par ${isRowEditing ? "is-editing" : "is-locked"}" data-field="par" type="text" inputmode="${inputMode}" value="${escapeHtml(item.parDisplay)}" aria-label="Par for ${escapeHtml(item.name)}" ${isRowEditing ? "" : "readonly"}></div>` : formatInventoryQuantity(item.parDisplay)}</td>
    <td data-cell="order" class="${item.orderQuantity > 0 ? "inventory-order-flag" : "muted"}">${orderCell}</td>
    <td>${escapeHtml(packLabel)}</td>
    <td>${unitCostCell}</td>
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
    row.querySelector(".inventory-row-edit-toggle")?.addEventListener("click", () => toggleInventoryRowEdit(item.id));
    row.querySelector(".custom-inventory-edit")?.addEventListener("click", () => editCustomInventoryItem(item.id));
    row.querySelector(".custom-inventory-delete")?.addEventListener("click", () => deleteCustomInventoryItem(item.id));
    row.querySelector(".inventory-move-up")?.addEventListener("click", () => moveInventoryItem(item.id, -1));
    row.querySelector(".inventory-move-down")?.addEventListener("click", () => moveInventoryItem(item.id, 1));
    row.querySelector(".inventory-drag-handle")?.addEventListener("dragstart", (event) => {
      draggedInventoryItemId = item.id;
      row.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    });
    row.querySelector(".inventory-drag-handle")?.addEventListener("dragend", () => {
      draggedInventoryItemId = "";
      row.classList.remove("is-dragging");
      document.querySelectorAll(".inventory-row--drag-target").forEach((target) => target.classList.remove("inventory-row--drag-target"));
    });
    row.addEventListener("dragover", (event) => {
      if (!canReorderInventoryItems(draggedInventoryItemId, item.id)) return;
      event.preventDefault();
      row.classList.add("inventory-row--drag-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("inventory-row--drag-target"));
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      row.classList.remove("inventory-row--drag-target");
      reorderInventoryItemBefore(draggedInventoryItemId, item.id);
    });
  }
  return row;
}

function getSortedInventoryGroupItems(group) {
  return inventoryItems
    .filter((item) => item.group === group)
    .sort((a, b) => getInventorySortKey(a).localeCompare(getInventorySortKey(b)));
}

function canReorderInventoryItems(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const source = findInventoryItem(sourceId);
  const target = findInventoryItem(targetId);
  return Boolean(source && target && source.group === target.group);
}

function moveInventoryItem(id, direction) {
  const item = findInventoryItem(id);
  if (!item) return;
  const groupItems = getSortedInventoryGroupItems(item.group);
  const currentIndex = groupItems.findIndex((entry) => entry.id === id);
  const target = groupItems[currentIndex + direction];
  if (!target) return;
  const fullOrder = getCompleteInventoryItemOrder();
  const sourceIndex = fullOrder.indexOf(id);
  const targetIndex = fullOrder.indexOf(target.id);
  [fullOrder[sourceIndex], fullOrder[targetIndex]] = [fullOrder[targetIndex], fullOrder[sourceIndex]];
  persistInventoryItemOrder(fullOrder);
}

function reorderInventoryItemBefore(sourceId, targetId) {
  if (!canReorderInventoryItems(sourceId, targetId)) return;
  const fullOrder = getCompleteInventoryItemOrder().filter((id) => id !== sourceId);
  const targetIndex = fullOrder.indexOf(targetId);
  fullOrder.splice(targetIndex, 0, sourceId);
  draggedInventoryItemId = "";
  persistInventoryItemOrder(fullOrder);
}

function getCompleteInventoryItemOrder() {
  return ["Liquor Cabinet", "Mixer Cabinet", "Other"]
    .flatMap((group) => getSortedInventoryGroupItems(group).map((item) => item.id));
}

function persistInventoryItemOrder(itemOrder) {
  inventoryItemOrder = [...new Set(itemOrder)];
  saveInventoryItemOrder();
  renderInventory();
  runSharedInventoryAction(
    { action: "reorder-items", itemOrder: inventoryItemOrder },
    { successMessage: "Cabinet order saved for all managers.", applyState: false },
  );
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
  renderWeeklyPlan();
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

function toggleInventoryRowEdit(id) {
  inventoryRowEditState[id] = !inventoryRowEditState[id];
  renderInventory();
}

async function saveInventorySnapshot() {
  if (!inventorySharedInitialized) {
    setInventorySharedStatus("Monday snapshots cannot be shared until the service computer completes the one-time inventory import.");
    return;
  }
  if (kegSyncLoading) {
    setInventorySharedStatus("PMB keg levels are still loading. Save the Monday snapshot after the refresh finishes.");
    return;
  }

  setInventorySharedStatus("Checking Weekly Usage and PMB keg levels for the Monday snapshot...", true);
  const usageResult = await runPmbWeeklyUsageSync();
  if (!usageResult?.ok || !await flushPendingSharedWeeklyUsageSave()) {
    inventorySharedSaving = false;
    inventorySharedMessage = `Monday snapshot not saved: ${usageResult?.error || weeklyUsageSharedSaveError || "Weekly Usage could not be saved."}`;
    renderInventoryPanels();
    return;
  }
  if (!await flushPendingParAgentStateSync()) {
    inventorySharedSaving = false;
    inventorySharedMessage = "Monday snapshot not saved: backup/on-hand keg counts could not be saved.";
    renderInventoryPanels();
    return;
  }
  const levelsLoaded = await runKegLevelSync();
  const summary = getInventorySnapshotSummary();
  if (!levelsLoaded || summary.liveTapCount !== summary.tapCount) {
    inventorySharedSaving = false;
    inventorySharedMessage = levelsLoaded
      ? `Monday snapshot not saved: PMB returned ${summary.liveTapCount} of ${summary.tapCount} configured taps. Refresh Keg Levels and try again.`
      : `Monday snapshot not saved: ${kegSyncMessage}`;
    renderInventoryPanels();
    return;
  }

  setInventorySharedStatus("Calculating and freezing Monday keg orders and cocktail prep...", true);
  const recommendationsSaved = await runKegParAgent();
  const kegPlanSnapshot = recommendationsSaved && parAgentState?.recommendations?.generatedAt
    ? {
        generatedAt: parAgentState.recommendations.generatedAt,
        items: parAgentState.recommendations.items,
        tapInputs: (parAgentState.recommendations.items || []).map((item) => ({
          key: item.key,
          tapNumber: item.tapNumber,
          wall: item.wall,
          name: item.name,
          liveFraction: item.liveFraction,
          backupKegs: item.backupKegs,
          currentStockKegs: item.currentStockKegs,
          currentStockOunces: item.currentStockOunces,
          avgWeeklyKegs: item.avgWeeklyKegs,
          avgWeeklyOunces: item.avgWeeklyOunces,
        })),
        summary: parAgentState.recommendations.summary,
      }
    : null;
  if (!kegPlanSnapshot) {
    inventorySharedSaving = false;
    inventorySharedMessage = `Monday snapshot not saved: ${parAgentMessage || "keg and cocktail recommendations could not be calculated."}`;
    renderInventoryPanels();
    return;
  }

  const state = await runSharedInventoryAction(
    { action: "save-snapshot", items: getInventorySnapshotItems(), summary, kegPlanSnapshot },
    {
      successMessage: "Monday snapshot saved with bottle counts, keg levels, on-hand kegs, orders, and cocktail prep.",
      rebuild: true,
    },
  );
  if (state) {
    kegOnHandOverrides = createClearedKegOnHandOverrides(kegWallItems, getKegItemKey);
    saveKegOnHandOverrides();
    scheduleParAgentStateSync({ immediate: true });
    const clearedCountsSaved = await flushPendingParAgentStateSync();
    inventorySharedMessage = clearedCountsSaved
      ? "Monday snapshot saved. Bottle and backup/on-hand keg fields are cleared for the next count; the locked inputs remain in the snapshot."
      : "Monday snapshot saved, but the cleared backup/on-hand keg fields still need to finish syncing.";
    renderInventoryHistory();
    renderInventoryPanels();
  }
}

function getInventorySnapshotSummary() {
  const bottleInventoryValue = sum(
    inventoryItems
      .filter((item) => !item.excludeFromInventoryValue)
      .map((item) => item.totalValue),
  );
  const lineValues = kegWallItems.reduce((totals, item) => {
    const values = getKegCurrentValueBreakdown(item, getKegLiveRow(item));
    totals.connectedLineValue += values.connectedValue;
    totals.backupKegValue += values.backupValue;
    return totals;
  }, { connectedLineValue: 0, backupKegValue: 0 });
  const currentLineValue = lineValues.connectedLineValue + lineValues.backupKegValue;
  return {
    bottleInventoryValue,
    ...lineValues,
    currentLineValue,
    totalBeverageInventoryValue: bottleInventoryValue + currentLineValue,
    pmbUpdatedAt: kegUpdatedAt,
    liveTapCount: kegWallItems.filter((item) => getKegLiveRow(item)).length,
    tapCount: kegWallItems.length,
  };
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
    const valueSummary = snapshot.summary;

    return `
      <details class="inventory-history-card"${index === 0 ? " open" : ""}>
        <summary>
          <div class="inventory-history-heading">
            <strong>Week of ${escapeHtml(formatInventorySnapshotLabel(getInventorySnapshotDate(snapshot)))}</strong>
            <span>Saved ${escapeHtml(formatUpdatedAt(snapshot.savedAt))}</span>
            <span>Shared manager snapshot</span>
            <span>${snapshot.items.length} items saved</span>
            ${snapshot.kegPlanSnapshot?.tapInputs?.length ? `<span>${formatNumber(snapshot.kegPlanSnapshot.tapInputs.length)} tap inputs saved</span>` : '<span>Legacy snapshot · resave to include tap inputs</span>'}
          </div>
          <div class="inventory-history-stats">
            <span>${money(totalValue)} on hand</span>
            ${valueSummary ? `<span>${money(valueSummary.currentLineValue)} current line</span>` : ""}
            ${valueSummary ? `<strong>${money(valueSummary.totalBeverageInventoryValue)} total beverage</strong>` : ""}
            <span>${money(reorderCost)} to reorder</span>
          </div>
        </summary>
        <div class="inventory-history-card__body">
          ${valueSummary ? renderInventorySnapshotValueSummary(valueSummary) : ""}
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

function renderInventorySnapshotValueSummary(summary) {
  return `
    <div class="inventory-history-value-summary">
      <div><span>Bottle inventory</span><strong>${money(summary.bottleInventoryValue)}</strong></div>
      <div><span>Connected contents</span><strong>${money(summary.connectedLineValue)}</strong></div>
      <div><span>Full cooler backups</span><strong>${money(summary.backupKegValue)}</strong></div>
      <div><span>Current line value</span><strong>${money(summary.currentLineValue)}</strong></div>
      <div class="inventory-history-value-summary__total"><span>Total beverage inventory</span><strong>${money(summary.totalBeverageInventoryValue)}</strong></div>
      <p>PMB levels ${formatNumber(summary.liveTapCount)} of ${formatNumber(summary.tapCount)} taps${summary.pmbUpdatedAt ? ` | Updated ${escapeHtml(formatUpdatedAt(summary.pmbUpdatedAt))}` : ""}</p>
    </div>
  `;
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
  const snapshot = inventoryHistory.find((entry) => entry.id === snapshotId);
  if (!snapshot) return;
  if (!confirmDashboardAction(
    `Delete the ${formatInventorySnapshotLabel(getInventorySnapshotDate(snapshot))} snapshot?`,
    ["The shared weekly inventory record will be removed for every manager."],
    "This cannot be undone from the dashboard.",
  )) return;

  const state = await runSharedInventoryAction(
    { action: "delete-snapshot", id: snapshotId },
    { successMessage: "The shared Monday snapshot was deleted." },
  );
  if (state) renderInventoryHistory();
}

async function restoreInventorySnapshot(snapshotId) {
  const snapshot = inventoryHistory.find((entry) => entry.id === snapshotId);
  if (!snapshot) return;
  if (!confirmDashboardAction(
    `Restore inventory from ${formatInventorySnapshotLabel(getInventorySnapshotDate(snapshot))}?`,
    [`${snapshot.items.length} saved item counts and pars will replace the current shared values.`, "Saved backup/on-hand keg counts will also be restored when this snapshot includes them."],
    "Current inventory values will change for every signed-in manager.",
  )) return;

  const state = await runSharedInventoryAction(
    { action: "restore-snapshot", id: snapshotId },
    {
      successMessage: `Restored the shared inventory from ${formatInventorySnapshotLabel(getInventorySnapshotDate(snapshot))}.`,
      rebuild: true,
    },
  );
  if (state) {
    const savedTapInputs = snapshot.kegPlanSnapshot?.tapInputs || [];
    if (savedTapInputs.length) {
      kegOnHandOverrides = Object.fromEntries(savedTapInputs.map((item) => [item.key, String(toNumber(item.backupKegs))]));
      saveKegOnHandOverrides();
      scheduleParAgentStateSync({ immediate: true });
      await flushPendingParAgentStateSync();
    }
    renderInventory();
    renderKegLevels();
  }
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
  switchRecipeView("current");
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
  const kegOz = toNumber(pmbProductKegOzInput?.value);
  const abvPercent = toNumber(pmbProductAbvInput?.value);
  const targetMargin = getBeerTargetMargin();
  const pricePerOz = getGeneratedBeerChargePerOz(kegCost, targetMargin, kegOz);
  if (!name || kegCost <= 0 || kegOz <= 0 || pricePerOz <= 0 || abvPercent <= 0 || abvPercent > 100) {
    setPmbProductStatus("Add a beer name, positive keg cost, correct keg size, and a verified ABV from Untappd before saving it to the queue.", "error");
    return;
  }

  pmbProductSaving = true;
  if (pmbProductSubmitButton) pmbProductSubmitButton.textContent = "Saving...";
  if (pmbProductSubmitButton) pmbProductSubmitButton.disabled = true;
  setPmbProductStatus("Preparing the beer for the Pour My Beer queue...", "loading");

  try {
    if (!clean(pmbProductNotesInput?.value) || !clean(pmbProductImageInput?.value)) {
      await ensureBeerProductLookup({ force: true });
    }

    if (!clean(pmbProductNotesInput?.value) || !clean(pmbProductImageInput?.value)) {
      setPmbProductStatus("I could not find both an internet description and image for that beer yet. Try the full beer name or click Shuffle image after lookup.", "error");
      return;
    }

    const localImageUrl = clean(document.querySelector("#pmb-product-image")?.value);
    const payload = {
      productKind,
      name,
      pricePerOz,
      servingOz: document.querySelector("#pmb-product-serving")?.value,
      brewery: document.querySelector("#pmb-product-brewery")?.value,
      style: document.querySelector("#pmb-product-style")?.value,
      abvPercent,
      ibu: document.querySelector("#pmb-product-ibu")?.value,
      kegOz,
      kegCost,
      targetMargin,
      notes: document.querySelector("#pmb-product-notes")?.value,
      imageUrl: localImageUrl,
    };

    const queued = enqueuePmbPublishItem(pmbPublishQueue, payload);
    pmbPublishQueue = queued.queue;
    savePmbPublishQueue();
    addComingSoonItemFromPmbProduct(payload);

    setPmbProductStatus(
      `${name} was ${queued.replaced ? "updated" : "saved"} for PMB review.`,
      "success",
    );
    cancelUntappdProductSearch("beer");
    pmbProductForm.reset();
    syncPmbProductDefaults();
    clearBeerLookupResult();
    render();
  } catch (error) {
    setPmbProductStatus(
      clean(error?.message) || "Could not save the beer to the PMB publishing queue.",
      "error",
    );
  } finally {
    pmbProductSaving = false;
    if (pmbProductSubmitButton) pmbProductSubmitButton.textContent = "Save beer to queue";
    if (pmbProductSubmitButton) pmbProductSubmitButton.disabled = false;
  }
}

async function addLiquorProduct(event) {
  event.preventDefault();
  if (liquorProductSaving) return;

  const name = normalizeIngredientAlias(clean(liquorProductNameInput?.value));
  const pricePerOz = toNumber(liquorProductPriceInput?.value);
  const servingOz = toNumber(liquorProductServingInput?.value);
  const bottleCost = toNumber(liquorProductBottleCostInput?.value);
  const bottleOz = toNumber(liquorProductBottleOzInput?.value);
  const abvPercent = toNumber(liquorProductAbvInput?.value);
  const notes = clean(liquorProductNotesInput?.value) || `${name || "This liquor"} is available as a straight liquor tap on the tap wall.`;

  if (
    !name
    || pricePerOz <= 0
    || servingOz <= 0
    || servingOz > 16
    || bottleCost <= 0
    || bottleOz <= 0
    || abvPercent <= 0
    || abvPercent > 100
  ) {
    setLiquorProductStatus("Enter a name plus positive charge, pour size, bottle cost, bottle size, and an ABV above 0 and no more than 100 before saving it to the queue.", "error");
    return;
  }

  const payload = {
    productKind: "liquor",
    name,
    pricePerOz,
    servingOz,
    brewery: clean(selectedUntappdLiquor?.producer || selectedUntappdLiquor?.brewery) || "On Par Entertainment",
    style: clean(selectedUntappdLiquor?.style) || "Liquor",
    abvPercent,
    ibu: 0,
    kegOz: bottleOz,
    bottleCost,
    bottleOz,
    notes,
    imageUrl: clean(selectedUntappdLiquor?.imageUrl),
    untappdId: toNumber(selectedUntappdLiquor?.untappdId),
  };

  liquorProductSaving = true;
  if (liquorProductSubmitButton) liquorProductSubmitButton.textContent = "Saving...";
  if (liquorProductSubmitButton) liquorProductSubmitButton.disabled = true;
  setLiquorProductStatus("", "loading");

  try {
    const queued = enqueuePmbPublishItem(pmbPublishQueue, payload);
    pmbPublishQueue = queued.queue;
    savePmbPublishQueue();
    comingSoonItems = mergeRequiredComingSoonItems(comingSoonItems, pmbPublishQueue);
    saveComingSoonItems();

    setLiquorProductStatus(
      `${name} was ${queued.replaced ? "updated" : "saved"} for PMB review.`,
      "success",
    );
    cancelUntappdProductSearch("liquor");
    liquorProductForm.reset();
    selectedUntappdLiquor = null;
    render();
  } catch (error) {
    setLiquorProductStatus(
      clean(error?.message) || "Could not save the liquor tap to the PMB publishing queue.",
      "error",
    );
  } finally {
    liquorProductSaving = false;
    if (liquorProductSubmitButton) liquorProductSubmitButton.textContent = "Save liquor to queue";
    if (liquorProductSubmitButton) liquorProductSubmitButton.disabled = false;
  }
}

function getPmbQueueStatusLabel(status) {
  return {
    ready: "Ready",
    failed: "Needs retry",
    published: "Published",
  }[status] || "Ready";
}

function getPmbQueueItemMeta(item) {
  const payload = item.payload || {};
  const parts = [
    item.kind === "liquor" ? "Liquor tap" : "Beer keg",
    toNumber(payload.pricePerOz) ? `${money(payload.pricePerOz)} / oz` : "",
    toNumber(payload.abvPercent) ? `${formatNumber(payload.abvPercent)}% ABV` : "",
  ];
  if (item.kind === "beer") {
    if (toNumber(payload.kegCost)) parts.push(`${money(payload.kegCost)} keg`);
    if (toNumber(payload.kegOz)) parts.push(`${formatNumber(payload.kegOz)} oz`);
  } else {
    if (toNumber(payload.bottleCost)) parts.push(`${money(payload.bottleCost)} bottle`);
    if (toNumber(payload.bottleOz)) parts.push(`${formatNumber(payload.bottleOz)} oz bottle`);
  }
  return parts.filter(Boolean).join(" · ");
}

function renderPmbPublishQueue() {
  if (!pmbPublishQueueList || !pmbPublishQueueSummary || !pmbQueueConnection) return;

  pmbPublishQueue = normalizePmbPublishQueue(pmbPublishQueue);
  const counts = getPmbPublishQueueCounts(pmbPublishQueue);
  const pendingCount = counts.ready + counts.failed;
  pmbPublishQueueSummary.textContent = pendingCount
    ? `${pendingCount} waiting for PMB review · ${counts.published} published record${counts.published === 1 ? "" : "s"}`
    : counts.published
      ? `No products waiting · ${counts.published} published record${counts.published === 1 ? "" : "s"}`
      : "";
  pmbQueueConnection.hidden = pendingCount === 0;
  pmbQueueConnection.dataset.state = pmbQueueConnectionState;
  pmbQueueConnection.textContent = pmbQueueConnectionMessage;
  if (checkPmbQueueConnectionButton) {
    checkPmbQueueConnectionButton.hidden = pendingCount === 0;
    checkPmbQueueConnectionButton.disabled = pmbQueueConnectionState === "checking";
    checkPmbQueueConnectionButton.textContent = pmbQueueConnectionState === "checking"
      ? "Checking..."
      : "Check PMB connection";
  }

  const sortedItems = [...pmbPublishQueue].sort((left, right) => {
    if (left.status === "published" && right.status !== "published") return 1;
    if (left.status !== "published" && right.status === "published") return -1;
    return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
  });
  if (!sortedItems.length) {
    pmbPublishQueueList.innerHTML = '<div class="pmb-queue-empty">Queue is empty.</div>';
    return;
  }

  pmbPublishQueueList.innerHTML = sortedItems.map((item) => {
    const isPublishing = activePmbQueuePublishId === item.id;
    const publishedPlu = toNumber(item.publishedProduct?.plu);
    const timing = item.status === "published"
      ? `Published ${formatUpdatedAt(item.publishedAt)}${publishedPlu ? ` · PMB PLU ${publishedPlu}` : ""}`
      : `Saved ${formatUpdatedAt(item.updatedAt)}${item.attempts ? ` · ${item.attempts} publish attempt${item.attempts === 1 ? "" : "s"}` : ""}`;
    return `
      <article class="pmb-queue-item" data-status="${escapeHtml(item.status)}">
        <div class="pmb-queue-item__details">
          <div class="pmb-queue-item__title">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="pmb-queue-badge">${escapeHtml(getPmbQueueStatusLabel(item.status))}</span>
          </div>
          <div class="pmb-queue-item__meta">${escapeHtml(getPmbQueueItemMeta(item))}</div>
          <div class="pmb-queue-item__meta">${escapeHtml(timing)}</div>
          ${item.lastError ? `<div class="pmb-queue-item__error">${escapeHtml(item.lastError)}</div>` : ""}
        </div>
        <div class="pmb-queue-item__actions">
          ${item.status !== "published" ? `
            <button
              class="primary-button"
              type="button"
              data-pmb-queue-action="publish"
              data-pmb-queue-id="${escapeHtml(item.id)}"
              ${isPublishing ? "disabled" : ""}
            >${isPublishing ? "Publishing..." : item.status === "failed" ? "Check & retry" : "Check & publish"}</button>
          ` : ""}
          <button
            class="ghost-button"
            type="button"
            data-pmb-queue-action="remove"
            data-pmb-queue-id="${escapeHtml(item.id)}"
            ${isPublishing ? "disabled" : ""}
          >${item.status === "published" ? "Remove history" : "Remove"}</button>
        </div>
      </article>
    `;
  }).join("");
}

async function checkPmbQueueConnection() {
  if (pmbQueueConnectionState === "checking") return false;
  pmbQueueConnectionState = "checking";
  pmbQueueConnectionMessage = "Checking the service-computer connection to Pour My Beer...";
  renderPmbPublishQueue();

  try {
    const response = await fetch("/api/pmb-products", {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    const result = await parseJsonResponse(response);
    if (!response.ok || result.ok !== true) {
      throw new Error(result.error || `PMB connection check failed (${response.status}).`);
    }
    pmbQueueConnectionState = "connected";
    pmbQueueConnectionMessage = result.message || "Pour My Beer is reachable from this computer. Queue publishing is available.";
    renderPmbPublishQueue();
    return true;
  } catch (error) {
    pmbQueueConnectionState = "offline";
    pmbQueueConnectionMessage = getPmbConnectionErrorMessage(
      error,
      "Pour My Beer is not reachable. The queue is unchanged; try again on the work network.",
    ).replace(
      "Showing saved dashboard data; no live values were changed.",
      "The queue is unchanged; no product was published.",
    );
    renderPmbPublishQueue();
    return false;
  }
}

function handlePmbPublishQueueAction(event) {
  const button = event.target.closest("[data-pmb-queue-action]");
  if (!button) return;
  const id = clean(button.dataset.pmbQueueId);
  if (!id) return;

  if (button.dataset.pmbQueueAction === "publish") {
    publishPmbQueueItem(id);
  } else if (button.dataset.pmbQueueAction === "remove") {
    removePmbQueueItemWithConfirmation(id);
  }
}

async function publishPmbQueueItem(id) {
  if (activePmbQueuePublishId) return;
  const item = pmbPublishQueue.find((entry) => entry.id === id);
  if (!item || item.status === "published") return;

  const connected = await checkPmbQueueConnection();
  if (!connected) return;

  const payload = item.payload || {};
  if (!confirmDashboardAction(
    `Publish “${item.name}” to Pour My Beer now?`,
    [
      item.kind === "liquor" ? "Type: Straight liquor tap" : "Type: Beer keg",
      `Charge: ${money(payload.pricePerOz)} / oz`,
      `Serving size: ${formatNumber(payload.servingOz)} oz`,
      `ABV: ${formatNumber(payload.abvPercent)}%`,
      item.kind === "beer" && toNumber(payload.kegCost) ? `Keg cost: ${money(payload.kegCost)}` : "",
      item.kind === "liquor" && toNumber(payload.bottleCost) ? `Bottle cost: ${money(payload.bottleCost)}` : "",
    ],
    "This sends immediately. If an exact-name PMB product already exists, its values may be updated.",
  )) return;

  activePmbQueuePublishId = id;
  pmbQueueConnectionMessage = `Publishing ${item.name} to Pour My Beer...`;
  renderPmbPublishQueue();

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
    if (!response.ok || result.ok !== true) {
      const attemptSummary = (result.attempts || [])
        .map((attempt) => {
          const responseText = clean(attempt.response);
          return `${attempt.path}: ${attempt.status || "failed"}${responseText ? ` (${responseText.slice(0, 120)})` : ""}`;
        })
        .join(", ");
      throw new Error(`${result.error || "PMB product publish failed."}${attemptSummary ? ` Tried ${attemptSummary}.` : ""}`);
    }

    if (item.kind === "beer") {
      saveCustomBeerKegFromPmbProduct(payload, result.product);
      addComingSoonItemFromPmbProduct(payload, result.product);
    } else {
      saveCustomLiquorTapFromPmbProduct(payload, result.product);
      if (toNumber(payload.bottleCost) && toNumber(payload.bottleOz)) {
        saveIngredientOverride(
          slugify(item.name),
          String(payload.bottleOz),
          String(payload.bottleCost),
        );
      }
    }

    pmbPublishQueue = markPmbPublished(pmbPublishQueue, id, result.product);
    savePmbPublishQueue();
    pmbQueueConnectionState = "connected";
    pmbQueueConnectionMessage = result.message || `${item.name} was published to Pour My Beer.`;
    ingredients = buildIngredientCatalog(getActiveRecipes());
    render();
    runTapPricingSync();
  } catch (error) {
    const message = getPmbConnectionErrorMessage(
      error,
      "Could not publish the queued PMB product.",
      { writeAttempted: true },
    );
    pmbPublishQueue = markPmbPublishFailed(pmbPublishQueue, id, message);
    savePmbPublishQueue();
    if (/work network|could not confirm/i.test(message)) {
      pmbQueueConnectionState = "offline";
    }
    pmbQueueConnectionMessage = message;
    renderPmbPublishQueue();
  } finally {
    activePmbQueuePublishId = "";
    renderPmbPublishQueue();
  }
}

function removePmbQueueItemWithConfirmation(id) {
  if (activePmbQueuePublishId === id) return;
  const item = pmbPublishQueue.find((entry) => entry.id === id);
  if (!item) return;
  const prompt = item.status === "published"
    ? `Remove the published queue history for “${item.name}”?`
    : `Remove “${item.name}” from the PMB publishing queue?`;
  const warning = item.status === "published"
    ? "This only removes the dashboard history. It does not delete anything from Pour My Beer."
    : "The product has not been sent to Pour My Beer.";
  if (!confirmDashboardAction(prompt, [], warning)) return;

  pmbPublishQueue = removePmbPublishItem(pmbPublishQueue, id);
  savePmbPublishQueue();
  if (item.kind === "beer") {
    setPmbProductStatus(`${item.name} was removed from the PMB publishing queue.`, "success");
  } else {
    setLiquorProductStatus(`${item.name} was removed from the PMB publishing queue.`, "success");
  }
  renderPmbPublishQueue();
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
    imageUrl: clean(payload.imageUrl),
    producer: clean(payload.brewery),
    style: clean(payload.style),
    untappdId: toNumber(payload.untappdId),
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

function buildComingSoonItemFromRecipe(recipe, { createdAt = "" } = {}) {
  const totals = getRecipeTotals(recipe);
  const pricing = getRecipePricing(recipe);
  return {
    id: `recipe:${recipe.id}`,
    kind: "recipe",
    recipeId: recipe.id,
    name: recipe.title,
    description: clean(recipe.description) || buildRecipeDescription(recipe.title, recipe.category, recipe.ingredients),
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
    ...(createdAt ? { createdAt } : {}),
  };
}

function hydrateComingSoonRecipeItems() {
  comingSoonItems = comingSoonItems.map((item) => {
    if (item.kind !== "recipe" || !item.recipeId) return item;
    const recipe = recipes.find((entry) => entry.id === item.recipeId);
    if (!recipe) return item;
    return {
      ...item,
      ...buildComingSoonItemFromRecipe(recipe, { createdAt: item.createdAt }),
    };
  });
}

function getComingSoonUntappdFields(item) {
  return {
    description: clean(item.description),
    imageUrl: clean(item.imageUrl),
    producer: clean(item.producer || item.brewery),
    style: clean(item.style || item.category),
    abvPercent: toNumber(item.abv),
    untappdId: toNumber(item.untappdId),
    untappdName: clean(item.name),
    untappdSource: clean(item.sourceName),
  };
}

async function hydrateComingSoonLiquorItemsFromUntappd() {
  const targets = comingSoonItems.filter((item) => item.kind === "liquor" && clean(item.untappdQuery));
  if (!targets.length) return;

  const results = await Promise.all(targets.map(async (item) => {
    try {
      const response = await fetch(`/api/untappd-search?q=${encodeURIComponent(item.untappdQuery)}&kind=liquor`, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = await parseJsonResponse(response);
      if (!response.ok || !payload?.items?.length) return null;
      return { id: item.id, fields: getComingSoonUntappdFields(payload.items[0]) };
    } catch {
      return null;
    }
  }));

  const fieldsById = new Map(results.filter(Boolean).map((result) => [result.id, result.fields]));
  if (!fieldsById.size) return;
  let changed = false;
  comingSoonItems = comingSoonItems.map((item) => {
    const fields = fieldsById.get(item.id);
    if (!fields) return item;
    const populatedFields = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== "" && value !== 0 && value != null),
    );
    const nextItem = { ...item, ...populatedFields };
    if (JSON.stringify(nextItem) !== JSON.stringify(item)) changed = true;
    return nextItem;
  });
  if (!changed) return;
  saveComingSoonItems();
  renderKegLevels();
}

function addComingSoonItemFromRecipe(recipe) {
  upsertComingSoonItem(buildComingSoonItemFromRecipe(recipe, {
    createdAt: new Date().toISOString(),
  }));
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
    abvPercent: toNumber(payload.abvPercent),
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

function getUntappdSearchElements(kind) {
  if (kind === "liquor") {
    return {
      input: liquorProductNameInput,
      results: liquorUntappdResults,
      items: liquorUntappdItems,
    };
  }
  return {
    input: pmbProductNameInput,
    results: beerUntappdResults,
    items: beerUntappdItems,
  };
}

function scheduleUntappdProductSearch(kind) {
  const { input } = getUntappdSearchElements(kind);
  const query = clean(input?.value);
  const isLiquor = kind === "liquor";
  const currentTimer = isLiquor ? liquorUntappdSearchTimer : beerUntappdSearchTimer;
  clearTimeout(currentTimer);

  if (query.length < 2) {
    if (isLiquor) {
      liquorUntappdItems = [];
      liquorUntappdSearchTimer = null;
    } else {
      beerUntappdItems = [];
      beerUntappdSearchTimer = null;
    }
    hideUntappdSearchResults(kind);
    return;
  }

  const timer = setTimeout(() => searchUntappdProducts(kind, query), 350);
  if (isLiquor) liquorUntappdSearchTimer = timer;
  else beerUntappdSearchTimer = timer;
}

async function searchUntappdProducts(kind, query) {
  const isLiquor = kind === "liquor";
  const requestId = isLiquor ? ++liquorUntappdRequestId : ++beerUntappdRequestId;
  const setStatus = isLiquor ? setLiquorProductStatus : setPmbProductStatus;
  setStatus(
    isLiquor
      ? "Searching spirits carried on On Par’s Untappd menus..."
      : "Searching the Untappd beer database...",
    "loading",
  );

  try {
    const response = await fetch(
      `/api/untappd-search?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(query)}`,
      { cache: "no-store" },
    );
    const result = await parseJsonResponse(response);
    const latestRequestId = isLiquor ? liquorUntappdRequestId : beerUntappdRequestId;
    if (requestId !== latestRequestId) return;
    if (!response.ok) throw new Error(result.error || "Untappd search failed.");

    const items = Array.isArray(result.items) ? result.items : [];
    if (isLiquor) liquorUntappdItems = items;
    else beerUntappdItems = items;
    renderUntappdSearchResults(kind, items);
    setStatus(
      items.length
        ? `Choose from ${items.length} Untappd ${items.length === 1 ? "match" : "matches"}.`
        : isLiquor
          ? "No matching spirit was found in On Par’s Untappd menus."
          : "No matching beer was found in Untappd.",
      items.length ? "success" : "error",
    );
  } catch (error) {
    if (requestId !== (isLiquor ? liquorUntappdRequestId : beerUntappdRequestId)) return;
    if (isLiquor) liquorUntappdItems = [];
    else beerUntappdItems = [];
    renderUntappdSearchResults(kind, [], error.message || "Untappd search failed.");
    setStatus(error.message || "Untappd search failed.", "error");
  }
}

function renderUntappdSearchResults(kind, items, emptyMessage = "") {
  const { input, results } = getUntappdSearchElements(kind);
  if (!results || !input) return;

  if (!items.length) {
    results.innerHTML = `<p class="untappd-search-empty">${escapeHtml(emptyMessage || "No Untappd matches found.")}</p>`;
  } else {
    results.innerHTML = items.map((item, index) => {
      const producer = clean(item.producer || item.brewery);
      const category = clean(item.style || item.category || (kind === "liquor" ? "Spirit" : "Beer"));
      const strength = toNumber(item.abv) ? `${formatNumber(item.abv)}% ABV` : "";
      const source = item.carried ? "Carried at On Par" : "Untappd";
      const details = [producer, category, strength, source].filter(Boolean).join(" · ");
      const image = clean(item.imageUrl);
      return `
        <button class="untappd-search-result" type="button" role="option" data-untappd-index="${index}">
          ${image
            ? `<img src="${escapeHtml(image)}" alt="">`
            : `<span class="untappd-search-result__placeholder">${kind === "liquor" ? "SPIRIT" : "BEER"}</span>`}
          <span>
            <strong>${escapeHtml(item.name)}</strong>
            <span>${escapeHtml(details)}</span>
          </span>
        </button>
      `;
    }).join("");
  }

  results.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function hideUntappdSearchResults(kind = "") {
  const kinds = kind ? [kind] : ["beer", "liquor"];
  kinds.forEach((currentKind) => {
    const { input, results } = getUntappdSearchElements(currentKind);
    if (results) results.hidden = true;
    input?.setAttribute("aria-expanded", "false");
  });
}

function cancelUntappdProductSearch(kind) {
  if (kind === "liquor") {
    clearTimeout(liquorUntappdSearchTimer);
    liquorUntappdSearchTimer = null;
    liquorUntappdRequestId += 1;
    liquorUntappdItems = [];
  } else {
    clearTimeout(beerUntappdSearchTimer);
    beerUntappdSearchTimer = null;
    beerUntappdRequestId += 1;
    beerUntappdItems = [];
  }
  hideUntappdSearchResults(kind);
}

function selectUntappdSearchResult(event, kind) {
  const button = event.target.closest("[data-untappd-index]");
  if (!button) return;
  const { items } = getUntappdSearchElements(kind);
  const item = items[Number(button.dataset.untappdIndex)];
  if (!item) return;

  if (kind === "liquor") {
    applyUntappdLiquorSelection(item);
  } else {
    applyUntappdBeerSelection(item);
  }
}

function applyUntappdBeerSelection(item) {
  selectedUntappdBeer = item;
  if (pmbProductNameInput) pmbProductNameInput.value = item.name;
  syncPmbProductDefaults();
  if (pmbProductBreweryInput) pmbProductBreweryInput.value = clean(item.producer || item.brewery);
  if (pmbProductStyleInput) pmbProductStyleInput.value = clean(item.style) || "Beer";
  if (pmbProductAbvInput) pmbProductAbvInput.value = item.abv == null ? "" : String(item.abv);
  if (pmbProductIbuInput) pmbProductIbuInput.value = item.ibu == null ? "0" : String(item.ibu);
  if (pmbProductNotesInput) pmbProductNotesInput.value = clean(item.description);
  setPmbProductImage(clean(item.imageUrl));
  lastGeneratedPmbProductDescription = clean(item.description);
  lastGeneratedPmbProductImage = clean(item.imageUrl);
  beerLookupItems = beerUntappdItems
    .filter((result) => result.description && result.imageUrl)
    .map((result) => ({ ...result, sourceName: "Untappd" }));
  beerLookupImageIndex = Math.max(
    0,
    beerLookupItems.findIndex((result) => (
      result.id === item.id
      || (result.untappdId && result.untappdId === item.untappdId)
    )),
  );
  beerLookupDescriptionIndex = beerLookupImageIndex;
  hideUntappdSearchResults("beer");
  setPmbProductStatus(
    `Selected ${item.name} from Untappd${item.producer ? ` by ${item.producer}` : ""}.`,
    "success",
  );
}

function applyUntappdLiquorSelection(item) {
  selectedUntappdLiquor = item;
  if (liquorProductNameInput) liquorProductNameInput.value = item.name;
  if (liquorProductAbvInput && item.abv != null) liquorProductAbvInput.value = String(item.abv);
  if (liquorProductNotesInput) {
    liquorProductNotesInput.value = clean(item.description)
      || [item.producer, item.category || item.style].filter(Boolean).join(" · ");
  }
  hideUntappdSearchResults("liquor");
  setLiquorProductStatus(
    `Selected ${item.name} from On Par’s Untappd menu${item.menuName ? ` (${item.menuName})` : ""}.`,
    "success",
  );
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
  if (!keepStatus) {
    selectedUntappdBeer = null;
    beerUntappdItems = [];
  }
  beerLookupItems = [];
  beerLookupImageIndex = 0;
  beerLookupDescriptionIndex = 0;
  if (!keepStatus) {
    if (pmbProductNotesInput) pmbProductNotesInput.value = "";
    setPmbProductImage("");
  }
  hideUntappdSearchResults("beer");
  if (!keepStatus) setPmbProductStatus("", "");
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
    const untappdItem = selectedUntappdBeer
      && clean(selectedUntappdBeer.name) === clean(pmbProductNameInput?.value)
      ? selectedUntappdBeer
      : null;
    const kegCost = toNumber(pmbProductKegCostInput?.value);
    const kegOz = toNumber(pmbProductKegOzInput?.value) || STANDARD_BEER_KEG_OZ;
    const targetMargin = getBeerTargetMargin();
    const chargePerOz = getGeneratedBeerChargePerOz(kegCost, targetMargin, kegOz);
    if (pmbProductServingInput) pmbProductServingInput.value = "16";
    if (pmbProductMarginInput && !clean(pmbProductMarginInput.value)) pmbProductMarginInput.value = String(DEFAULT_BEER_TARGET_MARGIN);
    if (pmbProductStyleInput) {
      pmbProductStyleInput.value = clean(untappdItem?.style) || inferBeerStyle(pmbProductNameInput?.value);
    }
    if (pmbProductBreweryInput) {
      pmbProductBreweryInput.value = clean(untappdItem?.producer || untappdItem?.brewery)
        || inferBeerBrewery(pmbProductNameInput?.value);
    }
    if (pmbProductAbvInput) {
      pmbProductAbvInput.value = untappdItem?.abv == null ? "" : String(untappdItem.abv);
    }
    if (pmbProductIbuInput) {
      pmbProductIbuInput.value = untappdItem?.ibu == null ? "0" : String(untappdItem.ibu);
    }
    if (pmbProductKegOzInput && !clean(pmbProductKegOzInput.value)) {
      pmbProductKegOzInput.value = String(STANDARD_BEER_KEG_OZ);
    }
    if (pmbProductPriceInput) pmbProductPriceInput.value = chargePerOz ? formatNumber(chargePerOz) : "";
    if (pmbGeneratedSummary) {
      pmbGeneratedSummary.textContent = chargePerOz
        ? `Generated: ${money(chargePerOz)}/oz at ${formatNumber(targetMargin)}% margin, 16 oz serving, ${formatNumber(kegOz)} oz keg.`
        : "";
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

function getGeneratedBeerChargePerOz(
  kegCost,
  targetMargin = DEFAULT_BEER_TARGET_MARGIN,
  kegOz = toNumber(pmbProductKegOzInput?.value) || STANDARD_BEER_KEG_OZ,
) {
  const costPerOz = toNumber(kegCost) / toNumber(kegOz);
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
    if (isHtml && response.status >= 500) {
      return {
        error: `The dashboard hit a temporary server gateway error (${response.status}). The refresh was retried automatically; please try the button again if PMB is still unavailable.`,
      };
    }
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
  const packageUnitHint = getRecipeBuilderPackageUnitHint(ingredient || {});
  const packageConfig = getRecipeBuilderPackageConfig(ingredient?.name || "", ingredient);
  row.dataset.packageUnitHint = packageUnitHint || packageConfig?.unitLabel || "";
  const quantityValue = getRecipeBuilderQuantityValue(ingredient, packageConfig);
  const ozValue = ingredient?.oz
    || (packageConfig ? calculateRecipeBuilderOunces(quantityValue, packageConfig) : "")
    || "";
  const costValue = ingredient?.manualCost ? ingredient.cost : "";
  const abvValue = ingredient?.manualAbvPercent === "" || ingredient?.manualAbvPercent == null ? "" : ingredient.manualAbvPercent;
  row.innerHTML = `
    <td>
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
    row.dataset.packageUnitHint = "";
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
  syncRecipeBuilderRow(row, {
    preserveExistingOz: Boolean(toNumber(ingredient?.oz)),
    preserveManualOz: true,
  });
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
  const packageConfig = getRecipeBuilderPackageConfig(nameInput.value, {
    packageUnit: row.dataset.packageUnitHint,
  });

  if (packageNote) packageNote.textContent = getRecipeBuilderPackageNote(packageConfig);
  if (ozNote) ozNote.textContent = getRecipeBuilderOzNote(packageConfig);

  if (packageConfig) {
    ozInput.readOnly = true;
    if (!options.preserveExistingOz || !toNumber(ozInput.value)) {
      const ounces = calculateRecipeBuilderOunces(quantityInput.value, packageConfig);
      ozInput.value = ounces ? formatNumber(ounces) : "";
    }
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
      ? ""
      : estimatedCost
        ? `${money(estimatedCost)} est.`
        : "";
  }
  if (abvNote) {
    const inferredAbv = getIngredientAbvPercent({ name, manualAbvPercent: clean(abvInput?.value) });
    abvNote.textContent = clean(abvInput?.value)
      ? ""
      : inferredAbv
        ? `${formatNumber(inferredAbv)}% auto`
        : "";
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
  const packageConfig = getRecipeBuilderPackageConfig(name, {
    packageUnit: row.dataset.packageUnitHint,
  });
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

function getRecipeBuilderPackageConfig(name, ingredient = null) {
  const normalizedName = normalizeIngredientAlias(clean(name));
  if (!normalizedName) return null;

  const id = slugify(normalizedName);
  const override = priceOverrides[id];
  const overrideBottleOz = toNumber(override?.bottleOz);
  const mappedBottleOz = toNumber(getVendorMapping(id)?.bottleOz);
  const unitHint = getRecipeBuilderPackageUnitHint(ingredient || {});
  if (unitHint === "ounces") return null;
  const isGallon = unitHint === "gallons"
    || (!unitHint && getIngredientGroup(normalizedName) === "Buckeye Beverage");
  const sizeOz = getRecipeBuilderPackageSizeOz({
    isGallon,
    overrideBottleOz,
    mappedBottleOz,
  });

  if (!sizeOz) return null;

  return {
    sizeOz,
    unitLabel: isGallon ? "gallons" : "bottles",
    unitSingle: isGallon ? "gallon" : "bottle",
  };
}

function getRecipeBuilderQuantityValue(ingredient, packageConfig) {
  if (!ingredient || !packageConfig) return "";
  return getRecipeBuilderPackageQuantity({
    packageCount: ingredient.packageCount,
    raw: ingredient.raw,
    oz: ingredient.oz,
    packageSizeOz: packageConfig.sizeOz,
    packageUnit: packageConfig.unitLabel,
  });
}

function calculateRecipeBuilderOunces(quantityValue, packageConfig) {
  if (!packageConfig) return 0;
  const quantity = toNumber(quantityValue);
  if (!quantity) return 0;
  return quantity * packageConfig.sizeOz;
}

function getRecipeBuilderPackageNote(packageConfig) {
  if (!packageConfig) return "";
  return `${formatNumber(packageConfig.sizeOz)} oz each`;
}

function getRecipeBuilderOzNote(packageConfig) {
  if (!packageConfig) return "";
  return "Auto";
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
  const preparedUnitCost = getPreparedIngredientFinishedUnitCost(id, overrideBottlePrice);
  if (preparedUnitCost) return preparedUnitCost;
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
  const recipe = recipes.find((entry) => entry.id === id);
  if (!confirmDashboardAction(
    `Move ${recipe?.title || "this recipe"} to Old Recipes?`,
    ["It will no longer appear in the active recipe list."],
    "You can reactivate it later.",
  )) return;

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
  const recipe = recipes.find((entry) => entry.id === id);
  if (!confirmDashboardAction(
    `Permanently delete ${recipe?.title || "this custom recipe"}?`,
    ["Its saved recipe, inactive status, and charge override will be removed."],
    "This cannot be undone from the dashboard.",
  )) return;

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

  switchAddProductType("cocktail");
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
  recipeSubmitButton.textContent = "Save recipe draft";
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
  const presentation = STATIC_RECIPE_PRESENTATION[recipe.id] || {};
  const { canonicalTitle = "", ...presentationFields } = presentation;
  const presentedRecipe = {
    ...recipe,
    ...presentationFields,
    title: clean(canonicalTitle) || recipe.title,
    description: clean(recipe.description) || clean(presentationFields.description),
    imageUrl: clean(recipe.imageUrl) || clean(presentationFields.imageUrl),
  };
  const edits = editedRecipes[recipe.id];
  if (!edits) return presentedRecipe;
  const repairedGallons = repairLegacyGallonRecipeIngredients(
    edits.ingredients || [],
    presentedRecipe.ingredients || [],
  );
  const repairedFormula = repairKnownRecipeFormulaEdits(
    presentedRecipe.id,
    repairedGallons.ingredients,
    presentedRecipe.ingredients || [],
  );
  if (repairedGallons.repaired || repairedFormula.repaired) {
    edits.ingredients = repairedFormula.ingredients;
    editedRecipes[recipe.id] = edits;
    saveEditedRecipes();
  }

  return {
    ...presentedRecipe,
    ...edits,
    title: clean(canonicalTitle) || clean(edits.title) || presentedRecipe.title,
    ingredients: (edits.ingredients || []).map((ingredient) => ({
      ...ingredient,
      id: slugify(ingredient.name),
      raw: ingredient.raw || buildRecipeIngredientRaw(
        ingredient.name,
        ingredient.packageCount,
        getRecipeBuilderPackageConfig(ingredient.name, ingredient),
      ),
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

      if (isPreparedIngredientRecipeNote({ raw: label, cost: costCell, ounces: ozCell })) return;

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
      const resolvedId = getResolvedIngredientId(ingredient);
      const resolvedName = normalizeIngredientAlias(ingredient.name);
      if (!byId.has(resolvedId)) {
        byId.set(resolvedId, {
          id: resolvedId,
          name: resolvedName,
          vendorProduct: getVendorMapping(resolvedId),
          totalCost: 0,
          totalOz: 0,
          recipes: [],
        });
      }

      const record = byId.get(resolvedId);
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

  if (!liveTapPriceItems.length) return [];

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
  const preparedCost = getPreparedIngredientCost(resolvedId, ingredient.oz, bottlePrice);

  if (preparedCost) {
    return {
      cost: preparedCost,
      source: "override",
    };
  }

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
  const preparedUnitCost = getPreparedIngredientFinishedUnitCost(ingredient.id, bottlePrice);
  if (preparedUnitCost) return preparedUnitCost;
  if (bottleOz && bottlePrice) return bottlePrice / bottleOz;
  return ingredient.totalOz ? ingredient.totalCost / ingredient.totalOz : 0;
}

function getCatalogCost(ingredient) {
  return getCatalogUnitCost(ingredient) * ingredient.totalOz;
}

function getCurrentKegPricingTapItems() {
  return buildVerifiedCurrentBeerTapItems({
    wallItems: kegWallItems,
    weeklyUsageItems,
    liveLevelItems: [...kegLiveLevels.values()],
    tapPriceItems: liveTapPriceItems,
    isBeerTapPosition,
  });
}

function buildKegPricingCatalog(sourceKegWallItems, currentTapItems = []) {
  const byId = new Map();
  const currentBeerByTap = new Map(
    currentTapItems
      .filter((item) => isBeerTapPosition(item) && toNumber(item.tapPosition))
      .map((item) => [toNumber(item.tapPosition), item]),
  );

  currentBeerByTap.forEach((item, tapNumber) => {
    const name = clean(item.name || item.matchedBrand);
    if (!name) return;
    const id = getKegPricingKey(name);
    const tapLabel = `${clean(item.wall) || "Current wall"} ${tapNumber}`;
    const existing = byId.get(id);
    if (existing) {
      if (!existing.sourceNames.includes(name)) existing.sourceNames.push(name);
      if (!existing.sourceTaps.includes(tapLabel)) existing.sourceTaps.push(tapLabel);
      return;
    }

    const catalogItem = {
      id,
      name: getKegDisplayName(name),
      tapNumber,
      wall: clean(item.wall),
      type: clean(item.type) || "Beer",
      brand: name,
    };
    const vendor = getKegVendorLabel(catalogItem);
    const kegOz = getDefaultKegSizeOz(catalogItem);
    byId.set(id, {
      ...catalogItem,
      kegOz,
      vendor,
      vendorProduct: getKegVendorProduct(catalogItem.name, vendor, kegOz),
      sourceNames: [name],
      sourceTaps: [tapLabel],
      sourceTypes: [catalogItem.type],
      isCurrentWallProduct: true,
    });
  });

  [
    ...buildActiveComingSoonBeerItems({ comingSoonItems }),
    ...buildAssignedOnDeckBeerItems({
      wallItems: sourceKegWallItems,
      isBeerTapPosition,
      resolveOnDeck: getKegOnDeckItem,
    }),
  ].forEach((item) => {
    const id = getKegPricingKey(item.name);
    const existing = byId.get(id);
    if (existing) {
      if (!existing.sourceTaps.includes(item.sourceTapLabel)) existing.sourceTaps.push(item.sourceTapLabel);
      return;
    }

    const customItem = customBeerKegs.find((entry) => getKegPricingKey(entry.name) === id) || {};
    const catalogItem = {
      ...customItem,
      ...item,
      id,
      brand: item.name,
    };
    const vendor = getKegVendorLabel(catalogItem);
    const kegOz = toNumber(item.kegOz) || toNumber(customItem.kegOz) || getDefaultKegSizeOz(catalogItem);
    byId.set(id, {
      ...catalogItem,
      kegOz,
      vendor,
      vendorProduct: getKegVendorProduct(item.name, vendor, kegOz),
      sourceNames: [item.name],
      sourceTaps: [item.sourceTapLabel],
      sourceTypes: ["Beer"],
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
  return isBeerTapPosition(item);
}

function sortTapLabels(a, b) {
  return toNumber(a.match(/\d+/)?.[0]) - toNumber(b.match(/\d+/)?.[0]);
}

function getDefaultKegSizeOz(item) {
  const liveRow = getKegLiveRow(item);
  const replacement = tapReplacementOverrides[getKegItemKey(item)];
  const overrideKegOz = getKegSizeOverrideOz(liveRow)
    || getKegSizeOverrideOz(replacement?.newBrand)
    || getKegSizeOverrideOz(item);
  if (overrideKegOz) return overrideKegOz;

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
  const mappedProduct = KEG_PROVI_PRODUCT_MAPPINGS[key] || {};
  return {
    vendor,
    syncVendor: "Provi",
    productName: mappedProduct.productName || aliases[0] || name,
    bottleOz: kegOz,
    preferredSku: mappedProduct.preferredSku || "",
    distributorHints: KEG_PROVI_DISTRIBUTOR_HINTS[vendor],
    searchAliases: [...new Set([
      name.replace(/\s+[12]$/, "").trim(),
      ...(mappedProduct.searchAliases || []),
      ...aliases,
    ].filter(Boolean))],
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
  return getKnownBeerKegSizeOz(item);
}

function normalizeKnownKegSizeOverrides(source = {}) {
  return Object.fromEntries(Object.entries(source).map(([id, override]) => {
    const knownKegOz = getKnownBeerKegSizeOz(id);
    if (!knownKegOz || !override || typeof override !== "object") return [id, override];
    return [id, { ...override, kegOz: String(knownKegOz) }];
  }));
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

function countVendorMappings(sourceIngredients = ingredients) {
  return sourceIngredients.filter((ingredient) => ingredient.vendorProduct).length;
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
    if (currentSection === "Bubbly in patio cooler") return;

    const normalizedName = normalizeInventoryName(first);
    const casePackaged = currentSection === "Juices and Mixers";
    const packSize = casePackaged ? normalizePackSize(row[4]) : 1;
    const caseCost = toNumber(row[3]);
    const unitCost = getInventoryUnitCost(caseCost, packSize);
    const note = clean(row[10]);
    const group = getInventoryGroup(normalizedName, currentSection);
    const baseId = getInventoryItemId(normalizedName);
    const id = baseId;
    const sourceOnHandUnits = getInventoryOnHandUnits({
      caseEquivalent: row[1],
      individualUnits: row[2],
      packSize,
      casePackaged,
    });
    const onHandDisplay = Object.prototype.hasOwnProperty.call(inventoryOnHandOverrides, id)
      ? inventoryOnHandOverrides[id]
      : inventorySharedInitialized ? "" : String(sourceOnHandUnits);
    const parDisplay = inventoryParOverrides[id] ?? clean(row[7]);

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
      orderHoldReason: getInventoryOrderHoldReason(normalizedName, group, note),
      excludeFromInventoryValue: normalizedName === "Non Alcoholic Beer",
    };

    item.excludeFromOrderList = Boolean(
      item.orderHoldReason || isFoodDepartmentOrderedInventoryItem(item.name),
    );

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
    const id = getInventoryItemId(normalizedName);
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
      const historicalFullKegOunces = toNumber(rawOz / currentEquivalent);
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
        historicalFullKegOunces,
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
    existing.historicalFullKegOunces = pickWeeklyUsageValue(
      existing.historicalFullKegOunces,
      item.historicalFullKegOunces,
    );
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
    onHandDisplay: Object.prototype.hasOwnProperty.call(inventoryOnHandOverrides, id)
      ? inventoryOnHandOverrides[id]
      : inventorySharedInitialized ? "" : "0",
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
  return ["Juices and Mixers", "Bubbly in patio cooler"].includes(first);
}

function isInventoryHeaderRow(first) {
  return /^bottle inventory/i.test(first) || /^on hand/i.test(first);
}

function normalizeInventoryName(name) {
  const normalized = normalizeInventoryBaseName(clean(name));

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
  if (sourceSection === "Bubbly in patio cooler") return "Other";
  if (normalized === "kahlua") return "Mixer Cabinet";
  if (normalized === "sweet and sour" || normalized === "non alcoholic beer") return "Other";

  const ingredientGroup = getIngredientGroup(name);
  if (ingredientGroup === "Liquor") return "Liquor Cabinet";
  return "Mixer Cabinet";
}

function getInventoryOrderHoldReason(name, group, note = "") {
  const sourceNote = clean(note);
  if (/do not order|hold|paused?/i.test(sourceNote)) {
    return `Source note: ${sourceNote}`;
  }
  return "";
}

function isFoodDepartmentOrderedInventoryItem(name) {
  return normalizeIngredientAlias(name) === "Sour Mix";
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
  const preparedName = getPreparedIngredientCanonicalName(normalized);
  if (preparedName) return preparedName;

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
  if (/^blue dot$/.test(normalized)) return "Blue Dot Juice";
  if (/^lime juice$/.test(normalized)) return "Lime Juice";
  if (/^lemon juice$/.test(normalized)) return "Lemon Juice";
  if (/^creme de cocao$/.test(normalized)) return "Creme de Cacao";
  if (/^llords /.test(normalized)) return titleCaseIngredientName(name.replace(/^Llords/i, "Llord's"));

  return titleCaseIngredientName(name);
}

function getIngredientGroup(name) {
  const normalized = clean(name).toLowerCase();

  if (STRAIGHT_LIQUOR_TAP_INGREDIENTS.some((item) => item.toLowerCase() === normalized)) return "Liquor";
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
  const sharedIndex = inventoryItemOrder.indexOf(item.id);
  if (sharedIndex >= 0) return `${String(sharedIndex).padStart(4, "0")}-${item.name.toLowerCase()}`;
  const cabinetIndex = INVENTORY_CABINET_ORDER.indexOf(item.name);
  if (cabinetIndex >= 0) return `a-${String(cabinetIndex).padStart(3, "0")}-${item.name.toLowerCase()}`;
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

  const inventoryPriceItems = inventoryItems
    .filter((item) => item.vendorProduct)
    .map((item) => ({
      id: item.id,
      name: item.name,
      priceType: "ingredient",
      vendorProduct: item.vendorProduct,
    }));

  const currentWallLiquorItems = getCurrentWallLiquorVendorItems();
  const byItemKey = new Map();
  [...ingredientItems, ...inventoryPriceItems, ...currentWallLiquorItems, ...kegItems].forEach((item) => {
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

async function runVendorSync({ automatic = false } = {}) {
  const syncScope = automatic ? "all" : vendorSyncScope;
  const candidates = getVendorMappedItems(syncScope);
  if (!candidates.length) {
    vendorSyncMessage = "No mapped pricing items match that vendor scope yet.";
    renderIngredientSummary();
    renderKegLevels();
    return { ok: false, skipped: true };
  }

  vendorSyncRunning = true;
  vendorSyncMessage = automatic
    ? "Automatically checking all mapped vendor prices..."
    : `Checking ${syncScope === "all" ? "all mapped vendors" : syncScope}...`;
  renderIngredientSummary();
  renderKegLevels();

  try {
    const response = await fetch("/api/vendor-sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        scope: syncScope,
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

    const candidatesByKey = new Map(
      candidates.map((item) => [`${item.priceType || "ingredient"}:${item.id}`, item]),
    );
    let applied = 0;
    let rejected = 0;
    (result.updates || []).forEach((update) => {
      if (!update.id || !Number.isFinite(update.bottleOz) || !Number.isFinite(update.bottlePrice)) return;
      const candidate = candidatesByKey.get(`${update.priceType || "ingredient"}:${update.id}`);
      const expectedBottleOz = toNumber(candidate?.vendorProduct?.bottleOz);
      if (expectedBottleOz > 0 && !isRoughlyEqual(update.bottleOz, expectedBottleOz)) {
        rejected += 1;
        return;
      }
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
        matchedSku: update.matchedSku || "",
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
    const blockedStatuses = vendorStatuses.filter((status) => ["blocked", "pending"].includes(status.status));
    const blockedNotes = blockedStatuses
      .map((status) => `${status.vendor}: ${status.message}`)
      .join(" ");

    const rejectionNote = rejected
      ? ` ${rejected} size mismatch${rejected === 1 ? "" : "es"}.`
      : "";
    vendorSyncMessage = blockedStatuses.length
      ? `${applied} price${applied === 1 ? "" : "s"} synced.${rejectionNote} ${blockedNotes}`
      : `${applied} price${applied === 1 ? "" : "s"} synced.${rejectionNote}`;
    render();
    return { ok: true, applied, rejected };
  } catch (error) {
    const errorMessage = error.message || "Vendor sync failed.";
    vendorSyncMessage = automatic
      ? `Automatic price sync could not finish: ${errorMessage} Use Sync Prices to retry.`
      : errorMessage;
    renderIngredientSummary();
    renderKegLevels();
    return { ok: false, error: errorMessage };
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
  const preparedAmount = getPreparedIngredientRecipeAmount(slugify(normalizedName), ingredient?.oz);
  if (preparedAmount) return preparedAmount;
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
    const savedOverrides = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const needsKnownBadOverrideRepair =
      localStorage.getItem(PRICE_OVERRIDE_MODEL_STORAGE_KEY) !== PRICE_OVERRIDE_MODEL_VERSION;

    if (
      needsKnownBadOverrideRepair &&
      isRoughlyEqual(toNumber(savedOverrides["tito-s"]?.bottleOz), 59.17) &&
      Math.abs(toNumber(savedOverrides["tito-s"]?.bottlePrice) - 25.85) < 0.001
    ) {
      savedOverrides["tito-s"] = DEFAULT_PRICE_OVERRIDES["tito-s"];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(savedOverrides));
    }
    localStorage.setItem(PRICE_OVERRIDE_MODEL_STORAGE_KEY, PRICE_OVERRIDE_MODEL_VERSION);

    return normalizePreparedIngredientPriceOverrides({
      ...DEFAULT_PRICE_OVERRIDES,
      ...savedOverrides,
    });
  } catch {
    return { ...DEFAULT_PRICE_OVERRIDES };
  }
}

function saveOverrides() {
  writeDashboardLocalStorageValue(STORAGE_KEY, getLocalIngredientPriceOverrides());
  scheduleSharedDashboardStateSync("pricing.ingredientPriceOverrides");
}

function loadKegPriceOverrides() {
  try {
    const savedOverrides = JSON.parse(localStorage.getItem(KEG_PRICE_STORAGE_KEY) || "{}");
    const merged = {
      ...DEFAULT_KEG_PRICE_OVERRIDES,
      ...savedOverrides,
    };

    Object.entries(DEFAULT_KEG_PRICE_OVERRIDES).forEach(([key, defaultOverride]) => {
      const savedOverride = savedOverrides[key];
      if (!savedOverride || isConservativeBundledPriceDefault(
        key,
        savedOverride,
        DEFAULT_KEG_PRICE_OVERRIDES,
        { excludeAmbiguous: false },
      )) {
        merged[key] = defaultOverride;
      }
    });

    return normalizeKnownKegSizeOverrides(merged);
  } catch {
    return normalizeKnownKegSizeOverrides({
      ...DEFAULT_KEG_PRICE_OVERRIDES,
    });
  }
}

function saveKegPriceOverrides() {
  writeDashboardLocalStorageValue(KEG_PRICE_STORAGE_KEY, getLocalKegPriceOverrides());
  scheduleSharedDashboardStateSync("pricing.kegPriceOverrides");
}

function loadCustomBeerKegs() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_BEER_KEG_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomBeerKegs() {
  writeDashboardLocalStorageValue(CUSTOM_BEER_KEG_STORAGE_KEY, customBeerKegs);
  scheduleSharedDashboardStateSync("products.customBeerKegs");
}

function loadCustomLiquorTaps() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_LIQUOR_TAP_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomLiquorTaps() {
  writeDashboardLocalStorageValue(CUSTOM_LIQUOR_TAP_STORAGE_KEY, customLiquorTaps);
  scheduleSharedDashboardStateSync("products.customLiquorTaps");
}

function loadPmbPublishQueue() {
  try {
    return normalizePmbPublishQueue(
      JSON.parse(localStorage.getItem(PMB_PUBLISH_QUEUE_STORAGE_KEY) || "[]"),
    );
  } catch {
    return [];
  }
}

function savePmbPublishQueue() {
  pmbPublishQueue = normalizePmbPublishQueue(pmbPublishQueue);
  writeDashboardLocalStorageValue(PMB_PUBLISH_QUEUE_STORAGE_KEY, pmbPublishQueue);
  scheduleSharedDashboardStateSync("products.pmbPublishQueue");
}

function loadComingSoonItems() {
  try {
    return JSON.parse(localStorage.getItem(COMING_SOON_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveComingSoonItems() {
  writeDashboardLocalStorageValue(COMING_SOON_STORAGE_KEY, comingSoonItems);
  scheduleSharedDashboardStateSync("products.comingSoonItems");
}

function loadTapReplacementOverrides() {
  try {
    return JSON.parse(localStorage.getItem(TAP_REPLACEMENT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveTapReplacementOverrides() {
  writeDashboardLocalStorageValue(TAP_REPLACEMENT_STORAGE_KEY, tapReplacementOverrides);
  scheduleSharedDashboardStateSync("products.tapReplacementOverrides");
}

function loadChargeOverrides() {
  try {
    return JSON.parse(localStorage.getItem(CHARGE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveChargeOverrides() {
  writeDashboardLocalStorageValue(CHARGE_STORAGE_KEY, chargeOverrides);
  scheduleSharedDashboardStateSync("pricing.chargeOverrides");
}

function loadCustomRecipes() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_RECIPE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveCustomRecipes() {
  if (isEmployeeDashboard) {
    saveEmployeeSharedRecipeCache();
    return;
  }
  writeDashboardLocalStorageValue(CUSTOM_RECIPE_STORAGE_KEY, customRecipes);
  scheduleSharedDashboardStateSync("recipes.customRecipes");
}

function loadInactiveRecipeIds() {
  try {
    return JSON.parse(localStorage.getItem(INACTIVE_RECIPE_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveInactiveRecipeIds() {
  if (isEmployeeDashboard) {
    saveEmployeeSharedRecipeCache();
    return;
  }
  writeDashboardLocalStorageValue(INACTIVE_RECIPE_STORAGE_KEY, inactiveRecipeIds);
  scheduleSharedDashboardStateSync("recipes.inactiveRecipeIds");
}

function loadEditedRecipes() {
  try {
    return JSON.parse(localStorage.getItem(EDITED_RECIPE_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveEditedRecipes() {
  if (isEmployeeDashboard) {
    saveEmployeeSharedRecipeCache();
    return;
  }
  writeDashboardLocalStorageValue(EDITED_RECIPE_STORAGE_KEY, editedRecipes);
  scheduleSharedDashboardStateSync("recipes.editedRecipes");
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

function loadInventoryItemOrder() {
  try {
    return JSON.parse(localStorage.getItem(INVENTORY_ORDER_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveInventoryItemOrder() {
  localStorage.setItem(INVENTORY_ORDER_STORAGE_KEY, JSON.stringify(inventoryItemOrder));
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
  scheduleSharedWeeklyUsageSave();
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
  scheduleSharedWeeklyUsageSave();
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
  scheduleSharedWeeklyUsageSave();
}

function loadWeeklyUsageLastSyncAt() {
  return clean(localStorage.getItem(WEEKLY_USAGE_LAST_SYNC_STORAGE_KEY) || "");
}

function saveWeeklyUsageLastSyncAt() {
  localStorage.setItem(WEEKLY_USAGE_LAST_SYNC_STORAGE_KEY, weeklyUsageLastSyncAt);
  scheduleSharedWeeklyUsageSave();
}

function loadKegOnHandOverrides() {
  try {
    return JSON.parse(localStorage.getItem(KEG_ON_HAND_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function loadPmbCurrentTapSnapshot() {
  try {
    const snapshot = JSON.parse(localStorage.getItem(PMB_CURRENT_TAP_SNAPSHOT_STORAGE_KEY) || "null");
    return snapshot && typeof snapshot === "object" ? snapshot : null;
  } catch {
    return null;
  }
}

function savePmbCurrentTapSnapshot() {
  try {
    localStorage.setItem(PMB_CURRENT_TAP_SNAPSHOT_STORAGE_KEY, JSON.stringify(pmbCurrentTapSnapshot));
  } catch {
    // A live complete snapshot still remains authoritative for this session.
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

function getCanonicalProductDisplayName(value) {
  const original = clean(value);
  const key = original
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+[123]\s*$/, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return CANONICAL_PRODUCT_DISPLAY_NAMES[key] || original;
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
