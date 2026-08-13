import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";
import {
  buildCurrentTapAssignments,
  getTapPricingRepresentativeAssignment,
} from "../../../lib/tap-pricing-assignments.mjs";
import { filterCurrentTapPricingItems } from "../../../public/keg-pricing-scope.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PMB_API_TIMEOUT_MS = 15000;
const PMB_TAP_CONFIG_TIMEOUT_MS = 15000;

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const safe = [];
    let inString = false;
    let escaping = false;
    for (const char of String(text || "")) {
      if (!inString) {
        if (char === '"') inString = true;
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
      if (char === '"') {
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

async function postJson(baseUrl, path, body, token = "") {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(PMB_API_TIMEOUT_MS),
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
  if (!baseUrl) {
    throw new Error("Missing PMB_API_BASE_URL in .env.local");
  }
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

function normalizeProductName(name) {
  return String(name || "")
    .replace(/’/g, "'")
    .replace(/\s+/g, " ")
    .trim();
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
      continue;
    }

    if (char === '"') {
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
      if (row.some((value) => String(value || "").trim())) rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value || "").trim())) rows.push(row);
  return rows;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTapKey(value, { stripWallNumber = true } = {}) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/’/g, "'")
    .replace(/&/g, " and ")
    .replace(stripWallNumber ? /\s*[123]\s*$/g : /$^/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\btito s\b/g, "titos")
    .replace(/\bdaniel s\b/g, "daniels")
    .replace(/\bvodka|whiskey|tequila|rum|gin|bourbon|cognac\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTrailingWallNumber(value) {
  const match = clean(value).match(/\s+([123])\s*$/);
  return match ? toNumber(match[1]) : 0;
}

function getTapAliases(value, { stripWallNumber = true } = {}) {
  const text = clean(value);
  const withoutParenthetical = text.replace(/\([^)]*\)/g, " ");
  return [...new Set([
    normalizeTapKey(text, { stripWallNumber: false }),
    normalizeTapKey(withoutParenthetical, { stripWallNumber: false }),
    ...(stripWallNumber ? [
      normalizeTapKey(text),
      normalizeTapKey(withoutParenthetical),
    ] : []),
  ].filter(Boolean))];
}

async function getTapLookup() {
  const csvPath = path.join(process.cwd(), "public", "data", "keg-levels-template.csv");
  const rows = parseCsv(await readFile(csvPath, "utf8"));
  const byExactAlias = new Map();
  const byLooseAlias = new Map();
  const byTap = new Map();
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

    const tap = { tapNumber, wall: currentWall, type, brand };
    byTap.set(tapNumber, tap);
    getTapAliases(brand, { stripWallNumber: false }).forEach((alias) => {
      if (!byExactAlias.has(alias)) byExactAlias.set(alias, []);
      byExactAlias.get(alias).push(tap);
    });
    getTapAliases(brand).forEach((alias) => {
      if (!byLooseAlias.has(alias)) byLooseAlias.set(alias, []);
      byLooseAlias.get(alias).push(tap);
    });
  });

  return { byExactAlias, byLooseAlias, byTap };
}

function getMatchedTap(productName, tapLookup) {
  const wallNumber = getTrailingWallNumber(productName);
  for (const alias of getTapAliases(productName, { stripWallNumber: false })) {
    const matches = tapLookup.byExactAlias.get(alias) || [];
    const match = wallNumber
      ? matches.find((tap) => getTrailingWallNumber(tap.brand) === wallNumber)
      : matches[0];
    if (match) return match;
  }

  if (wallNumber) return null;

  for (const alias of getTapAliases(productName)) {
    const matches = tapLookup.byLooseAlias.get(alias) || [];
    if (matches.length === 1) return matches[0];
  }
  return null;
}

function isLiquorTap(tapNumber) {
  return (tapNumber >= 1 && tapNumber <= 20) || (tapNumber >= 83 && tapNumber <= 92);
}

function getChargePerOz(product) {
  const cents = Number(product.price_per_unit);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return cents / 100;
}

function getItemPrice(item) {
  const price = Number(item?.price);
  const decimalPlaces = Number(item?.price_dp);
  if (!Number.isFinite(price) || price <= 0) return 0;
  return price / (10 ** (Number.isFinite(decimalPlaces) ? decimalPlaces : 2));
}

const PMB_PORTION_ITEM_ID_FIELD = clean(process.env.PMB_PORTION_ITEM_ID_FIELD);
const PMB_PORTION_QUANTITY_FIELD = clean(process.env.PMB_PORTION_QUANTITY_FIELD);
const PMB_PORTION_QUANTITY_DP_FIELD = clean(process.env.PMB_PORTION_QUANTITY_DP_FIELD);

function getPositiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function getVerifiedItemIdentity(item) {
  if (!PMB_PORTION_ITEM_ID_FIELD || !PMB_PORTION_QUANTITY_FIELD) return null;
  const itemId = clean(item?.[PMB_PORTION_ITEM_ID_FIELD]);
  const rawQuantity = Number(item?.[PMB_PORTION_QUANTITY_FIELD]);
  const quantityDpRaw = PMB_PORTION_QUANTITY_DP_FIELD
    ? Number(item?.[PMB_PORTION_QUANTITY_DP_FIELD])
    : 0;
  const quantityDp = Number.isSafeInteger(quantityDpRaw) && quantityDpRaw >= 0 && quantityDpRaw <= 6
    ? quantityDpRaw
    : -1;
  const quantityOz = quantityDp >= 0 ? rawQuantity / (10 ** quantityDp) : 0;
  const priceRaw = getPositiveInteger(item?.price);
  const priceDp = Number(item?.price_dp);
  if (
    !itemId
    || !Number.isFinite(quantityOz)
    || quantityOz <= 0
    || !priceRaw
    || !Number.isSafeInteger(priceDp)
    || priceDp < 0
    || priceDp > 6
  ) return null;
  return { itemId, quantityOz, priceRaw, priceDp };
}

function buildItemPriceMap(itemlist = []) {
  const byPlu = new Map();
  itemlist.forEach((item) => {
    const plu = Number(item?.product_plu || 0);
    const portionName = clean(item?.portion_name);
    const price = getItemPrice(item);
    if (!plu || !portionName || !price) return;
    if (!byPlu.has(plu)) byPlu.set(plu, []);
    byPlu.get(plu).push({
      name: portionName,
      price,
      ...getVerifiedItemIdentity(item),
    });
  });

  byPlu.forEach((items) => {
    items.sort((a, b) => {
      const order = { single: 1, double: 2 };
      return (order[a.name.toLowerCase()] || 99) - (order[b.name.toLowerCase()] || 99) || a.name.localeCompare(b.name);
    });
  });

  return byPlu;
}

export async function GET() {
  try {
    const config = getConfig();
    const token = await getAuthtoken(config);
    const [products, itemPrices, tapLookup, tapConfigRows] = await Promise.all([
      postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token),
      postJson(config.baseUrl, "/api/itemlist", { id: String(config.clientId) }, token),
      getTapLookup(),
      getTapConfigRows(config, { timeoutMs: PMB_TAP_CONFIG_TIMEOUT_MS }),
    ]);

    if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
      throw new Error(`PMB productlist failed (${products.status})`);
    }
    if (!tapConfigRows.length) {
      throw new Error("PMB tap configuration returned no current physical taps.");
    }

    const itemPricesByPlu = buildItemPriceMap(itemPrices.json?.itemlist || []);
    const currentTapAssignmentsByPlu = buildCurrentTapAssignments(tapConfigRows, tapLookup);
    const occupiedTapNumbers = new Set(
      [...currentTapAssignmentsByPlu.values()]
        .flat()
        .map((tap) => toNumber(tap.tapNumber))
        .filter(Boolean),
    );

    const items = filterCurrentTapPricingItems(products.json.productlist
      .map((product) => {
        const chargePerOz = getChargePerOz(product);
        const name = normalizeProductName(product.name);
        if (!name || !chargePerOz || /coming soon/i.test(name)) return null;
        const plu = Number(product.plu || 0) || null;
        const assignments = currentTapAssignmentsByPlu.get(plu) || [];
        const currentTap = getTapPricingRepresentativeAssignment(assignments);
        const fallbackTap = currentTap ? null : getMatchedTap(name, tapLookup);
        const matchedTap = currentTap || (fallbackTap && !occupiedTapNumbers.has(toNumber(fallbackTap.tapNumber)) ? fallbackTap : null);
        const portions = matchedTap?.tapNumber && isLiquorTap(matchedTap.tapNumber)
          ? itemPricesByPlu.get(plu) || []
          : [];

        return {
          tapPosition: matchedTap?.tapNumber ?? null,
          wall: matchedTap?.wall || "",
          type: matchedTap?.type || "",
          matchedBrand: matchedTap?.matchedBrand || matchedTap?.brand || "",
          templateBrand: matchedTap?.templateBrand || matchedTap?.brand || "",
          deviceId: currentTap?.deviceId ?? null,
          lineNum: currentTap?.lineNum ?? null,
          assignments,
          plu,
          name,
          chargePerOz,
          portions,
          pricePerUnitCents: Number(product.price_per_unit || 0),
          happyHour1PerOz: Number(product.price_per_unit_happyhour1 || 0) / 100 || null,
          happyHour2PerOz: Number(product.price_per_unit_happyhour2 || 0) / 100 || null,
          volumeUnit: String(product.volume_unit || ""),
          isActive: Number(product.is_active || 0) === 1,
          isInUse: Number(product.is_in_use || 0) === 1,
          isCurrentTap: Boolean(currentTap),
          tapMatchSource: currentTap ? "pmb-tap-config" : matchedTap ? "template-fallback" : "",
        };
      })
      .filter(Boolean));

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      items,
      portionPricing: {
        writeAvailable: false,
        schemaConfigured: Boolean(PMB_PORTION_ITEM_ID_FIELD && PMB_PORTION_QUANTITY_FIELD),
        code: PMB_PORTION_ITEM_ID_FIELD && PMB_PORTION_QUANTITY_FIELD
          ? "PMB_PORTION_FORM_UNVERIFIED"
          : "PMB_PORTION_SCHEMA_UNVERIFIED",
        message: PMB_PORTION_ITEM_ID_FIELD && PMB_PORTION_QUANTITY_FIELD
          ? "The PMB item edit form still needs one on-site read-only verification before live shot-price saves can be enabled."
          : "The PMB portion item IDs and quantities need one on-site read-only verification before live shot-price saves can be enabled.",
      },
    });
  } catch (error) {
    const message = error.message || "Could not load tap pricing.";
    const upstreamFailure = /PMB|tap configuration|timed out|fetch|socket|network/i.test(message);
    return NextResponse.json(
      { error: message },
      { status: upstreamFailure ? 503 : 500 },
    );
  }
}
