import { readFile } from "node:fs/promises";
import path from "node:path";
import { getKnownBeerKegSizeOz } from "../public/beer-keg-pricing.mjs";
import { getCocktailRecipeYieldOz as resolveCocktailRecipeYieldOz } from "../public/cocktail-recipe-yields.mjs";
import { getTapConfigRows } from "./pmb-tap-config.mjs";
import {
  buildVerifiedKegSlotMap,
  PmbKegSafetyError,
  requireSuccessfulKegLevelResponse,
} from "./pmb-keg-safety.mjs";
import {
  initializeSharedKegParAgentState,
  readSharedKegParAgentState,
  replaceSharedKegParAgentState,
} from "./keg-par-agent-shared-store.mjs";
import { readSharedWeeklyUsageState } from "./weekly-usage-shared-store.mjs";
import { readSharedDashboardState } from "./shared-dashboard-store.mjs";
import { sanitizeKegPlanSnapshot } from "./inventory-store.mjs";
import {
  applyTapReplacementSafety,
} from "./tap-replacement-safety.mjs";
import { getMissingLatestCompletedUsageTaps } from "./weekly-usage-periods.mjs";
import {
  createWeeklyPlanSnapshot,
  getCurrentWeeklyPlanSnapshot,
  isRecommendationForOperatingWeek,
} from "../public/weekly-action-plan.mjs";
import { normalizeVendorOrderPolicy } from "../public/vendor-order-drafts.mjs";

const STANDARD_BEER_KEG_OZ = 15.5 * 128;
const STANDARD_COCKTAIL_KEG_OZ = 12 * 128;
const STANDARD_LIQUOR_KEG_OZ = 500;
const MAIN_BEER_RESERVE_KEGS = 1;
const KARAOKE_BEER_RESERVE_KEGS = 0.5;
const COCKTAIL_RESERVE_KEGS = 0.25;
const LIQUOR_RESERVE_OZ = 100;
const STANDARD_LIQUOR_BOTTLE_OZ = 59.1745;
const LIQUOR_BOTTLE_SIZE_OVERRIDES = [
  { names: ["absolut raspberri"], ounces: 25.3605 },
  { names: ["absolut vanilia"], ounces: 33.814 },
  { names: ["skrewball", "screwball"], ounces: 25.3605 },
];
const DEFAULT_SETTINGS = {
  maxOrderPerTap: 2,
};

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getLiquorBottleOunces(tap = {}) {
  const configuredOunces = Number(tap.bottleOz ?? tap.bottleSizeOz ?? tap.unitSizeOz);
  if (Number.isFinite(configuredOunces) && configuredOunces > 0) return configuredOunces;

  const productName = clean(tap.name).toLowerCase();
  const override = LIQUOR_BOTTLE_SIZE_OVERRIDES.find(({ names }) => (
    names.some((name) => productName.includes(name))
  ));
  return override?.ounces || STANDARD_LIQUOR_BOTTLE_OZ;
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getTapStateKey(item = {}) {
  return slugify(`${item.wall || "tap"}-${toNumber(item.tapNumber)}-${item.templateBrand || item.brand || item.name || ""}`);
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const safe = [];
    let inString = false;
    let escaping = false;

    for (const char of String(text || "")) {
      if (!inString) {
        if (char === "\"") inString = true;
        safe.push(char);
        continue;
      }
      if (escaping) {
        if (/^["\\/bfnrtu]$/.test(char)) {
          safe.push(char);
        } else {
          safe.push("\\", char);
        }
        escaping = false;
        continue;
      }
      if (char === "\\") {
        safe.push(char);
        escaping = true;
        continue;
      }
      if (char === "\"") {
        safe.push(char);
        inString = false;
        continue;
      }
      if (char === "\n") {
        safe.push("\\n");
        continue;
      }
      if (char === "\r") {
        safe.push("\\r");
        continue;
      }
      safe.push(char);
    }

    try {
      return JSON.parse(safe.join("").replace(/,\s*([}\]])/g, "$1"));
    } catch {
      return null;
    }
  }
}

async function postJson(baseUrl, requestPath, body, token = "") {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const raw = await response.text();
  return {
    status: response.status,
    json: parseJsonLoose(raw),
    raw,
  };
}

function getConfig() {
  const baseUrl = (process.env.PMB_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("Missing PMB_API_BASE_URL in .env.local");
  const username = (process.env.PMB_API_USERNAME || "").trim();
  const password = (process.env.PMB_API_PASSWORD || "").trim();
  if (!username || !password) throw new Error("Missing PMB_API_USERNAME or PMB_API_PASSWORD in .env.local");

  return {
    baseUrl,
    username,
    password,
    clientId: Number(process.env.PMB_API_CLIENT_ID || "910423"),
    clientName: (process.env.PMB_API_CLIENT_NAME || "PourMyBeer API").trim(),
  };
}

async function getAuthtoken(config) {
  const auth = await postJson(config.baseUrl, "/api/authtoken", {
    username: config.username,
    password: config.password,
    id: config.clientId,
    name: config.clientName,
    type: "json-server-control",
    version: 1,
  });

  if (auth.status !== 200 || !auth.json?.authtoken) {
    throw new Error(`PMB authtoken failed (${auth.status})`);
  }

  return String(auth.json.authtoken);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"" && inQuotes && next === "\"") {
      cell += "\"";
      index += 1;
      continue;
    }
    if (char === "\"") {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some((value) => clean(value))) rows.push(row);
  return rows;
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
    const type = cells[1];
    const brand = cells[2];
    if (!tapNumber || !currentWall || !type || !brand) return;

    items.push({
      key: getTapStateKey({ wall: currentWall, tapNumber, brand }),
      tapNumber,
      type,
      brand,
      wall: currentWall,
    });
  });

  return items.sort((a, b) => a.tapNumber - b.tapNumber);
}

async function getKegWallItems() {
  const csvPath = path.join(process.cwd(), "public", "data", "keg-levels-template.csv");
  return parseKegLevels(parseCsv(await readFile(csvPath, "utf8")));
}

async function getApprovedWeeklyUsageChangeovers() {
  const csvPath = path.join(process.cwd(), "public", "data", "weekly-usage-changeovers.csv");
  let rows;
  try {
    rows = parseCsv(await readFile(csvPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return rows.slice(1).map((row) => ({
    tapNumber: toNumber(row[0]),
    previousName: clean(row[1]),
    currentName: clean(row[2]),
    effectiveDate: clean(row[3]),
    splitWeek: clean(row[4]).toLowerCase(),
  })).filter((row) => row.tapNumber && row.currentName && row.effectiveDate);
}

function buildTapLookup(kegWallItems) {
  const byTap = new Map();

  kegWallItems.forEach((tap) => {
    byTap.set(toNumber(tap.tapNumber), { ...tap });
  });

  return { byTap };
}

function buildCurrentTaps(rows, productByPlu, tapLookup) {
  return rows
    .map((row) => {
      const plu = toNumber(row.plu);
      const tapNumber = toNumber(row.tapNumber);
      if (!plu || !tapNumber || row.unused) return null;
      const template = tapLookup.byTap.get(tapNumber) || {};
      const productName = clean(productByPlu.get(plu)?.name || row.product);
      return {
        key: template.key || getTapStateKey({ wall: template.wall, tapNumber, brand: productName }),
        plu,
        tapNumber,
        wall: template.wall || "",
        type: template.type || "",
        name: productName,
        brand: productName,
        templateBrand: template.brand || "",
        deviceId: toNumber(row.deviceId),
        lineNum: toNumber(row.lineNum),
        slotKey: clean(row.slotKey) || `tap:${tapNumber}`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.tapNumber - b.tapNumber || a.name.localeCompare(b.name));
}

function isLiquorOunceTap(tapNumber) {
  return (tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92);
}

function isKegTap(item) {
  return !isLiquorOunceTap(toNumber(item?.tapNumber)) && clean(item?.type).toLowerCase() !== "shots";
}

function isCocktailTap(item) {
  return clean(item?.type).toLowerCase() === "cocktail";
}

function getKegSizeOverrideOz(item) {
  return getKnownBeerKegSizeOz(item);
}

function getDefaultKegSizeOz(item) {
  if (isLiquorOunceTap(toNumber(item?.tapNumber))) return STANDARD_LIQUOR_KEG_OZ;
  if (clean(item?.type).toLowerCase() === "cocktail") return STANDARD_COCKTAIL_KEG_OZ;
  return getKegSizeOverrideOz(item) || STANDARD_BEER_KEG_OZ;
}

export function getCocktailRecipeYieldOz(item) {
  if (!isCocktailTap(item)) return 0;
  return resolveCocktailRecipeYieldOz(item);
}

export function getKegFullOunces(liveRow, item = null) {
  const recipeYieldOz = getCocktailRecipeYieldOz(item);
  if (recipeYieldOz) return recipeYieldOz;
  const knownBeerKegOz = getKegSizeOverrideOz(liveRow) || getKegSizeOverrideOz(item);
  if (knownBeerKegOz) return knownBeerKegOz;
  if (!liveRow) return getDefaultKegSizeOz(item);
  const rawKegSize = toNumber(liveRow.rawKegSize);
  if (rawKegSize) {
    const decimalPlaces = Math.max(0, Math.round(toNumber(liveRow.rawKegSizeDp)));
    return decimalPlaces ? rawKegSize / (10 ** decimalPlaces) : rawKegSize;
  }
  return getDefaultKegSizeOz(item);
}

function getKegCurrentFraction(liveRow, item = null) {
  if (!liveRow) return 0;
  const rawPercent = toNumber(liveRow.rawPercent);
  if (rawPercent > 0) return rawPercent / 10000;

  const percent = toNumber(liveRow.fillLevelPercent);
  return percent > 0 ? percent / 100 : 0;
}

function round(value, places = 2) {
  const multiplier = 10 ** places;
  return Math.round(toNumber(value) * multiplier) / multiplier;
}

function getSettings(state = {}) {
  const settings = {
    maxOrderPerTap: state.settings?.maxOrderPerTap ?? DEFAULT_SETTINGS.maxOrderPerTap,
  };

  const envMap = {
    PAR_AGENT_MAX_ORDER_PER_TAP: "maxOrderPerTap",
  };
  Object.entries(envMap).forEach(([envKey, settingKey]) => {
    if (process.env[envKey] == null || process.env[envKey] === "") return;
    settings[settingKey] = process.env[envKey];
  });

  Object.keys(settings).forEach((key) => {
    const value = toNumber(settings[key]);
    if (value || String(settings[key]).trim() === "0") settings[key] = value;
  });

  settings.maxOrderPerTap = Math.max(1, Math.round(settings.maxOrderPerTap || DEFAULT_SETTINGS.maxOrderPerTap));
  return settings;
}

export async function readParAgentState() {
  const shared = await readSharedKegParAgentState();
  return { ...shared.data, revision: shared.revision, initialized: shared.initialized, initializedAt: shared.initializedAt, updatedAt: shared.updatedAt, updatedByRole: shared.updatedByRole };
}

export async function writeParAgentState(nextState, { expectedRevision, initialize = false, role = "owner" } = {}) {
  const payload = {
    expectedRevision: expectedRevision ?? nextState.revision,
    data: {
      onHandOverrides: nextState.onHandOverrides || {},
      parOverrides: nextState.parOverrides || {},
      onDeckOverrides: nextState.onDeckOverrides || {},
      settings: getSettings(nextState),
      recommendations: nextState.recommendations || null,
    },
  };
  const shared = initialize
    ? await initializeSharedKegParAgentState(payload, role)
    : await replaceSharedKegParAgentState(payload, role);
  return { ...shared.data, revision: shared.revision, initialized: shared.initialized, initializedAt: shared.initializedAt, updatedAt: shared.updatedAt, updatedByRole: shared.updatedByRole };
}

export async function syncParAgentState(patch = {}, { expectedRevision, role = "owner", initialize = false } = {}) {
  const current = await readParAgentState();
  return writeParAgentState({
    ...current,
    onHandOverrides: patch.onHandOverrides || current.onHandOverrides || {},
    parOverrides: patch.parOverrides || current.parOverrides || {},
    onDeckOverrides: patch.onDeckOverrides || current.onDeckOverrides || {},
    settings: {
      ...(current.settings || {}),
      ...(patch.settings || {}),
    },
  }, { expectedRevision: expectedRevision ?? current.revision, role, initialize });
}

export async function publishWeeklyPlanSnapshot({
  expectedRevision,
  inventoryItems = [],
  orderPolicy = null,
  recommendationPricing = [],
  kegPlanSnapshot = null,
  role = "owner",
} = {}) {
  const current = await readParAgentState();
  const frozenKegPlan = sanitizeKegPlanSnapshot(kegPlanSnapshot);
  if (!current.initialized || !frozenKegPlan?.generatedAt) {
    const error = new Error("Save the Monday snapshot with keg levels and on-hand counts before publishing the plan.");
    error.code = "WEEKLY_PLAN_NOT_GENERATED";
    error.status = 409;
    throw error;
  }
  if (!isRecommendationForOperatingWeek(frozenKegPlan.generatedAt, new Date())) {
    const error = new Error("The saved Monday keg snapshot belongs to an earlier operating week.");
    error.code = "WEEKLY_PLAN_WRONG_WEEK";
    error.status = 409;
    throw error;
  }

  const pricingByKey = new Map(
    (Array.isArray(recommendationPricing) ? recommendationPricing : [])
      .map((item) => [clean(item?.key), item])
      .filter(([key]) => key),
  );
  const recommendations = frozenKegPlan.items.map((item) => {
    const pricing = pricingByKey.get(clean(item.key));
    if (!pricing) return item;
    return {
      ...item,
      vendor: clean(pricing.vendor).slice(0, 80),
      vendorSku: clean(pricing.vendorSku).slice(0, 120),
      vendorProductName: clean(pricing.vendorProductName).slice(0, 240),
      unitCost: Math.max(0, toNumber(pricing.unitCost)),
    };
  });
  const weeklyPlanSnapshot = createWeeklyPlanSnapshot({
    generatedAt: frozenKegPlan.generatedAt,
    inventoryItems: Array.isArray(inventoryItems) ? inventoryItems.slice(0, 1_000) : [],
    orderPolicy: normalizeVendorOrderPolicy(orderPolicy),
    recommendations,
  });
  const nextRevision = Number(current.revision) + 1;
  return writeParAgentState({
    ...current,
    recommendations: {
      ...(current.recommendations || {}),
      generatedAt: frozenKegPlan.generatedAt,
      summary: frozenKegPlan.summary,
      items: recommendations,
      prepChecklist: {},
      weeklyPlanSnapshot,
      publishedStateRevision: nextRevision,
      weeklyPlanRecalledAt: "",
    },
  }, {
    expectedRevision: expectedRevision ?? current.revision,
    role,
  });
}

export async function recallWeeklyPlanSnapshot({
  expectedRevision,
  role = "owner",
} = {}) {
  const current = await readParAgentState();
  const snapshot = getCurrentWeeklyPlanSnapshot(current.recommendations, new Date());
  if (!current.initialized || !snapshot) {
    const error = new Error("There is no current locked Weekly Plan to recall.");
    error.code = "WEEKLY_PLAN_NOT_LOCKED";
    error.status = 409;
    throw error;
  }

  return writeParAgentState({
    ...current,
    recommendations: {
      ...(current.recommendations || {}),
      prepChecklist: {},
      weeklyOrderTracking: {},
      weeklyPlanSnapshot: null,
      publishedStateRevision: 0,
      weeklyPlanRecalledAt: new Date().toISOString(),
    },
  }, {
    expectedRevision: expectedRevision ?? current.revision,
    role,
  });
}

export function validateTapConfigCoverage(verifiedSlots, kegWallItems) {
  const slots = verifiedSlots instanceof Map ? [...verifiedSlots.values()] : [...(verifiedSlots || [])];
  const expectedTapNumbers = [...new Set(
    (kegWallItems || []).map((tap) => toNumber(tap?.tapNumber)).filter(Boolean),
  )].sort((a, b) => a - b);
  const liveTapNumbers = [...new Set(
    slots.map((slot) => toNumber(slot?.tapNumber)).filter(Boolean),
  )].sort((a, b) => a - b);
  const expectedSet = new Set(expectedTapNumbers);
  const liveSet = new Set(liveTapNumbers);
  const missingTapNumbers = expectedTapNumbers.filter((tapNumber) => !liveSet.has(tapNumber));
  const unexpectedTapNumbers = liveTapNumbers.filter((tapNumber) => !expectedSet.has(tapNumber));
  const unidentifiedSlotCount = slots.filter((slot) => !toNumber(slot?.tapNumber)).length;

  if (
    !expectedTapNumbers.length
    || missingTapNumbers.length
    || unexpectedTapNumbers.length
    || unidentifiedSlotCount
    || slots.length !== expectedTapNumbers.length
  ) {
    throw new PmbKegSafetyError(
      "Live PMB tap configuration is incomplete or does not match the configured keg wall. Existing recommendations were kept.",
      {
        code: "PMB_TAP_CONFIG_PARTIAL",
        status: 503,
        details: {
          expectedTapCount: expectedTapNumbers.length,
          liveTapCount: slots.length,
          missingTapNumbers,
          unexpectedTapNumbers,
          unidentifiedSlotCount,
        },
      },
    );
  }

  return slots;
}

export async function fetchPmbSnapshot({
  config: providedConfig = null,
  getConfigImpl = getConfig,
  getAuthtokenImpl = getAuthtoken,
  getKegWallItemsImpl = getKegWallItems,
  getTapConfigRowsImpl = getTapConfigRows,
  postJsonImpl = postJson,
} = {}) {
  const config = providedConfig || getConfigImpl();
  const token = await getAuthtokenImpl(config);
  const kegWallItems = await getKegWallItemsImpl();
  const tapLookup = buildTapLookup(kegWallItems);

  const products = await postJsonImpl(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token);
  if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
    throw new PmbKegSafetyError(`PMB productlist failed (${products.status})`, {
      code: "PMB_PRODUCT_LIST_UNAVAILABLE",
      status: 503,
    });
  }

  const productByPlu = new Map();
  products.json.productlist.forEach((product) => {
    const plu = toNumber(product?.plu);
    if (!plu) return;
    productByPlu.set(plu, {
      plu,
      name: clean(product.name),
    });
  });

  let tapConfigRows;
  try {
    tapConfigRows = await getTapConfigRowsImpl(config);
  } catch (error) {
    if (error instanceof PmbKegSafetyError) throw error;
    throw new PmbKegSafetyError(
      `Live PMB tap configuration could not be verified: ${error?.message || "tap configuration unavailable"}. Existing recommendations were kept.`,
      {
        code: "PMB_TAP_CONFIG_UNAVAILABLE",
        status: 503,
      },
    );
  }
  const verifiedSlots = buildVerifiedKegSlotMap(tapConfigRows);
  validateTapConfigCoverage(verifiedSlots, kegWallItems);
  const currentTaps = buildCurrentTaps([...verifiedSlots.values()], productByPlu, tapLookup);

  const levelBySlot = new Map();
  for (const slot of currentTaps) {
    const response = await postJsonImpl(
      config.baseUrl,
      "/api/getkeglevels",
      { device_id: slot.deviceId, line_num: slot.lineNum },
      token,
    );
    const levelJson = requireSuccessfulKegLevelResponse(response, slot, {
      requireKegSize: false,
    });
    const rawPercent = Number(levelJson.fill_level_perc);
    const rawKegSize = Number(levelJson.fill_level_keg_size);
    const rawKegSizeDp = Number(levelJson.fill_level_keg_size_dp);
    levelBySlot.set(`${slot.deviceId}:${slot.lineNum}`, {
      fillLevelPercent: Math.round((rawPercent / 100) * 10) / 10,
      rawPercent,
      rawKegSize: Number.isFinite(rawKegSize) && rawKegSize > 0 ? rawKegSize : null,
      rawKegSizeDp: Number.isFinite(rawKegSizeDp) && rawKegSizeDp >= 0 ? rawKegSizeDp : null,
    });
  }

  const levelsByTap = new Map();
  currentTaps.forEach((tap) => {
    const level = levelBySlot.get(`${tap.deviceId}:${tap.lineNum}`) || {};
    levelsByTap.set(tap.slotKey, {
      ...level,
      slotKey: tap.slotKey,
      plu: tap.plu,
      name: tap.name,
      tapNumber: tap.tapNumber,
      deviceId: tap.deviceId,
      lineNum: tap.lineNum,
    });
  });

  return {
    currentTaps,
    kegWallItems,
    tapLookup,
    weeklyVolumeByPlu: new Map(),
    levelsByTap,
    weeks: [],
  };
}

function getOnDeckProduct(state, key) {
  const saved = state.onDeckOverrides?.[key];
  if (!saved) return null;
  if (typeof saved === "string") return { name: clean(saved) };
  const name = clean(saved.name || saved.productName);
  return name
    ? {
      comingSoonId: clean(saved.comingSoonId),
      name,
      kind: clean(saved.kind),
      plu: toNumber(saved.plu),
      onHand: toNumber(saved.onHand),
      onHandUnit: clean(saved.onHandUnit),
    }
    : null;
}

const ROLLING_USAGE_WEEKS = 6;

function getSharedWeeklyUsageValues(item, displayUnit) {
  if (!item || clean(item.displayUnit).toLowerCase() !== displayUnit) return null;
  const values = Array.isArray(item.history)
    ? item.history.slice(0, ROLLING_USAGE_WEEKS).flatMap((entry) => {
        const rawValue = entry?.value;
        if (rawValue === null || rawValue === undefined || rawValue === "") return [];
        const value = Number(rawValue);
        return Number.isFinite(value) && value >= 0 ? [value] : [];
      })
    : [];
  return {
    average: values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0,
    values,
  };
}

export function buildRawRecommendation(tap, level, weeklyEntries, state, settings, sharedWeeklyUsageItem = null) {
  const isKeg = isKegTap(tap);
  const isLiquor = isLiquorOunceTap(toNumber(tap?.tapNumber));
  const backupKegs = toNumber(state.onHandOverrides?.[tap.key]);
  const onDeckProduct = getOnDeckProduct(state, tap.key);
  const onDeckOnHandKegs = onDeckProduct
    && clean(onDeckProduct.kind).toLowerCase() !== "liquor"
    && clean(onDeckProduct.onHandUnit).toLowerCase() !== "oz"
    ? toNumber(onDeckProduct.onHand)
    : 0;
  const fullOunces = getKegFullOunces(level, tap);
  const liveFraction = isKeg || isLiquor ? round(getKegCurrentFraction(level, tap), 3) : 0;
  const recentWeeklyKegs = isKeg
    ? weeklyEntries.map((entry) => round(fullOunces ? entry.volumeOz / fullOunces : 0, 3))
    : [];
  const sharedKegUsage = isKeg ? getSharedWeeklyUsageValues(sharedWeeklyUsageItem, "kegs") : null;
  const weeklyKegs = sharedKegUsage ? sharedKegUsage.values.map((value) => round(value, 3)) : recentWeeklyKegs;
  const avgWeeklyKegs = sharedKegUsage
    ? round(sharedKegUsage.average, 3)
    : weeklyKegs.length
      ? round(weeklyKegs.reduce((total, value) => total + value, 0) / weeklyKegs.length, 3)
      : 0;
  const currentStockKegs = round(liveFraction + backupKegs + onDeckOnHandKegs, 3);

  if (isLiquor) {
    const sharedOunceUsage = getSharedWeeklyUsageValues(sharedWeeklyUsageItem, "oz");
    const weeklyOunces = sharedOunceUsage
      ? sharedOunceUsage.values.map((value) => round(value, 2))
      : weeklyEntries.map((entry) => round(entry.volumeOz, 2));
    const avgWeeklyOunces = sharedOunceUsage
      ? round(sharedOunceUsage.average, 2)
      : weeklyOunces.length
        ? round(weeklyOunces.reduce((total, value) => total + value, 0) / weeklyOunces.length, 2)
        : 0;
    const currentStockOunces = round(fullOunces * liveFraction, 2);
    const targetStockOunces = round(avgWeeklyOunces + LIQUOR_RESERVE_OZ, 2);
    const gapOunces = round(targetStockOunces - currentStockOunces, 2);
    const bottleOz = getLiquorBottleOunces(tap);
    const refillBottleQty = Math.ceil(LIQUOR_RESERVE_OZ / bottleOz);
    const suggestedBottleOrderQty = currentStockOunces < targetStockOunces
      ? refillBottleQty
      : 0;
    const weeksOfStock = avgWeeklyOunces > 0 ? round(currentStockOunces / avgWeeklyOunces, 2) : 99;
    const reason = suggestedBottleOrderQty
      ? `Current keg ${currentStockOunces} oz is below ${targetStockOunces} oz: ${avgWeeklyOunces} oz/week plus 100 oz. Order ${suggestedBottleOrderQty} bottles (${round(suggestedBottleOrderQty * bottleOz, 2)} oz) for this physical liquor tap.`
      : `Current keg ${currentStockOunces} oz covers ${avgWeeklyOunces} oz/week plus 100 oz.`;

    return {
      key: tap.key,
      tapNumber: tap.tapNumber,
      wall: tap.wall,
      name: tap.name,
      templateBrand: tap.templateBrand,
      type: tap.type,
      plu: tap.plu,
      isKegTap: false,
      isLiquorTap: true,
      liveFraction,
      backupKegs,
      currentStockKegs: 0,
      avgWeeklyKegs: 0,
      currentStockOunces,
      avgWeeklyOunces,
      targetStockOunces,
      gapOunces,
      suggestedPar: "",
      suggestedBottleOrderQty,
      refillBottleQty: suggestedBottleOrderQty,
      bottleOz: round(bottleOz, 4),
      minimumRefillOunces: LIQUOR_RESERVE_OZ,
      suggestedRefillQty: 0,
      deferredQty: 0,
      rawOrderQty: suggestedBottleOrderQty,
      orderQty: suggestedBottleOrderQty,
      orderProductName: tap.name,
      actionType: suggestedBottleOrderQty ? "order" : "none",
      deferredReview: false,
      deferredReason: "",
      onDeckProduct: null,
      priority: round(avgWeeklyOunces + Math.max(0, gapOunces), 2),
      weeksOfStock,
      weeklyKegs: [],
      weeklyOunces,
      reason,
    };
  }

  if (!isKeg) {
    return {
      key: tap.key,
      tapNumber: tap.tapNumber,
      wall: tap.wall,
      name: tap.name,
      templateBrand: tap.templateBrand,
      type: tap.type,
      plu: tap.plu,
      isKegTap: false,
      liveFraction,
      backupKegs,
      currentStockKegs,
      avgWeeklyKegs: 0,
      suggestedPar: "",
      rawOrderQty: 0,
      orderQty: 0,
      orderProductName: "",
      actionType: "none",
      onDeckProduct,
      reason: "Straight-liquor tap; handled by bottle inventory.",
      weeklyKegs: [],
    };
  }

  if (isCocktailTap(tap)) {
    const targetStockKegs = round(avgWeeklyKegs + COCKTAIL_RESERVE_KEGS, 2);
    const gapKegs = round(targetStockKegs - currentStockKegs, 3);
    const rawMakeQty = gapKegs > 0 ? Math.ceil(gapKegs) : 0;
    const weeksOfStock = avgWeeklyKegs > 0 ? round(currentStockKegs / avgWeeklyKegs, 2) : 99;
    const reasonParts = [];

    if (rawMakeQty) {
      reasonParts.push(`Current stock ${currentStockKegs} is below ${targetStockKegs}: ${avgWeeklyKegs}/week plus 0.25 keg.`);
    } else {
      reasonParts.push(`Current stock ${currentStockKegs} covers ${avgWeeklyKegs}/week plus 0.25 keg.`);
    }
    if (rawMakeQty && onDeckProduct?.name) {
      reasonParts.push(`Make ${onDeckProduct.name} from On Deck instead of ${tap.name}.`);
    }

    return {
      key: tap.key,
      tapNumber: tap.tapNumber,
      wall: tap.wall,
      name: tap.name,
      templateBrand: tap.templateBrand,
      type: tap.type,
      plu: tap.plu,
      isKegTap: true,
      liveFraction,
      backupKegs,
      currentStockKegs,
      avgWeeklyKegs,
      targetStockKegs,
      suggestedPar: targetStockKegs,
      gapKegs,
      rawOrderQty: rawMakeQty,
      orderQty: rawMakeQty,
      orderProductName: rawMakeQty && onDeckProduct?.name ? onDeckProduct.name : tap.name,
      actionType: "make",
      onDeckProduct,
      priority: round((avgWeeklyKegs * 100) + Math.max(0, gapKegs) * 60, 2),
      weeksOfStock,
      weeklyKegs,
      reason: reasonParts.join(" "),
    };
  }

  const isMainBeer = clean(tap.wall).toLowerCase() === "main";
  const beerReserveKegs = isMainBeer
    ? MAIN_BEER_RESERVE_KEGS
    : KARAOKE_BEER_RESERVE_KEGS;
  const targetStockKegs = round(avgWeeklyKegs + beerReserveKegs, 2);
  const gapKegs = round(targetStockKegs - currentStockKegs, 3);
  const maxOrderPerTap = Math.max(1, Math.round(toNumber(settings?.maxOrderPerTap) || DEFAULT_SETTINGS.maxOrderPerTap));
  const calculatedOrderQty = gapKegs > 0
    ? (isMainBeer ? 1 : Math.ceil(gapKegs))
    : 0;
  const rawOrderQty = Math.min(maxOrderPerTap, calculatedOrderQty);
  const orderCapApplied = rawOrderQty < calculatedOrderQty;
  const weeksOfStock = avgWeeklyKegs > 0 ? round(currentStockKegs / avgWeeklyKegs, 2) : 99;
  const priority = round(
    (avgWeeklyKegs * 100)
    + Math.max(0, 4 - Math.min(weeksOfStock, 4)) * 30
    + Math.max(0, gapKegs) * 20,
    2,
  );
  const reasonParts = [];

  if (rawOrderQty) {
    reasonParts.push(`Current stock ${currentStockKegs} is below ${targetStockKegs}: ${avgWeeklyKegs}/week plus ${beerReserveKegs} keg.`);
  } else {
    reasonParts.push(`Current stock ${currentStockKegs} covers ${avgWeeklyKegs}/week plus ${beerReserveKegs} keg.`);
  }
  if (rawOrderQty && onDeckProduct?.name) {
    reasonParts.push(`Order ${onDeckProduct.name} from On Deck instead of ${tap.name}.`);
  }
  if (orderCapApplied) {
    reasonParts.push(`Calculated need is ${calculatedOrderQty} kegs; the configured per-tap order cap reduced this to ${maxOrderPerTap}.`);
  }

  return {
    key: tap.key,
    tapNumber: tap.tapNumber,
    wall: tap.wall,
    name: tap.name,
    templateBrand: tap.templateBrand,
    type: tap.type,
    plu: tap.plu,
    isKegTap: true,
    liveFraction,
    backupKegs,
    currentStockKegs,
    avgWeeklyKegs,
    targetStockKegs,
    suggestedPar: targetStockKegs,
    gapKegs,
    calculatedOrderQty,
    orderCap: maxOrderPerTap,
    orderCapApplied,
    rawOrderQty,
    orderQty: rawOrderQty,
    orderProductName: rawOrderQty && onDeckProduct?.name ? onDeckProduct.name : tap.name,
    actionType: "order",
    onDeckProduct,
    priority,
    weeksOfStock,
    weeklyKegs,
    reason: reasonParts.join(" "),
  };
}

export function getOnHandCoverage(currentTaps, onHandOverrides = {}) {
  const requiredTaps = (currentTaps || []).filter((tap) => isKegTap(tap));
  const missingTaps = requiredTaps.filter((tap) => {
    if (!Object.hasOwn(onHandOverrides || {}, tap.key)) return false;
    const rawValue = onHandOverrides[tap.key];
    if (rawValue == null || clean(rawValue) === "") return false;
    const numericValue = Number(String(rawValue).replace(/,/g, ""));
    return !Number.isFinite(numericValue) || numericValue < 0;
  });

  return {
    requiredCount: requiredTaps.length,
    coveredCount: requiredTaps.length - missingTaps.length,
    missingTaps: missingTaps.map((tap) => ({
      key: tap.key,
      tapNumber: toNumber(tap.tapNumber),
      name: clean(tap.name),
      wall: clean(tap.wall),
    })),
  };
}

export function applyTapReplacementMetadata(currentTaps, replacements = {}) {
  return applyTapReplacementSafety(currentTaps, replacements);
}

export function getUnsafeTapReplacementHistory(currentTaps, replacements = {}, approvedChangeovers = []) {
  try {
    applyTapReplacementSafety(currentTaps, replacements, approvedChangeovers);
    return [];
  } catch (error) {
    if (error?.code !== "TAP_REPLACEMENT_HISTORY_UNSAFE") throw error;
    return [{ tapNumber: error.details?.tapNumber, name: "", reason: error.details?.reason || error.message }];
  }
}

export async function runParAgentUpdate({ dryRun = false, patch = null, expectedRevision, role = "owner" } = {}) {
  const synced = patch ? await syncParAgentState(patch, { expectedRevision, role }) : await readParAgentState();
  const settings = getSettings(synced);
  const [snapshot, sharedWeeklyUsage, sharedDashboard, approvedChangeovers] = await Promise.all([
    fetchPmbSnapshot(),
    readSharedWeeklyUsageState(),
    readSharedDashboardState(),
    getApprovedWeeklyUsageChangeovers(),
  ]);
  if (!sharedWeeklyUsage.initialized) {
    throw new Error("Shared Weekly Usage must be initialized before the par agent can run.");
  }
  if (!sharedDashboard.initialized) {
    throw new Error("Shared dashboard setup must be initialized before the par agent can verify tap replacements.");
  }
  const tapReplacements = sharedDashboard.data?.products?.tapReplacementOverrides || {};
  const unsafeReplacementHistory = getUnsafeTapReplacementHistory(
    snapshot.currentTaps,
    tapReplacements,
    approvedChangeovers,
  );
  if (unsafeReplacementHistory.length) {
    const taps = unsafeReplacementHistory.map((item) => item.tapNumber).join(", ");
    throw new Error(`Tap replacement history cannot be separated safely for tap${unsafeReplacementHistory.length === 1 ? "" : "s"} ${taps}. Assign a unique PMB PLU or add an approved changeover boundary before running the par agent.`);
  }
  snapshot.currentTaps = applyTapReplacementSafety(
    snapshot.currentTaps,
    tapReplacements,
    approvedChangeovers,
  );
  const weeklyUsageByTap = new Map(
    (sharedWeeklyUsage.data?.activeItems || []).map((item) => [toNumber(item.tapNumber), item]),
  );
  const missingUsageTaps = snapshot.currentTaps
    .map((tap) => toNumber(tap.tapNumber))
    .filter((tapNumber) => tapNumber && !weeklyUsageByTap.has(tapNumber));
  if (missingUsageTaps.length) {
    throw new Error(`Shared Weekly Usage is missing tap${missingUsageTaps.length === 1 ? "" : "s"} ${missingUsageTaps.join(", ")}. Refresh Weekly Usage before running the par agent.`);
  }
  const staleUsageTaps = getMissingLatestCompletedUsageTaps(
    snapshot.currentTaps.map((tap) => weeklyUsageByTap.get(toNumber(tap.tapNumber))),
  );
  if (staleUsageTaps.length) {
    throw new Error(`Shared Weekly Usage is missing the latest completed Monday-Sunday week for tap${staleUsageTaps.length === 1 ? "" : "s"} ${staleUsageTaps.join(", ")}. Refresh Weekly Usage before running the par agent.`);
  }
  const state = patch ? await readParAgentState() : synced;
  const onHandEntryCount = Object.keys(state.onHandOverrides || {}).length;
  const onHandCoverage = getOnHandCoverage(snapshot.currentTaps, state.onHandOverrides || {});
  const inventoryStateMissing = onHandCoverage.missingTaps.length > 0;

  const rawRecommendations = snapshot.currentTaps.map((tap) => {
    const level = snapshot.levelsByTap.get(tap.slotKey) || null;
    if (!level) {
      throw new PmbKegSafetyError(
        `PMB did not return a verified level for tap ${tap.tapNumber}. Existing recommendations were kept.`,
        {
          code: "PMB_KEG_LEVEL_READ_FAILED",
          status: 503,
          details: {
            tapNumber: tap.tapNumber,
            deviceId: tap.deviceId,
            lineNum: tap.lineNum,
          },
        },
      );
    }
    const weeklyEntries = snapshot.weeklyVolumeByPlu.get(toNumber(tap.plu)) || [];
    return buildRawRecommendation(
      tap,
      level,
      weeklyEntries,
      state,
      settings,
      weeklyUsageByTap.get(toNumber(tap.tapNumber)),
    );
  });

  const items = (inventoryStateMissing
    ? rawRecommendations.map((item) => item.isKegTap ? ({
      ...item,
      orderQty: 0,
      inventoryStateMissing: true,
      reason: `${item.reason} Backup/on-hand counts have not synced to the server yet, so ordering is held for review.`,
    }) : item)
    : rawRecommendations
  ).sort((a, b) => a.tapNumber - b.tapNumber || a.name.localeCompare(b.name));
  const orderTotal = items.reduce((total, item) => total + toNumber(item.orderQty), 0);
  const activeOrderItems = items.filter((item) => toNumber(item.orderQty) > 0);
  const activeCocktailMakeItems = activeOrderItems.filter((item) => item.actionType === "make");
  const activeKegOrderItems = activeOrderItems.filter((item) => item.isKegTap && item.actionType === "order");
  const activeLiquorOrderItems = activeOrderItems.filter((item) => item.isLiquorTap);
  const nextParOverrides = { ...(state.parOverrides || {}) };
  items.forEach((item) => {
    if (item.isKegTap && item.suggestedPar !== "") {
      nextParOverrides[item.key] = String(item.suggestedPar);
    }
  });

  const recommendations = {
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(dryRun),
    sourceStateRevision: Number(state.revision),
    publishedStateRevision: dryRun ? Number(state.revision) : Number(state.revision) + 1,
    weeks: snapshot.weeks,
    settings,
    summary: {
      tapCount: items.length,
      kegTapCount: items.filter((item) => item.isKegTap).length,
      orderItemCount: activeOrderItems.length,
      orderTotal,
      kegOrderCount: activeKegOrderItems.length,
      kegOrderTotal: activeKegOrderItems.reduce((total, item) => total + toNumber(item.orderQty), 0),
      liquorOrderCount: activeLiquorOrderItems.length,
      liquorOrderTotal: activeLiquorOrderItems.reduce((total, item) => total + toNumber(item.orderQty), 0),
      deferredLiquorRefillCount: 0,
      deferredLiquorRefillTotal: 0,
      cocktailMakeCount: activeCocktailMakeItems.length,
      cocktailMakeTotal: activeCocktailMakeItems.reduce((total, item) => total + toNumber(item.orderQty), 0),
      onHandEntryCount,
      requiredOnHandEntryCount: onHandCoverage.requiredCount,
      coveredOnHandEntryCount: onHandCoverage.coveredCount,
      missingOnHandCount: onHandCoverage.missingTaps.length,
      missingOnHandTaps: onHandCoverage.missingTaps,
      inventoryStateMissing,
    },
    items,
  };

  const nextState = {
    ...state,
    settings,
    parOverrides: dryRun || inventoryStateMissing ? state.parOverrides || {} : nextParOverrides,
    recommendations,
  };

  return dryRun ? nextState : writeParAgentState(nextState, { expectedRevision: state.revision, role });
}
