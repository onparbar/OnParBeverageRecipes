import crypto from "node:crypto";
import http from "node:http";
import { parsePmbJson } from "./pmb-json.mjs";

const REQUEST_TIMEOUT_MS = 15_000;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function getConfig(env = process.env) {
  const baseUrl = clean(env.PMB_API_BASE_URL).replace(/\/$/, "");
  const username = clean(env.PMB_API_USERNAME);
  const password = clean(env.PMB_API_PASSWORD);
  if (!baseUrl) throw Object.assign(new Error("Missing PMB_API_BASE_URL in .env.local"), { status: 500 });
  if (!username || !password) {
    throw Object.assign(new Error("Missing PMB_API_USERNAME or PMB_API_PASSWORD in .env.local"), { status: 500 });
  }
  return {
    baseUrl,
    username,
    password,
    clientId: Number(env.PMB_API_CLIENT_ID || "910423"),
    clientName: clean(env.PMB_API_CLIENT_NAME || "PourMyBeer API"),
  };
}

export async function postJson(config, path, body, token = "") {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const raw = await response.text();
  return { status: response.status, json: parsePmbJson(raw), raw };
}

export async function getAuthtoken(config) {
  const result = await postJson(config, "/api/authtoken", {
    username: config.username,
    password: config.password,
    id: config.clientId,
    name: config.clientName,
    type: "json-server-control",
    version: 1,
  });
  if (result.status !== 200 || !result.json?.authtoken) {
    throw Object.assign(new Error(`PMB authtoken failed (${result.status || 0})`), { status: 503 });
  }
  return String(result.json.authtoken);
}

export async function getProductList(config, token) {
  const result = await postJson(config, "/api/productlist", { id: String(config.clientId) }, token);
  if (result.status !== 200 || !Array.isArray(result.json?.productlist)) {
    throw Object.assign(new Error(`PMB productlist failed (${result.status || 0})`), { status: 503 });
  }
  return result.json.productlist;
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function parseDigestChallenge(header) {
  const digest = String(header || "").replace(/^Digest\s+/i, "");
  const parts = digest.match(/(?:[^,"]|"[^"]*")+/g) || [];
  return parts.reduce((result, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (key) result[key] = rest.join("=").replace(/^"|"$/g, "");
    return result;
  }, {});
}

function absorbCookies(headers, cookieJar) {
  const values = Array.isArray(headers?.["set-cookie"])
    ? headers["set-cookie"]
    : headers?.["set-cookie"] ? [headers["set-cookie"]] : [];
  values.forEach((value) => {
    const first = String(value).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) cookieJar.set(first.slice(0, index), first.slice(index + 1));
  });
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function digestAuthorization(config, method, path, challenge) {
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

function httpRequest(config, method, path, body, headers) {
  const url = new URL(config.baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port || 80,
      path,
      method,
      headers: { Accept: "text/html,*/*", "User-Agent": "OnParBeverageDashboard/1.0", ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        raw: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("PMB management request timed out.")));
    if (body?.length) request.write(body);
    request.end();
  });
}

export async function digestRequest(config, method, path, body, headers, cookieJar = new Map(), { beforeWrite } = {}) {
  const firstCookie = cookieHeader(cookieJar);
  if (beforeWrite) await beforeWrite();
  const first = await httpRequest(config, method, path, body, {
    ...headers,
    ...(firstCookie ? { Cookie: firstCookie } : {}),
  });
  absorbCookies(first.headers, cookieJar);
  if (first.status !== 401) return first;

  const challenge = parseDigestChallenge(first.headers?.["www-authenticate"]);
  if (!challenge.realm || !challenge.nonce) return first;
  const cookie = cookieHeader(cookieJar);
  if (beforeWrite) await beforeWrite();
  const result = await httpRequest(config, method, path, body, {
    ...headers,
    Authorization: digestAuthorization(config, method, path, challenge),
    ...(cookie ? { Cookie: cookie } : {}),
  });
  absorbCookies(result.headers, cookieJar);
  return result;
}

export function urlEncodedBody(entries) {
  const body = Buffer.from(new URLSearchParams(entries).toString());
  return {
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Content-Length": body.byteLength,
    },
  };
}

function multipartBody(entries) {
  const boundary = `------------------------${crypto.randomBytes(12).toString("hex")}`;
  const chunks = [];
  entries.forEach(([rawName, rawValue]) => {
    const name = String(rawName || "").replace(/[\r\n"]/g, "_");
    chunks.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${name}"`,
      "",
      String(rawValue ?? ""),
      "",
    ].join("\r\n")));
  });
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return {
    body,
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.byteLength },
  };
}

export async function openProductEditForm(config, plu) {
  const cookieJar = new Map();
  const request = urlEncodedBody([
    ["fd_edit_plu", String(plu)],
    ["submit_edit_product", "edit"],
  ]);
  const response = await digestRequest(config, "POST", "/pages/products", request.body, request.headers, cookieJar);
  if (response.status !== 200) {
    throw Object.assign(new Error(`PMB product edit form failed (${response.status || 0}).`), { status: 502 });
  }
  return { html: response.raw, cookieJar };
}

export async function saveProductEditForm(config, entries, cookieJar, { beforeWrite } = {}) {
  const request = multipartBody(entries);
  const response = await digestRequest(config, "POST", "/pages/products", request.body, request.headers, cookieJar, { beforeWrite });
  if (response.status !== 200) {
    throw Object.assign(new Error(`PMB product save failed (${response.status || 0}).`), { status: 502 });
  }
}

