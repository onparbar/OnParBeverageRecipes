import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

import { getProductLineScore, selectBottleCandidate } from "../../../lib/vendor-product-matching.mjs";

const PROVI_BASE_URL = "https://app.provi.com";
const PROVI_CAPTURE_PATH = path.join(os.homedir(), ".FoodOrderAgent", "provi", "captures", "latest-provi-capture.json");
const PROVI_SESSION_PATH = path.join(os.homedir(), ".FoodOrderAgent", "provi", "provi_session_state.json");
const STANDARD_BEER_KEG_OZ = 15.5 * 128;
const KEG_SIZE_OVERRIDES = {
  "stella-artois": 50 * 33.814,
};

export async function POST(request) {
  try {
    const body = await request.json();
    const scope = body?.scope || "all";
    const items = Array.isArray(body?.items) ? body.items : [];
    const vendorNames = [...new Set(items.map((item) => item?.syncVendor || item?.vendorProduct?.syncVendor || item?.vendorProduct?.vendor).filter(Boolean))]
      .filter((vendor) => scope === "all" || vendor === scope);

    const vendorStatuses = [];
    const updates = [];
    const proviSessionPromise = loadProviSessionContext();
    const proviSearchCache = new Map();

    for (const vendorName of vendorNames) {
      const vendorItems = items.filter((item) => (item?.syncVendor || item?.vendorProduct?.syncVendor || item?.vendorProduct?.vendor) === vendorName);

      if (vendorName === "OHLQ") {
        const ohlqResult = await syncOhlqPrices(vendorItems, { proviSessionPromise, proviSearchCache });
        vendorStatuses.push(ohlqResult.status);
        updates.push(...ohlqResult.updates);
        continue;
      }

      if (vendorName === "Provi") {
        const proviResult = await syncProviPrices(vendorItems, { proviSessionPromise, proviSearchCache });
        vendorStatuses.push(proviResult.status);
        updates.push(...proviResult.updates);
        continue;
      }

      vendorStatuses.push({
        vendor: vendorName,
        status: "pending",
        message: "No sync adapter is configured for this vendor yet.",
      });
    }

    return NextResponse.json({
      updates,
      vendorStatuses,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Unable to run vendor sync.",
      },
      {
        status: 500,
      },
    );
  }
}

async function syncProviPrices(items, context) {
  return syncVendorWithProvi(items, {
    ...context,
    vendorName: "Provi",
    distributorHints: ["Southern Glazer's Wine & Spirits", "Southern Glazers", "SGWS"],
  });
}

async function syncOhlqPrices(items, context) {
  return syncVendorWithProvi(items, {
    ...context,
    vendorName: "OHLQ",
    distributorHints: ["Ohio Liquor - OHLQ", "OHLQ"],
  });
}

async function syncVendorWithProvi(items, context) {
  let sessionContext;
  try {
    sessionContext = await context.proviSessionPromise;
  } catch (error) {
    return {
      updates: [],
      status: {
        vendor: context.vendorName,
        status: "pending",
        message: error.message || "Provi session data is missing. Run the one-time Provi login flow again before syncing.",
      },
    };
  }

  const updates = [];

  for (const item of items) {
    const product = item?.vendorProduct;
    if (!product?.productName) continue;

    try {
      const matchedProduct = await fetchMatchedProviProduct(item, sessionContext, context.proviSearchCache, context.distributorHints);
      if (!matchedProduct) continue;

      const bottlePrice = getMatchedInventoryPrice(matchedProduct, item);
      const bottleOz = getMatchedBottleOz(matchedProduct) || product.bottleOz;
      if (!Number.isFinite(bottlePrice) || bottlePrice <= 0 || !Number.isFinite(bottleOz) || bottleOz <= 0) continue;

      updates.push({
        id: item.id,
        priceType: item.priceType || "ingredient",
        bottlePrice,
        bottleOz,
        matchedSku: String(matchedProduct.variant.inventory?.sku || ""),
        matchedProductName: String(matchedProduct.line?.name || matchedProduct.variant.product?.name || ""),
        matchedSize: String(matchedProduct.variant.product?.container_size || ""),
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      return {
        updates,
        status: {
          vendor: context.vendorName,
          status: "blocked",
          message: error.message || `${context.vendorName} sync could not read pricing from the saved Provi session.`,
        },
      };
    }
  }

  return {
    updates,
    status: {
      vendor: context.vendorName,
      status: updates.length ? "ok" : "pending",
      message: updates.length
        ? `Pulled ${updates.length} mapped price${updates.length === 1 ? "" : "s"} through Provi.`
        : "The Provi session is connected, but no matching priced products were found for the mapped items.",
    },
  };
}

async function fetchMatchedProviProduct(item, sessionContext, searchCache, distributorHints = []) {
  const product = item?.vendorProduct || {};
  const queries = getSearchQueries(product, item);
  const activeDistributorHints = Array.isArray(product.distributorHints) && product.distributorHints.length
    ? product.distributorHints
    : distributorHints;

  for (const query of queries) {
    const cacheKey = `${sessionContext.retailerContext}::${query}`;
    let results = searchCache.get(cacheKey);

    if (!results) {
      results = await fetchProviProductLines(query, sessionContext);
      searchCache.set(cacheKey, results);
    }

    const match = findMatchingProviProductLine(results, item, activeDistributorHints);
    if (match) return match;
  }

  return null;
}

async function fetchProviProductLines(productName, sessionContext) {
  const url = new URL(`${PROVI_BASE_URL}/api/retailer/product_lines`);
  url.searchParams.set("search", productName);
  url.searchParams.set("page_name", "search");
  url.searchParams.set("page_value", productName);
  url.searchParams.set("limit", "20");
  url.searchParams.set("include_external_ads", "true");
  url.searchParams.set("dedupe_organic_from_ads", "false");

  const response = await fetch(url, {
    headers: buildProviRequestHeaders(sessionContext),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Provi returned ${response.status} while loading product pricing.`);
  }

  const payload = await response.json();
  return Array.isArray(payload) ? payload : [];
}

function findMatchingProviProductLine(results, item, distributorHints = []) {
  if (!Array.isArray(results) || !results.length) return null;

  const expectedName = normalizeName(stripSizeLabel(item?.vendorProduct?.productName || item?.name || ""));
  const expectedIngredientName = normalizeName(item?.name || "");
  const targetBottleOz = toNumber(item?.vendorProduct?.bottleOz);
  const normalizedHints = distributorHints.map((value) => normalizeName(value));

  const candidateLines = results
    .filter((line) => {
      if (!normalizedHints.length) return true;
      const distributorName = normalizeName(line?.distributor_info?.distributor_name || line?.distributor?.name || "");
      return normalizedHints.some((hint) => distributorName.includes(hint));
    })
    .map((line) => ({
      line,
      score: getProductLineScore(line?.name, expectedName, expectedIngredientName),
    }))
    .filter((entry) => entry.score >= 50)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.line);

  for (const line of candidateLines) {
    const matchedVariant = selectMatchingProduct(line?.products || [], item, targetBottleOz);
    if (matchedVariant) {
      return {
        line,
        variant: matchedVariant,
      };
    }
  }

  return null;
}

function selectMatchingProduct(products, item, targetBottleOz) {
  const expectedSizeText = extractSizeLabel(item?.vendorProduct?.productName || "");
  const preferredSku = normalizeSku(item?.vendorProduct?.preferredSku);
  const candidates = (products || [])
    .map((product) => ({
      product,
      inventory: getPreferredInventory(product, item),
      bottleOz: getProductBottleOz(product),
      sizeLabel: normalizeName(product?.container_size || ""),
      packageText: normalizeName(`${product?.container_size || ""} ${product?.name || ""}`),
    }))
    .filter((entry) => entry.inventory && getInventoryPrice(entry.inventory, item) > 0);

  if (!candidates.length) return null;

  if (isKegSyncItem(item)) {
    const expectedKegOz = getExpectedKegOz(item, targetBottleOz);
    return candidates.find((entry) => isKegPackage(entry) && isRoughlyEqual(entry.bottleOz, expectedKegOz)) ||
      candidates.find((entry) => entry.bottleOz >= 500 && isRoughlyEqual(entry.bottleOz, expectedKegOz)) ||
      null;
  }

  return selectBottleCandidate(candidates, {
    targetBottleOz,
    preferredSku,
    expectedSizeLabel: expectedSizeText,
  });
}

function isKegSyncItem(item) {
  return item?.priceType === "keg" || toNumber(item?.vendorProduct?.bottleOz) >= 500;
}

function isKegPackage(entry) {
  return /\b(keg|bbl|barrel)\b/i.test(entry.packageText || "");
}

function getExpectedKegOz(item, fallbackOz = 0) {
  const key = normalizeName(item?.vendorProduct?.productName || item?.name || "").replace(/\s+/g, "-");
  return KEG_SIZE_OVERRIDES[key] || fallbackOz || STANDARD_BEER_KEG_OZ;
}

function getPreferredInventory(product, item) {
  const inventory = Array.isArray(product?.inventory) ? product.inventory : [];
  const preferredSku = normalizeSku(item?.vendorProduct?.preferredSku);
  if (preferredSku) {
    const preferredInventory = inventory.find(
      (entry) => normalizeSku(entry?.sku) === preferredSku && getInventoryPrice(entry, item) > 0,
    );
    if (preferredInventory) return preferredInventory;
  }
  return inventory.find((entry) => getInventoryPrice(entry, item) > 0) || inventory[0] || null;
}

function getMatchedInventoryPrice(match, item) {
  const inventory = match?.variant?.inventory || {};
  const product = match?.variant?.product || {};
  return getInventoryPrice(inventory, item) || toNumber(product?.unit_price || product?.price);
}

function getInventoryPrice(inventory, item) {
  if (!inventory) return 0;
  const unitPrice = toNumber(inventory.unit_price || inventory.price);
  if (unitPrice > 0) return unitPrice;
  if (isKegSyncItem(item)) {
    return toNumber(inventory.case_price || inventory.keg_price || inventory.pack_price);
  }
  return 0;
}

function getMatchedBottleOz(match) {
  return match?.variant?.bottleOz || getProductBottleOz(match?.variant?.product);
}

function getProductBottleOz(product) {
  const directSize = parseBottleOzFromText(product?.container_size);
  if (directSize) return directSize;
  return parseBottleOzFromText(product?.name || "");
}

function extractSizeLabel(text) {
  const value = String(text || "");
  const match = value.match(/(\d+(?:\.\d+)?)\s*(l|ml|oz)\b/i);
  return match ? `${match[1]} ${match[2]}` : "";
}

function stripSizeLabel(text) {
  return String(text || "")
    .replace(/\s+\d+(?:\.\d+)?\s*(l|ml|oz)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function getSearchQuery(text) {
  const stripped = stripSizeLabel(text);
  return stripped || String(text || "").trim();
}

function getSearchQueries(product, item) {
  const values = [
    product?.productName,
    ...(Array.isArray(product?.searchAliases) ? product.searchAliases : []),
    item?.name,
    stripSizeLabel(product?.productName).replace(/\b\d+\b/g, " ").replace(/\s{2,}/g, " ").trim(),
    stripSizeLabel(item?.name),
  ];

  return [...new Set(values.map((value) => getSearchQuery(value)).filter(Boolean))];
}

function parseBottleOzFromText(value) {
  const text = String(value || "");
  const bblMatch = text.match(/(\d+)?(?:\s*\/\s*(\d+))?\s*bbl\b/i);
  if (bblMatch) {
    const numerator = bblMatch[1] ? Number.parseFloat(bblMatch[1]) : 1;
    const denominator = bblMatch[2] ? Number.parseFloat(bblMatch[2]) : 1;
    if (numerator > 0 && denominator > 0) return (numerator / denominator) * 3968;
  }

  const gallonMatch = text.match(/(\d+(?:\.\d+)?)\s*(gal|gallon|gallons)\b/i);
  if (gallonMatch) return Number.parseFloat(gallonMatch[1]) * 128;

  const literMatch = text.match(/(\d+(?:\.\d+)?)\s*l\b/i);
  if (literMatch) return Number.parseFloat(literMatch[1]) * 33.814;

  const mlMatch = text.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return Number.parseFloat(mlMatch[1]) * 0.033814;

  const ozMatch = text.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) return Number.parseFloat(ozMatch[1]);

  return 0;
}

function buildProviRequestHeaders(sessionContext) {
  return {
    Accept: "application/json",
    Cookie: sessionContext.cookieHeader,
    Origin: PROVI_BASE_URL,
    Referer: `${PROVI_BASE_URL}/`,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    "x-tiz-retailer-context": sessionContext.retailerContext,
  };
}

async function loadProviSessionContext() {
  const envContext = loadProviContextFromEnv();
  if (envContext) {
    return envContext;
  }

  let sessionState;
  let capture;

  try {
    [sessionState, capture] = await Promise.all([
      readJson(PROVI_SESSION_PATH),
      readJson(PROVI_CAPTURE_PATH),
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        "Provi setup is missing on this computer. Run `npm run provi:session`, then `npm run provi:capture`, before syncing prices.",
      );
    }
    throw error;
  }

  const cookies = Array.isArray(sessionState?.storageState?.cookies) ? sessionState.storageState.cookies : [];
  const cookieHeader = cookies
    .filter((cookie) => /provi\.com$/i.test(String(cookie.domain || "").replace(/^\./, "")))
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");

  if (!cookieHeader) {
    throw new Error("No Provi cookies were found in the saved session. Run `npm run provi:session` again.");
  }

  const retailerContext = capture?.events?.find((event) => event?.type === "request" && event?.headers?.["x-tiz-retailer-context"])
    ?.headers?.["x-tiz-retailer-context"];

  if (!retailerContext) {
    throw new Error("The saved Provi capture does not include the retailer context header yet. Run `npm run provi:capture` again.");
  }

  return {
    cookieHeader,
    retailerContext: String(retailerContext),
  };
}

function loadProviContextFromEnv() {
  const cookieHeader = String(process.env.PROVI_COOKIE_HEADER || "").trim();
  const retailerContext = String(process.env.PROVI_RETAILER_CONTEXT || "").trim();

  if (!cookieHeader || !retailerContext) {
    return null;
  }

  return {
    cookieHeader,
    retailerContext,
  };
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function toNumber(value) {
  const cleaned = String(value ?? "").replace(/[$,%\s]/g, "").replace(/,/g, "");
  const number = Number.parseFloat(cleaned);
  return Number.isFinite(number) ? number : 0;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeSku(value) {
  return String(value || "").trim().toUpperCase();
}

function isRoughlyEqual(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return false;
  return Math.abs(left - right) < 0.2;
}
