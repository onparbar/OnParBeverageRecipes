import { NextResponse } from "next/server";
import crypto from "node:crypto";
import http from "node:http";
import sharp from "sharp";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { fetchRemoteBuffer } from "../../../lib/safe-remote-fetch.mjs";

export const runtime = "nodejs";

const PRODUCT_IMAGE_WIDTH = 676;
const PRODUCT_IMAGE_HEIGHT = 540;
const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const PRODUCT_IMAGE_SOURCE_MAX_BYTES = 15 * 1024 * 1024;
const SAFE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif", "image/apng"];

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

async function postJson(baseUrl, path, body, token = "") {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    const raw = await response.text();
    return {
      status: response.status,
      json: parseJsonLoose(raw),
      raw,
    };
  } catch (error) {
    return {
      status: 0,
      json: null,
      raw: error.message || "PMB request failed.",
    };
  }
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function parseDigestChallenge(header) {
  const digest = String(header || "").replace(/^Digest\s+/i, "");
  const parts = digest.match(/(?:[^,"]|"[^"]*")+/g) || [];
  return parts.reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return acc;
    acc[key] = rest.join("=").replace(/^"|"$/g, "");
    return acc;
  }, {});
}

function httpRequest(config, method, path, body = "", headers = {}) {
  const url = new URL(config.baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path,
        method,
        headers: {
          Accept: "text/html,*/*",
          "User-Agent": "curl/8.7.1",
          ...headers,
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode || 0,
            headers: response.headers,
            raw: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );

    request.on("error", reject);
    request.setTimeout(15000, () => request.destroy(new Error("PMB management UI request timed out.")));
    if (body) request.write(body);
    request.end();
  });
}

function buildUrlEncodedForm(fields) {
  const body = new URLSearchParams(fields).toString();
  return {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": Buffer.byteLength(body),
    },
  };
}

function quoteMultipartValue(value) {
  return String(value || "").replace(/[\r\n"]/g, "_");
}

function buildMultipartForm(fields, files = []) {
  const boundary = `------------------------${crypto.randomBytes(12).toString("hex")}`;
  const chunks = [];

  Object.entries(fields).forEach(([key, value]) => {
    chunks.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${quoteMultipartValue(key)}"`,
      "",
      String(value ?? ""),
      "",
    ].join("\r\n")));
  });

  files.forEach((file) => {
    if (!file?.buffer?.length) return;
    chunks.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${quoteMultipartValue(file.fieldName)}"; filename="${quoteMultipartValue(file.filename)}"`,
      `Content-Type: ${file.contentType || "application/octet-stream"}`,
      "",
      "",
    ].join("\r\n")));
    chunks.push(file.buffer);
    chunks.push(Buffer.from("\r\n"));
  });

  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);

  return {
    body,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.byteLength,
    },
  };
}

function absorbCookies(headers, cookieJar) {
  const setCookie = headers?.["set-cookie"];
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  values.forEach((value) => {
    const first = String(value).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) cookieJar.set(first.slice(0, index), first.slice(index + 1));
  });
}

function buildCookieHeader(cookieJar) {
  return Array.from(cookieJar.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
}

async function postDigestForm(config, path, fields, { multipart = false, cookieJar = new Map(), files = [] } = {}) {
  const { body, headers: baseHeaders } = multipart ? buildMultipartForm(fields, files) : buildUrlEncodedForm(fields);
  const firstCookie = buildCookieHeader(cookieJar);
  const first = await httpRequest(config, "POST", path, body, {
    ...baseHeaders,
    ...(firstCookie ? { Cookie: firstCookie } : {}),
  }).catch((error) => ({
    status: 0,
    headers: {},
    raw: error.message || "PMB management form request failed.",
  }));
  absorbCookies(first.headers, cookieJar);

  if (first.status !== 401) return first;

  const challenge = parseDigestChallenge(first.headers["www-authenticate"]);
  if (!challenge.realm || !challenge.nonce) {
    return first;
  }

  const qop = String(challenge.qop || "auth").split(",")[0].trim() || "auth";
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${config.username}:${challenge.realm}:${config.password}`);
  const ha2 = md5(`POST:${path}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  const cookie = Array.isArray(first.headers["set-cookie"])
    ? first.headers["set-cookie"].map((value) => value.split(";")[0]).join("; ")
    : buildCookieHeader(cookieJar);
  const authorization = [
    `Digest username="${config.username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${path}"`,
    "algorithm=MD5",
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
  ].join(", ");

  return httpRequest(config, "POST", path, body, {
    ...baseHeaders,
    Authorization: authorization,
    ...(cookie || buildCookieHeader(cookieJar) ? { Cookie: cookie || buildCookieHeader(cookieJar) } : {}),
  }).then((responseResult) => {
    absorbCookies(responseResult.headers, cookieJar);
    return responseResult;
  }).catch((error) => ({
    status: 0,
    headers: {},
    raw: error.message || "PMB management form request failed.",
  }));
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

  return {
    token: String(auth.json.authtoken),
    uuid: clean(auth.json.uuid),
  };
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getSafeImageBasename(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "product";
}

async function readImageSourceBuffer(imageUrl) {
  const source = String(imageUrl || "").trim();
  if (!source) return null;

  const dataUrlMatch = source.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([\s\S]+)$/i);
  if (dataUrlMatch) {
    const buffer = Buffer.from(dataUrlMatch[2].replace(/\s+/g, ""), "base64");
    if (!buffer.length) throw new Error("PMB product image was empty.");
    if (buffer.byteLength > PRODUCT_IMAGE_SOURCE_MAX_BYTES) {
      throw new Error("PMB product image source is too large. Use an image under 15MB before cropping.");
    }
    return buffer;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(source);
  } catch {
    throw new Error("PMB product image must be a dashboard image preview or a direct image URL.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("PMB product image must use http or https.");
  }

  const response = await fetchRemoteBuffer(parsedUrl, {
    acceptedContentTypes: SAFE_IMAGE_TYPES,
    headers: {
      "User-Agent": "OnParBeverageDashboard/1.0",
      Accept: "image/avif,image/webp,image/apng,image/png,image/jpeg,image/gif",
    },
    maxBytes: PRODUCT_IMAGE_SOURCE_MAX_BYTES,
    timeoutMs: 10_000,
  });

  if (!response.ok) {
    throw new Error(`PMB product image download failed (${response.status}).`);
  }

  const buffer = response.buffer;
  if (!buffer.length) throw new Error("PMB product image was empty.");
  if (buffer.byteLength > PRODUCT_IMAGE_SOURCE_MAX_BYTES) {
    throw new Error("PMB product image source is too large. Use an image under 15MB before cropping.");
  }

  return buffer;
}

async function buildPmbImageFile(imageUrl, productName) {
  const sourceBuffer = await readImageSourceBuffer(imageUrl);
  if (!sourceBuffer) return null;

  for (const quality of [88, 82, 76, 70, 64, 58, 52]) {
    const output = await sharp(sourceBuffer, { animated: false, limitInputPixels: 40_000_000 })
      .rotate()
      .resize(PRODUCT_IMAGE_WIDTH, PRODUCT_IMAGE_HEIGHT, { fit: "cover", position: "center" })
      .withMetadata({ density: 72 })
      .jpeg({ quality, progressive: true })
      .toBuffer();

    if (output.byteLength <= PRODUCT_IMAGE_MAX_BYTES) {
      return {
        fieldName: "file",
        filename: `${getSafeImageBasename(productName)}.jpg`,
        contentType: "image/jpeg",
        buffer: output,
      };
    }
  }

  throw new Error("PMB product image could not be compressed under 5MB.");
}

function htmlNote(text) {
  const safe = clean(text || "Added from On Par Beverage Dashboard")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p><span style="font-size: 24pt; font-family: 'Comic Sans MS', sans-serif;">${safe}</span></p>`;
}

function buildFallbackDescription(input, isBeer) {
  const name = clean(input.name) || (isBeer ? "New Beer" : "New Cocktail");
  const maker = clean(input.brewery);
  const style = clean(input.style) || (isBeer ? "Beer" : "Cocktail");
  if (isBeer) {
    const normalized = name.toLowerCase();
    const makerPhrase = maker ? ` from ${maker}` : "";
    if (normalized.includes("garage beer")) {
      return `${name} is a crisp, laid-back classic lager${makerPhrase}, built for easy sipping with light malt character, a clean body, and a refreshing finish that feels right at home on the beer wall.`;
    }
    if (normalized.includes("ipa")) {
      return `${name} is a hop-forward ${style}${makerPhrase}, pouring with bright aromatics, balanced bitterness, and a clean finish for guests who want something bold without feeling heavy.`;
    }
    if (normalized.includes("stout") || normalized.includes("porter")) {
      return `${name} is a smooth ${style}${makerPhrase}, bringing roasty depth, a rounded body, and a steady finish that gives the tap wall a richer, darker option.`;
    }
    if (normalized.includes("cider")) {
      return `${name} is a bright ${style}${makerPhrase}, pouring crisp and fruit-forward with a clean finish for a refreshing alternative to beer.`;
    }
    if (normalized.includes("seltzer")) {
      return `${name} is a light, sparkling ${style}${makerPhrase}, made for a clean pour with a crisp finish and an easy-drinking feel.`;
    }
    return `${name} is a refreshing ${style}${makerPhrase}, selected for a balanced draft pour, approachable flavor, and clean finish that fits naturally into the beer wall lineup.`;
  }
  return `${name} is a balanced draft cocktail designed for a smooth pour, bright flavor, and a clean finish from the tap wall.`;
}

async function getNextPlu(config, token) {
  const products = await getProductList(config, token);
  const productList = products.productlist || [];
  const existingPlus = productList
    .map((product) => Number(product.plu || 0))
    .filter((plu) => Number.isFinite(plu) && plu > 0);

  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = Math.floor(10000 + Math.random() * 89999);
    if (!existingPlus.includes(candidate)) return candidate;
  }

  return Math.max(10000, ...existingPlus) + 1;
}

async function getProductList(config, token) {
  const products = await postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token.token);
  if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
    throw new Error(`PMB productlist failed (${products.status})`);
  }
  return products.json;
}

function normalizeName(value) {
  return clean(value).toLowerCase();
}

function normalizeCloneProductName(value) {
  return normalizeName(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function getCloneSourceProduct(productList, sourceName) {
  const expected = normalizeCloneProductName(sourceName);
  const matches = (Array.isArray(productList) ? productList : [])
    .filter((product) => normalizeCloneProductName(product?.name) === expected);
  if (matches.length !== 1) {
    throw new Error(`PMB must contain exactly one ${clean(sourceName)} product before it can be copied.`);
  }
  return matches[0];
}

function getCloneImageUrl(product, baseUrl) {
  const candidates = [
    product?.image_url,
    product?.imageUrl,
    product?.product_image_url,
    product?.productImageUrl,
    product?.product_image,
    product?.productImage,
    product?.image_path,
    product?.imagePath,
    product?.picture_url,
    product?.picture,
    product?.photo_url,
    product?.photo,
    product?.image,
  ];
  for (const candidate of candidates) {
    const raw = typeof candidate === "object"
      ? candidate?.url || candidate?.src || candidate?.path
      : candidate;
    const value = clean(raw);
    if (!value) continue;
    if (/^data:image\//i.test(value)) return value;
    try {
      return new URL(value, baseUrl).toString();
    } catch {
      // Try the next known PMB image field.
    }
  }
  return "";
}

function buildClonedProduct(input, plu, sourceProduct) {
  const requestedProduct = buildProduct(input, plu);
  return {
    ...requestedProduct,
    ...sourceProduct,
    plu,
    name: requestedProduct.name,
    active: 1,
    inuse: 1,
  };
}

function buildProduct(input, plu) {
  const productKind = clean(input.productKind || input.kind || "cocktail").toLowerCase();
  const isBeer = productKind === "beer";
  const isLiquor = productKind === "liquor";
  const name = clean(input.name);
  const pricePerOz = toNumber(input.pricePerOz);
  const servingOz = toNumber(input.servingOz) || (isBeer ? 16 : isLiquor ? 1.5 : 5.8);
  const abvPercent = toNumber(input.abvPercent);
  const ibu = input.ibu === "" || input.ibu == null ? 0 : Math.round(toNumber(input.ibu));

  if (!name) throw new Error("Product name is required.");
  if (pricePerOz <= 0 || pricePerOz > 100) {
    throw new Error("Charge per oz must be greater than $0 and no more than $100.");
  }
  if (servingOz <= 0 || servingOz > 128) {
    throw new Error("Serving size must be greater than 0 and no more than 128 oz.");
  }
  if ((isBeer || isLiquor) && (abvPercent <= 0 || abvPercent > 100)) {
    throw new Error("Beer and liquor ABV must be greater than 0 and no more than 100%.");
  }
  if (ibu < 0 || ibu > 200) {
    throw new Error("IBU must be between 0 and 200.");
  }

  return {
    plu,
    is_active: input.isActive === false ? 0 : 1,
    is_in_use: input.isInUse === false ? 0 : 1,
    is_advert: 0,
    volume_unit: "oz",
    volume_unit_dp: 1,
    volume_base_unit_divider: 1,
    price_per_unit: Math.round(pricePerOz * 100),
    price_per_unit_happyhour1: Math.round(toNumber(input.happyHour1PerOz || pricePerOz) * 100),
    price_per_unit_happyhour2: Math.round(toNumber(input.happyHour2PerOz || pricePerOz) * 100),
    price_per_unit_happyhour1_percent: 0,
    price_per_unit_happyhour2_percent: 0,
    units_per_serving: Math.round(servingOz * 100),
    name,
    tasting_notes: htmlNote(input.notes || buildFallbackDescription(input, isBeer)),
    brewery: clean(input.brewery) || (isBeer ? "" : "On Par Entertainment"),
    style: clean(input.style) || (isBeer ? "Beer" : isLiquor ? "Liquor" : "Cocktail"),
    abv: Math.round(abvPercent * 100),
    ibu,
    product_type: isBeer ? 1 : 3,
  };
}

function decimalDollarsFromCents(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function decimalOuncesFromHundredths(value) {
  const ounces = Number(value || 0) / 100;
  if (!Number.isFinite(ounces)) return "0";
  const text = ounces.toFixed(2).replace(/(\.\d*?)0+$/g, "$1").replace(/\.$/g, "");
  return text || "0";
}

function buildManagementProductForm(product, imageFile = null, { mode = "add" } = {}) {
  const fields = {
    fd_plu: String(product.plu),
    fd_name: product.name,
    fd_brewery: product.brewery,
    fd_style: product.style,
    fd_tasting_notes: product.tasting_notes,
    fd_volume_unit: product.volume_unit,
    fd_volume_unit_dp: String(product.volume_unit_dp),
    fd_volume_base_unit_divider: String(product.volume_base_unit_divider),
    fd_price_per_unit: decimalDollarsFromCents(product.price_per_unit),
    fd_vat_rate: "0",
    fd_price_per_unit_hh1: decimalDollarsFromCents(product.price_per_unit_happyhour1 || product.price_per_unit),
    fd_price_per_unit_hh1_percent: String(product.price_per_unit_happyhour1_percent || 0),
    fd_price_per_unit_hh2: decimalDollarsFromCents(product.price_per_unit_happyhour2 || product.price_per_unit),
    fd_price_per_unit_hh2_percent: String(product.price_per_unit_happyhour2_percent || 0),
    fd_price_per_unit_growler: "0",
    fd_units_per_serving: decimalOuncesFromHundredths(product.units_per_serving),
    fd_product_type: String(product.product_type),
    fd_abv_used: "on",
    fd_abv: (Number(product.abv || 0) / 100).toFixed(1),
    fd_ibu_used: "on",
    fd_ibu: String(Math.max(0, Number(product.ibu || 0))),
    fd_is_active: "on",
    fd_printable_as_qr: "on",
    chosenPortions: "Test",
  };

  if (mode === "edit") {
    fields.submit_saveedit_product = "save";
  } else {
    fields.submit_saveadd_product = "save new";
    if (!imageFile) fields.fd_delete_image = "delete_image";
  }
  return fields;
}

async function createProductViaManagementUi(config, token, product, imageFile = null, { matchByPluOnly = false } = {}) {
  const before = await getProductList(config, token);
  const existing = (before.productlist || []).find((item) => (
    Number(item.plu) === Number(product.plu) ||
    (!matchByPluOnly && normalizeName(item.name) === normalizeName(product.name))
  ));
  if (existing) {
    return updateProductViaManagementUi(config, token, { ...product, plu: Number(existing.plu || product.plu) }, imageFile, existing);
  }

  const cookieJar = new Map();
  const openForm = await postDigestForm(config, "/pages/products", { submit_add_product: "add product" }, { cookieJar });
  if (openForm.status !== 200 || !String(openForm.raw || "").includes("submit_saveadd_product")) {
    return {
      ok: false,
      path: "/pages/products",
      status: openForm.status,
      response: clean(openForm.raw).slice(0, 500) || "TTG did not return the add-product form.",
    };
  }

  const result = await postDigestForm(config, "/pages/products", buildManagementProductForm(product, imageFile), {
    multipart: true,
    cookieJar,
    files: imageFile ? [imageFile] : [],
  });
  const responseText = clean(result.raw).slice(0, 500);
  if (result.status !== 200) {
    return {
      ok: false,
      path: "/pages/products",
      status: result.status,
      response: responseText,
    };
  }

  const after = await getProductList(config, token);
  const saved = (after.productlist || []).find((item) => Number(item.plu) === Number(product.plu));
  if (!saved) {
    return {
      ok: false,
      path: "/pages/products",
      status: result.status,
      response: responseText || "TTG returned the product page, but the new PLU was not found afterward.",
    };
  }

  return {
    ok: true,
    product: saved,
    path: "/pages/products",
    response: "Saved via TTG Product Database form.",
    imageUploaded: Boolean(imageFile),
  };
}

async function updateProductViaManagementUi(config, token, product, imageFile = null, existing = null) {
  const cookieJar = new Map();
  const openForm = await postDigestForm(config, "/pages/products", {
    fd_edit_plu: String(product.plu),
    submit_edit_product: "edit",
  }, { cookieJar });

  if (openForm.status !== 200 || !String(openForm.raw || "").includes("submit_saveedit_product")) {
    return {
      ok: false,
      path: "/pages/products",
      status: openForm.status,
      response: clean(openForm.raw).slice(0, 500) || "TTG did not return the edit-product form.",
    };
  }

  const result = await postDigestForm(config, "/pages/products", buildManagementProductForm(product, imageFile, { mode: "edit" }), {
    multipart: true,
    cookieJar,
    files: imageFile ? [imageFile] : [],
  });
  const responseText = clean(result.raw).slice(0, 500);
  if (result.status !== 200) {
    return {
      ok: false,
      path: "/pages/products",
      status: result.status,
      response: responseText,
    };
  }

  const after = await getProductList(config, token);
  const saved = (after.productlist || []).find((item) => Number(item.plu) === Number(product.plu));
  if (!saved) {
    return {
      ok: false,
      path: "/pages/products",
      status: result.status,
      response: responseText || "TTG returned the product page, but the edited PLU was not found afterward.",
    };
  }

  return {
    ok: true,
    product: saved,
    path: "/pages/products",
    response: `${saved.name || existing?.name || product.name} was updated via TTG Product Database form.`,
    updatedExisting: true,
    imageUploaded: Boolean(imageFile),
  };
}

async function sendConfigUpdate(config, token) {
  for (const path of ["/api/configupdate", "/m2m/api/configupdate"]) {
    const result = await postJson(config.baseUrl, path, {
      id: String(config.clientId),
      authtoken: token.token,
      ...(token.uuid ? { uuid: token.uuid } : {}),
    }, token.token);
    if (result.status === 200) return path;
  }
  return "";
}

async function trySendConfigUpdate(config, token) {
  try {
    return await sendConfigUpdate(config, token);
  } catch {
    return "";
  }
}

export async function GET() {
  try {
    const config = getConfig();
    const token = await getAuthtoken(config);
    const products = await getProductList(config, token);
    const productCount = Array.isArray(products.productlist) ? products.productlist.length : 0;
    return NextResponse.json(
      {
        ok: true,
        message: `Pour My Beer is connected on the work network (${productCount} products available).`,
        productCount,
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    const message = error.message || "Could not connect to Pour My Beer.";
    const status = /^Missing PMB_API_BASE_URL/.test(message) ? 500 : 503;
    return NextResponse.json(
      {
        ok: false,
        error: message,
        code: "PMB_CONNECTION_UNAVAILABLE",
      },
      {
        status,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

export async function POST(request) {
  const attempts = [];

  try {
    await requireDashboardRequestRole(request, { owner: true });
    const input = await request.json();
    const config = getConfig();
    const token = await getAuthtoken(config);
    const plu = toNumber(input.plu) || await getNextPlu(config, token);
    const cloneSourceName = clean(input.cloneSourceName);
    const sourceProduct = cloneSourceName
      ? getCloneSourceProduct((await getProductList(config, token)).productlist, cloneSourceName)
      : null;
    const product = sourceProduct
      ? buildClonedProduct(input, plu, sourceProduct)
      : buildProduct(input, plu);
    const cloneImageUrl = sourceProduct ? getCloneImageUrl(sourceProduct, config.baseUrl) : "";
    const imageFile = await buildPmbImageFile(input.imageUrl || cloneImageUrl, product.name);
    if (sourceProduct && !imageFile) {
      throw new Error(`PMB did not provide the ${cloneSourceName} image, so the duplicate was not created.`);
    }
    const uiWrite = await createProductViaManagementUi(config, token, product, imageFile, {
      matchByPluOnly: input.matchByPluOnly === true,
    });

    attempts.push({
      path: uiWrite.path,
      status: uiWrite.status || (uiWrite.ok ? 200 : 0),
      response: uiWrite.response,
    });

    if (uiWrite.ok) {
      const shouldSendConfigUpdate = input.sendConfigUpdate === true;
      const configUpdatePath = shouldSendConfigUpdate ? await trySendConfigUpdate(config, token) : "";
      return NextResponse.json({
        ok: true,
        message: uiWrite.updatedExisting
          ? `${uiWrite.product.name} was updated in Pour My Beer.`
          : `${uiWrite.product.name} was sent to Pour My Beer.`,
        product: uiWrite.product,
        imageUploaded: Boolean(imageFile),
        path: uiWrite.path,
        configUpdatePath,
        configUpdateSent: Boolean(configUpdatePath),
        updatedExisting: Boolean(uiWrite.updatedExisting),
      });
    }

    return NextResponse.json(
      {
        error: "TTG Product Database form did not save the product. The dashboard verified PMB afterward and the new PLU was not present.",
        product,
        attempts,
      },
      { status: 502 },
    );
  } catch (error) {
    const message = error.message || "Could not send product to Pour My Beer.";
    const status = error instanceof SyntaxError || /required|must be|invalid/i.test(message) ? 400 : 502;
    return NextResponse.json(
      {
        error: message,
        attempts,
      },
      { status },
    );
  }
}
