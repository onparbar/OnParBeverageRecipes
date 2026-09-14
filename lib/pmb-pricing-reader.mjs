import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";
import { parsePmbJson } from "./pmb-json.mjs";
import { parseTapConfigRows } from "./pmb-tap-config.mjs";
import { parsePmbProductEditForm } from "./pmb-price-update.mjs";
import { readPmbPricingManagementPage, verifyPmbPortionManagementReadOnly } from "./pmb-item-management.mjs";

const requests = new Map();
const capabilityRequests = new Map();
const nameKey = (value) => String(value ?? "").normalize("NFKD").toLowerCase().replace(/[^a-z0-9]/g, "");
const isPlu = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;

function failure(message, { code = "PMB_PRICING_READ_FAILED", status = 503 } = {}) {
  return Object.assign(new Error(message), { code, status });
}

function connectionKey(config) {
  return crypto.createHash("sha256").update(JSON.stringify([
    config.baseUrl, config.username, config.password, config.clientId,
  ])).digest("hex");
}

function limitedConfig(config, milliseconds) {
  return { ...config, readSignal: config.readSignal
    ? AbortSignal.any([config.readSignal, AbortSignal.timeout(milliseconds)])
    : AbortSignal.timeout(milliseconds) };
}

// These are PMB read operations despite their POST-based API. Never retry saves.
async function readJson(config, endpoint, body, token = "") {
  if (!["/api/authtoken", "/api/productlist", "/api/itemlist"].includes(endpoint)) {
    throw failure("Unsupported PMB pricing read operation.");
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const url = new URL(`${config.baseUrl}${endpoint}`);
      const transport = url.protocol === "https:" ? https : http;
      const payload = Buffer.from(JSON.stringify(body));
      const signal = limitedConfig(config, 8_000).readSignal;
      const result = await new Promise((resolve, reject) => {
        const request = transport.request(url, {
          method: "POST", agent: false, signal,
          headers: {
            "Content-Type": "application/json", Accept: "application/json",
            "Content-Length": payload.length, Connection: "close",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }, (response) => {
          const chunks = [];
          response.on("error", reject);
          response.on("aborted", () => reject(Object.assign(new Error("PMB response interrupted."), { code: "ECONNRESET" })));
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode || 0, json: parsePmbJson(Buffer.concat(chunks).toString("utf8")) }));
        });
        request.on("error", reject);
        request.end(payload);
      });
      if (result.status !== 200) throw failure(`PMB ${endpoint} returned ${result.status}.`, { status: result.status });
      if (!result.json) throw failure(`PMB ${endpoint} returned unreadable pricing data.`, { code: "PMB_PRICING_JSON_INVALID", status: 502 });
      return result.json;
    } catch (error) {
      if (config.readSignal?.aborted) throw failure(`PMB pricing read timed out at ${endpoint}.`);
      const transient = [408, 429, 500, 502, 503, 504].includes(error.status)
        || /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|ABORT_ERR/.test(error.code || "");
      if (attempt === 0 && transient) continue;
      throw failure(`PMB pricing read failed at ${endpoint}: ${error.status ? `HTTP ${error.status}` : error.code || error.name || "connection error"}.`, {
        code: error.code || "PMB_PRICING_CONNECTION_FAILED", status: error.status || 503,
      });
    }
  }
}

function currentTargets(rows) {
  const targets = new Map();
  for (const row of rows) {
    if (row.unused || !isPlu(row.plu) || !isPlu(row.tapNumber) || !isPlu(row.deviceId) || !isPlu(row.lineNum)) continue;
    const plu = Number(row.plu);
    const key = nameKey(row.product);
    if (!key || (targets.has(plu) && nameKey(targets.get(plu).name) !== key)) {
      throw failure("PMB tap configuration contains conflicting product identities.", { code: "PMB_PRICING_IDENTITY_CONFLICT" });
    }
    targets.set(plu, { plu, name: String(row.product).trim() });
  }
  if (!targets.size) throw failure("PMB tap configuration returned no verified physical taps.");
  return [...targets.values()];
}

export function validateCurrentPmbPriceProducts(products, targets) {
  if (!Array.isArray(products)) throw failure("PMB product prices are unavailable.");
  for (const target of targets) {
    const matches = products.filter((product) => Number(product?.plu) === target.plu);
    if (matches.length !== 1 || nameKey(matches[0].name) !== nameKey(target.name)) {
      throw failure(`PMB price identity could not be verified for ${target.name}.`, { code: "PMB_PRICING_IDENTITY_CONFLICT" });
    }
    const value = matches[0].price_per_unit;
    if (value === null || value === undefined || String(value).trim() === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0) {
      throw failure(`PMB returned an invalid price for ${target.name}.`, { code: "PMB_PRICING_PRICE_INVALID" });
    }
  }
  return products;
}

export function productPriceFromPmbEditForm(html, target) {
  const entries = parsePmbProductEditForm(html);
  const value = (key, required = true) => {
    const matches = entries.filter(([name]) => name === key);
    if (matches.length > 1 || (required && matches.length !== 1)) throw failure(`PMB price form did not contain one ${key} field.`);
    return matches[0]?.[1];
  };
  const plu = Number(value("fd_plu"));
  const name = value("fd_name");
  if (plu !== target.plu || nameKey(name) !== nameKey(target.name)) {
    throw failure(`PMB opened a different product while reading ${target.name}.`, { code: "PMB_PRICING_IDENTITY_CONFLICT" });
  }
  const cents = (key, required = true) => {
    const raw = value(key, required);
    if (raw === undefined && !required) return null;
    if (!/^\d+(?:\.\d{1,2})?$/.test(String(raw).trim())) throw failure(`PMB returned an invalid ${key} price for ${name}.`);
    const amount = Math.round(Number(raw) * 100);
    if (!Number.isSafeInteger(amount)) throw failure(`PMB returned an invalid price for ${name}.`);
    return amount;
  };
  return {
    plu, name, price_per_unit: cents("fd_price_per_unit"),
    price_per_unit_happyhour1: cents("fd_price_per_unit_hh1", false),
    price_per_unit_happyhour2: cents("fd_price_per_unit_hh2", false),
    volume_unit: value("fd_volume_unit"), product_type: Number(value("fd_product_type")),
    is_active: entries.some(([key]) => key === "fd_is_active") ? 1 : 0,
    is_in_use: entries.some(([key]) => key === "fd_is_in_use") ? 1 : 0,
    pricingSource: "pmb-management",
  };
}

async function collectPricing(config, state) {
  const bounded = limitedConfig(config, 60_000);
  // Reuse PMB's resilient Digest connection rather than opening another unauthenticated session.
  const tapConfigRows = parseTapConfigRows(await readPmbPricingManagementPage(limitedConfig(bounded, 12_000)));
  const targets = currentTargets(tapConfigRows);
  let products;
  let token = "";
  let source = "pmb-api";
  const sourceErrors = [];
  const tryPrimaryApi = Date.now() >= state.preferManagementUntil;
  if (tryPrimaryApi) {
    try {
      const auth = await readJson(bounded, "/api/authtoken", {
        username: config.username, password: config.password, id: config.clientId,
        name: config.clientName, type: "json-server-control", version: 1,
      });
      if (!auth.authtoken) throw failure("PMB did not provide a pricing API token.");
      token = String(auth.authtoken);
      const result = await readJson(bounded, "/api/productlist", { id: String(config.clientId) }, token);
      products = validateCurrentPmbPriceProducts(result.productlist, targets);
    } catch (error) {
      sourceErrors.push(error.message);
    }
  }
  if (!products) {
    source = "pmb-management";
    const management = limitedConfig(bounded, 25_000);
    products = [];
    for (const target of targets) {
      management.readSignal.throwIfAborted();
      const html = await readPmbPricingManagementPage(management, { plu: target.plu });
      products.push(productPriceFromPmbEditForm(html, target));
    }
    validateCurrentPmbPriceProducts(products, targets);
    // Start the recovery interval only after an actual primary-API attempt fails.
    // Refreshes using the fallback must not keep pushing the retry time forward.
    if (tryPrimaryApi) state.preferManagementUntil = Date.now() + 5 * 60_000;
  }
  let itemlist = [];
  let itemPricesAvailable = false;
  let itemPricesError = "PMB shot-price lookup is unavailable; tap product prices were read separately.";
  // Product-editor fallback does not imply that portion/shot prices were refreshed.
  if (token) {
    try {
      const result = await readJson(limitedConfig(bounded, 10_000), "/api/itemlist", { id: String(config.clientId) }, token);
      if (!Array.isArray(result.itemlist) || !result.itemlist.length) throw failure("PMB returned no shot-price rows.");
      itemlist = result.itemlist;
      itemPricesAvailable = true;
      itemPricesError = "";
    } catch (error) {
      itemPricesError = error.message;
    }
  }
  return { products, tapConfigRows, itemlist, itemPricesAvailable, itemPricesError, source, sourceErrors, updatedAt: new Date().toISOString() };
}

export async function readCurrentPmbPricing(config) {
  const key = connectionKey(config);
  let state = requests.get(key);
  if (!state) {
    state = { pending: null, preferManagementUntil: 0 };
    requests.set(key, state);
  }
  // Concurrent refreshes share a read. Completed reads are not cached, so post-save refreshes stay current.
  if (!state.pending) state.pending = collectPricing(config, state).finally(() => { state.pending = null; });
  return state.pending;
}

export async function readPmbPricingCapability(config, rows, schema) {
  const key = crypto.createHash("sha256").update(JSON.stringify([connectionKey(config), rows, schema])).digest("hex");
  let pending = capabilityRequests.get(key);
  if (!pending) {
    pending = verifyPmbPortionManagementReadOnly(limitedConfig(config, 10_000), rows, schema)
      .catch((error) => ({ ok: false, code: error.code || "PMB_PORTION_FORM_UNVERIFIED", message: error.message }))
      .finally(() => capabilityRequests.delete(key));
    capabilityRequests.set(key, pending);
  }
  // An optional edit-form probe must not hold up displaying already verified prices.
  let timer;
  try {
    return await Promise.race([pending, new Promise((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, code: "PMB_PORTION_CHECK_PENDING", message: "Current prices are loaded. Shot-price editing is waiting for PMB form verification." }), 2_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
