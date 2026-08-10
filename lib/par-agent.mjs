import { readFile } from "node:fs/promises";
import path from "node:path";
import { getKnownBeerKegSizeOz } from "../public/beer-keg-pricing.mjs";
import { getCocktailRecipeYieldOz as resolveCocktailRecipeYieldOz } from "../public/cocktail-recipe-yields.mjs";
import { getTapConfigRows } from "./pmb-tap-config.mjs";
import {
  initializeSharedKegParAgentState,
  readSharedKegParAgentState,
  replaceSharedKegParAgentState,
} from "./keg-par-agent-shared-store.mjs";
import { readSharedWeeklyUsageState } from "./weekly-usage-shared-store.mjs";

const STANDARD_BEER_KEG_OZ = 15.5 * 128;
const STANDARD_COCKTAIL_KEG_OZ = 12 * 128;
const BEER_RESERVE_KEGS = 0.5;
const COCKTAIL_RESERVE_KEGS = 0.25;
const LIQUOR_RESERVE_OZ = 100;
const DEFAULT_SETTINGS = {
  maxOrderPerTap: 2,
  coolerCapacityKegs: 0,
};

export function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
        safe.push(char);
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

  return {
    baseUrl,
    username: (process.env.PMB_API_USERNAME || "admin").trim(),
    password: (process.env.PMB_API_PASSWORD || "admin").trim(),
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

function normalizeName(value, { stripWallNumber = false } = {}) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(stripWallNumber ? /\s+[123]\s*$/ : /$^/, "")
    .toLowerCase()
    .replace(/\b(vodka|tequila|whiskey|whisky|rum|bourbon|cognac|gin)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\btito s\b/g, "titos")
    .replace(/\bdaniel s\b/g, "daniels")
    .replace(/\s+/g, " ")
    .trim();
}

function getTrailingWallNumber(value) {
  const match = clean(value).match(/\s+([123])\s*$/);
  return match ? toNumber(match[1]) : 0;
}

function addAlias(map, alias, tap) {
  if (!alias) return;
  const existing = map.get(alias) || [];
  existing.push(tap);
  map.set(alias, existing);
}

function getAliasMatch(map, alias, wallNumber = 0) {
  const candidates = map.get(alias) || [];
  if (!candidates.length) return null;
  if (wallNumber) return candidates.find((tap) => toNumber(tap.wallNumber) === wallNumber) || null;
  return candidates.length === 1 ? candidates[0] : null;
}

function buildTapLookup(kegWallItems) {
  const byExactAlias = new Map();
  const byLooseAlias = new Map();
  const byTap = new Map();

  kegWallItems.forEach((tap) => {
    const nextTap = { ...tap, wallNumber: getTrailingWallNumber(tap.brand) };
    byTap.set(tap.tapNumber, nextTap);
    addAlias(byExactAlias, normalizeName(tap.brand), nextTap);
    addAlias(byLooseAlias, normalizeName(tap.brand, { stripWallNumber: true }), nextTap);
  });

  return { byExactAlias, byLooseAlias, byTap };
}

function getMatchedTap(name, plu, context) {
  const currentTap = context.currentTapByPlu.get(toNumber(plu));
  if (currentTap) return currentTap;
  const wallNumber = getTrailingWallNumber(name);
  const exactMatch = getAliasMatch(context.tapLookup.byExactAlias, normalizeName(name), wallNumber);
  if (exactMatch) return exactMatch;
  return getAliasMatch(context.tapLookup.byLooseAlias, normalizeName(name, { stripWallNumber: true }), wallNumber);
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
    coolerCapacityKegs: state.settings?.coolerCapacityKegs ?? DEFAULT_SETTINGS.coolerCapacityKegs,
  };

  const envMap = {
    PAR_AGENT_MAX_ORDER_PER_TAP: "maxOrderPerTap",
    PAR_AGENT_COOLER_CAPACITY_KEGS: "coolerCapacityKegs",
  };
  Object.entries(envMap).forEach(([envKey, settingKey]) => {
    if (process.env[envKey] == null || process.env[envKey] === "") return;
    settings[settingKey] = process.env[envKey];
  });

  Object.keys(settings).forEach((key) => {
    const value = toNumber(settings[key]);
    if (value || String(settings[key]).trim() === "0") settings[key] = value;
  });

  settings.maxOrderPerTap = Math.max(1, Math.min(4, Math.round(settings.maxOrderPerTap || DEFAULT_SETTINGS.maxOrderPerTap)));
  settings.coolerCapacityKegs = toNumber(settings.coolerCapacityKegs);
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
      settings: nextState.settings || {},
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

async function fetchPmbSnapshot() {
  const config = getConfig();
  const token = await getAuthtoken(config);
  const kegWallItems = await getKegWallItems();
  const tapLookup = buildTapLookup(kegWallItems);

  const products = await postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token);
  if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
    throw new Error(`PMB productlist failed (${products.status})`);
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

  const tapConfigRows = await getTapConfigRows(config).catch(() => []);
  const currentTaps = buildCurrentTaps(tapConfigRows, productByPlu, tapLookup);
  const currentTapByPlu = new Map(currentTaps.map((tap) => [toNumber(tap.plu), tap]));

  const uniqueSlots = [...new Map(
    currentTaps
      .filter((tap) => tap.deviceId && tap.lineNum)
      .map((tap) => [`${tap.deviceId}:${tap.lineNum}`, tap]),
  ).values()];

  const levelBySlot = new Map();
  for (const slot of uniqueSlots) {
    const response = await postJson(
      config.baseUrl,
      "/api/getkeglevels",
      { device_id: slot.deviceId, line_num: slot.lineNum },
      token,
    );
    const rawPercent = toNumber(response.json?.fill_level_perc);
    levelBySlot.set(`${slot.deviceId}:${slot.lineNum}`, {
      fillLevelPercent: rawPercent ? Math.round((rawPercent / 100) * 10) / 10 : null,
      rawPercent,
      rawKegSize: toNumber(response.json?.fill_level_keg_size),
      rawKegSizeDp: toNumber(response.json?.fill_level_keg_size_dp),
    });
  }

  const levelsByPlu = new Map();
  currentTaps.forEach((tap) => {
    const level = levelBySlot.get(`${tap.deviceId}:${tap.lineNum}`) || {};
    levelsByPlu.set(toNumber(tap.plu), {
      ...level,
      plu: tap.plu,
      name: tap.name,
      tapNumber: tap.tapNumber,
      deviceId: tap.deviceId,
      lineNum: tap.lineNum,
    });
  });

  return {
    currentTaps,
    currentTapByPlu,
    kegWallItems,
    tapLookup,
    weeklyVolumeByPlu: new Map(),
    levelsByPlu,
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
    }
    : null;
}

function getSharedWeeklyUsageValues(item, displayUnit) {
  if (!item || clean(item.displayUnit).toLowerCase() !== displayUnit) return null;
  const values = Array.isArray(item.history)
    ? item.history.map((entry) => Number(entry?.value)).filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  const storedAverage = Number(item.average);
  return {
    average: Number.isFinite(storedAverage)
      ? storedAverage
      : values.length
        ? values.reduce((total, value) => total + value, 0) / values.length
        : 0,
    values,
  };
}

export function buildRawRecommendation(tap, level, weeklyEntries, state, settings, sharedWeeklyUsageItem = null) {
  const isKeg = isKegTap(tap);
  const isLiquor = isLiquorOunceTap(toNumber(tap?.tapNumber));
  const backupKegs = toNumber(state.onHandOverrides?.[tap.key]);
  const onDeckProduct = getOnDeckProduct(state, tap.key);
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
  const currentStockKegs = round(liveFraction + backupKegs, 3);

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
    const rawOrderQty = currentStockOunces < targetStockOunces ? 1 : 0;
    const weeksOfStock = avgWeeklyOunces > 0 ? round(currentStockOunces / avgWeeklyOunces, 2) : 99;
    const reason = rawOrderQty
      ? `Current keg ${currentStockOunces} oz is below ${targetStockOunces} oz: ${avgWeeklyOunces} oz/week plus 100 oz.`
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
      rawOrderQty,
      orderQty: rawOrderQty,
      orderProductName: tap.name,
      actionType: "order",
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
    const rawMakeQty = currentStockKegs < targetStockKegs ? 1 : 0;
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

  const targetStockKegs = round(avgWeeklyKegs + BEER_RESERVE_KEGS, 2);
  const gapKegs = round(targetStockKegs - currentStockKegs, 3);
  const maxOrderPerTap = Math.max(1, Math.round(toNumber(settings?.maxOrderPerTap) || DEFAULT_SETTINGS.maxOrderPerTap));
  const rawOrderQty = currentStockKegs < targetStockKegs
    ? Math.min(maxOrderPerTap, Math.ceil(gapKegs))
    : 0;
  const weeksOfStock = avgWeeklyKegs > 0 ? round(currentStockKegs / avgWeeklyKegs, 2) : 99;
  const priority = round(
    (avgWeeklyKegs * 100)
    + Math.max(0, 4 - Math.min(weeksOfStock, 4)) * 30
    + Math.max(0, gapKegs) * 20,
    2,
  );
  const reasonParts = [];

  if (rawOrderQty) {
    reasonParts.push(`Current stock ${currentStockKegs} is below ${targetStockKegs}: ${avgWeeklyKegs}/week plus 0.5 keg.`);
  } else {
    reasonParts.push(`Current stock ${currentStockKegs} covers ${avgWeeklyKegs}/week plus 0.5 keg.`);
  }
  if (rawOrderQty && onDeckProduct?.name) {
    reasonParts.push(`Order ${onDeckProduct.name} from On Deck instead of ${tap.name}.`);
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

export function applyCoolerCapacity(recommendations, state, settings) {
  const capacity = toNumber(settings.coolerCapacityKegs);
  const kegRecommendations = recommendations.filter((item) => item.isKegTap && item.actionType !== "make");
  const currentBackupKegs = round(kegRecommendations.reduce((total, item) => total + toNumber(item.backupKegs), 0), 2);

  if (!capacity) {
    return {
      items: recommendations,
      summary: {
        capacityEnabled: false,
        coolerCapacityKegs: 0,
        currentBackupKegs,
        availableBackupSlots: null,
        suppressedByCapacity: 0,
      },
    };
  }

  let available = Math.max(0, Math.floor(capacity - currentBackupKegs));
  const wantedByKey = new Map(kegRecommendations.map((item) => [item.key, item.rawOrderQty]));
  const allocatedByKey = new Map();

  kegRecommendations
    .filter((item) => item.rawOrderQty > 0)
    .sort((a, b) => (
      a.weeksOfStock - b.weeksOfStock
      || b.avgWeeklyKegs - a.avgWeeklyKegs
      || b.gapKegs - a.gapKegs
      || a.tapNumber - b.tapNumber
    ))
    .forEach((item) => {
      if (available <= 0) {
        allocatedByKey.set(item.key, 0);
        return;
      }
      const allocated = Math.min(item.rawOrderQty, available);
      available -= allocated;
      allocatedByKey.set(item.key, allocated);
    });

  let suppressedByCapacity = 0;
  const items = recommendations.map((item) => {
    if (!item.isKegTap || item.actionType === "make" || item.rawOrderQty <= 0) return item;
    const allocated = allocatedByKey.get(item.key) || 0;
    const wanted = wantedByKey.get(item.key) || 0;
    if (allocated >= wanted) return item;
    suppressedByCapacity += wanted - allocated;
    return {
      ...item,
      orderQty: allocated,
      capacityLimited: true,
      reason: allocated
        ? `${item.reason} Cooler capacity trimmed this from ${wanted} to ${allocated}.`
        : `${item.reason} Cooler capacity is full, so this was held for review.`,
    };
  });

  return {
    items,
    summary: {
      capacityEnabled: true,
      coolerCapacityKegs: capacity,
      currentBackupKegs,
      availableBackupSlots: Math.max(0, Math.floor(capacity - currentBackupKegs)),
      remainingBackupSlots: available,
      suppressedByCapacity,
    },
  };
}

export async function runParAgentUpdate({ dryRun = false, patch = null, expectedRevision, role = "owner" } = {}) {
  const synced = patch ? await syncParAgentState(patch, { expectedRevision, role }) : await readParAgentState();
  const settings = getSettings(synced);
  const [snapshot, sharedWeeklyUsage] = await Promise.all([
    fetchPmbSnapshot(),
    readSharedWeeklyUsageState(),
  ]);
  if (!sharedWeeklyUsage.initialized) {
    throw new Error("Shared Weekly Usage must be initialized before the par agent can run.");
  }
  const weeklyUsageByTap = new Map(
    (sharedWeeklyUsage.data?.activeItems || []).map((item) => [toNumber(item.tapNumber), item]),
  );
  const missingUsageTaps = snapshot.currentTaps
    .map((tap) => toNumber(tap.tapNumber))
    .filter((tapNumber) => tapNumber && !weeklyUsageByTap.has(tapNumber));
  if (missingUsageTaps.length) {
    throw new Error(`Shared Weekly Usage is missing tap${missingUsageTaps.length === 1 ? "" : "s"} ${missingUsageTaps.join(", ")}. Refresh Weekly Usage before running the par agent.`);
  }
  const state = patch ? await readParAgentState() : synced;
  const onHandEntryCount = Object.keys(state.onHandOverrides || {}).length;
  const inventoryStateMissing = onHandEntryCount < 5;

  const rawRecommendations = snapshot.currentTaps.map((tap) => {
    const level = snapshot.levelsByPlu.get(toNumber(tap.plu)) || null;
    const weeklyEntries = snapshot.weeklyVolumeByPlu.get(toNumber(tap.plu)) || [];
    const matchedTap = getMatchedTap(tap.name, tap.plu, {
      tapLookup: snapshot.tapLookup,
      currentTapByPlu: snapshot.currentTapByPlu,
    }) || tap;
    return buildRawRecommendation(
      { ...matchedTap, ...tap, key: matchedTap.key || tap.key },
      level,
      weeklyEntries,
      state,
      settings,
      weeklyUsageByTap.get(toNumber(tap.tapNumber)),
    );
  });

  const capacityResult = inventoryStateMissing
    ? {
      items: rawRecommendations.map((item) => ({
        ...item,
        orderQty: 0,
        capacityLimited: false,
        inventoryStateMissing: true,
        reason: item.isKegTap
          ? `${item.reason} Backup/on-hand counts have not synced to the server yet, so ordering is held for review.`
          : item.reason,
      })),
      summary: {
        capacityEnabled: Boolean(toNumber(settings.coolerCapacityKegs)),
        coolerCapacityKegs: toNumber(settings.coolerCapacityKegs),
        currentBackupKegs: 0,
        availableBackupSlots: null,
        suppressedByCapacity: 0,
      },
    }
    : applyCoolerCapacity(rawRecommendations, state, settings);
  const items = capacityResult.items.sort((a, b) => a.tapNumber - b.tapNumber || a.name.localeCompare(b.name));
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
      cocktailMakeCount: activeCocktailMakeItems.length,
      cocktailMakeTotal: activeCocktailMakeItems.reduce((total, item) => total + toNumber(item.orderQty), 0),
      onHandEntryCount,
      inventoryStateMissing,
      ...capacityResult.summary,
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
