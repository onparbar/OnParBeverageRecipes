import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getTapConfigRows } from "../../../lib/pmb-tap-config.mjs";
import { isCompletedMondayWeekStart } from "../../../lib/weekly-usage-periods.mjs";

export const runtime = "nodejs";

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
        inString = false;
        safe.push(char);
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

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (wallNumber) {
    return candidates.find((tap) => toNumber(tap.wallNumber) === wallNumber) || null;
  }
  return candidates.length === 1 ? candidates[0] : null;
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

    const tap = { tapNumber, wall: currentWall, type, brand, wallNumber: getTrailingWallNumber(brand) };
    byTap.set(tapNumber, tap);
    addAlias(byExactAlias, normalizeName(brand), tap);
    addAlias(byLooseAlias, normalizeName(brand, { stripWallNumber: true }), tap);
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

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function buildWeekRange(start) {
  const weekStart = startOfDay(start);
  const endExclusive = new Date(weekStart);
  endExclusive.setDate(weekStart.getDate() + 7);
  const endInclusive = new Date(endExclusive);
  endInclusive.setDate(endExclusive.getDate() - 1);
  return { start: weekStart, endExclusive, endInclusive };
}

function getLastCompletedWeekRange() {
  const today = startOfDay(new Date());
  const day = today.getDay();
  const diffToThisMonday = day === 0 ? -6 : 1 - day;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + diffToThisMonday);
  const start = new Date(thisMonday);
  start.setDate(thisMonday.getDate() - 7);
  return buildWeekRange(start);
}

function invalidWeeklyUsageRange(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function getRequestedDateRanges(request) {
  const url = new URL(request.url);
  const weeksParam = clean(url.searchParams.get("weeks"));
  const startParam = clean(url.searchParams.get("start"));
  const endParam = clean(url.searchParams.get("end"));

  if (weeksParam) {
    const ranges = weeksParam
      .split(",")
      .map((value) => clean(value))
      .filter(Boolean)
      .map((value) => buildWeekRange(new Date(`${value}T00:00:00`)))
      .filter((range) => Number.isFinite(range.start.getTime()));

    const completedRanges = ranges
      .filter((range) => isCompletedMondayWeekStart(range.start))
      .sort((a, b) => a.start.getTime() - b.start.getTime())
      .filter((range, index, all) => index === 0 || formatDate(range.start) !== formatDate(all[index - 1].start))
      .slice(-12);

    if (completedRanges.length && completedRanges.length === ranges.length) {
      return completedRanges;
    }
    if (ranges.length) {
      throw invalidWeeklyUsageRange("PMB weekly usage only accepts completed Monday-Sunday weeks.");
    }
  }

  if (startParam && endParam) {
    const start = startOfDay(new Date(`${startParam}T00:00:00`));
    const endInclusive = startOfDay(new Date(`${endParam}T00:00:00`));
    const endExclusive = new Date(endInclusive);
    endExclusive.setDate(endExclusive.getDate() + 1);
    const isMondaySundayWeek = start.getDay() === 1
      && endInclusive.getDay() === 0
      && Math.round((endExclusive.getTime() - start.getTime()) / 86400000) === 7
      && isCompletedMondayWeekStart(start);
    if (!isMondaySundayWeek) {
      throw invalidWeeklyUsageRange("PMB weekly usage only accepts a completed Monday-Sunday range.");
    }
    return [{ start, endExclusive, endInclusive }];
  }

  return [getLastCompletedWeekRange()];
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

function getTransactionRangePayload(range) {
  return {
    start_time: `${formatDate(range.start)}T00:00:00${formatOffset(range.start)}`,
    end_time: `${formatDate(range.endExclusive)}T00:00:00${formatOffset(range.endExclusive)}`,
  };
}

function buildWeeklyReport(range, transactions, productByPlu, context) {
  const byPlu = new Map();
  transactions.forEach((transaction) => {
    const plu = toNumber(transaction?.plu);
    const volumeOz = toNumber(transaction?.volume_amount);
    if (!plu || !volumeOz) return;

    const existing = byPlu.get(plu) || {
      plu,
      name: productByPlu.get(plu)?.name || `PLU ${plu}`,
      volumeOz: 0,
      transactionCount: 0,
    };
    existing.volumeOz += volumeOz;
    existing.transactionCount += 1;
    byPlu.set(plu, existing);
  });

  context.currentTapByPlu.forEach((tap, plu) => {
    if (byPlu.has(plu)) return;
    byPlu.set(plu, {
      plu,
      name: tap.name || productByPlu.get(plu)?.name || `PLU ${plu}`,
      volumeOz: 0,
      transactionCount: 0,
    });
  });

  const items = [...byPlu.values()]
    .map((item) => {
      const tap = getMatchedTap(item.name, item.plu, context);
      const currentTap = context.currentTapByPlu.get(toNumber(item.plu));
      return {
        ...item,
        volumeOz: Math.round(item.volumeOz * 100) / 100,
        tapNumber: tap?.tapNumber || null,
        wall: tap?.wall || "",
        type: tap?.type || "",
        brand: tap?.brand || tap?.name || "",
        templateBrand: tap?.templateBrand || "",
        isCurrentTap: Boolean(currentTap),
      };
    })
    .sort((a, b) => (a.tapNumber || 9999) - (b.tapNumber || 9999) || a.name.localeCompare(b.name));

  return {
    label: `${formatShortDate(range.start)} - ${formatShortDate(range.endInclusive)}`,
    startDate: formatDate(range.start),
    endDate: formatDate(range.endInclusive),
    transactionCount: transactions.length,
    matchedTapCount: items.filter((item) => item.tapNumber).length,
    items,
  };
}

export async function GET(request) {
  try {
    const ranges = getRequestedDateRanges(request);
    const config = getConfig();
    const token = await getAuthtoken(config);

    const [products, tapLookup] = await Promise.all([
      postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token),
      getTapLookup(),
    ]);

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

    const currentTaps = buildCurrentTaps(
      await getTapConfigRows(config).catch(() => []),
      productByPlu,
      tapLookup,
    );
    const currentTapByPlu = new Map(currentTaps.map((tap) => [toNumber(tap.plu), tap]));

    const transactionResults = await Promise.all(ranges.map((range) => (
      postJson(config.baseUrl, "/api/transactions", { id: config.clientId, ...getTransactionRangePayload(range) }, token)
    )));

    transactionResults.forEach((transactions, index) => {
      if (transactions.status !== 200 || !Array.isArray(transactions.json?.taptransactions)) {
        throw new Error(`PMB transactions failed for ${formatShortDate(ranges[index].start)} (${transactions.status})`);
      }
    });

    const context = { tapLookup, currentTapByPlu };
    const reports = ranges.map((range, index) => buildWeeklyReport(
      range,
      transactionResults[index].json.taptransactions,
      productByPlu,
      context,
    ));
    const primaryReport = reports[reports.length - 1] || buildWeeklyReport(getLastCompletedWeekRange(), [], productByPlu, context);

    return NextResponse.json({
      ...primaryReport,
      updatedAt: new Date().toISOString(),
      reportCount: reports.length,
      totalTransactionCount: reports.reduce((total, report) => total + report.transactionCount, 0),
      currentTaps,
      reports,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Could not pull PMB weekly usage." },
      { status: error.status || 500 },
    );
  }
}
