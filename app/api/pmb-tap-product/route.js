import { NextResponse } from "next/server";
import crypto from "node:crypto";
import http from "node:http";
import { POST as savePmbProduct } from "../pmb-products/route.js";

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

function buildDigestAuthorization(config, method, path, challenge) {
  const qop = String(challenge.qop || "auth").split(",")[0].trim() || "auth";
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${config.username}:${challenge.realm}:${config.password}`);
  const ha2 = md5(`${method}:${path}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);

  return [
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
}

async function getDigestPage(config, path, { cookieJar = new Map() } = {}) {
  const firstCookie = buildCookieHeader(cookieJar);
  const first = await httpRequest(config, "GET", path, "", {
    ...(firstCookie ? { Cookie: firstCookie } : {}),
  }).catch((error) => ({
    status: 0,
    headers: {},
    raw: error.message || "PMB management page request failed.",
  }));
  absorbCookies(first.headers, cookieJar);

  if (first.status !== 401) return first;

  const challenge = parseDigestChallenge(first.headers["www-authenticate"]);
  if (!challenge.realm || !challenge.nonce) return first;

  const cookie = buildCookieHeader(cookieJar);
  const authorization = buildDigestAuthorization(config, "GET", path, challenge);
  return httpRequest(config, "GET", path, "", {
    Authorization: authorization,
    ...(cookie ? { Cookie: cookie } : {}),
  }).then((responseResult) => {
    absorbCookies(responseResult.headers, cookieJar);
    return responseResult;
  }).catch((error) => ({
    status: 0,
    headers: {},
    raw: error.message || "PMB management page request failed.",
  }));
}

async function postDigestForm(config, path, fields, { cookieJar = new Map() } = {}) {
  const { body, headers: baseHeaders } = buildUrlEncodedForm(fields);
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
  if (!challenge.realm || !challenge.nonce) return first;

  const cookie = buildCookieHeader(cookieJar);
  const authorization = buildDigestAuthorization(config, "POST", path, challenge);
  return httpRequest(config, "POST", path, body, {
    ...baseHeaders,
    Authorization: authorization,
    ...(cookie ? { Cookie: cookie } : {}),
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

async function getProductList(config, token) {
  const products = await postJson(config.baseUrl, "/api/productlist", { id: String(config.clientId) }, token);
  if (products.status !== 200 || !Array.isArray(products.json?.productlist)) {
    throw new Error(`PMB productlist failed (${products.status})`);
  }
  return products.json.productlist;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function toNumber(value) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[$,%]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function decodeHtml(value) {
  return clean(String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " "));
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

function normalizeName(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/\s+\d+\s*$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseTapConfigRows(html) {
  const rows = [];
  const rowPattern = /<tr id="dev(\d+)(?:_r(\d+))?">([\s\S]*?)(?=<tr id="dev|<\/tbody>)/g;
  let match;

  while ((match = rowPattern.exec(html))) {
    const deviceId = Number(match[1] || 0);
    const body = match[3] || "";
    const pluCell = body.match(/<td class="plunum">([\s\S]*?)<\/td>/);
    if (!deviceId || !pluCell) continue;

    const pluText = stripHtml(pluCell[1]);
    const lineNum = Number(pluText.match(/^(\d+):/)?.[1] || match[2] || 0);
    const plu = Number(pluText.match(/PLU#(\d+)/)?.[1] || 0);
    const product = clean(stripHtml(pluText.replace(/^\d+:\s*/, "").replace(/^PLU#\d+\s*/, "")));
    const lineName = decodeHtml(body.match(/<input type="text" name="fd_line_name"[^>]*value="([^"]*)"/)?.[1] || "");
    const tapNumber = Number(lineName || 0) || null;

    rows.push({
      tapNumber,
      deviceId,
      lineNum,
      plu: plu || null,
      product,
      unused: /unused/i.test(pluText),
    });
  }

  return rows;
}

async function getTapConfigRows(config) {
  const cookieJar = new Map();
  const page = await getDigestPage(config, "/pages/tapconfig", { cookieJar });
  if (page.status !== 200) {
    throw new Error(`PMB tapconfig page failed (${page.status || 0}).`);
  }
  const rows = parseTapConfigRows(page.raw);
  if (!rows.length) throw new Error("PMB tapconfig did not include any tap rows.");
  return rows;
}

function resolveTapSlot(rows, input) {
  const tapNumber = toNumber(input.tapNumber || input.tap?.tapNumber);
  const currentPlu = toNumber(input.currentPlu || input.tap?.plu);
  const currentName = clean(input.currentBrand || input.tap?.brand);

  let slot = tapNumber ? rows.find((row) => row.tapNumber === tapNumber) : null;
  if (!slot && currentPlu) slot = rows.find((row) => row.plu === currentPlu);
  if (!slot && currentName) {
    const normalized = normalizeName(currentName);
    slot = rows.find((row) => normalizeName(row.product) === normalized);
  }

  if (!slot) throw new Error("PMB could not find that tap in Client Configuration.");
  if (!slot.plu || slot.unused) throw new Error(`Tap ${slot.tapNumber || input.tapNumber || ""} is unused in PMB and has no product PLU to update.`);
  return slot;
}

function findTargetProduct(products, target) {
  const targetPlu = toNumber(target.plu || target.targetPlu);
  if (targetPlu) {
    const byPlu = products.find((product) => Number(product.plu || 0) === targetPlu);
    if (byPlu) return byPlu;
  }

  const targetName = normalizeName(target.name || target.productName);
  if (!targetName) return null;

  return products.find((product) => normalizeName(product.name) === targetName)
    || products.find((product) => normalizeName(product.name).includes(targetName) || targetName.includes(normalizeName(product.name)));
}

function getProductSuffix(value) {
  return clean(value).match(/\s(\d+)\s*$/)?.[1] || "";
}

function getAssignedTapProductName(targetName, currentName, { keepExactName = false } = {}) {
  const name = clean(targetName);
  if (!name) return "";
  if (keepExactName || getProductSuffix(name)) return name;

  const suffix = getProductSuffix(currentName);
  return suffix ? `${name} ${suffix}` : name;
}

function inferProductKind(target, sourceProduct) {
  const raw = clean(target.productKind || target.kind).toLowerCase();
  if (raw === "beer") return "beer";
  if (raw === "recipe" || raw === "cocktail") return "cocktail";
  return Number(sourceProduct?.product_type || 0) === 1 ? "beer" : "cocktail";
}

function buildTapProductPayload(input, slot, sourceProduct) {
  const target = input.target || {};
  const productKind = inferProductKind(target, sourceProduct);
  const sourceServingOz = Number(sourceProduct?.units_per_serving || 0) / 100;
  const sourcePricePerOz = Number(sourceProduct?.price_per_unit || 0) / 100;
  const sourceAbvPercent = Number(sourceProduct?.abv || 0) / 100;
  const assignedName = getAssignedTapProductName(
    target.name || target.productName || sourceProduct?.name,
    slot.product,
    { keepExactName: target.keepExactName === true },
  );

  if (!assignedName) throw new Error("Replacement product name is required.");

  const pricePerOz = toNumber(target.pricePerOz || target.chargePerOz) || sourcePricePerOz;
  if (!pricePerOz) throw new Error(`${assignedName} needs a PMB price before it can replace a tap.`);

  const notes = clean(target.description || target.notes) || stripHtml(sourceProduct?.tasting_notes);

  return {
    productKind,
    plu: slot.plu,
    name: assignedName,
    pricePerOz,
    servingOz: toNumber(target.servingOz || target.pourOz) || sourceServingOz || (productKind === "beer" ? 16 : 5.8),
    brewery: clean(target.brewery || sourceProduct?.brewery) || (productKind === "beer" ? "" : "On Par Entertainment"),
    style: clean(target.style || sourceProduct?.style) || (productKind === "beer" ? "Beer" : "Draft Cocktail"),
    abvPercent: toNumber(target.abvPercent) || sourceAbvPercent,
    ibu: target.ibu === "" || target.ibu == null ? Number(sourceProduct?.ibu || 0) : toNumber(target.ibu),
    kegOz: toNumber(target.kegOz),
    kegCost: toNumber(target.kegCost || target.batchCost),
    targetMargin: toNumber(target.targetMargin),
    notes,
    imageUrl: clean(target.imageUrl),
    matchByPluOnly: true,
    sendConfigUpdate: false,
  };
}

async function saveProductOnTapPlu(productPayload) {
  const response = await savePmbProduct(new Request("http://localhost/api/pmb-products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(productPayload),
  }));

  let result = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    const error = new Error(result?.error || `PMB product save failed (${response.status}).`);
    error.details = result;
    throw error;
  }

  return result;
}

async function sendTargetedConfigUpdate(config, deviceId) {
  const result = await postDigestForm(config, "/pages/tapconfig", {
    fd_device_id: String(deviceId),
    fd_do_sendconfigupdate: "config update",
  });

  if (result.status !== 200) {
    const error = new Error(`PMB targeted config update failed (${result.status || 0}).`);
    error.response = clean(stripHtml(result.raw)).slice(0, 500);
    throw error;
  }

  return {
    path: "/pages/tapconfig",
    status: result.status,
  };
}

export async function POST(request) {
  try {
    const input = await request.json();
    const config = getConfig();
    const [rows, token] = await Promise.all([
      getTapConfigRows(config),
      getAuthtoken(config),
    ]);
    const products = await getProductList(config, token);
    const slot = resolveTapSlot(rows, input);
    const sourceProduct = findTargetProduct(products, input.target || {});
    const productPayload = buildTapProductPayload(input, slot, sourceProduct);

    if (input.dryRun === true) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        slot,
        product: {
          plu: productPayload.plu,
          name: productPayload.name,
          productKind: productPayload.productKind,
          pricePerOz: productPayload.pricePerOz,
        },
      });
    }

    const productResult = await saveProductOnTapPlu(productPayload);
    const configUpdate = input.sendConfigUpdate === false
      ? null
      : await sendTargetedConfigUpdate(config, slot.deviceId);

    return NextResponse.json({
      ok: true,
      message: `${productPayload.name} was pushed to PMB on tap ${slot.tapNumber || input.tapNumber}.`,
      slot,
      product: productResult.product || {
        plu: productPayload.plu,
        name: productPayload.name,
      },
      imageUploaded: Boolean(productResult.imageUploaded),
      configUpdateSent: Boolean(configUpdate),
      configUpdatePath: configUpdate?.path || "",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error.message || "Could not change the PMB tap product.",
        details: error.details || null,
        response: error.response || "",
      },
      { status: /required|choose|missing|unused|price/i.test(error.message || "") ? 400 : 502 },
    );
  }
}
